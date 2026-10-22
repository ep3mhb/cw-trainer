import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { iceServersFor, mintTurnCredential } from '../src/turn';

describe('TURN credentials', () => {
  it('are what coturn will recompute: HMAC-SHA1 of the username under the secret', () => {
    const c = mintTurnCredential('s3cret', 3600, 1_700_000_000);
    expect(c.username).toBe('1700003600');
    expect(c.expiresAt).toBe(1_700_003_600);
    expect(c.credential).toBe(createHmac('sha1', 's3cret').update('1700003600').digest('base64'));
  });

  it('can carry a tag so a relay log line names the member', () => {
    const c = mintTurnCredential('s3cret', 60, 100, 'EP2MHB');
    expect(c.username).toBe('160:EP2MHB');
  });

  it('shape the ICE server entry a browser expects', () => {
    const c = mintTurnCredential('s', 1, 0);
    expect(iceServersFor('turn:sig.example:3478', c)).toEqual([
      { urls: ['turn:sig.example:3478'], username: '1', credential: c.credential },
    ]);
  });
});
