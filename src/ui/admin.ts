/**
 * The administrator's tab (RFP §8: "Minimal admin page for Phase 2
 * release — four actions only: approve a callsign, reset a password, disable
 * a user, delete a user"), plus the reports members have sent (§7).
 *
 * A tab of its own, shown only while a member whose role is admin is signed
 * in; it was at the foot of the On air tab until 0.7.3, where it sat below a
 * member's own log and had to be scrolled past. The server decides what an
 * administrator is, this file only asks — hiding the tab tidies the
 * interface and protects nothing, and every route behind it refuses a
 * non-administrator with 403 whether or not the tab is on screen.
 *
 * Every action takes a reason, which is logged with the action on the
 * server, and the two irreversible ones (delete, forced reset) ask twice.
 *
 * Why callsign confirmation matters enough for a page of its own: a member
 * who types someone else's callsign at registration would otherwise appear
 * on the band, and in other members' ADIF logs, as that operator. Until an
 * administrator confirms it, the callsign is marked "unconfirmed" wherever
 * it appears and no contact with it is exportable.
 */

import { describeIdentifier } from '../core/callsign';
import { api, type AdminAction, type AdminMember, type MemberInfo, type ReportRecord } from '../net/api';
import { clear, el, failureText } from './dom';
import type { Ctx, View } from './context';

/**
 * A deleted account. The server keeps the row so that the moderation log and
 * other members' contacts still have something to point at, and empties it:
 * the callsign becomes DELETED-<id> and the name and address go. They are
 * not members any more, so they are not counted as members and not listed
 * with them.
 */
const isDeleted = (m: AdminMember): boolean => m.callsign.startsWith('DELETED-');

export function adminView(ctx: Ctx): View {
  const node = el('div', { class: 'view admin-view' });
  const me = ctx.member;
  if (me === null || me.role !== 'admin') {
    node.append(el('section', { class: 'panel' },
      el('h2', { text: 'Administration' }),
      el('p', { class: 'hint', text: 'Sign in on the On air tab as an administrator to use this tab.' })));
    return { node };
  }
  const panel = adminPanel(ctx, me);
  node.append(panel.node);
  return { node, refresh: () => void panel.reload() };
}

