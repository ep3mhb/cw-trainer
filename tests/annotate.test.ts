import { describe, expect, it } from 'vitest';
import { annotate } from '../src/ui/help';

describe('worked-example annotation', () => {
  it('puts the caret exactly under the character it points at', () => {
    const [line, carets] = annotate('CQ DE A65XY K', [{ find: 'K', note: 'over' }]);
    const column = carets!.indexOf('↑');
    expect(line![column]).toBe('K');
  });

  it('finds the nth occurrence, not the first', () => {
    const line = 'A = B = C';
    const [, carets] = annotate(line, [{ find: '=', nth: 2, note: '' }]);
    expect(carets!.indexOf('↑')).toBe(line.lastIndexOf('='));
  });

  it('places a caret under every mark', () => {
    const [, carets] = annotate('A = B = C', [
      { find: '=', nth: 1, note: '' },
      { find: '=', nth: 2, note: '' },
    ]);
    expect([...carets!].filter((c) => c === '↑')).toHaveLength(2);
  });

  it('indents each note to its own caret', () => {
    const [, , note] = annotate('CQ DE A65XY K', [{ find: 'K', note: 'over' }]);
    expect(note).toBe(`${' '.repeat(12)}over`);
  });

  it('drops a mark it cannot find rather than pointing at column zero', () => {
    const [line, carets] = annotate('CQ DE A65XY', [{ find: 'ZZ', note: 'nope' }]);
    expect(line).toBe('CQ DE A65XY');
    expect(carets).toBe('');
  });
});
