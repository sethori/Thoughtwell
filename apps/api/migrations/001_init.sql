-- 001_init: phase 1 schema.
-- Runs as the owner role. The API connects as notes_app, which is not the
-- owner, so row-level security applies to every query it makes.

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE unit_type AS ENUM ('org', 'directorate', 'division', 'branch', 'section', 'project');
CREATE TYPE role_name AS ENUM ('viewer', 'contributor', 'editor', 'approver', 'admin');
CREATE TYPE user_kind AS ENUM ('person', 'agent');
CREATE TYPE principal_type AS ENUM ('user', 'group');
CREATE TYPE resource_type AS ENUM ('unit', 'folder', 'page');

-- The current request's organization. Empty or unset means no rows visible.
CREATE FUNCTION app_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------- tenancy

CREATE TABLE orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  -- branding { name, brandColor, logoAssetId }, uploads policy, toggles
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES org_units(id) ON DELETE RESTRICT,
  type        unit_type NOT NULL,
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  path        ltree NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, path),
  CHECK ((type = 'org') = (parent_id IS NULL))
);
CREATE INDEX org_units_path_gist ON org_units USING gist (path);
CREATE INDEX org_units_parent ON org_units (parent_id);
-- One root per organization.
CREATE UNIQUE INDEX org_units_one_root ON org_units (org_id) WHERE parent_id IS NULL;

-- A child must be exactly one level below its parent.
CREATE FUNCTION org_units_check_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_type unit_type;
  levels unit_type[] := enum_range(NULL::unit_type);
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT type INTO parent_type FROM org_units WHERE id = NEW.parent_id AND org_id = NEW.org_id;
  IF parent_type IS NULL THEN
    RAISE EXCEPTION 'parent unit not found in this organization' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF array_position(levels, NEW.type) <> array_position(levels, parent_type) + 1 THEN
    RAISE EXCEPTION 'a % cannot sit under a %', NEW.type, parent_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER org_units_level BEFORE INSERT OR UPDATE OF parent_id, type ON org_units
  FOR EACH ROW EXECUTE FUNCTION org_units_check_level();

-- ---------------------------------------------------------------- people

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  username       citext NOT NULL UNIQUE,
  display_name   text NOT NULL,
  email          citext,
  title          text,
  phone          text,
  kind           user_kind NOT NULL DEFAULT 'person',
  -- The member relationship: where this person sits in the org chart.
  home_unit_id   uuid REFERENCES org_units(id) ON DELETE SET NULL,
  is_org_admin   boolean NOT NULL DEFAULT false,
  -- Admin toggle: may approve own changes in one-person folders (phase 3).
  can_self_approve boolean NOT NULL DEFAULT false,
  password_hash  text,
  preferences    jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_id    text,
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_org ON users (org_id);
CREATE INDEX users_home_unit ON users (home_unit_id);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  text
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL REFERENCES org_units(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  source      text NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'directory')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, name)
);

CREATE TABLE group_members (
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members (user_id);

-- ---------------------------------------------------------------- content

CREATE TABLE folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL REFERENCES org_units(id) ON DELETE RESTRICT,
  parent_id   uuid REFERENCES folders(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  path        ltree NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, path)
);
CREATE INDEX folders_path_gist ON folders USING gist (path);
CREATE INDEX folders_unit ON folders (unit_id);

CREATE TABLE pages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  folder_id             uuid NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  title                 text NOT NULL DEFAULT 'Untitled',
  -- Phase 1 stores the draft as ProseMirror JSON. Phase 2 adds the Yjs
  -- document state beside it for live co-editing.
  draft_content         jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  draft_state           bytea,
  draft_rev             integer NOT NULL DEFAULT 0,
  draft_updated_at      timestamptz NOT NULL DEFAULT now(),
  draft_updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  published_version_id  uuid,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);
CREATE INDEX pages_folder ON pages (folder_id);
CREATE INDEX pages_recent ON pages (org_id, draft_updated_at DESC);

CREATE TABLE page_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  page_id            uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  number             integer NOT NULL,
  title              text NOT NULL,
  content            jsonb NOT NULL,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  review_request_id  uuid,
  archived_at        timestamptz,
  UNIQUE (page_id, number)
);
ALTER TABLE pages ADD CONSTRAINT pages_published_fk
  FOREIGN KEY (published_version_id) REFERENCES page_versions(id) ON DELETE SET NULL;

