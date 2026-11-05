-- Phase 2 and 3: live co-editing, review and notifications.

-- Review: one open review per page; per-change decisions keyed by change key.
ALTER TABLE review_requests
  ADD COLUMN decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN decided_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX review_requests_one_open ON review_requests (page_id) WHERE status = 'open';
CREATE INDEX review_requests_status ON review_requests (status, created_at DESC);

-- Review conversation: the submit note, comments (optionally on one change),
-- and the note left when a draft is sent back or approved.
ALTER TABLE review_notes
  ADD COLUMN change_key text,
  ADD COLUMN kind text NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment', 'submit', 'send_back', 'approve', 'withdraw'));
CREATE INDEX review_notes_review ON review_notes (review_request_id, created_at);

-- Delivery bookkeeping for email and Teams. In-app notifications need none.
ALTER TABLE notifications
  ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivery_error text;
CREATE INDEX notifications_undelivered ON notifications (created_at) WHERE delivered_at IS NULL;
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- People who may approve a page: approver or admin on it, active, not agents.
CREATE FUNCTION page_approvers(p_page uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT u.id FROM users u
  WHERE u.disabled_at IS NULL AND u.kind = 'person'
    AND effective_role(u.id, 'page', p_page) >= 'approver'
$$;

-- People watching a page directly, or through its folder, parent folders,
-- unit or the units above it, for one event, who can still see it.
CREATE FUNCTION page_watchers(p_page uuid, p_event text) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT w.user_id
  FROM pages p
  JOIN folders f ON f.id = p.folder_id
  JOIN org_units fu ON fu.id = f.unit_id
  JOIN watches w ON p_event = ANY (w.events) AND (
       (w.scope_type = 'page' AND w.scope_id = p.id)
    OR (w.scope_type = 'folder' AND w.scope_id IN (SELECT a.id FROM folders a WHERE a.path @> f.path))
    OR (w.scope_type = 'unit' AND w.scope_id IN (SELECT a.id FROM org_units a WHERE a.path @> fu.path))
  )
  JOIN users u ON u.id = w.user_id AND u.disabled_at IS NULL
  WHERE p.id = p_page
    AND effective_role(w.user_id, 'page', p.id) >= (CASE WHEN p_event = 'review' THEN 'contributor' ELSE 'viewer' END)::role_name
$$;

-- Nearest setting for a unit: the unit itself, then the units above it.
CREATE FUNCTION resolve_unit_setting(p_unit uuid, p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT ws.value
  FROM org_units target
  JOIN org_units u ON u.path @> target.path
  JOIN workflow_settings ws ON ws.scope_type = 'unit' AND ws.scope_id = u.id AND ws.key = p_key
  WHERE target.id = p_unit
  ORDER BY nlevel(u.path) DESC
  LIMIT 1
$$;
