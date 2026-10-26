import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { ApiError } from '@budget/shared';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    haUser: { id: string | null; name: string | null; displayName: string | null } | null;
    ingressPath: string | null;
  }
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'validation_error', formatIssues(result.error));
  }
  return result.data;
}

function formatIssues(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/** Identifier stored as `created_by`: the person chosen in the UI, else the Home Assistant user. */
export function actorOf(req: FastifyRequest): string | null {
  const header = req.headers['x-budget-person'];
  const chosen = Array.isArray(header) ? header[0] : header;
  return chosen?.slice(0, 64) || req.haUser?.displayName || req.haUser?.name || null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      const body: ApiError = { error: err.code, message: err.message };
      return reply.status(err.status).send(body);
    }
    if (err instanceof ZodError) {
      const body: ApiError = { error: 'validation_error', message: formatIssues(err) };
      return reply.status(400).send(body);
    }
    const fastifyErr = err as { statusCode?: number; message?: string };
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      const body: ApiError = { error: 'bad_request', message: fastifyErr.message ?? 'Bad request' };
      return reply.status(fastifyErr.statusCode).send(body);
    }
    req.log.error({ err }, 'unhandled error');
    const body: ApiError = { error: 'internal_error', message: 'Erreur interne' };
    return reply.status(500).send(body);
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      const body: ApiError = { error: 'not_found', message: 'Unknown API route' };
      return reply.status(404).send(body);
    }
    return reply.status(404).type('text/plain').send('Not found');
  });
}
