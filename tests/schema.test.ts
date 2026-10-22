import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, EXPORT_VERSION, VBAND_KEYMAP, mergeSettings, parseEnvelope,
  type ExportEnvelope,
} from '../src/storage/schema';

const validEnvelope = (): ExportEnvelope => ({
  format: 'cw-trainer-export',
  version: EXPORT_VERSION,
  exportedAt: '2026-09-18T00:00:00.000Z',
  settings: DEFAULT_SETTINGS as ExportEnvelope['settings'],
  progress: { unlocked: 7 },
  sessions: [],
  attempts: [{ sent: 'K', typed: 'K', responseMs: 320, at: 1 }],
  sending: [],
  rollups: [],
});

describe('export envelope', () => {
  it('round-trips through JSON with the history intact', () => {
    const parsed = parseEnvelope(JSON.parse(JSON.stringify(validEnvelope())));
    expect(parsed.progress.unlocked).toBe(7);
    expect(parsed.attempts).toHaveLength(1);
  });

  it('rejects a file that is not an export', () => {
    expect(() => parseEnvelope({ hello: 'world' })).toThrow(/not a cw trainer export/i);
    expect(() => parseEnvelope(null)).toThrow();
    expect(() => parseEnvelope('a string')).toThrow();
  });

  it('rejects a version this build cannot read, naming the range', () => {
    expect(() => parseEnvelope({ ...validEnvelope(), version: 99 })).toThrow(/versions 1 to/);
    expect(() => parseEnvelope({ ...validEnvelope(), version: 0 })).toThrow();
  });

  it('tolerates collections a future or older build omitted', () => {
    const sparse = { format: 'cw-trainer-export', version: 1 };
    const parsed = parseEnvelope(sparse);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.attempts).toEqual([]);
    expect(parsed.progress.unlocked).toBe(2);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses a nonsense unlocked count rather than breaking the course', () => {
    expect(parseEnvelope({ ...validEnvelope(), progress: { unlocked: 0 } }).progress.unlocked).toBe(2);
    expect(parseEnvelope({ ...validEnvelope(), progress: { unlocked: 'lots' } }).progress.unlocked).toBe(2);
  });
});

describe('settings merge', () => {
  it('fills in a field a stored settings object does not have yet', () => {
    const merged = mergeSettings({ timing: { characterWpm: 25 } });
    expect(merged.timing.characterWpm).toBe(25);
    expect(merged.timing.weighting).toBe(DEFAULT_SETTINGS.timing.weighting);
    expect(merged.audio.pitchHz).toBe(600);
  });

  it('returns defaults for junk', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('does not share structure with the frozen defaults', () => {
    const merged = mergeSettings({});
    merged.timing.characterWpm = 99;
    expect(DEFAULT_SETTINGS.timing.characterWpm).toBe(18);
  });

  it('ships the VBand bracket convention as the default key map', () => {
    expect(VBAND_KEYMAP.ditKeys).toContain('BracketLeft');
    expect(VBAND_KEYMAP.dahKeys).toContain('BracketRight');
    expect(DEFAULT_SETTINGS.keyMap).toEqual(VBAND_KEYMAP);
  });
});

describe('progress across export versions (RFD A25)', () => {
  it('carries the failed-character weighting out and back', () => {
    const file = {
      format: 'cw-trainer-export', version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      settings: DEFAULT_SETTINGS,
      progress: { unlocked: 9, failed: ['R', '7'] },
      sessions: [], attempts: [], sending: [], rollups: [],
    };
    const parsed = parseEnvelope(file);
    expect(parsed.progress).toEqual({ unlocked: 9, failed: ['R', '7'] });
  });

  it('still reads a version 1 file, written before the exam existed', () => {
    const old = {
      format: 'cw-trainer-export', version: 1,
      exportedAt: new Date().toISOString(),
      settings: DEFAULT_SETTINGS,
      progress: { unlocked: 7 },
      sessions: [], attempts: [], sending: [], rollups: [],
    };
    const parsed = parseEnvelope(old);
    expect(parsed.progress.unlocked).toBe(7);
    expect(parsed.progress.failed).toEqual([]);
  });

  it('ignores rubbish in the weighting rather than refusing the file', () => {
    const file = {
      format: 'cw-trainer-export', version: 2,
      exportedAt: new Date().toISOString(),
      settings: DEFAULT_SETTINGS,
      progress: { unlocked: 4, failed: ['R', 7, null, 'K'] },
      sessions: [], attempts: [], sending: [], rollups: [],
    };
    expect(parseEnvelope(file).progress.failed).toEqual(['R', 'K']);
  });

  it('refuses a file from a future build in words a member can act on', () => {
    const future = {
      format: 'cw-trainer-export', version: EXPORT_VERSION + 1,
      exportedAt: new Date().toISOString(),
      settings: DEFAULT_SETTINGS, progress: { unlocked: 2 },
      sessions: [], attempts: [], sending: [], rollups: [],
    };
    expect(() => parseEnvelope(future)).toThrow(/Unsupported export version/);
  });
});
