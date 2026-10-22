/**
 * RST, the report exchanged in a CW contact (RFP §7: what goes in the log).
 *
 * Readability 1–5, Strength 1–9, Tone 1–9. On CW it is sent with the
 * cut numbers operators actually use — N for 9, T for 0 — so "5NN" is 599
 * and both spellings must be accepted; what is stored and exported is the
 * plain digits, which is what every logging program expects in RST_SENT and
 * RST_RCVD. Two characters (RS only) is not valid for CW, where tone is part
 * of the report; a member who sends "59" is told so rather than logged
 * wrongly.
 */

/** "5NN" → "599", "579" → "579"; null if it is not an RST. */
export function normaliseRst(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/N/g, '9').replace(/T/g, '0');
  if (!/^[1-5][1-9][1-9]$/.test(s)) return null;
  return s;
}

/** The report as operators send it on CW: 599 → 5NN. */
export function cutRst(rst: string): string {
  return rst.replace(/9/g, 'N').replace(/0/g, 'T');
}
