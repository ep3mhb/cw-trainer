/**
 * Accuracy, the confusion matrix and CSV export (RFP §4).
 *
 * "Per-character accuracy display and a confusion matrix showing which
 * characters are mistaken for which. This drives targeted drilling and is a
 * required feature, not a nice-to-have."
 */
import type { ConditionLevel } from './conditions';

/** One character the student was sent, and what they typed for it. */
export interface Attempt {
  /** The character that was sent. */
  sent: string;
  /** What the student typed, or '' where they typed nothing. */
  typed: string;
  /** Milliseconds from the character finishing to the keystroke. */
  responseMs: number;
  /** Epoch ms, used for the 30-day retention rule in RFP §4. */
  at: number;
}

export interface CharacterStat {
  character: string;
  attempted: number;
  correct: number;
  accuracy: number;
  medianResponseMs: number;
}

/**
 * Align what was sent against what was typed and produce one attempt per
 * sent character.
 *
 * A plain index-by-index comparison is wrong the moment the student drops a
 * character, so this walks both strings with a small edit-distance
 * alignment. Getting this right is what makes the confusion matrix
 * trustworthy.
 */
export function alignAnswer(sent: string, typed: string): { sent: string; typed: string }[] {
  const a = [...sent.replace(/\s+/g, '')];
  const b = [...typed.toUpperCase().replace(/\s+/g, '')];
  const n = a.length;
  const m = b.length;

  // Levenshtein table with operation backtracking.
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) (cost[i] as number[])[0] = i;
  for (let j = 0; j <= m; j += 1) (cost[0] as number[])[j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const substitution = (cost[i - 1] as number[])[j - 1] as number;
      const same = a[i - 1] === b[j - 1];
      (cost[i] as number[])[j] = Math.min(
        substitution + (same ? 0 : 1),
        ((cost[i - 1] as number[])[j] as number) + 1,
        ((cost[i] as number[])[j - 1] as number) + 1,
      );
    }
  }

  const pairs: { sent: string; typed: string }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = (cost[i] as number[])[j] as number;
    if (i > 0 && j > 0) {
      const diag = (cost[i - 1] as number[])[j - 1] as number;
      const same = a[i - 1] === b[j - 1];
      if (here === diag + (same ? 0 : 1)) {
        pairs.push({ sent: a[i - 1] as string, typed: b[j - 1] as string });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && here === ((cost[i - 1] as number[])[j] as number) + 1) {
      // Student missed this character entirely.
      pairs.push({ sent: a[i - 1] as string, typed: '' });
      i -= 1;
      continue;
    }
    // Student inserted a character that was never sent; not charged to any
    // sent character, but recorded so the matrix shows spurious input.
    pairs.push({ sent: '', typed: b[j - 1] as string });
    j -= 1;
  }
  return pairs.reverse();
}

/** Per-character accuracy across a set of attempts. */
export function characterStats(attempts: readonly Attempt[]): CharacterStat[] {
  const byChar = new Map<string, { attempted: number; correct: number; times: number[] }>();
  for (const attempt of attempts) {
    if (attempt.sent === '') continue;
    const entry = byChar.get(attempt.sent) ?? { attempted: 0, correct: 0, times: [] };
    entry.attempted += 1;
    if (attempt.typed === attempt.sent) {
      entry.correct += 1;
      if (attempt.responseMs > 0) entry.times.push(attempt.responseMs);
    }
    byChar.set(attempt.sent, entry);
  }
  return [...byChar.entries()]
    .map(([character, e]) => ({
      character,
      attempted: e.attempted,
      correct: e.correct,
      accuracy: e.attempted === 0 ? 0 : e.correct / e.attempted,
      medianResponseMs: median(e.times),
    }))
    .sort((x, y) => x.accuracy - y.accuracy || x.character.localeCompare(y.character));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
    : (sorted[mid] as number);
}

