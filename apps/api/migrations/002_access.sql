-- 002_access: permission resolution in the database.
-- All functions run with the caller's rights, so row-level security still
-- confines them to the current organization.

-- The user plus every group they belong to.
CREATE FUNCTION principals_of(p_user uuid)
RETURNS TABLE (ptype principal_type, pid uuid)
LANGUAGE sql STABLE AS $$
  SELECT 'user'::principal_type, p_user
  UNION ALL
  SELECT 'group'::principal_type, gm.group_id FROM group_members gm WHERE gm.user_id = p_user
$$;

CREATE FUNCTION is_org_admin(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT u.is_org_admin AND u.disabled_at IS NULL FROM users u WHERE u.id = p_user), false)
$$;

-- Highest role from grants on this unit or any unit above it.
CREATE FUNCTION unit_role(p_user uuid, p_unit uuid) RETURNS role_name
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN is_org_admin(p_user) THEN 'admin'::role_name ELSE (
    SELECT max(g.role)
    FROM grants g
    JOIN principals_of(p_user) p ON p.ptype = g.principal_type AND p.pid = g.principal_id
    JOIN org_units a ON a.id = g.resource_id
    JOIN org_units target ON target.id = p_unit
    WHERE g.resource_type = 'unit' AND a.path @> target.path
  ) END
$$;

-- Unit grants reaching the folder's unit, plus grants on this folder or its parents.
CREATE FUNCTION folder_role(p_user uuid, p_folder uuid) RETURNS role_name
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN is_org_admin(p_user) THEN 'admin'::role_name ELSE greatest(
    (SELECT unit_role(p_user, f.unit_id) FROM folders f WHERE f.id = p_folder),
    (SELECT max(g.role)
     FROM grants g
     JOIN principals_of(p_user) p ON p.ptype = g.principal_type AND p.pid = g.principal_id
     JOIN folders a ON a.id = g.resource_id
     JOIN folders target ON target.id = p_folder
     WHERE g.resource_type = 'folder' AND a.path @> target.path)
  ) END
$$;

CREATE FUNCTION page_role(p_user uuid, p_page uuid) RETURNS role_name
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN is_org_admin(p_user) THEN 'admin'::role_name ELSE greatest(
    (SELECT folder_role(p_user, pg.folder_id) FROM pages pg WHERE pg.id = p_page),
    (SELECT max(g.role)
     FROM grants g
     JOIN principals_of(p_user) p ON p.ptype = g.principal_type AND p.pid = g.principal_id
     WHERE g.resource_type = 'page' AND g.resource_id = p_page)
  ) END
$$;

CREATE FUNCTION effective_role(p_user uuid, p_type resource_type, p_id uuid) RETURNS role_name
LANGUAGE sql STABLE AS $$
  SELECT CASE p_type
    WHEN 'unit' THEN unit_role(p_user, p_id)
    WHEN 'folder' THEN folder_role(p_user, p_id)
    WHEN 'page' THEN page_role(p_user, p_id)
  END
$$;

-- Every folder the user can see, with their role on it. One pass, for the sidebar.
CREATE FUNCTION accessible_folders(p_user uuid)
RETURNS TABLE (folder_id uuid, role role_name)
LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM principals_of(p_user)),
  ug AS (
    SELECT u.path, g.role FROM grants g
    JOIN p ON p.ptype = g.principal_type AND p.pid = g.principal_id
    JOIN org_units u ON u.id = g.resource_id
    WHERE g.resource_type = 'unit'
  ),
  fg AS (
    SELECT f.path, g.role FROM grants g
    JOIN p ON p.ptype = g.principal_type AND p.pid = g.principal_id
    JOIN folders f ON f.id = g.resource_id
    WHERE g.resource_type = 'folder'
  ),
  adm AS (SELECT is_org_admin(p_user) AS yes)
  SELECT f.id,
    CASE WHEN (SELECT yes FROM adm) THEN 'admin'::role_name ELSE greatest(
      (SELECT max(ug.role) FROM ug WHERE ug.path @> u.path),
      (SELECT max(fg.role) FROM fg WHERE fg.path @> f.path)
    ) END
  FROM folders f
  JOIN org_units u ON u.id = f.unit_id
  WHERE (SELECT yes FROM adm)
     OR EXISTS (SELECT 1 FROM ug WHERE ug.path @> u.path)
     OR EXISTS (SELECT 1 FROM fg WHERE fg.path @> f.path)
$$;

-- Every unit where the user holds a role, directly or from above.
CREATE FUNCTION accessible_units(p_user uuid)
RETURNS TABLE (unit_id uuid, role role_name)
LANGUAGE sql STABLE AS $$
  WITH ug AS (
    SELECT u.path, g.role FROM grants g
    JOIN principals_of(p_user) p ON p.ptype = g.principal_type AND p.pid = g.principal_id
    JOIN org_units u ON u.id = g.resource_id
    WHERE g.resource_type = 'unit'
  )
  SELECT u.id,
    CASE WHEN is_org_admin(p_user) THEN 'admin'::role_name
         ELSE (SELECT max(ug.role) FROM ug WHERE ug.path @> u.path) END
  FROM org_units u
  WHERE is_org_admin(p_user) OR EXISTS (SELECT 1 FROM ug WHERE ug.path @> u.path)
$$;

-- Nearest setting wins: folder, its parent folders, its unit, the units above.
CREATE FUNCTION resolve_setting(p_folder uuid, p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT s.value FROM (
    SELECT ws.value, nlevel(f.path) + 1000 AS depth
    FROM folders target
    JOIN folders f ON f.path @> target.path
    JOIN workflow_settings ws ON ws.scope_type = 'folder' AND ws.scope_id = f.id AND ws.key = p_key
    WHERE target.id = p_folder
    UNION ALL
    SELECT ws.value, nlevel(u.path) AS depth
    FROM folders target
    JOIN org_units tu ON tu.id = target.unit_id
    JOIN org_units u ON u.path @> tu.path
    JOIN workflow_settings ws ON ws.scope_type = 'unit' AND ws.scope_id = u.id AND ws.key = p_key
    WHERE target.id = p_folder
  ) s
  ORDER BY s.depth DESC
  LIMIT 1
$$;
