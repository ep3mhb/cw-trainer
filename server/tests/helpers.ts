import { Api } from '../src/api';
import type { Config } from '../src/config';
import { Hub, type Socket } from '../src/hub';
import type { Mailer } from '../src/mail';
import { MemoryStore } from '../src/store';
import { decodeServerMessage, type ServerMessage } from '../../src/core/signalling';

export const CONFIG: Config = {
  port: 0, host: '127.0.0.1', databaseUrl: 'memory', turnSecret: 'test-secret-do-not-use',
  turnUri: 'turn:sig.example:3478', icePolicy: 'relay', adminCallsign: 'EP2MHB',
  appOrigin: 'https://cw.example', smtp: null, turnTtlS: 3600, sessionTtlS: 86400,
  publicOrigin: 'https://sig.example.test',
};

export class FakeMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = [];
  async send(to: string, subject: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
  }
}

export class FakeSocket implements Socket {
  readonly out: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(text: string): void {
    if (this.closed) throw new Error('closed');
    const m = decodeServerMessage(text);
    if (!m) throw new Error(`server sent something the client cannot parse: ${text}`);
    this.out.push(m);
  }
  close(code?: number, reason?: string): void {
    this.closed = { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) };
  }
  /** Messages of one kind, most recent last. */
  ofKind<K extends ServerMessage['kind']>(kind: K): Extract<ServerMessage, { kind: K }>[] {
    return this.out.filter((m): m is Extract<ServerMessage, { kind: K }> => m.kind === kind);
  }
  last<K extends ServerMessage['kind']>(kind: K): Extract<ServerMessage, { kind: K }> | undefined {
    const all = this.ofKind(kind);
    return all[all.length - 1];
  }
  drain(): void { this.out.length = 0; }
}

export interface World {
  store: MemoryStore;
  api: Api;
  hub: Hub;
  mailer: FakeMailer;
  clock: { now: number };
  logged: string[];
  /** Register and sign in a member, returning their session token. */
  member(name: string, email: string, callsign?: string): Promise<{ token: string; callsign: string }>;
  /** Connect a socket and say hello with a token. */
  join(token: string): Promise<{ socket: FakeSocket; send: (m: object) => Promise<void>; close: () => Promise<void>; id: string }>;
}

export function world(over: Partial<Config> = {}): World {
  const store = new MemoryStore();
  const clock = { now: 1_700_000_000_000 };
  const mailer = new FakeMailer();
  const config = { ...CONFIG, ...over };
  const logged: string[] = [];
  const api = new Api(store, config, mailer, () => clock.now, (line) => logged.push(line));
  let seed = 1;
  const hub = new Hub(store, config, {
    now: () => clock.now,
    random: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; },
  });
  return {
    store, api, hub, mailer, clock, logged,
    async member(name, email, callsign) {
      const res = await api.handle({
        method: 'POST', path: '/api/register', token: null,
        body: { name, email, password: 'a-good-long-password', ...(callsign ? { callsign } : {}) },
      });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
      const body = res.body as { token: string; member: { callsign: string } };
      return { token: body.token, callsign: body.member.callsign };
    },
    async join(token) {
      const socket = new FakeSocket();
      const conn = hub.attach(socket);
      const send = (m: object): Promise<void> => conn.receive(JSON.stringify(m));
      await send({ kind: 'hello', v: 1, token });
      const welcome = socket.last('welcome');
      return { socket, send, close: conn.close, id: welcome?.you ?? '' };
    },
  };
}
