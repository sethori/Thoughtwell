import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(`${where}${first?.message ?? 'Invalid input'}`);
  }
  return r.data;
}

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });
export const name = z.string().trim().min(1).max(200);
