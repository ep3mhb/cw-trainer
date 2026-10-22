/**
 * Progress reporting (RFP §4).
 *
 * Per-character accuracy, the confusion matrix, effective WPM over time,
 * session history and CSV export. The confusion matrix is the feature the
 * RFP singles out as "required, not a nice-to-have", so it is the centre of
 * this view rather than a footnote.
 */

import {
  characterStats, characterStatsToCsv, confusionMatrix, sessionsToCsv,
  type Attempt, type SessionRecord,
} from '../core/stats';
import { badge, clear, downloadText, el } from './dom';
import { api } from '../net/api';
import type { SendingRecord } from '../storage/schema';
import type { Ctx, View } from './context';

export function progressView(ctx: Ctx): View {
  const node = el('div');
  const headline = el('div', { class: 'row' });
  const charTable = el('div', { class: 'scroll-x' });
  const matrixBox = el('div', { class: 'scroll-x' });
  const confusionList = el('p', { class: 'hint' });
  const trend = el('div');
  const historyTable = el('div', { class: 'scroll-x' });
  const sendingTable = el('div', { class: 'scroll-x' });

  const exportSessionsCsv = el('button', { class: 'btn', text: 'Sessions CSV' });
  const exportCharsCsv = el('button', { class: 'btn', text: 'Per-character CSV' });

  let sessions: SessionRecord[] = [];
  let attempts: Attempt[] = [];
  let sending: SendingRecord[] = [];

  exportSessionsCsv.addEventListener('click', () => {
    downloadText('cw-sessions.csv', sessionsToCsv(sessions), 'text/csv');
  });
  exportCharsCsv.addEventListener('click', () => {
    downloadText('cw-characters.csv', characterStatsToCsv(characterStats(attempts)), 'text/csv');
  });

  function renderHeadline(): void {
    const totalAttempted = sessions.reduce((a, s) => a + s.attempted, 0);
    const totalCorrect = sessions.reduce((a, s) => a + s.correct, 0);
    const accuracy = totalAttempted === 0 ? 0 : totalCorrect / totalAttempted;
    const best = sessions.reduce((a, s) => Math.max(a, s.effectiveWpm), 0);
    clear(headline);
    headline.append(
      badge('Sessions', String(sessions.length)),
      badge('Characters copied', String(totalAttempted)),
      badge(
        'Overall accuracy',
        totalAttempted === 0 ? '—' : `${(accuracy * 100).toFixed(1)}%`,
        totalAttempted === 0 ? '' : accuracy >= 0.9 ? 'good' : 'warn',
      ),
      badge('Characters unlocked', `${String(ctx.progress.unlocked)} of 40`),
      badge('Best effective speed', best === 0 ? '—' : `${String(best)} WPM`),
    );
  }

  function renderCharacters(): void {
    const stats = characterStats(attempts);
    clear(charTable);
    if (stats.length === 0) {
      charTable.append(el('p', { class: 'hint', text: 'No receiving data yet. Run a session on the Receive tab.' }));
      return;
    }
    const rows = stats.map((s) =>
      el(
        'tr',
        {},
        el('td', {}, el('b', { text: s.character })),
        el('td', { class: 'num', text: String(s.attempted) }),
        el('td', { class: 'num', text: String(s.correct) }),
        el('td', { class: 'num', text: `${(s.accuracy * 100).toFixed(0)}%` }),
        el('td', { class: 'num', text: s.medianResponseMs === 0 ? '—' : `${String(Math.round(s.medianResponseMs))} ms` }),
      ),
    );
    charTable.append(
      el(
        'table',
        {},
        el('caption', { class: 'sr-only', text: 'Per-character accuracy, worst first' }),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'Char' }),
            el('th', { class: 'num', text: 'Sent' }),
            el('th', { class: 'num', text: 'Right' }),
            el('th', { class: 'num', text: 'Accuracy' }),
            el('th', { class: 'num', text: 'Median response' }),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
    );
  }

  function renderMatrix(): void {
    const matrix = confusionMatrix(attempts);
    clear(matrixBox);
    clear(confusionList);
    if (matrix.characters.length === 0) {
      matrixBox.append(el('p', { class: 'hint', text: 'The matrix fills in as you copy.' }));
      return;
    }

    const columns = [...matrix.characters, '·'];
    const head = el('tr', {}, el('th', { text: 'sent ↓' }), ...columns.map((c) => el('th', { text: c })));
    const body = matrix.characters.map((sentChar) => {
      const row = matrix.counts.get(sentChar);
      return el(
        'tr',
        {},
        el('th', { text: sentChar }),
        ...columns.map((typedChar) => {
          const count = row?.get(typedChar) ?? 0;
          if (count === 0) return el('td', { text: '·' });
          if (typedChar === sentChar) return el('td', { class: 'self', text: String(count) });
          return el('td', { class: 'conf', title: `${sentChar} heard as ${typedChar}`, text: String(count) });
        }),
      );
    });
    matrixBox.append(
      el(
        'table',
        { class: 'matrix' },
        el('caption', { class: 'sr-only', text: 'Confusion matrix: rows are characters sent, columns what was typed. The dot column is a missed character.' }),
        el('thead', {}, head),
        el('tbody', {}, ...body),
      ),
    );

    if (matrix.topConfusions.length > 0) {
      confusionList.textContent = `Worst confusions: ${matrix.topConfusions
        .map((c) => `${c.sent}→${c.typed === '·' ? 'missed' : c.typed} (${String(c.count)})`)
        .join(', ')}. Drill these deliberately.`;
    }
  }

  /** Effective WPM over time, drawn as an inline SVG — no chart library. */
  function renderTrend(): void {
    clear(trend);
    const points = sessions.filter((s) => s.attempted > 0);
    if (points.length < 2) {
      trend.append(el('p', { class: 'hint', text: 'Two or more sessions are needed to draw a trend.' }));
      return;
    }
    const width = 640;
    const height = 180;
    const pad = 28;
    const maxWpm = Math.max(...points.map((s) => s.effectiveWpm), 10) * 1.15;
    const step = (width - pad * 2) / Math.max(1, points.length - 1);

    const toY = (value: number): number => height - pad - (value / maxWpm) * (height - pad * 2);
    const line = points.map((s, i) => `${String(pad + i * step)},${String(toY(s.effectiveWpm))}`).join(' ');
    const accuracyLine = points
      .map((s, i) => `${String(pad + i * step)},${String(toY((s.correct / s.attempted) * maxWpm))}`)
      .join(' ');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Effective speed over ${String(points.length)} sessions, from ${String(points[0]?.effectiveWpm ?? 0)} to ${String(points[points.length - 1]?.effectiveWpm ?? 0)} WPM`);
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.innerHTML =
      `<line x1="${String(pad)}" y1="${String(height - pad)}" x2="${String(width - pad)}" y2="${String(height - pad)}" stroke="currentColor" opacity="0.3"/>` +
      `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${line}"/>` +
      `<polyline fill="none" stroke="var(--good)" stroke-width="1.5" stroke-dasharray="4 3" points="${accuracyLine}"/>` +
      `<text x="${String(pad)}" y="${String(pad - 10)}" fill="currentColor" font-size="11" opacity="0.7">effective WPM (solid) · accuracy (dashed, full scale = 100%)</text>`;
    trend.append(svg);
  }

  function renderHistory(): void {
    clear(historyTable);
    if (sessions.length === 0) {
      historyTable.append(el('p', { class: 'hint', text: 'No sessions recorded yet.' }));
      return;
    }
    const rows = [...sessions].reverse().slice(0, 40).map((s) =>
      el(
        'tr',
        {},
        el('td', { text: new Date(s.startedAt).toLocaleString() }),
        el('td', { text: s.lessonType }),
        el('td', { class: 'num', text: `${String(s.characterWpm)}/${String(s.effectiveWpm)}` }),
        el('td', { class: 'num', text: String(s.attempted) }),
        el('td', { class: 'num', text: s.attempted === 0 ? '—' : `${((s.correct / s.attempted) * 100).toFixed(0)}%` }),
      ),
    );
    historyTable.append(
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'When' }),
            el('th', { text: 'Lesson' }),
            el('th', { class: 'num', text: 'Char/Eff' }),
            el('th', { class: 'num', text: 'Chars' }),
            el('th', { class: 'num', text: 'Accuracy' }),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
    );
  }

  function renderSending(): void {
    clear(sendingTable);
    if (sending.length === 0) {
      sendingTable.append(el('p', { class: 'hint', text: 'No sending analysed yet. Use the Send tab.' }));
      return;
    }
    const rows = [...sending].reverse().slice(0, 30).map((r) =>
      el(
        'tr',
        {},
        el('td', { text: new Date(r.at).toLocaleString() }),
        el('td', { class: 'num', text: `${r.estimatedWpm.toFixed(1)}` }),
        el('td', { class: 'num', text: r.weighting.toFixed(2) }),
        el('td', { class: 'num', text: `${(r.consistency * 100).toFixed(0)}%` }),
        el('td', { class: 'num', text: `${(r.accuracy * 100).toFixed(0)}%` }),
        el('td', { class: 'num', text: `${r.measuredLatencyMs.toFixed(0)} ms` }),
      ),
    );
    sendingTable.append(
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'When' }),
            el('th', { class: 'num', text: 'WPM' }),
            el('th', { class: 'num', text: 'Weight' }),
            el('th', { class: 'num', text: 'Steady' }),
            el('th', { class: 'num', text: 'Match' }),
            el('th', { class: 'num', text: 'Latency' }),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
    );
  }

  async function load(): Promise<void> {
    [sessions, attempts, sending] = await Promise.all([
      ctx.store.sessions(),
      ctx.store.attempts(),
      ctx.store.sending(),
    ]);
    renderHeadline();
    renderCharacters();
    renderMatrix();
    renderTrend();
    renderHistory();
    renderSending();
  }

  /*
   * RFD A37: the same questions, answered across every device rather than
   * for this browser alone.
   *
   * Deliberately a panel on this tab and not a view of its own. A member
   * asking "how am I doing" does not want to choose between two answers
   * first; they want the one that counts, and when records are kept on the
   * server that is this one. It is absent entirely for anyone who has not
   * asked for the service, which is most people.
   */
  const acrossPanel = el('section', { class: 'panel', hidden: true },
    el('h2', { text: 'Across your devices' }));
  const acrossBody = el('div');
  acrossPanel.append(acrossBody);

  async function loadAcross(): Promise<void> {
    if (!ctx.member?.keepRecords) {
      acrossPanel.hidden = true;
      return;
    }
    acrossPanel.hidden = false;
    clear(acrossBody);
    acrossBody.append(el('p', { class: 'hint', text: 'Asking the server\u2026' }));
    try {
      const report = await api.trainingReport();
      clear(acrossBody);
      if (!report.keepRecords) { acrossPanel.hidden = true; return; }

      const attempted = report.characters.reduce((a, c) => a + c.attempted, 0);
      const correct = report.characters.reduce((a, c) => a + c.correct, 0);
      const accuracy = attempted === 0 ? 0 : correct / attempted;

      acrossBody.append(
        el('div', { class: 'row' },
          badge('Sessions', String(report.sessions.length)),
          badge('Characters copied', String(attempted)),
          badge('Overall accuracy', attempted === 0 ? '\u2014' : `${(accuracy * 100).toFixed(1)}%`,
            attempted === 0 ? '' : accuracy >= 0.9 ? 'good' : 'warn'),
          badge('Characters unlocked', `${String(report.unlocked)} of 40`)),
      );

      if (report.sessions.length === 0) {
        acrossBody.append(el('p', { class: 'hint', text:
          'Nothing here yet. Your next finished session will be the first \u2014 and if you have practised on '
          + 'another device since turning this on, it will appear when that device is next online.' }));
        return;
      }

      // Per character, rolled up across every session the server holds.
      const rows = [...report.characters].sort((a, b) =>
        (a.correct / Math.max(1, a.attempted)) - (b.correct / Math.max(1, b.attempted)));
      const table = el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Character' }), el('th', { text: 'Attempted' }),
          el('th', { text: 'Correct' }), el('th', { text: 'Accuracy' }), el('th', { text: 'Mean reply' }))),
        el('tbody', {}, ...rows.map((c) => el('tr', {},
          el('td', { text: c.character }),
          el('td', { text: String(c.attempted) }),
          el('td', { text: String(c.correct) }),
          el('td', { text: c.attempted === 0 ? '\u2014' : `${((c.correct / c.attempted) * 100).toFixed(0)}%` }),
          // The mean is over correct answers only, which is what the
          // browser sends: a wrong key or none at all times hesitation and
          // the timeout, not recognition.
          el('td', { text: c.correct === 0 ? '\u2014' : `${String(Math.round(c.responseMsTotal / c.correct))} ms` })))),
      );
      acrossBody.append(
        el('p', { class: 'hint', text: 'Weakest first. This is every session the server holds, from every device you practise on.' }),
        el('div', { class: 'scroll-x' }, table),
      );
    } catch {
      clear(acrossBody);
      acrossBody.append(el('p', { class: 'hint', text:
        'Could not reach the server. What you see below is this browser\u2019s own history, which is '
        + 'complete for this device.' }));
    }
  }

  node.append(
    acrossPanel,
    el('section', { class: 'panel' }, el('h2', { text: 'Progress' }), headline,
      el('div', { style: 'height:0.7rem' }),
      el('div', { class: 'row' }, exportSessionsCsv, exportCharsCsv)),
    el('section', { class: 'panel' }, el('h2', { text: 'Effective speed over time' }), trend),
    el('section', { class: 'panel' }, el('h2', { text: 'Confusion matrix' }),
      el('p', { class: 'hint', text: 'Rows are what was sent, columns what you typed. The · column counts characters you missed entirely.' }),
      matrixBox, confusionList),
    el('section', { class: 'panel' }, el('h2', { text: 'Per character' }), charTable),
    el('section', { class: 'panel' }, el('h2', { text: 'Session history' }), historyTable),
    el('section', { class: 'panel' }, el('h2', { text: 'Sending history' }), sendingTable),
  );

  const refresh = async (): Promise<void> => {
    await load();
    await loadAcross();
  };

  void refresh();

  return { node, refresh };
}
