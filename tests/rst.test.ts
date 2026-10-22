import { describe, expect, it } from 'vitest';
import { cutRst, normaliseRst } from '../src/core/rst';

describe('RST as sent and as logged', () => {
  it('accepts cut numbers and stores digits', () => {
    expect(normaliseRst('5NN')).toBe('599');
    expect(normaliseRst(' 5nn ')).toBe('599');
    expect(normaliseRst('579')).toBe('579');
    expect(normaliseRst('4N8')).toBe('498');
  });
  it('rejects what is not a CW report', () => {
    expect(normaliseRst('59')).toBeNull();      // no tone: phone, not CW
    expect(normaliseRst('699')).toBeNull();     // readability is 1–5
    expect(normaliseRst('5T9')).toBeNull();     // strength 0 is not a strength
    expect(normaliseRst('abc')).toBeNull();
    expect(normaliseRst('')).toBeNull();
  });
  it('cuts the numbers for sending', () => {
    expect(cutRst('599')).toBe('5NN');
    expect(cutRst('579')).toBe('57N');
  });
});