function adminPanel(ctx: Ctx, me: MemberInfo): { node: HTMLElement; reload: () => Promise<void> } {
  const panel = el('section', { class: 'panel admin-panel' }, el('h2', { text: 'Administration' }));
  const note = el('p', { class: 'hint', text: 'Loading members…' });
  const memberList = el('div', { class: 'admin-list' });
  const deletedList = el('div', { class: 'admin-list' });
  const deletedSummary = el('summary', { class: 'hint', text: 'Deleted accounts' });
  const deletedBox = el('details', { class: 'admin-deleted' }, deletedSummary, deletedList);
  const reportList = el('div', { class: 'admin-list' });
  const reload = el('button', { class: 'btn', text: 'Refresh' });

  let members: AdminMember[] = [];
  let reports: ReportRecord[] = [];
  /** A58: which members the table shows, and whether the server approves callsigns itself. */
  let filter: 'all' | 'attention' | 'waiting' | 'active' | 'disabled' = 'all';
  let autoApprove = true;
  const filters = el('div', { class: 'row admin-filters' });

  const when = (iso: string): string => new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  /** What each action did, said as a sentence (RFD A59): not the action's code name. */
  const DONE: Record<AdminAction, (m: AdminMember) => string> = {
    'verify': (m) => `${m.callsign}: callsign confirmed.`,
    'unverify': (m) => `${m.callsign}: callsign confirmation withdrawn.`,
    'disable': (m) => `${m.callsign}: account disabled.`,
    'enable': (m) => `${m.callsign}: account enabled.`,
    'delete': (m) => `${m.callsign}: account deleted.`,
    'reset': (m) => `${m.callsign}: signed out everywhere, and a reset link sent to ${m.email}.`,
    'unmute': (m) => `${m.callsign}: mute lifted.`,
    'confirm-link': (m) => `Confirmation link sent to ${m.email}.`,
  };

  async function act(m: AdminMember, action: AdminAction, ask: string, twice = false): Promise<void> {
    const reason = window.prompt(`${ask} ${m.callsign} (${m.name}). Reason, for the log:`);
    if (reason === null) return;
    if (twice && !window.confirm(`${ask} ${m.callsign}: this cannot be undone from here. Go ahead?`)) return;
    try {
      await api.adminAct(m.id, action, reason.trim());
      ctx.toast(DONE[action](m), 'good');
    } catch (error) {
      ctx.toast(failureText(error, 'That did not work.'), 'bad');
    }
    await load();
  }

  /**
   * RFD A58: one status per member, in plain words, instead of a row of
   * badges. `group` decides the filter it falls under; `tone` its colour.
   */
  type Group = 'waiting' | 'attention' | 'active' | 'disabled';
  function statusOf(m: AdminMember): { text: string; tone: 'good' | 'warn' | 'bad' | ''; group: Group } {
    if (m.disabled) return { text: 'Disabled', tone: 'bad', group: 'disabled' };
    if (m.emailConfirmed === false) {
      if (m.confirmationSentAt && m.confirmationExpired) {
        return { text: `Link expired (sent ${short(m.confirmationSentAt)})`, tone: 'bad', group: 'attention' };
      }
      if (m.confirmationSentAt) return { text: `Waiting for email · link sent ${short(m.confirmationSentAt)}`, tone: 'warn', group: 'waiting' };
      return { text: 'Waiting for email · no link sent yet', tone: 'warn', group: 'attention' };
    }
    if (!m.training && !m.verified) {
      return autoApprove
        ? { text: 'Callsign withdrawn', tone: 'bad', group: 'attention' }
        : { text: 'Callsign to approve', tone: 'warn', group: 'attention' };
    }
    return { text: m.muted ? 'Active · muted' : 'Active', tone: m.muted ? 'warn' : 'good', group: 'active' };
  }

  const short = (iso: string): string => new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const day = (iso: string | null | undefined): string => (iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  function memberRow(m: AdminMember): HTMLElement {
    const id = describeIdentifier(m.callsign);
    const deleted = isDeleted(m);
    const status = deleted ? { text: 'Deleted', tone: '' as const, group: 'disabled' as Group } : statusOf(m);
    const main = el('div', { class: 'admin-act' });
    const more = el('details', { class: 'admin-more' });
    const menu = el('div', { class: 'admin-menu' });
    const primary = (text: string, cls: string, onClick: () => void): void => {
      const btn = el('button', { class: cls, text });
      btn.addEventListener('click', onClick);
      main.append(btn);
    };
    const item = (text: string, cls: string, onClick: () => void): void => {
      const btn = el('button', { class: cls, text });
      btn.addEventListener('click', () => { more.open = false; onClick(); });
      menu.append(btn);
    };
    if (m.id !== me.id && !deleted) {
      // The one thing to do now, if there is one.
      if (m.disabled) primary('Enable', 'btn', () => void act(m, 'enable', 'Enable'));
      else if (m.emailConfirmed === false) {
        const live = m.confirmationSentAt != null && !m.confirmationExpired;
        primary(live ? 'Send again' : 'Send link', live ? 'btn' : 'btn primary',
          () => void act(m, 'confirm-link', 'Mail a confirmation link to'));
      } else if (!m.training && !m.verified) {
        primary(autoApprove ? 'Confirm callsign again' : 'Approve callsign', 'btn primary',
          () => void act(m, 'verify', 'Confirm the callsign of'));
      } else if (m.muted) primary('Unmute', 'btn', () => void act(m, 'unmute', 'Lift the mute on'));
      // Everything else, out of the way.
      if (!m.training && m.verified) item('Withdraw callsign confirmation', 'btn', () => void act(m, 'unverify', 'Withdraw confirmation of'));
      item('Force password reset', 'btn', () => void act(m, 'reset', 'Sign out and mail a reset link to', true));
      if (!m.disabled) item('Disable account', 'btn danger', () => void act(m, 'disable', 'Disable'));
      item('Delete account', 'btn danger destructive', () => void act(m, 'delete', 'Delete', true));
      more.append(el('summary', { class: 'btn', text: 'More ▾' }), menu);
    }
    const tags = el('span', { class: 'admin-tags' },
      m.training ? el('span', { class: 'badge warn', text: 'training' }) : null,
      m.role === 'admin' ? el('span', { class: 'badge', text: 'admin' }) : null);
    return el('div', { class: `admin-tr${status.group === 'attention' ? ' attention' : ''}` },
      el('div', { class: 'admin-td admin-call' }, el('b', { class: 'mono', text: id.text }), tags),
      el('div', { class: 'admin-td admin-who' },
        el('span', { text: deleted ? '' : m.name }),
        el('span', { class: 'hint', text: deleted ? '' : m.email })),
      el('div', { class: 'admin-td' }, el('span', { class: `admin-status ${status.tone}`, text: status.text })),
      el('div', { class: 'admin-td hint' }, day(m.createdAt)),
      el('div', { class: 'admin-td hint' }, day(m.lastSeenAt)),
      el('div', { class: 'admin-td admin-actions' }, main, m.id !== me.id && !deleted ? more : null));
  }

  const head = (): HTMLElement => el('div', { class: 'admin-tr admin-th' },
    ...['Callsign', 'Name and email', 'Status', 'Joined', 'Last on the band', ''].map((t) => el('div', { class: 'admin-td', text: t })));

  function renderMembers(): void {
    clear(memberList);
    clear(deletedList);
    clear(filters);
    const gone = members.filter(isDeleted);
    const current = members.filter((m) => !isDeleted(m));
    const count = (g: Group): number => current.filter((m) => statusOf(m).group === g).length;
    const parts: [typeof filter, string, number][] = [
      ['all', 'All', current.length],
      ['attention', 'Needs you', count('attention')],
      ['waiting', 'Waiting for email', count('waiting')],
      ['active', 'Active', count('active')],
      ['disabled', 'Disabled', count('disabled')],
    ];
    for (const [key, label, n] of parts) {
      if (key !== 'all' && n === 0 && filter !== key) continue;
      const chip = el('button', { class: `btn admin-chip${filter === key ? ' on' : ''}`, text: `${label} ${String(n)}` });
      chip.addEventListener('click', () => { filter = key; renderMembers(); });
      filters.append(chip);
    }
    note.textContent = `${String(current.length)} member${current.length === 1 ? '' : 's'}`
      + (gone.length > 0 ? ` · ${String(gone.length)} deleted` : '') + '.'
      + (autoApprove ? ' Callsigns are confirmed automatically when the member confirms their email.' : '');
    const order: Group[] = ['attention', 'waiting', 'active', 'disabled'];
    const shown = current
      .filter((m) => filter === 'all' || statusOf(m).group === filter)
      .sort((x, y) => order.indexOf(statusOf(x).group) - order.indexOf(statusOf(y).group) || x.callsign.localeCompare(y.callsign));
    memberList.append(head());
    for (const m of shown) memberList.append(memberRow(m));
    if (shown.length === 0) memberList.append(el('p', { class: 'hint', text: 'Nobody here.' }));

    deletedBox.hidden = gone.length === 0;
    deletedSummary.textContent = `${String(gone.length)} deleted account${gone.length === 1 ? '' : 's'}`;
    for (const m of gone) deletedList.append(memberRow(m));
  }

  function renderReports(): void {
    clear(reportList);
    const open = reports.filter((r) => !r.resolved);
    if (reports.length === 0) {
      reportList.append(el('p', { class: 'hint', text: 'No reports. Members can send one from any station’s row on the band.' }));
      return;
    }
    for (const r of [...open, ...reports.filter((r) => r.resolved)].slice(0, 30)) {
      const actions = el('div', { class: 'row' });
      if (!r.resolved) {
        const done = el('button', { class: 'btn', text: 'Mark dealt with' });
        done.addEventListener('click', () => void (async () => {
          try { await api.adminResolve(r.id); } catch (error) { ctx.toast(failureText(error, 'That did not work.'), 'bad'); }
          await load();
        })());
        actions.append(done);
      }
      reportList.append(el('div', { class: `admin-row${r.resolved ? '' : ' attention'}` },
        el('div', { class: 'station-main' },
          el('span', { class: 'mono hint', text: when(r.createdAt) }),
          el('b', { class: 'mono', text: r.byCallsign }),
          el('span', { class: 'hint', text: 'about' }),
          el('b', { class: 'mono', text: r.aboutCallsign }),
          r.resolved ? el('span', { class: 'badge good', text: 'dealt with' }) : el('span', { class: 'badge bad', text: 'open' }),
          el('span', { class: 'hint', style: 'width:100%', text: r.reason }),
          r.transcript
            ? el('details', { class: 'transcript', style: 'width:100%' },
              el('summary', { class: 'hint', text: `What ${r.aboutCallsign} sent, as the reporting browser decoded it` }),
              el('pre', { class: 'mono transcript-text', text: r.transcript }))
            : el('span', { class: 'hint', style: 'width:100%', text: 'No transcript: the reporter had not heard them send.' })),
        actions));
    }
  }

  async function load(): Promise<void> {
    try {
      [members, reports] = await Promise.all([
        api.adminMembers().then((r) => { autoApprove = r.autoApprove !== false; return r.members; }),
        api.adminReports().then((r) => r.reports),
      ]);
    } catch (error) {
      note.textContent = failureText(error, 'Could not load the members.');
      return;
    }
    renderMembers();
    renderReports();
  }
  reload.addEventListener('click', () => void load());

  panel.append(
    el('p', { class: 'hint' },
      'Each member has one status. The button beside it is the one thing to do now, if there is one; '
      + 'the rest is under More. Every action is logged with your reason.'),
    el('div', { class: 'row' }, note, reload),
    filters,
    memberList,
    deletedBox,
    el('h3', { text: 'Reports from members' }),
    reportList,
  );
  void load();
  return { node: panel, reload: load };
}
