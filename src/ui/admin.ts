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
import { clear, el } from './dom';
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

  const when = (iso: string): string => new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  async function act(m: AdminMember, action: AdminAction, ask: string, twice = false): Promise<void> {
    const reason = window.prompt(`${ask} ${m.callsign} (${m.name}). Reason, for the log:`);
    if (reason === null) return;
    if (twice && !window.confirm(`${ask} ${m.callsign}: this cannot be undone from here. Go ahead?`)) return;
    try {
      await api.adminAct(m.id, action, reason.trim());
      ctx.toast(`${m.callsign}: ${action} done.`, 'good');
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : 'that did not work', 'bad');
    }
    await load();
  }

  function memberRow(m: AdminMember, awaiting: boolean): HTMLElement {
    const id = describeIdentifier(m.callsign);
    const deleted = isDeleted(m);
    const unconfirmed = !m.training && !m.verified && !deleted;
    const actions = el('div', { class: 'row' });
    const button = (text: string, cls: string, onClick: () => void): void => {
      const b = el('button', { class: cls, text });
      b.addEventListener('click', onClick);
      actions.append(b);
    };
    if (m.id !== me.id && !deleted) {
      if (!m.training) {
        if (m.verified) button('Withdraw confirmation', 'btn', () => void act(m, 'unverify', 'Withdraw confirmation of'));
        else button('Confirm callsign', 'btn primary', () => void act(m, 'verify', 'Confirm the callsign of'));
      }
      if (m.muted) button('Unmute', 'btn', () => void act(m, 'unmute', 'Lift the mute on'));
      button('Force reset', 'btn', () => void act(m, 'reset', 'Sign out and mail a reset link to', true));
      if (m.disabled) button('Enable', 'btn', () => void act(m, 'enable', 'Enable'));
      else button('Disable', 'btn danger', () => void act(m, 'disable', 'Disable'));
      // Destructive, and drawn as such: the account is emptied and the
      // callsign released. The reason is still required.
      button('Delete', 'btn danger destructive', () => void act(m, 'delete', 'Delete', true));
    }
    return el('div', { class: `admin-row${awaiting ? ' attention' : ''}` },
      el('div', { class: 'station-main' },
        el('b', { class: 'mono', text: id.text }),
        m.training ? el('span', { class: 'badge warn', text: 'training' }) : null,
        unconfirmed ? el('span', { class: 'badge bad', text: 'unconfirmed' }) : null,
        m.role !== 'member' && m.role !== 'student' ? el('span', { class: 'badge', text: m.role }) : null,
        deleted ? el('span', { class: 'badge bad', text: 'deleted' }) : m.disabled ? el('span', { class: 'badge bad', text: 'disabled' }) : null,
        m.muted ? el('span', { class: 'badge warn', text: 'muted' }) : null,
        el('span', { class: 'hint', text: deleted ? '' : `${m.name} · ${m.email}` })),
      actions);
  }

  function renderMembers(): void {
    clear(memberList);
    clear(deletedList);
    const gone = members.filter(isDeleted);
    const active = members.filter((m) => !isDeleted(m));
    const awaiting = active.filter((m) => !m.training && !m.verified && !m.disabled);
    note.textContent = `${String(active.length)} member${active.length === 1 ? '' : 's'}`
      + (gone.length > 0 ? ` · ${String(gone.length)} deleted` : '')
      + (awaiting.length > 0 ? ` — ${String(awaiting.length)} callsign${awaiting.length === 1 ? '' : 's'} awaiting confirmation` : '')
      + '.';
    // Those waiting on you first, then the rest by callsign.
    const ordered = [...awaiting, ...active.filter((m) => !awaiting.includes(m))];
    for (const m of ordered) memberList.append(memberRow(m, awaiting.includes(m)));

    deletedBox.hidden = gone.length === 0;
    deletedSummary.textContent = `${String(gone.length)} deleted account${gone.length === 1 ? '' : 's'}`;
    for (const m of gone) deletedList.append(memberRow(m, false));
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
          try { await api.adminResolve(r.id); } catch (error) { ctx.toast(error instanceof Error ? error.message : 'that did not work', 'bad'); }
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
        api.adminMembers().then((r) => r.members),
        api.adminReports().then((r) => r.reports),
      ]);
    } catch (error) {
      note.textContent = error instanceof Error ? error.message : 'could not load';
      return;
    }
    renderMembers();
    renderReports();
  }
  reload.addEventListener('click', () => void load());

  panel.append(
    el('p', { class: 'hint' },
      'The four actions an administrator has. A claimed callsign is marked unconfirmed until you confirm it, and '
      + 'no contact with an unconfirmed callsign exports. Every action is logged with your reason.'),
    el('div', { class: 'row' }, note, reload),
    memberList,
    deletedBox,
    el('h3', { text: 'Reports from members' }),
    reportList,
  );
  void load();
  return { node: panel, reload: load };
}
