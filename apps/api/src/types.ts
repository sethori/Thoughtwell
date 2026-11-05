import type { Db } from './db.js';

export interface AuthContext {
  userId: string;
  orgId: string;
  sessionId: string;
  kind: 'person' | 'agent';
  isOrgAdmin: boolean;
  ip?: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route needs no signed-in session. */
    public?: boolean;
  }
  interface FastifyRequest {
    auth?: AuthContext;
    /** Runs `fn` in a transaction scoped to the signed-in user's organization. */
    tx<T>(fn: (db: Db, auth: AuthContext) => Promise<T>): Promise<T>;
  }
}
