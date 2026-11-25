/** RFD A57: every mail goes out as plain text and the same words as HTML. */
import { describe, expect, it } from 'vitest';
import { textToHtml } from '../src/mail';

describe('textToHtml', () => {
  it('keeps every word, links the addresses, and escapes the rest', () => {
    const text = 'Hello Anna <test>,\n\nOpen this:\n\nhttps://cw.example/#confirm-email=abc_DEF-1\n\n73\nRESONIK CW Trainer';
    const html = textToHtml(text);
    expect(html).toContain('<a href="https://cw.example/#confirm-email=abc_DEF-1"');
    expect(html).toContain('Hello Anna &lt;test&gt;,');
    expect(html).toContain('73<br>RESONIK CW Trainer');
    expect(html.match(/<p /g)).toHaveLength(4);
    expect(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).toContain('Open this:');
  });
});
