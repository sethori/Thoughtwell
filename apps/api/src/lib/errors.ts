export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const tooLarge = (message: string) => new HttpError(413, 'too_large', message);

/** Maps Postgres errors that represent bad input onto HTTP errors. */
export function fromPgError(err: unknown): HttpError | undefined {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case '23505':
      return conflict('That already exists');
    case '23503':
      return conflict('This is still referenced by something else');
    case '23514':
      return badRequest(e.message ?? 'Invalid value');
    case '22P02':
      return badRequest('Invalid identifier');
    default:
      return undefined;
  }
}
