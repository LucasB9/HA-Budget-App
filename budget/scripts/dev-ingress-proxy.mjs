// Fake Home Assistant Ingress for local testing: serves the app under a dynamic-looking path prefix,
// strips it before forwarding, and adds the headers the Supervisor would set.
//
//   npm run dev:ingress   ->   http://localhost:8123/api/hassio_ingress/dev-token-7Zq1/
//
// If the app works here, its asset and API URLs are properly relative.
import { createServer, request } from 'node:http';

const PORT = Number(process.env.FAKE_HA_PORT ?? 8123);
const TARGET_PORT = Number(process.env.API_PORT ?? 3000);
const TOKEN = process.env.FAKE_INGRESS_TOKEN ?? 'dev-token-7Zq1';
const PREFIX = `/api/hassio_ingress/${TOKEN}`;
const USER = process.env.FAKE_HA_USER ?? 'Lucas';

createServer((req, res) => {
  const url = req.url ?? '/';
  if (url !== PREFIX && !url.startsWith(`${PREFIX}/`) && !url.startsWith(`${PREFIX}?`)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Fake Home Assistant. Open ${PREFIX}/`);
    return;
  }
  const forwarded = url.slice(PREFIX.length) || '/';
  const upstream = request(
    {
      host: '127.0.0.1',
      port: TARGET_PORT,
      method: req.method,
      path: forwarded.startsWith('/') ? forwarded : `/${forwarded}`,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${TARGET_PORT}`,
        'x-ingress-path': PREFIX,
        'x-remote-user-id': 'fake-user-id',
        'x-remote-user-name': USER.toLowerCase(),
        'x-remote-user-display-name': USER,
      },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Backend not reachable on port ' + TARGET_PORT);
  });
  req.pipe(upstream);
}).listen(PORT, () => {
  console.log(`Fake ingress ready: http://localhost:${PORT}${PREFIX}/  (user: ${USER})`);
});
