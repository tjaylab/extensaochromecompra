export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} não encontrado(a)`);
export const forbidden = (msg = 'Sem permissão para esta ação') => new HttpError(403, 'forbidden', msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflict', msg, details);
