/**
 * ApnaScore Statistics & Leaderboards Controller
 */
(function () {
  'use strict';

  let cachedData = null;
  let activeCat = 'mostRuns';

  document.addEventListener('DOMContentLoaded', async () => {
    const isLeaderboardPage = document.body.dataset.page === 'leaderboards';
    ApnaUI.initShell({
      activePage: isLeaderboardPage ? 'leaderboards' : 'statistics',
      pageTitle: isLeaderboardPage ? 'Leaderboards' : 'Statistics'
    });

    document.querySelectorAll('#statCategoryTabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#statCategoryTabs .tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeCat = btn.dataset.cat;
        renderTable();
      });
    });

    document.getElementById('applyStatFiltersBtn').addEventListener('click', loadLeaderboards);
    await loadLeaderboards(true);
  });

  async function loadLeaderboards(populateFilterOptions = false) {
    const qs = new URLSearchParams();
    const tid = document.getElementById('statTournamentFilter').value;
    const teamId = document.getElementById('statTeamFilter').value;
    const village = document.getElementById('statVillageFilter').value.trim();
    const season = document.getElementById('statSeasonFilter').value.trim();
    const from = document.getElementById('statFromDate').value;
    const to = document.getElementById('statToDate').value;

    if (tid) qs.set('tournamentId', tid);
    if (teamId) qs.set('teamId', teamId);
    if (village) qs.set('village', village);
    if (season) qs.set('season', season);
    if (from) qs.set('fromDate', from);
    if (to) qs.set('toDate', to);

    try {
      const res = await ApnaAPI.get(`/api/stats/leaderboards?${qs.toString()}`);
      cachedData = res.leaderboards || {};

      if (populateFilterOptions && res.filterOptions) {
        const tSel = document.getElementById('statTournamentFilter');
        tSel.innerHTML = '<option value="">All Tournaments</option>' +
          (res.filterOptions.tournaments || []).map((t) => `<option value="${t._id}">${ApnaUI.escapeHtml(t.name)}</option>`).join('');
        const tmSel = document.getElementById('statTeamFilter');
        tmSel.innerHTML = '<option value="">All Teams</option>' +
          (res.filterOptions.teams || []).map((t) => `<option value="${t._id}">${ApnaUI.escapeHtml(t.name)}</option>`).join('');
      }

      renderCaps();
      renderTable();
    } catch (err) {
      document.getElementById('statTableCard').innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  function renderCaps() {
    const d = cachedData || {};
    document.getElementById('statCapCards').innerHTML = `
      <div class="cap-card cap-orange">
        <span class="text-sm">🧡 Orange Cap (Most Runs)</span>
        <strong style="font-size:1.1rem;">${d.orangeCap ? `${ApnaUI.escapeHtml(d.orangeCap.name)} — ${d.orangeCap.runs} Runs` : 'No data yet'}</strong>
      </div>
      <div class="cap-card cap-purple">
        <span class="text-sm">💜 Purple Cap (Most Wickets)</span>
        <strong style="font-size:1.1rem;">${d.purpleCap ? `${ApnaUI.escapeHtml(d.purpleCap.name)} — ${d.purpleCap.wickets} Wickets` : 'No data yet'}</strong>
      </div>
      <div class="cap-card cap-mvp">
        <span class="text-sm">🏆 Player of the Tournament</span>
        <strong style="font-size:1.1rem;">${d.playerOfTournament ? `${ApnaUI.escapeHtml(d.playerOfTournament.name)} — ${d.playerOfTournament.mvpPoints} Pts` : 'No data yet'}</strong>
      </div>
    `;
  }

  function renderTable() {
    const list = (cachedData && cachedData[activeCat]) || [];
    const card = document.getElementById('statTableCard');
    if (!list.length) {
      card.innerHTML = `<div class="empty-state">No records match these filters yet.</div>`;
      return;
    }

    card.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Village</th>
              <th class="num">M</th><th class="num">Runs</th><th class="num">HS</th>
              <th class="num">4s</th><th class="num">6s</th><th class="num">SR</th>
              <th class="num">Wkts</th><th class="num">Econ</th><th class="num">Ct</th><th class="num">MVP</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><a href="/player.html?id=${r.playerId}"><strong>${ApnaUI.escapeHtml(r.name)}</strong></a></td>
                <td>${ApnaUI.escapeHtml(r.village || '-')}</td>
                <td class="num">${r.matches}</td>
                <td class="num"><strong>${r.runs}</strong></td>
                <td class="num">${r.highestScore}</td>
                <td class="num">${r.fours}</td>
                <td class="num">${r.sixes}</td>
                <td class="num">${r.strikeRate.toFixed(1)}</td>
                <td class="num"><strong>${r.wickets}</strong></td>
                <td class="num">${r.economy.toFixed(2)}</td>
                <td class="num">${r.catches}</td>
                <td class="num"><strong>${r.mvpPoints}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}());
