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
    try {
      const data = await ApnaAPI.get('/api/dashboard/summary');
      const c = data.counts || {};
      document.getElementById('kpiTotalMatches').textContent = c.totalMatches ?? 0;
      document.getElementById('kpiLiveMatches').textContent = c.liveMatches ?? 0;
      document.getElementById('kpiUpcoming').textContent = c.upcomingMatches ?? 0;
      document.getElementById('kpiCompleted').textContent = c.completedMatches ?? 0;
      document.getElementById('kpiTournaments').textContent = c.activeTournaments ?? 0;
      document.getElementById('kpiTeams').textContent = c.totalTeams ?? 0;
      document.getElementById('kpiPlayers').textContent = c.totalPlayers ?? 0;

      renderMatches([...(data.liveMatches || []), ...(data.recentMatches || []).filter((r) => !(data.liveMatches || []).some((l) => l._id === r._id))].slice(0, 6));
      renderFixtures(data.upcomingFixtures || []);
      renderLeaders('topBatsmenList', data.topBatsmen || [], 'runs', 'Runs');
      renderLeaders('topBowlersList', data.topBowlers || [], 'wickets', 'Wkts');
      renderWinners(data.recentWinners || []);
    } catch (err) {
      document.getElementById('recentMatchesList').innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
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