export interface ConfusionMatrix {
  /** Characters that appear as either a row or a column. */
  characters: string[];
  /** counts[sent][typed] — typed '' means the character was missed. */
  counts: Map<string, Map<string, number>>;
  /** The worst confusions, most frequent first. */
  topConfusions: { sent: string; typed: string; count: number }[];
}

/** Build the confusion matrix. */
export function confusionMatrix(attempts: readonly Attempt[]): ConfusionMatrix {
  const counts = new Map<string, Map<string, number>>();
  const characters = new Set<string>();
  const confusions: { sent: string; typed: string; count: number }[] = [];

  for (const attempt of attempts) {
    if (attempt.sent === '') continue;
    characters.add(attempt.sent);
    if (attempt.typed !== '') characters.add(attempt.typed);
    const row = counts.get(attempt.sent) ?? new Map<string, number>();
    const key = attempt.typed === '' ? '·' : attempt.typed;
    row.set(key, (row.get(key) ?? 0) + 1);
    counts.set(attempt.sent, row);
  }

  for (const [sent, row] of counts) {
    for (const [typed, count] of row) {
      if (typed !== sent) confusions.push({ sent, typed, count });
    }
  }
  confusions.sort((a, b) => b.count - a.count);

  return {
    characters: [...characters].sort(),
    counts,
    topConfusions: confusions.slice(0, 12),
  };
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  lessonType: string;
  characterWpm: number;
  effectiveWpm: number;
  attempted: number;
  correct: number;
  unlockedCount: number;
  /**
   * The conditions this session was worked at (RFD A39). Optional because
   * every session recorded before 0.10.0 has none, and an export from an
   * older build must still import; absent reads as 'off', which is what
   * those sessions were.
   */
  conditions?: ConditionLevel;
}

/**
 * Escape one CSV field per RFC 4180: wrap in quotes if it contains a comma,
 * a quote or a newline, and double any quote inside. The comma character is
 * itself part of the Koch course, so this is not a theoretical case.
 */
export function escapeCsv(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** CSV export of session history (RFP §4). */
export function sessionsToCsv(sessions: readonly SessionRecord[]): string {
  const header = [
    'session_id', 'started_at', 'ended_at', 'lesson_type', 'character_wpm',
    'effective_wpm', 'characters_attempted', 'characters_correct', 'accuracy',
    'characters_unlocked',
  ].join(',');
  const rows = sessions.map((s) => {
    const accuracy = s.attempted === 0 ? 0 : s.correct / s.attempted;
    return [
      s.id,
      new Date(s.startedAt).toISOString(),
      new Date(s.endedAt).toISOString(),
      s.lessonType,
      s.characterWpm,
      s.effectiveWpm,
      s.attempted,
      s.correct,
      accuracy.toFixed(4),
      s.unlockedCount,
    ].map(escapeCsv).join(',');
  });
  return [header, ...rows].join('\n');
}

/** CSV export of per-character accuracy. */
export function characterStatsToCsv(stats: readonly CharacterStat[]): string {
  const header = ['character', 'attempted', 'correct', 'accuracy', 'median_response_ms'].join(',');
  const rows = stats.map((s) =>
    [s.character, s.attempted, s.correct, s.accuracy.toFixed(4), Math.round(s.medianResponseMs)]
      .map(escapeCsv)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

/**
 * Raw attempt retention (RFP §4): "Raw attempt data retained 30 days, then
 * rolled up on a schedule."
 */
export const RAW_RETENTION_DAYS = 30;

export function partitionForRollup(
  attempts: readonly Attempt[],
  now: number = Date.now(),
): { keep: Attempt[]; rollUp: Attempt[] } {
  const cutoff = now - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep: Attempt[] = [];
  const rollUp: Attempt[] = [];
  for (const attempt of attempts) {
    if (attempt.at >= cutoff) keep.push(attempt);
    else rollUp.push(attempt);
  }
  return { keep, rollUp };
}
