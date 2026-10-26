export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'bad_request'): HttpError => new HttpError(400, code, message);
export const notFound = (message: string, code = 'not_found'): HttpError => new HttpError(404, code, message);
export const conflict = (message: string, code = 'conflict'): HttpError => new HttpError(409, code, message);