-- Published versions are immutable: only archiving is allowed.
CREATE FUNCTION page_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.number IS DISTINCT FROM OLD.number OR NEW.page_id IS DISTINCT FROM OLD.page_id THEN
    RAISE EXCEPTION 'published versions cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER page_versions_no_edit BEFORE UPDATE ON page_versions
  FOR EACH ROW EXECUTE FUNCTION page_versions_immutable();

CREATE TABLE assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  page_id      uuid REFERENCES pages(id) ON DELETE SET NULL,
  storage_key  text NOT NULL,
  filename     text NOT NULL,
  mime         text NOT NULL,
  size_bytes   bigint NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- access

CREATE TABLE grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  principal_type  principal_type NOT NULL,
  principal_id    uuid NOT NULL,
  resource_type   resource_type NOT NULL,
  resource_id     uuid NOT NULL,
  role            role_name NOT NULL,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_type, principal_id, resource_type, resource_id)
);
CREATE INDEX grants_principal ON grants (principal_type, principal_id);
CREATE INDEX grants_resource ON grants (resource_type, resource_id);

-- Settings resolve by walking up the tree: folder, parent folders, unit,
-- parent units, org. Nearest wins.
CREATE TABLE workflow_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  scope_type  text NOT NULL CHECK (scope_type IN ('unit', 'folder')),
  scope_id    uuid NOT NULL,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  UNIQUE (scope_type, scope_id, key)
);

-- ---------------------------------------------------------------- review (phase 3)
-- Created now so phase 3 needs no migration of existing data.

CREATE TABLE review_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  page_id          uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  round            integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'sent_back', 'approved', 'withdrawn')),
  submitted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  base_version_id  uuid REFERENCES page_versions(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);
ALTER TABLE page_versions ADD CONSTRAINT page_versions_review_fk
  FOREIGN KEY (review_request_id) REFERENCES review_requests(id) ON DELETE SET NULL;

CREATE TABLE changes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  page_id            uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  author_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  kind               text NOT NULL,
  anchor             jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_change_id   uuid REFERENCES changes(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_review', 'needs_work', 'accepted', 'rejected', 'superseded')),
  review_request_id  uuid REFERENCES review_requests(id) ON DELETE SET NULL,
  decided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX changes_page ON changes (page_id, status);

CREATE TABLE review_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  review_request_id  uuid NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
  change_id          uuid REFERENCES changes(id) ON DELETE CASCADE,
  author_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notifications

CREATE TABLE watches (
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type  text NOT NULL CHECK (scope_type IN ('unit', 'folder', 'page')),
  scope_id    uuid NOT NULL,
  events      text[] NOT NULL DEFAULT ARRAY['published'],
  PRIMARY KEY (user_id, scope_type, scope_id)
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------- audit

CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind     user_kind,
  action         text NOT NULL,
  resource_type  text,
  resource_id    uuid,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             inet,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_at ON audit_log (org_id, at DESC);
CREATE INDEX audit_log_resource ON audit_log (resource_type, resource_id);

-- ---------------------------------------------------------------- row-level security

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_units', 'users', 'sessions', 'groups', 'group_members', 'folders', 'pages',
    'page_versions', 'assets', 'grants', 'workflow_settings', 'review_requests',
    'changes', 'review_notes', 'watches', 'notifications', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id())', t);
  END LOOP;
END $$;

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON orgs USING (id = app_org_id()) WITH CHECK (id = app_org_id());

-- ---------------------------------------------------------------- auth helpers
-- Sign-in happens before the organization is known, so these two run with
-- the owner's rights and return only what sign-in needs.

CREATE FUNCTION auth_find_user(p_username text)
RETURNS TABLE (id uuid, org_id uuid, password_hash text, disabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.org_id, u.password_hash, u.disabled_at IS NOT NULL
  FROM users u
  WHERE u.username = p_username::citext AND u.kind = 'person'
$$;

CREATE FUNCTION auth_get_session(p_token_hash bytea)
RETURNS TABLE (session_id uuid, user_id uuid, org_id uuid, kind user_kind, is_org_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.user_id, s.org_id, u.kind, u.is_org_admin
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now() AND u.disabled_at IS NULL
$$;
