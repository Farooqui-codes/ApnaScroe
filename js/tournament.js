/**
 * ApnaScore Tournament Management Controller
 */
(function () {
  'use strict';

  let allTeams = [];
  let currentTournamentData = null;

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'tournaments', pageTitle: 'Tournaments' });
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('ctStart').value = today;
    document.getElementById('ctEnd').value = today;

    await loadTeamsForSelect();

    if (id) {
      document.getElementById('tournamentListView').classList.add('hidden');
      document.getElementById('tournamentDetailView').classList.remove('hidden');
      bindDetailTabs();
      await loadTournamentDetail(id);
    } else {
      bindListControls();
      await loadTournaments();
      if (params.get('action') === 'create') openCreateModal();
    }
  });

  async function loadTeamsForSelect() {
    try {
      const res = await ApnaAPI.get('/api/teams');
      allTeams = res.teams || [];
      document.getElementById('ctTeamsMulti').innerHTML = allTeams
        .map((t) => `<option value="${t._id}">${ApnaUI.escapeHtml(t.name)} (${ApnaUI.escapeHtml(t.village)})</option>`)
        .join('');
    } catch (_) {}
  }

  function openCreateModal() {
    if (!ApnaAuth.requireAuth()) return;
    document.getElementById('createTourModal').classList.add('open');
  }

  function bindListControls() {
    document.getElementById('openCreateTourBtn').addEventListener('click', openCreateModal);
    document.getElementById('tourSearchInput').addEventListener('input', loadTournaments);
    document.getElementById('tourStatusFilter').addEventListener('change', loadTournaments);

    document.getElementById('createTourForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const selectedTeams = Array.from(document.getElementById('ctTeamsMulti').selectedOptions).map((o) => o.value);
        const res = await ApnaAPI.post('/api/tournaments', {
          name: document.getElementById('ctName').value.trim(),
          village: document.getElementById('ctVillage').value.trim(),
          format: document.getElementById('ctFormat').value,
          oversPerMatch: Number(document.getElementById('ctOvers').value || 8),
          startDate: document.getElementById('ctStart').value,
          endDate: document.getElementById('ctEnd').value,
          entryFee: Number(document.getElementById('ctFee').value || 0),
          prizeMoney: document.getElementById('ctPrize').value.trim(),
          maxTeams: Number(document.getElementById('ctMaxTeams').value || 8),
          pointsConfig: { win: 2, loss: 0, tie: 1, noResult: 1, tieBreaker: document.getElementById('ctTieBreaker').value },
          isPublic: document.getElementById('ctPublic').checked,
          teamIds: selectedTeams
        });
        document.getElementById('createTourModal').classList.remove('open');
        ApnaUI.showToast('Tournament created!');
        window.location.href = `/tournament.html?id=${res.tournament._id}`;
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    });
  }

  async function loadTournaments() {
    const grid = document.getElementById('tournamentsGrid');
    const search = document.getElementById('tourSearchInput').value.trim();
    const status = document.getElementById('tourStatusFilter').value;
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (status) qs.set('status', status);

    try {
      const res = await ApnaAPI.get(`/api/tournaments?${qs.toString()}`);
      const list = res.tournaments || [];
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state">No tournaments yet. Click "+ Create Tournament" to launch one!</div>`;
        return;
      }
      grid.innerHTML = list.map((t) => `
        <div class="tournament-card">
          <div class="tournament-banner">
            <div>
              <span class="badge badge-lime" style="background:var(--brand-lime);color:#0F3822;">${ApnaUI.escapeHtml(t.format.replace('_', ' ').toUpperCase())}</span>
              <h3 style="margin:6px 0 0;font-size:1.08rem;">${ApnaUI.escapeHtml(t.name)}</h3>
              <div style="font-size:0.82rem;color:#D7F7E3;">${ApnaUI.escapeHtml(t.village)} • ${t.oversPerMatch} Overs</div>
            </div>
            <img src="${ApnaUI.escapeHtml(t.logoUrl || '/assets/icons/apnascore-icon.png')}" alt="Logo" class="tournament-logo-thumb" />
          </div>
          <div style="padding:14px;display:flex;flex-direction:column;gap:8px;">
            <div class="flex-between text-sm">
              <span class="text-muted">Teams: ${(t.registeredTeams || []).length}/${t.maxTeams}</span>
              <span class="badge badge-success">${ApnaUI.escapeHtml(t.status.toUpperCase())}</span>
            </div>
            <div class="text-sm text-muted">Prize: ${ApnaUI.escapeHtml(t.prizeMoney || 'Trophy')} • Fee: ₹${t.entryFee || 0}</div>
            ${t.winnerTeamId ? `<div class="text-sm" style="color:var(--brand-primary);font-weight:700;">🏆 Winner: ${ApnaUI.escapeHtml(t.winnerTeamId.name)}</div>` : ''}
            <div class="flex-gap mt-1">
              <a href="/tournament.html?id=${t._id}" class="btn btn-primary btn-sm">Manage / View</a>
              <a href="/api/scorecards/tournament/${t._id}/pdf" target="_blank" class="btn btn-secondary btn-sm">PDF</a>
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  function bindDetailTabs() {
    document.querySelectorAll('#tourDetailTabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tourDetailTabs .tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ['points', 'fixtures', 'teams', 'awards'].forEach((k) => {
          document.getElementById(`tPanel-${k}`).classList.toggle('hidden', k !== btn.dataset.ttab);
        });
      });
    });
  }

  async function loadTournamentDetail(id) {
    try {
      const data = await ApnaAPI.get(`/api/tournaments/${id}`);
      currentTournamentData = data;
      const t = data.tournament;
      document.getElementById('tdTitle').textContent = t.name;
      document.getElementById('tdMeta').textContent = `${t.village} • ${t.format.replace('_', ' ').toUpperCase()} • ${t.oversPerMatch} Overs • Status: ${t.status.toUpperCase()}`;
      document.getElementById('tdShareBtn').href = `/public-tournament.html?id=${t.shareCode || t._id}`;
      document.getElementById('tdPdfBtn').href = `/api/scorecards/tournament/${t._id}/pdf`;

      renderPointsTable(data.pointsTable || []);
      renderFixtures(t, data.fixtures || []);
      renderTournamentTeams(t);
      renderAwards(t, data.awards || [], data.leaderboards || {});
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  function renderPointsTable(rows) {
    const el = document.getElementById('tPanel-points');
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state">Register at least 2 teams to initialize the points table.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="card-header"><h3 class="card-title">Points Table & Net Run Rate</h3></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">NR</th><th class="num">Pts</th><th class="num">NRR</th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${ApnaUI.escapeHtml(r.teamName)}</strong> ${r.qualified ? '<span class="badge badge-success">Q</span>' : ''}</td>
                <td class="num">${r.played}</td>
                <td class="num">${r.won}</td>
                <td class="num">${r.lost}</td>
                <td class="num">${r.tied}</td>
                <td class="num">${r.noResult}</td>
                <td class="num"><strong>${r.points}</strong></td>
                <td class="num">${Number(r.netRunRate || 0) >= 0 ? '+' : ''}${Number(r.netRunRate || 0).toFixed(3)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderFixtures(t, fixtures) {
    const el = document.getElementById('tPanel-fixtures');
    const approvedTeams = (t.registeredTeams || []).filter((r) => r.status === 'approved' && r.teamId);
    const teamOpts = approvedTeams.map((r) => `<option value="${r.teamId._id}">${ApnaUI.escapeHtml(r.teamId.name)}</option>`).join('');

    el.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">Tournament Fixtures</h3>
        <div class="flex-gap">
          <button type="button" class="btn btn-primary btn-sm" id="autoGenFixturesBtn">Auto-Generate Fixtures</button>
        </div>
      </div>
      <div class="card mb-2" style="background:var(--bg-surface-alt);">
        <strong class="text-sm">Add Manual Fixture</strong>
        <div class="form-grid-3 mt-1">
          <select class="form-control" id="mfTeamA">${teamOpts}</select>
          <select class="form-control" id="mfTeamB">${teamOpts}</select>
          <input class="form-control" id="mfRound" placeholder="Round (e.g. Semi-Final)" value="League Match" />
        </div>
        <button type="button" class="btn btn-secondary btn-sm mt-1" id="addManualFixtureBtn">+ Add Fixture</button>
      </div>
      <div>
        ${fixtures.length ? fixtures.map((f) => `
          <div class="fixture-card">
            <div>
              <span class="badge badge-neutral">#${f.matchNumber} • ${ApnaUI.escapeHtml(f.roundName)}</span>
              <div class="mt-1"><strong>${ApnaUI.escapeHtml(f.teamAName)} vs ${ApnaUI.escapeHtml(f.teamBName)}</strong></div>
              <div class="text-sm text-muted">${ApnaUI.escapeHtml(f.resultText || f.status.toUpperCase())}</div>
            </div>
            <div class="flex-gap">
              ${f.matchId
                ? `<a href="/live-score.html?matchId=${f.matchId}" class="btn btn-primary btn-sm">Open Match</a>`
                : (f.teamAId && f.teamBId ? `<a href="/match-create.html?tournamentId=${t._id}&fixtureId=${f._id}&teamAId=${f.teamAId}&teamBId=${f.teamBId}" class="btn btn-primary btn-sm">Start Match</a>` : '')}
            </div>
          </div>
        `).join('') : '<div class="empty-state">No fixtures generated yet.</div>'}
      </div>
    `;

    document.getElementById('autoGenFixturesBtn').onclick = async () => {
      try {
        await ApnaAPI.post(`/api/tournaments/${t._id}/fixtures/generate`, {});
        ApnaUI.showToast('Fixtures generated!');
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    document.getElementById('addManualFixtureBtn').onclick = async () => {
      const a = document.getElementById('mfTeamA').value;
      const b = document.getElementById('mfTeamB').value;
      if (!a || !b || a === b) return ApnaUI.showToast('Select two distinct teams.', 'error');
      try {
        await ApnaAPI.post(`/api/tournaments/${t._id}/fixtures/manual`, {
          teamAId: a,
          teamBId: b,
          roundName: document.getElementById('mfRound').value.trim() || 'League Match'
        });
        ApnaUI.showToast('Fixture added.');
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  function renderTournamentTeams(t) {
    const el = document.getElementById('tPanel-teams');
    const regIds = new Set((t.registeredTeams || []).map((r) => String(r.teamId?._id || r.teamId)));
    const available = allTeams.filter((team) => !regIds.has(String(team._id)));

    el.innerHTML = `
      <div class="card-header"><h3 class="card-title">Registered Teams</h3></div>
      <div class="flex-gap mb-2">
        <select class="form-control" id="regTeamSelect" style="max-width:280px;">
          ${available.map((tm) => `<option value="${tm._id}">${ApnaUI.escapeHtml(tm.name)} (${ApnaUI.escapeHtml(tm.village)})</option>`).join('')}
        </select>
        <input class="form-control" id="regGroupInput" value="Group A" style="max-width:140px;" />
        <button type="button" class="btn btn-primary btn-sm" id="regTeamBtn">+ Register Team</button>
      </div>
      <div>
        ${(t.registeredTeams || []).map((r) => {
          const tm = r.teamId || {};
          return `
            <div class="fixture-card">
              <div>
                <strong>${ApnaUI.escapeHtml(tm.name || 'Team')}</strong>
                <span class="text-sm text-muted"> • ${ApnaUI.escapeHtml(r.groupName)} • Status: ${ApnaUI.escapeHtml(r.status.toUpperCase())}</span>
              </div>
              <div class="flex-gap">
                ${r.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" onclick="TourApprove('${t._id}','${tm._id}','approved')">Approve</button>` : ''}
              </div>
            </div>
          `;
        }).join('') || '<div class="empty-state">No teams registered yet.</div>'}
      </div>
    `;

    document.getElementById('regTeamBtn').onclick = async () => {
      const teamId = document.getElementById('regTeamSelect').value;
      if (!teamId) return ApnaUI.showToast('Select a team to register.', 'error');
      try {
        await ApnaAPI.post(`/api/tournaments/${t._id}/register-team`, {
          teamId,
          groupName: document.getElementById('regGroupInput').value.trim() || 'Group A'
        });
        ApnaUI.showToast('Team registered.');
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  window.TourApprove = async (tourId, teamId, status) => {
    try {
      await ApnaAPI.post(`/api/tournaments/${tourId}/approve-team`, { teamId, status });
      ApnaUI.showToast('Team status updated.');
      await loadTournamentDetail(tourId);
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  };

  function renderAwards(t, awards, leaderboards) {
    const el = document.getElementById('tPanel-awards');
    const approved = (t.registeredTeams || []).filter((r) => r.status === 'approved' && r.teamId);
    const opts = approved.map((r) => `<option value="${r.teamId._id}">${ApnaUI.escapeHtml(r.teamId.name)}</option>`).join('');

    el.innerHTML = `
      <div class="card-header"><h3 class="card-title">Tournament Champions & Caps</h3></div>
      <div class="cap-grid">
        <div class="cap-card cap-orange">
          <span class="text-sm">Orange Cap (Most Runs)</span>
          <strong>${leaderboards.orangeCap ? `${ApnaUI.escapeHtml(leaderboards.orangeCap.name)} (${leaderboards.orangeCap.runs} runs)` : 'TBD'}</strong>
        </div>
        <div class="cap-card cap-purple">
          <span class="text-sm">Purple Cap (Most Wickets)</span>
          <strong>${leaderboards.purpleCap ? `${ApnaUI.escapeHtml(leaderboards.purpleCap.name)} (${leaderboards.purpleCap.wickets} wkts)` : 'TBD'}</strong>
        </div>
        <div class="cap-card cap-mvp">
          <span class="text-sm">MVP / Player of Tournament</span>
          <strong>${leaderboards.playerOfTournament ? `${ApnaUI.escapeHtml(leaderboards.playerOfTournament.name)} (${leaderboards.playerOfTournament.mvpPoints} pts)` : 'TBD'}</strong>
        </div>
      </div>

      ${t.winnerTeamId ? `<div class="card mb-2" style="background:var(--success-bg);"><strong>🏆 Champion: ${ApnaUI.escapeHtml(t.winnerTeamId.name)}</strong></div>` : ''}

      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Announce Winner</label><select class="form-control" id="awWinnerSel">${opts}</select></div>
        <div class="form-group"><label class="form-label">Runner Up</label><select class="form-control" id="awRunnerSel"><option value="">None</option>${opts}</select></div>
      </div>
      <button type="button" class="btn btn-primary" id="announceWinnerBtn">Declare Tournament Winner</button>
    `;

    document.getElementById('announceWinnerBtn').onclick = async () => {
      const winnerTeamId = document.getElementById('awWinnerSel').value;
      if (!winnerTeamId) return;
      try {
        await ApnaAPI.post(`/api/tournaments/${t._id}/winner`, {
          winnerTeamId,
          runnerUpTeamId: document.getElementById('awRunnerSel').value || null
        });
        ApnaAnimations.celebrate('🏆 CHAMPION ANNOUNCED!', 'boundary');
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }
}());
