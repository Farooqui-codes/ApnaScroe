/**
 * ApnaScore Home Dashboard Controller
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'dashboard', pageTitle: 'Dashboard' });

    document.querySelectorAll('.quick-action-icon[data-icon]').forEach((el) => {
      el.innerHTML = ApnaIcons.icon(el.getAttribute('data-icon'), 20);
    });

    const user = ApnaAuth.getUser();
    if (user) {
      document.getElementById('welcomeHeading').textContent = `Namaste, ${user.name}!`;
    } else if (ApnaAuth.isGuest()) {
      document.getElementById('welcomeHeading').textContent = 'Welcome, Guest Scorer!';
      document.getElementById('guestBannerBox')?.classList.remove('hidden');
    } else {
      document.getElementById('guestBannerBox')?.classList.remove('hidden');
    }

    await checkOfflineRecovery();
    await loadDashboard();
    ApnaAnimations.animateCards('.kpi-card, .quick-action-card, .card');
  });

  async function checkOfflineRecovery() {
    if (!window.ApnaOffline) return;
    const localMatches = await ApnaOffline.getAllLocalMatches();
    const pendingCount = await ApnaOffline.getPendingEventsCount();
    const unsynced = localMatches.filter((m) => m.syncStatus !== 'synced');
    if (unsynced.length > 0 || pendingCount > 0) {
      const box = document.getElementById('offlineRecoveryBox');
      const list = document.getElementById('offlineRecoveryList');
      box.classList.remove('hidden');
      list.innerHTML = localMatches
        .slice(0, 4)
        .map((m) => {
          const title = ApnaUI.escapeHtml(m.match.title || 'Offline Match');
          const id = encodeURIComponent(m.serverMatchId || m.localId);
          return `<a href="/live-score.html?matchId=${id}" style="margin-right:12px;font-weight:700;">Resume: ${title} (${m.syncStatus})</a>`;
        })
        .join('') + (pendingCount ? ` • ${pendingCount} pending ball(s)` : '');

      document.getElementById('syncNowDashBtn').onclick = async () => {
        const res = await ApnaOffline.syncAllPending();
        if (res.error) ApnaUI.showToast(res.error, 'warning');
        else {
          ApnaUI.showToast(`Synced ${res.synced} scoring event(s).`);
          await checkOfflineRecovery();
          await loadDashboard();
        }
      };
    }
  }

  async function loadDashboard() {
    const [localMatches, localTeams, localPlayers] = await Promise.all([
      window.ApnaOffline ? ApnaOffline.getAllLocalMatches().catch(() => []) : [],
      window.ApnaOffline ? ApnaOffline.getLocalTeams().catch(() => []) : [],
      window.ApnaOffline ? ApnaOffline.getLocalPlayers().catch(() => []) : []
    ]);

    try {
      const data = await ApnaAPI.get('/api/dashboard/summary');
      const c = data.counts || {};
      const localOnlyMatches = localMatches.filter((lm) => !lm.serverMatchId);
      document.getElementById('kpiTotalMatches').textContent = (c.totalMatches ?? 0) + localOnlyMatches.length;
      document.getElementById('kpiLiveMatches').textContent = (c.liveMatches ?? 0) + localOnlyMatches.filter((m) => m.match?.status === 'live').length;
      document.getElementById('kpiUpcoming').textContent = c.upcomingMatches ?? 0;
      document.getElementById('kpiCompleted').textContent = (c.completedMatches ?? 0) + localOnlyMatches.filter((m) => m.match?.status === 'completed').length;
      document.getElementById('kpiTournaments').textContent = c.activeTournaments ?? 0;
      document.getElementById('kpiTeams').textContent = Math.max(c.totalTeams ?? 0, localTeams.length);
      document.getElementById('kpiPlayers').textContent = Math.max(c.totalPlayers ?? 0, localPlayers.length);

      const srvCombined = [...(data.liveMatches || []), ...(data.recentMatches || []).filter((r) => !(data.liveMatches || []).some((l) => l._id === r._id))];
      const merged = [
        ...localOnlyMatches.map((lm) => Object.assign({}, lm.match, { _id: lm.localId })),
        ...srvCombined
      ];
      renderMatches(merged.slice(0, 6));
      renderFixtures(data.upcomingFixtures || []);
      renderLeaders('topBatsmenList', data.topBatsmen || [], 'runs', 'Runs');
      renderLeaders('topBowlersList', data.topBowlers || [], 'wickets', 'Wkts');
      renderWinners(data.recentWinners || []);
    } catch (_) {
      // Offline / local fallback using IndexedDB data
      document.getElementById('kpiTotalMatches').textContent = localMatches.length;
      document.getElementById('kpiLiveMatches').textContent = localMatches.filter((m) => m.match?.status === 'live').length;
      document.getElementById('kpiCompleted').textContent = localMatches.filter((m) => m.match?.status === 'completed').length;
      document.getElementById('kpiTeams').textContent = localTeams.length;
      document.getElementById('kpiPlayers').textContent = localPlayers.length;
      renderMatches(localMatches.map((lm) => Object.assign({}, lm.match, { _id: lm.localId })).slice(0, 6));
      renderFixtures([]);
      renderLeaders('topBatsmenList', [], 'runs', 'Runs');
      renderLeaders('topBowlersList', [], 'wickets', 'Wkts');
      renderWinners([]);
    }
  }

  function renderMatches(matches) {
    const el = document.getElementById('recentMatchesList');
    if (!matches.length) {
      el.innerHTML = `<div class="empty-state">No matches yet. <a href="/match-create.html">Start your first match</a>.</div>`;
      return;
    }
    el.innerHTML = matches.map((m) => {
      const inn1 = (m.inningsSummary || []).find((i) => i.inningsNumber === 1);
      const inn2 = (m.inningsSummary || []).find((i) => i.inningsNumber === 2);
      const isLive = ['live', 'paused', 'innings_break'].includes(m.status);
      const badge = isLive
        ? `<span class="badge badge-live"><span class="live-dot"></span>LIVE</span>`
        : `<span class="badge badge-neutral">${ApnaUI.escapeHtml(m.status.toUpperCase())}</span>`;

      const scoreA = inn1 ? `${inn1.totalRuns}/${inn1.wickets} (${inn1.oversString})` : '-';
      const scoreB = inn2 ? `${inn2.totalRuns}/${inn2.wickets} (${inn2.oversString})` : '-';

      return `
        <div class="match-card">
          <div class="flex-between">
            <span class="text-sm text-muted">${ApnaUI.escapeHtml(m.venue)} • ${m.oversPerInnings} Ov</span>
            ${badge}
          </div>
          <div>
            <div class="match-team-row">
              <span>${ApnaUI.escapeHtml((inn1 && inn1.battingTeamName) || m.teamA.name)}</span>
              <span class="match-team-score">${scoreA}</span>
            </div>
            <div class="match-team-row mt-1">
              <span>${ApnaUI.escapeHtml((inn2 && inn2.battingTeamName) || m.teamB.name)}</span>
              <span class="match-team-score">${scoreB}</span>
            </div>
          </div>
          <div class="text-sm" style="color:var(--brand-primary);font-weight:600;">
            ${ApnaUI.escapeHtml((m.result && m.result.marginText) || m.title)}
          </div>
          <div class="flex-gap">
            <a href="/live-score.html?matchId=${m._id}" class="btn btn-primary btn-sm">${isLive ? 'Score / Watch' : 'Open Match'}</a>
            <a href="/scorecard.html?matchId=${m._id}" class="btn btn-secondary btn-sm">Scorecard</a>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderFixtures(fixtures) {
    const el = document.getElementById('upcomingFixturesList');
    if (!fixtures.length) {
      el.innerHTML = `<div class="empty-state">No upcoming fixtures scheduled.</div>`;
      return;
    }
    el.innerHTML = fixtures.map((f) => `
      <div class="fixture-card">
        <div>
          <strong>${ApnaUI.escapeHtml(f.teamAName)} vs ${ApnaUI.escapeHtml(f.teamBName)}</strong>
          <div class="text-sm text-muted">${ApnaUI.escapeHtml((f.tournamentId && f.tournamentId.name) || 'Tournament')} • ${ApnaUI.escapeHtml(f.roundName)}</div>
        </div>
        <a href="/match-create.html?fixtureId=${f._id}&tournamentId=${f.tournamentId ? f.tournamentId._id : ''}&teamAId=${f.teamAId || ''}&teamBId=${f.teamBId || ''}" class="btn btn-secondary btn-sm">Start Match</a>
      </div>
    `).join('');
  }

  function renderLeaders(containerId, list, statKey, statLabel) {
    const el = document.getElementById(containerId);
    if (!list.length) {
      el.innerHTML = `<div class="empty-state text-sm">Complete a match to populate stats.</div>`;
      return;
    }
    el.innerHTML = list.map((p, idx) => `
      <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div>
          <strong>${idx + 1}. ${ApnaUI.escapeHtml(p.name)}</strong>
          <div class="text-sm text-muted">${ApnaUI.escapeHtml(p.village)}</div>
        </div>
        <span class="badge badge-success">${(p.stats && p.stats[statKey]) || 0} ${statLabel}</span>
      </div>
    `).join('');
  }

  function renderWinners(winners) {
    const el = document.getElementById('recentWinnersList');
    if (!winners.length) {
      el.innerHTML = `<div class="empty-state text-sm">No completed tournaments yet.</div>`;
      return;
    }
    el.innerHTML = winners.map((t) => `
      <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div>
          <strong>${ApnaUI.escapeHtml(t.name)}</strong>
          <div class="text-sm text-muted">${ApnaUI.escapeHtml(t.village)}</div>
        </div>
        <span class="badge badge-success">🏆 ${ApnaUI.escapeHtml((t.winnerTeamId && t.winnerTeamId.name) || 'Champion')}</span>
      </div>
    `).join('');
  }
}());
