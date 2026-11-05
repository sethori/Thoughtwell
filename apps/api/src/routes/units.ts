import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canContain, childPath, childTypeOf, UNIT_LABELS, type UnitType } from '@notes/shared';
import { one, type Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { idParams, name, parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';

interface UnitRow {
  id: string;
  parent_id: string | null;
  type: UnitType;
  name: string;
  path: string;
}

async function getUnit(db: Db, id: string): Promise<UnitRow> {
  const u = await one<UnitRow>(db, 'SELECT id, parent_id, type, name, path::text AS path FROM org_units WHERE id = $1', [id]);
  if (!u) throw notFound('Unit not found');
  return u;
}

const createBody = z.object({ parentId: uuid, name });
const updateBody = z.object({ name: name.optional(), parentId: uuid.optional() });

/** The org tree editor: add, rename, move and delete units at every level. */
export async function unitRoutes(app: FastifyInstance) {
  app.post('/api/units', async (req, reply) => {
    const body = parse(createBody, req.body);
    const unit = await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'unit', body.parentId, 'admin');
      const parent = await getUnit(db, body.parentId);
      const type = childTypeOf(parent.type);
      if (!type) throw badRequest(`A ${UNIT_LABELS[parent.type].toLowerCase()} cannot hold anything below it`);
      const id = randomUUID();
      const created = await one<UnitRow>(
        db,
        `INSERT INTO org_units (id, org_id, parent_id, type, name, path)
         VALUES ($1, $2, $3, $4, $5, $6::ltree)
         RETURNING id, parent_id, type, name, path::text AS path`,
        [id, auth.orgId, parent.id, type, body.name, childPath(parent.path, id)],
      );
      await audit(db, auth, 'unit.create', 'unit', id, { name: body.name, type, parentId: parent.id });
      return created;
    });
    reply.code(201);
    return unit;
  });

  app.patch('/api/units/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateBody, req.body);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'unit', id, 'admin');
      const unit = await getUnit(db, id);

      if (body.name && body.name !== unit.name) {
        await db.query('UPDATE org_units SET name = $2, updated_at = now() WHERE id = $1', [id, body.name]);
        await audit(db, auth, 'unit.rename', 'unit', id, { from: unit.name, to: body.name });
      }

      if (body.parentId && body.parentId !== unit.parent_id) {
        if (!unit.parent_id) throw badRequest('The organization root cannot be moved');
        await requireRole(db, auth.userId, 'unit', body.parentId, 'admin');
        const target = await getUnit(db, body.parentId);
        if (!canContain(target.type, unit.type)) {
          throw badRequest(`A ${unit.type} must sit under a ${UNIT_LABELS[parentLevelOf(unit.type)].toLowerCase()}`);
        }
        const inside = await one(db, 'SELECT 1 FROM org_units WHERE id = $1 AND path <@ $2::ltree', [target.id, unit.path]);
        if (inside) throw badRequest('A unit cannot move inside itself');
        // Rewrite the whole subtree's paths in one statement.
        await db.query(
          `UPDATE org_units
           SET path = $2::ltree || subpath(path, nlevel($1::ltree) - 1), updated_at = now()
           WHERE path <@ $1::ltree`,
          [unit.path, target.path],
        );
        await db.query('UPDATE org_units SET parent_id = $2 WHERE id = $1', [id, target.id]);
        await audit(db, auth, 'unit.move', 'unit', id, { fromParent: unit.parent_id, toParent: target.id });
      }
      return getUnit(db, id);
    });
  });

  app.delete('/api/units/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'unit', id, 'admin');
      const unit = await getUnit(db, id);
      if (!unit.parent_id) throw badRequest('The organization root cannot be deleted');
      const use = await one<{ children: number; folders: number; people: number; groups: number }>(
        db,
        `SELECT
           (SELECT count(*)::int FROM org_units WHERE parent_id = $1) AS children,
           (SELECT count(*)::int FROM folders WHERE unit_id = $1) AS folders,
           (SELECT count(*)::int FROM users WHERE home_unit_id = $1 AND disabled_at IS NULL) AS people,
           (SELECT count(*)::int FROM groups WHERE unit_id = $1) AS groups`,
        [id],
      );
      const blockers = Object.entries(use ?? {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`);
      if (blockers.length) {
        throw conflict(`Move or archive what this unit still holds first: ${blockers.join(', ')}`);
      }
      await db.query(`DELETE FROM grants WHERE resource_type = 'unit' AND resource_id = $1`, [id]);
      await db.query(`DELETE FROM workflow_settings WHERE scope_type = 'unit' AND scope_id = $1`, [id]);
      await db.query('DELETE FROM org_units WHERE id = $1', [id]);
      await audit(db, auth, 'unit.delete', 'unit', id, { name: unit.name, type: unit.type });
    });
    reply.code(204);
  });
}

function parentLevelOf(type: UnitType): UnitType {
  const order: UnitType[] = ['org', 'directorate', 'division', 'branch', 'section', 'project'];
  return order[Math.max(0, order.indexOf(type) - 1)]!;
}
