import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AppContext } from './context.js';
import { registerErrorHandler } from './http.js';
import { registerIngress } from './ingress.js';
import { catalogRoutes } from './routes/catalog.js';
import { coreRoutes } from './routes/core.js';
import { expenseRoutes } from './routes/expenses.js';
import { monthRoutes } from './routes/months.js';

/** Injects `<base href>` so relative asset URLs resolve under the ingress prefix, even without a trailing slash. */
function renderIndex(html: string, ingressPath: string | null): string {
  if (!ingressPath) return html;
  return html.replace(/<head[^>]*>/, (head) => `${head}\n    <base href="${ingressPath}/" />`);
}

export function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });

  registerErrorHandler(app);
  registerIngress(app, ctx);

  coreRoutes(app, ctx);
  catalogRoutes(app, ctx);
  monthRoutes(app, ctx);
  expenseRoutes(app, ctx);

  const indexPath = join(ctx.config.webDir, 'index.html');
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, 'utf8');
    app.register(fastifyStatic, {
      root: ctx.config.webDir,
      index: false,
      wildcard: false,
      // index.html is served by the routes below, which inject the ingress base href
      globIgnore: ['index.html'],
      setHeaders: (res, path) => {
        if (path.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
    const serveIndex = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send(renderIndex(indexHtml, req.ingressPath));
    app.get('/', serveIndex);
    app.get('/index.html', serveIndex);
  }

  return app;
}
