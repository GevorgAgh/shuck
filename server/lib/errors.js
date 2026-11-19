// One error shape for the whole API: { "error": { "code", "message", "fields"? } }
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, fields) =>
  new HttpError(400, 'INVALID_INPUT', message, fields ? { fields } : {});
export const unauthorized = (message = 'Please sign in first.') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You are not allowed to do this.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message, extra) => new HttpError(409, code, message, extra);

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
  }
  const status = err?.status || err?.statusCode;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_INPUT', message: status === 404 ? 'Not found.' : err.message } });
  }
  if (err?.code === 'SQLITE_BUSY') {
    console.error('SQLITE_BUSY', err);
    return res.status(503).json({ error: { code: 'BUSY', message: 'The server is busy, please try again.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
}
