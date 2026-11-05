import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { roleAtLeast } from '@notes/shared';
import type { AppDeps } from '../app.js';
import { many, one, type Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { idParams, parse } from '../lib/validate.js';
import { requireRole } from '../services/access.js';
import { approversOf, notify, watchersOf } from '../services/notify.js';
import { publishDraft, publishPolicy } from '../services/workflow.js';
import type { AuthContext } from '../types.js';

/**
 * Review: a contributor submits the draft; an approver sees what changed since
 * the published version (marked up inline in the editor), accepts or rejects
 * each change or the whole draft, and approves (which publishes) or sends it
 * back with a note. Rejecting a change edits the draft itself, live, so the
 * draft is always exactly what would be published.
 */

const note = z.string().trim().max(5000);
const submitBody = z.object({ note: note.optional() });
const decisionBody = z.object({ key: z.string().min(1).max(40), decision: z.enum(['accepted', 'rejected']).nullable() });
const sendBackBody = z.object({ note: note.min(1, 'Say what needs to change') });
const approveBody = z.object({ note: note.optional() });
const commentBody = z.object({ body: note.min(1), changeKey: z.string().max(40).optional() });
const listQuery = z.object({ scope: z.enum(['inbox', 'mine']).default('inbox') });

interface ReviewRow {
  id: string;
  page_id: string;
  status: 'open' | 'sent_back' | 'approved' | 'withdrawn';
  submitted_by: string | null;
  round: number;
  decisions: Record<string, 'accepted' | 'rejected'>;
}

async function loadReview(db: Db, id: string): Promise<ReviewRow> {
  const r = await one<ReviewRow>(
    db,
    'SELECT id, page_id, status, submitted_by, round, decisions FROM review_requests WHERE id = $1',
    [id],
  );
  if (!r) throw notFound('Review not found');
  return r;
}

/** Approvers decide; the person who submitted only when self-approval is allowed for them here. */
async function requireDecider(db: Db, auth: AuthContext, review: ReviewRow) {
  await requireRole(db, auth.userId, 'page', review.page_id, 'contributor');
  const policy = await publishPolicy(db, auth.userId, review.page_id);
  if (!policy.canApprove) throw forbidden('Only approvers can decide on a review');
  if (review.submitted_by === auth.userId && !policy.selfApproval) {
    throw forbidden('Someone else needs to approve your own changes here');
  }
  if (review.status !== 'open') throw conflict('This review is closed');
  return policy;
}

async function pageInfo(db: Db, pageId: string) {
  return (await one<{ title: string; folder_name: string }>(
    db,
    'SELECT p.title, f.name AS folder_name FROM pages p JOIN folders f ON f.id = p.folder_id WHERE p.id = $1',
    [pageId],
  ))!;
}

/** Everyone who took part: the submitter and anyone who left a note. */
async function participants(db: Db, review: ReviewRow): Promise<string[]> {
  const rows = await many<{ author_id: string }>(
    db,
    'SELECT DISTINCT author_id FROM review_notes WHERE review_request_id = $1 AND author_id IS NOT NULL',
    [review.id],
  );
  return [...(review.submitted_by ? [review.submitted_by] : []), ...rows.map((r) => r.author_id)];
}

export async function reviewRoutes(app: FastifyInstance, deps: Pick<AppDeps, 'collab' | 'dispatcher'>) {
  const { collab, dispatcher } = deps;

  app.post('/api/pages/:id/reviews', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(submitBody, req.body);
    await collab?.flush(id);
    const review = await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'page', id, 'contributor');
      const open = await one(db, `SELECT 1 FROM review_requests WHERE page_id = $1 AND status = 'open'`, [id]);
      if (open) throw conflict('This page is already waiting for review');
      const row = await one<{ id: string; round: number }>(
        db,
        `INSERT INTO review_requests (org_id, page_id, round, submitted_by, base_version_id)
         SELECT $1, p.id, (SELECT count(*) + 1 FROM review_requests WHERE page_id = p.id), $3, p.published_version_id
         FROM pages p WHERE p.id = $2 AND p.archived_at IS NULL
         RETURNING id, round`,
        [auth.orgId, id, auth.userId],
      );
      if (!row) throw notFound();
      await db.query(
        `INSERT INTO review_notes (org_id, review_request_id, author_id, body, kind) VALUES ($1, $2, $3, $4, 'submit')`,
        [auth.orgId, row.id, auth.userId, body.note ?? ''],
      );
      const info = await pageInfo(db, id);
      await notify(db, auth, 'review.submitted', [...(await approversOf(db, id)), ...(await watchersOf(db, id, 'review'))], {
        pageId: id,
        pageTitle: info.title,
        reviewId: row.id,
        note: body.note,
        folderName: info.folder_name,
      });
      await audit(db, auth, 'review.submit', 'page', id, { reviewId: row.id, round: row.round });
      return row;
    });
    dispatcher?.kick(req.auth!.orgId);
    reply.code(201);
    return review;
  });

  app.get('/api/reviews', async (req) => {
    const q = parse(listQuery, req.query);
    return req.tx(async (db, auth) => {
      const where =
        q.scope === 'mine'
          ? `r.submitted_by = $1 AND (r.status IN ('open', 'sent_back') OR r.closed_at > now() - interval '14 days')`
          : `r.status = 'open' AND effective_role($1, 'page', r.page_id) >= 'approver'
             AND (r.submitted_by IS DISTINCT FROM $1 OR (SELECT can_self_approve FROM users WHERE id = $1)
                  OR resolve_setting(p.folder_id, 'approval.allow_self') = 'true'::jsonb)`;
      return many(
        db,
        `SELECT r.id, r.page_id, r.status, r.round, r.created_at, r.closed_at,
                p.title AS page_title, f.name AS folder_name, su.display_name AS submitted_by_name,
                (SELECT n.body FROM review_notes n WHERE n.review_request_id = r.id AND n.kind IN ('submit', 'send_back', 'approve')
                 ORDER BY n.created_at DESC LIMIT 1) AS latest_note
         FROM review_requests r
         JOIN pages p ON p.id = r.page_id AND p.archived_at IS NULL
         JOIN folders f ON f.id = p.folder_id
         LEFT JOIN users su ON su.id = r.submitted_by
         WHERE ${where}
         ORDER BY r.created_at DESC LIMIT 100`,
        [auth.userId],
      );
    });
  });

  app.get('/api/reviews/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db, auth) => {
      const r = await loadReview(db, id);
      await requireRole(db, auth.userId, 'page', r.page_id, 'contributor');
      const policy = await publishPolicy(db, auth.userId, r.page_id);
      const notes = await many(
        db,
        `SELECT n.id, n.kind, n.body, n.change_key, n.created_at, u.display_name AS author_name, n.author_id
         FROM review_notes n LEFT JOIN users u ON u.id = n.author_id
         WHERE n.review_request_id = $1 ORDER BY n.created_at`,
        [id],
      );
      const info = await one<Record<string, unknown>>(
        db,
        `SELECT r.created_at, r.closed_at, su.display_name AS submitted_by_name, bv.number AS base_number
         FROM review_requests r LEFT JOIN users su ON su.id = r.submitted_by
         LEFT JOIN page_versions bv ON bv.id = r.base_version_id WHERE r.id = $1`,
        [id],
      );
      const isSubmitter = r.submitted_by === auth.userId;
      return {
        ...r,
        ...info,
        notes,
        canDecide: r.status === 'open' && policy.canApprove && (!isSubmitter || policy.selfApproval),
        canWithdraw: r.status === 'open' && isSubmitter,
      };
    });
  });

  app.put('/api/reviews/:id/decisions', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(decisionBody, req.body);
    return req.tx(async (db, auth) => {
      const r = await loadReview(db, id);
      await requireDecider(db, auth, r);
      const row = await one<{ decisions: Record<string, string> }>(
        db,
        body.decision === null
          ? `UPDATE review_requests SET decisions = decisions - $2 WHERE id = $1 RETURNING decisions`
          : `UPDATE review_requests SET decisions = decisions || jsonb_build_object($2::text, $3::text) WHERE id = $1 RETURNING decisions`,
        body.decision === null ? [id, body.key] : [id, body.key, body.decision],
      );
      return { decisions: row!.decisions };
    });
  });

  app.post('/api/reviews/:id/approve', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(approveBody, req.body);
    const pageId = await req.tx(async (db) => (await loadReview(db, id)).page_id);
    await collab?.flush(pageId);
    const result = await req.tx(async (db, auth) => {
      const r = await loadReview(db, id);
      await requireDecider(db, auth, r);
      const version = await publishDraft(db, auth, r.page_id, r.id);
      await db.query(
        `UPDATE review_requests SET status = 'approved', closed_at = now(), decided_by = $2 WHERE id = $1`,
        [id, auth.userId],
      );
      if (body.note) {
        await db.query(
          `INSERT INTO review_notes (org_id, review_request_id, author_id, body, kind) VALUES ($1, $2, $3, $4, 'approve')`,
          [auth.orgId, id, auth.userId, body.note],
        );
      }
      const info = await pageInfo(db, r.page_id);
      const base = { pageId: r.page_id, pageTitle: info.title, reviewId: id, version: version.number, folderName: info.folder_name };
      const toTell = await participants(db, r);
      await notify(db, auth, 'review.approved', toTell, { ...base, note: body.note });
      const watchers = (await watchersOf(db, r.page_id, 'published')).filter((u) => !toTell.includes(u));
      await notify(db, auth, 'page.published', watchers, base);
      await audit(db, auth, 'review.approve', 'page', r.page_id, { reviewId: id, version: version.number });
      return { number: version.number, at: version.created_at };
    });
    dispatcher?.kick(req.auth!.orgId);
    return result;
  });

  app.post('/api/reviews/:id/send-back', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(sendBackBody, req.body);
    const result = await req.tx(async (db, auth) => {
      const r = await loadReview(db, id);
      await requireDecider(db, auth, r);
      await db.query(
        `UPDATE review_requests SET status = 'sent_back', closed_at = now(), decided_by = $2 WHERE id = $1`,
        [id, auth.userId],
      );
      await db.query(
        `INSERT INTO review_notes (org_id, review_request_id, author_id, body, kind) VALUES ($1, $2, $3, $4, 'send_back')`,
        [auth.orgId, id, auth.userId, body.note],
      );
      const info = await pageInfo(db, r.page_id);
      await notify(db, auth, 'review.sent_back', await participants(db, r), {
        pageId: r.page_id,
        pageTitle: info.title,
        reviewId: id,
        note: body.note,
      });
      await audit(db, auth, 'review.send_back', 'page', r.page_id, { reviewId: id });
      return { status: 'sent_back' };
    });
    dispatcher?.kick(req.auth!.orgId);
    return result;
  });

  app.post('/api/reviews/:id/withdraw', async (req) => {
    const { id } = parse(idParams, req.params);
    const result = await req.tx(async (db, auth) => {
      const r = await loadReview(db, id);
      if (r.submitted_by !== auth.userId) throw forbidden('Only the person who asked for the review can withdraw it');
      if (r.status !== 'open') throw conflict('This review is closed');
      await db.query(`UPDATE review_requests SET status = 'withdrawn', closed_at = now() WHERE id = $1`, [id]);
      await db.query(
        `INSERT INTO review_notes (org_id, review_request_id, author_id, body, kind) VALUES ($1, $2, $3, '', 'withdraw')`,
        [auth.orgId, id, auth.userId],
      );
      const info = await pageInfo(db, r.page_id);
      await notify(db, auth, 'review.withdrawn', await approversOf(db, r.page_id), { pageId: r.page_id, pageTitle: info.title, reviewId: id });
      await audit(db, auth, 'review.withdraw', 'page', r.page_id, { reviewId: id });
      return { status: 'withdrawn' };
    });
    dispatcher?.kick(req.auth!.orgId);
    return result;
  });

  app.post('/api/reviews/:id/notes', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(commentBody, req.body);
    const row = await req.tx(async (db, auth) => {
      const r = await loadReview(db, id);
      const role = await requireRole(db, auth.userId, 'page', r.page_id, 'contributor');
      if (!roleAtLeast(role, 'contributor')) throw forbidden();
      if (r.status !== 'open') throw badRequest('This review is closed');
      const n = await one(
        db,
        `INSERT INTO review_notes (org_id, review_request_id, author_id, body, change_key, kind)
         VALUES ($1, $2, $3, $4, $5, 'comment') RETURNING id, created_at`,
        [auth.orgId, id, auth.userId, body.body, body.changeKey ?? null],
      );
      const info = await pageInfo(db, r.page_id);
      await notify(db, auth, 'review.comment', [...(await participants(db, r)), ...(await approversOf(db, r.page_id))], {
        pageId: r.page_id,
        pageTitle: info.title,
        reviewId: id,
        note: body.body,
      });
      return n;
    });
    dispatcher?.kick(req.auth!.orgId);
    reply.code(201);
    return row;
  });
}
