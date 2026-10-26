import type { FastifyInstance } from 'fastify';
import { INGRESS_GATEWAY_IP } from './config.js';
import type { AppContext } from './context.js';

const INGRESS_PATH_RE = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/;

/** Routes that authenticate themselves (bearer token) and may be reached outside the ingress gateway. */
const SELF_AUTHENTICATED_PREFIXES = ['/api/shortcut/'];

function header(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function normalizeIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/, '');
}

/**
 * Inside Home Assistant the app must only be reachable through the Supervisor ingress gateway.
 * Also extracts the logged-in HA user and the ingress prefix from the headers the Supervisor sets.
 */
export function registerIngress(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('haUser', null);
  app.decorateRequest('ingressPath', null);

  app.addHook('onRequest', async (req, reply) => {
    const fromGateway = normalizeIp(req.socket.remoteAddress) === INGRESS_GATEWAY_IP;
    if (ctx.config.enforceIngress && !fromGateway) {
      if (!SELF_AUTHENTICATED_PREFIXES.some((p) => req.url.startsWith(p))) {
        return reply.status(403).send({ error: 'forbidden', message: 'Accès via Home Assistant uniquement' });
      }
      return;
    }

    const ingressPath = header(req.headers['x-ingress-path']);
    req.ingressPath = ingressPath && INGRESS_PATH_RE.test(ingressPath) ? ingressPath : null;

    const id = header(req.headers['x-remote-user-id']);
    const name = header(req.headers['x-remote-user-name']);
    const displayName = header(req.headers['x-remote-user-display-name']);
    req.haUser = id || name || displayName ? { id, name, displayName } : null;
  });
}
