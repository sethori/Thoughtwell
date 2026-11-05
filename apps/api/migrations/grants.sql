-- Privileges for the restricted app role. Re-applied after every migration
-- run, so new tables are covered. Kept separate so it can stay idempotent.

GRANT USAGE ON SCHEMA public TO notes_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO notes_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO notes_app;

-- Organizations are created by the seed script, never by the API.
REVOKE INSERT, DELETE ON orgs FROM notes_app;

-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_log FROM notes_app;

-- Published versions are never deleted by the application (archiving is an update).
REVOKE DELETE ON page_versions FROM notes_app;

-- People are disabled, not deleted, so history keeps its authors.
-- The app may never read password hashes; sign-in goes through auth_find_user.
REVOKE SELECT, DELETE ON users FROM notes_app;
GRANT SELECT (
  id, org_id, username, display_name, email, title, phone, kind, home_unit_id,
  is_org_admin, can_self_approve, preferences, external_id, disabled_at, created_at
) ON users TO notes_app;

-- The migrations bookkeeping table is the owner's alone.
REVOKE ALL ON schema_migrations FROM notes_app;

REVOKE ALL ON FUNCTION auth_find_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_get_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO notes_app;
GRANT EXECUTE ON FUNCTION auth_get_session(bytea) TO notes_app;
