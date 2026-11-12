/**
 * ApnaScore Separate Tournament Management Controller
 */
(function (root) {
  'use strict';

  let allTeams = [];
  let activeFilter = 'mine';

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
    if (!ApnaAuth.isLoggedIn()) {
      if (window.ApnaMigrate) {
        ApnaMigrate.showRestrictionPrompt('Create a free account to publish your match and manage tournaments.');
        return;
      }
      ApnaAuth.requireAuth();
      return;
    }
    goTourStep(1);
    document.getElementById('createTourModal').classList.add('open');
  }

  function goTourStep(step) {
    if (step > 1) {
      const name = document.getElementById('ctName').value.trim();
      const village = document.getElementById('ctVillage').value.trim();
      const start = document.getElementById('ctStart').value;
      if (!name || !village || !start) {
        ApnaUI.showToast('Please enter Tournament Name, Location, and Start Date first.', 'error');
        step = 1;
      }
    }
    document.querySelectorAll('.tw-panel').forEach((p) => {
      p.classList.toggle('hidden', Number(p.dataset.twp) !== step);
    });
    document.querySelectorAll('#tourWizSteps .wizard-step-pill').forEach((pill) => {
      const s = Number(pill.dataset.tw);
      pill.classList.toggle('active', s === step);
      pill.classList.toggle('done', s < step);
    });
  }

  function bindListControls() {
    document.getElementById('openCreateTourBtn').addEventListener('click', openCreateModal);
    document.getElementById('tourSearchInput').addEventListener('input', loadTournaments);

    document.querySelectorAll('#tourWizSteps .wizard-step-pill').forEach((pill) => {
      pill.addEventListener('click', () => goTourStep(Number(pill.dataset.tw)));
    });

    document.querySelectorAll('#tourListTabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tourListTabs .tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.tfilter;
        loadTournaments();
      });
    });

    document.getElementById('createTourForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('ctName').value.trim();
      const village = document.getElementById('ctVillage').value.trim();
      const startDate = document.getElementById('ctStart').value;
      const endDate = document.getElementById('ctEnd').value;
      if (!name || !village || !startDate) {
        goTourStep(1);
        return ApnaUI.showToast('Tournament Name, Location, and Start Date are required.', 'error');
      }
      if (!endDate) {
        goTourStep(2);
        return ApnaUI.showToast('End Date is required.', 'error');
      }
      try {
        const selectedTeams = Array.from(document.getElementById('ctTeamsMulti').selectedOptions).map((o) => o.value);
        const presetId = document.getElementById('ctRulePreset').value;
        const baseRules = ApnaScoringEngine.getPresetById(presetId);
        const res = await ApnaAPI.post('/api/tournaments', {
          name,
          village,
          format: document.getElementById('ctFormat').value,
          oversPerMatch: Number(document.getElementById('ctOvers').value || 8),
          startDate,
          endDate,
          entryFee: Number(document.getElementById('ctFee').value || 0),
          prizeMoney: document.getElementById('ctPrize').value.trim(),
          maxTeams: Number(document.getElementById('ctMaxTeams').value || 8),
          rules: baseRules,
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
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (activeFilter === 'mine') qs.set('mine', '1');
    else qs.set('status', activeFilter);

    try {
      const res = await ApnaAPI.get(`/api/tournaments?${qs.toString()}`);
      const list = res.tournaments || [];
      if (!list.length) {
        grid.innerHTML = `
          <div class="card empty-state" style="grid-column:1/-1;">
            <p style="margin:0 0 6px;font-weight:700;color:var(--text-primary);">No tournaments created yet.</p>
            <p class="text-sm text-muted" style="margin:0 0 14px;">Create your first tournament.</p>
            <button type="button" class="btn btn-primary btn-sm" onclick="TourWiz.openCreate()">+ Create Tournament</button>
          </div>
        `;
        return;
      }
      grid.innerHTML = list.map((t) => `
        <div class="tournament-card">
          <div class="tournament-banner">
            <div>
              <span class="badge" style="background:var(--brand-lime);color:#0F3822;">${ApnaUI.escapeHtml(t.format.replace('_', ' ').toUpperCase())}</span>
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
            ${t.winnerTeamId ? `<div class="text-sm" style="color:var(--text-brand);font-weight:700;">🏆 Winner: ${ApnaUI.escapeHtml(t.winnerTeamId.name)}</div>` : ''}
            <div class="flex-gap mt-1">
              <a href="/tournament.html?id=${t._id}" class="btn btn-primary btn-sm">Open Tournament</a>
              <a href="/api/scorecards/tournament/${t._id}/pdf" target="_blank" class="btn btn-secondary btn-sm">Results PDF</a>
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
        ['overview', 'teams', 'fixtures', 'points', 'live', 'results', 'settings'].forEach((k) => {
          document.getElementById(`tPanel-${k}`).classList.toggle('hidden', k !== btn.dataset.ttab);
        });
      });
    });
  }

  async function loadTournamentDetail(id) {
    try {
      const [data, mRes] = await Promise.all([
        ApnaAPI.get(`/api/tournaments/${id}`),
        ApnaAPI.get(`/api/matches?tournamentId=${encodeURIComponent(id)}`).catch(() => ({ matches: [] }))
      ]);
      const t = data.tournament;
      const tMatches = mRes.matches || [];

      document.getElementById('tdTitle').textContent = t.name;
      document.getElementById('tdMeta').textContent = `${t.village} • ${t.format.replace('_', ' ').toUpperCase()} • ${t.oversPerMatch} Overs • ${t.status.toUpperCase()}`;
      document.getElementById('tdShareBtn').href = `/public-tournament.html?id=${t.shareCode || t._id}`;
      document.getElementById('tdPdfBtn').href = `/api/scorecards/tournament/${t._id}/pdf`;

      renderOverview(t, data.fixtures || [], tMatches);
      renderTournamentTeams(t);
      renderFixtures(t, data.fixtures || []);
      renderPointsTable(data.pointsTable || []);
      renderTournamentMatches('tPanel-live', tMatches.filter((m) => ['live', 'paused', 'innings_break'].includes(m.status)), 'No live tournament matches right now.');
      renderResults(t, tMatches.filter((m) => ['completed', 'tied', 'abandoned'].includes(m.status)), data.leaderboards || {});
      renderTournamentSettings(t);
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  function renderOverview(t, fixtures, matches) {
    const liveCount = matches.filter((m) => ['live', 'paused', 'innings_break'].includes(m.status)).length;
    const doneCount = matches.filter((m) => ['completed', 'tied'].includes(m.status)).length;
    document.getElementById('tPanel-overview').innerHTML = `
      <div class="card-header"><h3 class="card-title">Tournament Overview</h3></div>
      <div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">Registered Teams</span><span class="kpi-value">${(t.registeredTeams || []).length} / ${t.maxTeams}</span></div>
        <div class="kpi-card"><span class="kpi-label">Fixtures</span><span class="kpi-value">${fixtures.length}</span></div>
        <div class="kpi-card"><span class="kpi-label">Live Matches</span><span class="kpi-value">${liveCount}</span></div>
        <div class="kpi-card"><span class="kpi-label">Completed</span><span class="kpi-value">${doneCount}</span></div>
      </div>
      <p class="text-sm text-muted">Start Date: ${new Date(t.startDate).toLocaleDateString()} • Overs: ${t.oversPerMatch} • Prize: ${ApnaUI.escapeHtml(t.prizeMoney || 'Trophy')}</p>
      ${t.winnerTeamId ? `<div class="card" style="background:var(--success-bg);"><strong>🏆 Champion: ${ApnaUI.escapeHtml(t.winnerTeamId.name)}</strong></div>` : ''}
    `;
  }

  function renderTournamentTeams(t) {
    const el = document.getElementById('tPanel-teams');
    const regIds = new Set((t.registeredTeams || []).map((r) => String(r.teamId?._id || r.teamId)));
    const available = allTeams.filter((team) => !regIds.has(String(team._id)));

    el.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">Teams (${(t.registeredTeams || []).length})</h3>
        <a href="/team.html?action=create" class="btn btn-secondary btn-sm">+ Create New Team</a>
      </div>
      <div class="flex-gap mb-2">
        <select class="form-control" id="regTeamSelect" style="max-width:280px;">
          ${available.map((tm) => `<option value="${tm._id}">${ApnaUI.escapeHtml(tm.name)} (${ApnaUI.escapeHtml(tm.village)})</option>`).join('') || '<option value="">No available teams</option>'}
        </select>
        <input class="form-control" id="regGroupInput" value="Group A" style="max-width:130px;" />
        <button type="button" class="btn btn-primary btn-sm" id="regTeamBtn">+ Add Team</button>
      </div>
      <div>
        ${(t.registeredTeams || []).map((r) => {
          const tm = r.teamId || {};
          return `
            <div class="fixture-card">
              <div>
                <strong>${ApnaUI.escapeHtml(tm.name || 'Team')}</strong>
                <span class="text-sm text-muted"> • ${ApnaUI.escapeHtml(r.groupName)} • ${ApnaUI.escapeHtml(r.status.toUpperCase())}</span>
              </div>
              ${r.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" onclick="TourApprove('${t._id}','${tm._id}','approved')">Approve</button>` : ''}
            </div>
          `;
        }).join('') || '<div class="empty-state">No teams added to this tournament yet.</div>'}
      </div>
    `;

    document.getElementById('regTeamBtn').onclick = async () => {
      const teamId = document.getElementById('regTeamSelect').value;
      if (!teamId) return ApnaUI.showToast('Create or select a team first.', 'error');
      try {
        await ApnaAPI.post(`/api/tournaments/${t._id}/register-team`, {
          teamId,
          groupName: document.getElementById('regGroupInput').value.trim() || 'Group A'
        });
        ApnaUI.showToast('Team added.');
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  window.TourApprove = async (tourId, teamId, status) => {
    try {
      await ApnaAPI.post(`/api/tournaments/${tourId}/approve-team`, { teamId, status });
      await loadTournamentDetail(tourId);
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  };

  function renderFixtures(t, fixtures) {
    const el = document.getElementById('tPanel-fixtures');
    const approvedTeams = (t.registeredTeams || []).filter((r) => r.status === 'approved' && r.teamId);
    const teamOpts = approvedTeams.map((r) => `<option value="${r.teamId._id}">${ApnaUI.escapeHtml(r.teamId.name)}</option>`).join('');

    el.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">Tournament Fixtures</h3>
        <button type="button" class="btn btn-primary btn-sm" id="autoGenFixturesBtn">Auto-Generate Fixtures</button>
      </div>
      <div class="card mb-2" style="background:var(--bg-surface-alt);">
        <strong class="text-sm">Add Manual Fixture</strong>
        <div class="form-grid-3 mt-1">
          <select class="form-control" id="mfTeamA">${teamOpts}</select>
          <select class="form-control" id="mfTeamB">${teamOpts}</select>
          <input class="form-control" id="mfRound" placeholder="Round" value="League Match" />
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
        `).join('') : '<div class="empty-state">No fixtures created yet. Add at least 2 teams and click Auto-Generate Fixtures.</div>'}
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

    if (approvedTeams.length > 1) {
      const mfB = document.getElementById('mfTeamB');
      if (mfB && mfB.options.length > 1) mfB.selectedIndex = 1;
    }

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
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  function renderPointsTable(rows) {
    const el = document.getElementById('tPanel-points');
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state">Add teams to see the Points Table & NRR.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="card-header"><h3 class="card-title">Points Table & Net Run Rate</h3></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Pts</th><th class="num">NRR</th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${ApnaUI.escapeHtml(r.teamName)}</strong> ${r.qualified ? '<span class="badge badge-success">Q</span>' : ''}</td>
                <td class="num">${r.played}</td>
                <td class="num">${r.won}</td>
                <td class="num">${r.lost}</td>
                <td class="num">${r.tied}</td>
                <td class="num"><strong>${r.points}</strong></td>
                <td class="num">${Number(r.netRunRate || 0) >= 0 ? '+' : ''}${Number(r.netRunRate || 0).toFixed(3)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTournamentMatches(panelId, matches, emptyMsg) {
    const el = document.getElementById(panelId);
    if (!matches.length) {
      el.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
      return;
    }
    el.innerHTML = `<div class="match-list-grid">${matches.map((m) => `
      <div class="match-card">
        <strong>${ApnaUI.escapeHtml(m.title)}</strong>
        <div class="text-sm text-muted">${ApnaUI.escapeHtml(m.result?.marginText || m.status.toUpperCase())}</div>
        <div class="flex-gap">
          <a href="/live-score.html?matchId=${m._id}" class="btn btn-primary btn-sm">Open Match</a>
          <a href="/scorecard.html?matchId=${m._id}" class="btn btn-secondary btn-sm">Scorecard</a>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function renderResults(t, completedMatches, leaderboards) {
    const el = document.getElementById('tPanel-results');
    const approved = (t.registeredTeams || []).filter((r) => r.status === 'approved' && r.teamId);
    const opts = approved.map((r) => `<option value="${r.teamId._id}">${ApnaUI.escapeHtml(r.teamId.name)}</option>`).join('');

    el.innerHTML = `
      <div class="card-header"><h3 class="card-title">Tournament Results & Awards</h3></div>
      <div class="cap-grid">
        <div class="cap-card cap-orange"><span class="text-sm">Orange Cap</span><strong>${leaderboards.orangeCap ? `${ApnaUI.escapeHtml(leaderboards.orangeCap.name)} (${leaderboards.orangeCap.runs} runs)` : 'No runs recorded yet'}</strong></div>
        <div class="cap-card cap-purple"><span class="text-sm">Purple Cap</span><strong>${leaderboards.purpleCap ? `${ApnaUI.escapeHtml(leaderboards.purpleCap.name)} (${leaderboards.purpleCap.wickets} wkts)` : 'No wickets recorded yet'}</strong></div>
      </div>
      <div id="tourCompletedList"></div>
      <div class="form-grid-2 mt-2">
        <div class="form-group"><label class="form-label">Declare Champion</label><select class="form-control" id="awWinnerSel">${opts}</select></div>
        <div class="form-group"><label class="form-label">Runner Up</label><select class="form-control" id="awRunnerSel"><option value="">None</option>${opts}</select></div>
      </div>
      <button type="button" class="btn btn-primary" id="announceWinnerBtn">Declare Winner</button>
    `;
    renderTournamentMatches('tourCompletedList', completedMatches, 'No completed tournament matches yet.');

    document.getElementById('announceWinnerBtn').onclick = async () => {
      const winnerTeamId = document.getElementById('awWinnerSel').value;
      if (!winnerTeamId) {
        return ApnaUI.showToast('Approve at least 1 team before declaring a tournament winner.', 'error');
      }
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

  function renderTournamentSettings(t) {
    const el = document.getElementById('tPanel-settings');
    el.innerHTML = `
      <div class="card-header"><h3 class="card-title">Tournament Settings & Branding</h3></div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Tournament Status</label>
          <select class="form-control" id="tsStatusSel">
            <option value="upcoming" ${t.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
            <option value="ongoing" ${t.status === 'ongoing' ? 'selected' : ''}>Live / Ongoing</option>
            <option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Overs per Match</label><input type="number" min="1" max="50" class="form-control" id="tsOversInp" value="${t.oversPerMatch}" /></div>
      </div>
      <div class="flex-gap">
        <button type="button" class="btn btn-primary btn-sm" id="tsSaveBtn">Save Settings</button>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;">Upload Logo <input type="file" accept="image/*" id="tourLogoUploadInp" class="hidden" /></label>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;">Upload Poster <input type="file" accept="image/*" id="tourPosterUploadInp" class="hidden" /></label>
      </div>
    `;

    document.getElementById('tsSaveBtn').onclick = async () => {
      try {
        await ApnaAPI.put(`/api/tournaments/${t._id}`, {
          status: document.getElementById('tsStatusSel').value,
          oversPerMatch: Number(document.getElementById('tsOversInp').value || t.oversPerMatch)
        });
        ApnaUI.showToast('Tournament settings saved.');
        await loadTournamentDetail(t._id);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    const bindMedia = (inputId, type) => {
      document.getElementById(inputId)?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('image', file);
        fd.append('type', type);
        try {
          await ApnaAPI.upload(`/api/tournaments/${t._id}/media`, fd);
          ApnaUI.showToast(`Tournament ${type} updated!`);
          await loadTournamentDetail(t._id);
        } catch (err) {
          ApnaUI.showToast(err.message, 'error');
        }
      });
    };
    bindMedia('tourLogoUploadInp', 'logo');
    bindMedia('tourPosterUploadInp', 'poster');
  }

  root.TourWiz = { go: goTourStep, openCreate: openCreateModal };
}(window));
