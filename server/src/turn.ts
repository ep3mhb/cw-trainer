/**
 * TURN credentials (RFP §7), minted the way coturn's `use-auth-secret` expects.
 *
 * coturn never learns member accounts and the server never stores TURN
 * passwords: the username is an expiry time, the password is an HMAC-SHA1 of
 * it under the shared secret, and coturn recomputes the HMAC to check it.
 * A credential leaked from one member's browser is useless after it expires
 * and cannot be used to derive the secret.
 */

import { createHmac } from 'node:crypto';
import type { IceServer } from '../../src/core/signalling';

export interface TurnCredential {
  username: string;
  credential: string;
  /** Unix seconds. */
  expiresAt: number;
}

export function mintTurnCredential(
  secret: string,
  ttlS: number,
  nowS: number = Math.floor(Date.now() / 1000),
  /** Optional tag so a credential can be traced to a member in coturn's log. */
  tag = '',
): TurnCredential {
  const expiresAt = nowS + ttlS;
  const username = tag ? `${String(expiresAt)}:${tag}` : String(expiresAt);
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt };
}

/** The ICE server list handed to a browser in `welcome`. */
export function iceServersFor(turnUri: string, credential: TurnCredential): IceServer[] {
  return [{ urls: [turnUri], username: credential.username, credential: credential.credential }];
}
