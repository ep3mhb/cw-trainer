/**
 * The process. Everything with a decision in it lives in hub.ts and api.ts;
 * this file only wires Node's HTTP server and `ws` to them and reads flags.
 *
 *   node dist/server.js            run
 *   node dist/server.js --migrate  apply pending migrations and exit
 *   node dist/server.js --check    load config, connect to the database, exit
 *
 * Listens on 127.0.0.1 only. Caddy terminates TLS and forwards /ws and /api/
 * (docs/SERVER-SETUP.md §5).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config';
import { PgStore } from './store';
import { Hub } from './hub';
import { Api } from './api';
import { makeMailer } from './mail';

declare const __SERVER_VERSION__: string;

const log = (line: string): void => {
  console.log(`${new Date().toISOString()} ${line}`);
};

const MAX_BODY = 16 * 1024;
/** A socket that has not said hello within this long is dropped. */
/** Ping every 20 s; a socket silent for two intervals is dead. */
const HEARTBEAT_MS = 20_000;
const HELLO_TIMEOUT_MS = 10_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 && token.length <= 256 ? token : null;
}

/**
 * The application lives at cw.mikroutik.com and this API at sig.mikroutik.com,
 * so every browser call is cross-origin. Exactly one origin is allowed — the
 * configured one — and nothing else on the internet can drive a member's
 * session from a page they were tricked into opening.
 */
function cors(appOrigin: string): Record<string, string> {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

function reply(
  res: ServerResponse, status: number, body: unknown, appOrigin: string,
  contentType = 'application/json; charset=utf-8',
): void {
  // Everything here is JSON but the certificate verification page, which is
  // HTML because a person reads it. A string body with its own content type
  // goes out as it is rather than being quoted into a JSON string.
  const text = typeof body === 'string' && contentType !== 'application/json; charset=utf-8'
    ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...cors(appOrigin),
  });
  res.end(text);
}

async function main(): Promise<void> {
  const flag = process.argv[2];
  const config = loadConfig();
  const store = new PgStore(config.databaseUrl);

  if (flag === '--migrate') {
    const here = dirname(fileURLToPath(import.meta.url));
    const applied = await store.migrate(join(here, '..', 'migrations'));
    log(applied.length === 0 ? 'migrations: nothing to apply' : `migrations applied: ${applied.join(', ')}`);
    await store.close();
    return;
  }
  if (flag === '--check') {
    await store.listMembers();
    log(`ok: database reachable, TURN at ${config.turnUri}, policy ${config.icePolicy}, smtp ${config.smtp ? config.smtp.host : 'not configured'}`);
    await store.close();
    return;
  }

  const mailer = makeMailer(config, log);
  const api = new Api(store, config, mailer, () => Date.now(), log);
  const hub = new Hub(store, config, { log });

  const http = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const origin = config.appOrigin;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors(origin));
        res.end();
        return;
      }
      if (url.pathname === '/health') {
        reply(res, 200, { ok: true, version: __SERVER_VERSION__, onBand: hub.size }, origin);
        return;
      }
      // The one public page this server serves to a person rather than to a
      // program: what a printed certificate's QR square scans to.
      //
      // HEAD as well as GET, and not for tidiness. `curl -I` sends HEAD, and
      // it is the first thing anyone reaches for to ask "is this route
      // live?" \u2014 answering it from the generic handler tells them the route
      // is missing when it is not. Node suppresses the body for a HEAD, so
      // the same answer serves both.
      if ((req.method === 'GET' || req.method === 'HEAD')
        && url.pathname.startsWith('/certificate/')) {
        const answer = await api.handle({
          method: 'GET', path: url.pathname, token: null, body: null,
        });
        reply(res, answer.status, answer.body, origin, answer.contentType);
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        reply(res, 404, { error: 'not here' }, origin);
        return;
      }
      let body: unknown = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        try {
          body = await readJson(req);
        } catch (error) {
          reply(res, 400, { error: (error as Error).message }, origin);
          return;
        }
      }
      const out = await api.handle({ method: req.method ?? 'GET', path: url.pathname, token: bearer(req), body });
      reply(res, out.status, out.body, origin);
    })().catch((error: unknown) => {
      log(`api error: ${String(error)}`);
      if (!res.headersSent) reply(res, 500, { error: 'something went wrong on the server' }, config.appOrigin);
    });
  });

  const wss = new WebSocketServer({
    server: http, path: '/ws', maxPayload: 64 * 1024,
    // Browsers send Origin on a WebSocket upgrade and cannot forge it. Only
    // the application's own origin may open the band; a non-browser client
    // (a test tool) may omit the header altogether.
    verifyClient: ({ origin }: { origin: string }) => origin === undefined || origin === '' || origin === config.appOrigin,
  });
  // Protocol-level heartbeat, server side: a socket that does not answer a
  // ping within one interval is terminated, which runs the hub's departure
  // and tells the band the member has gone — instead of them lingering as a
  // phantom station until TCP gives up, which on a phone that lost its
  // radio can be minutes.
  const alive = new WeakSet<import('ws').WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    const conn = hub.attach({
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    });
    let admitted = false;
    const timer = setTimeout(() => {
      if (!admitted) ws.close(4001, 'hello timeout');
    }, HELLO_TIMEOUT_MS);
    ws.on('message', (data) => {
      admitted = true;
      clearTimeout(timer);
      void conn.receive(typeof data === 'string' ? data : data.toString()).catch((error: unknown) => {
        log(`ws error: ${String(error)}`);
      });
    });
    ws.on('close', () => {
      clearTimeout(timer);
      void conn.close();
    });
    ws.on('error', (error) => log(`ws socket error: ${error.message}`));
  });

  http.listen(config.port, config.host, () => {
    log(`cw-signalling v${__SERVER_VERSION__} listening on ${config.host}:${String(config.port)} (ICE policy ${config.icePolicy})`);
  });

  const shutdown = (): void => {
    log('shutting down');
    wss.close();
    http.close(() => {
      void store.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
