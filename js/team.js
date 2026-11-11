/**
 * ApnaScore Team Management Controller
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'teams', pageTitle: 'Teams' });
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (id) {
      document.getElementById('teamListView').classList.add('hidden');
      document.getElementById('teamDetailView').classList.remove('hidden');
      await loadTeamDetail(id);
    } else {
      document.getElementById('openCreateTeamBtn').addEventListener('click', async () => {
        if (!ApnaAuth.isAuthenticatedOrGuest()) await ApnaAuth.continueAsGuest(null);
        document.getElementById('createTeamModal').classList.add('open');
      });
      document.getElementById('teamSearchInput').addEventListener('input', loadTeams);
      document.getElementById('teamVillageFilter').addEventListener('input', loadTeams);
      document.getElementById('joinByCodeBtn').addEventListener('click', joinByInviteCode);
      document.getElementById('createTeamForm').addEventListener('submit', createTeam);
      await loadTeams();
      if (params.get('action') === 'create') {
        if (!ApnaAuth.isAuthenticatedOrGuest()) await ApnaAuth.continueAsGuest(null);
        document.getElementById('createTeamModal').classList.add('open');
      }
    }
  });

  async function createTeam(e) {
    e.preventDefault();
    const clientId = 'lteam_' + Date.now();
    const payload = {
      name: document.getElementById('tName').value.trim(),
      shortName: document.getElementById('tShort').value.trim(),
      village: document.getElementById('tVillage').value.trim(),
      ownerName: document.getElementById('tOwner').value.trim(),
      clientId
    };
    try {
      const res = await ApnaAPI.post('/api/teams', payload);
      await ApnaOffline.saveTeamLocally(Object.assign({}, res.team, { localId: res.team._id }));
      document.getElementById('createTeamModal').classList.remove('open');
      ApnaUI.showToast(`Team "${res.team.name}" created!`);
      window.location.href = `/team.html?id=${res.team._id}`;
    } catch (err) {
      if (err.isOffline || !navigator.onLine) {
        const localTeam = await ApnaOffline.saveTeamLocally({ ...payload, _id: clientId, localId: clientId, players: [] });
        document.getElementById('createTeamModal').classList.remove('open');
        ApnaUI.showToast(`Offline: Team "${localTeam.name}" saved locally!`);
        await loadTeams();
      } else {
        ApnaUI.showToast(err.message, 'error');
      }
    }
  }

  async function joinByInviteCode() {
    if (!ApnaAuth.requireAuth()) return;
    const code = prompt('Enter Team Invite Code:');
    if (!code) return;
    const playerId = prompt('Enter your Player ID:');
    if (!playerId) return;
    try {
      await ApnaAPI.post('/api/teams/join-request', { inviteCode: code.trim(), playerId: playerId.trim() });
      ApnaUI.showToast('Join request sent for approval!');
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  async function loadTeams() {
    const grid = document.getElementById('teamsGrid');
    const qs = new URLSearchParams();
    const s = document.getElementById('teamSearchInput').value.trim();
    const v = document.getElementById('teamVillageFilter').value.trim();
    if (s) qs.set('search', s);
    if (v) qs.set('village', v);

    try {
      const [res, localTeams] = await Promise.all([
        ApnaAPI.get(`/api/teams?${qs.toString()}`).catch(() => ({ teams: [] })),
        ApnaOffline.getLocalTeams().catch(() => [])
      ]);
      const list = [...(res.teams || [])];
      for (const lt of localTeams) {
        if (!lt.migrated && !list.some((t) => String(t._id) === String(lt._id) || (lt.clientId && t.clientId === lt.clientId))) {
          list.unshift(Object.assign({}, lt, { _id: lt._id || lt.localId }));
        }
      }
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state">No teams found. Create your first team!</div>`;
        return;
      }
      grid.innerHTML = list.map((t, idx) => `
        <div class="card">
          <div class="flex-between mb-2">
            <div class="flex-gap">
              <img src="${ApnaUI.escapeHtml(t.logoUrl || '/assets/icons/apnascore-icon.png')}" class="avatar-circle" alt="Team" />
              <div>
                <strong>${ApnaUI.escapeHtml(t.name)}</strong>
                <div class="text-sm text-muted">${ApnaUI.escapeHtml(t.village)} • Rank #${idx + 1}</div>
              </div>
            </div>
            <span class="badge badge-neutral">${ApnaUI.escapeHtml(t.shortName || 'TM')}</span>
          </div>
          <div class="text-sm text-muted">
            Players: ${(t.players || []).length} • Won: ${t.stats?.won || 0} • Pts: ${t.stats?.rankingPoints || 1000}
          </div>
          <div class="flex-gap mt-2">
            <a href="/team.html?id=${t._id}" class="btn btn-primary btn-sm">Manage Squad</a>
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  async function loadTeamDetail(id) {
    try {
      const [tRes, pRes] = await Promise.all([
        ApnaAPI.get(`/api/teams/${id}`),
        ApnaAPI.get('/api/players')
      ]);
      const t = tRes.team;
      const allPlayers = pRes.players || [];

      document.getElementById('teamDetailName').textContent = t.name;
      document.getElementById('teamInviteCodeBadge').textContent = `Invite Code: ${t.inviteCode || '-'}`;
      document.getElementById('teamDetailMeta').textContent = `Village: ${t.village} • Captain: ${(t.captainId && t.captainId.name) || 'Not assigned'} • Won ${t.stats?.won || 0}/${t.stats?.matchesPlayed || 0} matches`;

      const inTeamIds = new Set((t.players || []).map((p) => String(p._id)));
      const avail = allPlayers.filter((p) => !inTeamIds.has(String(p._id)));

      document.getElementById('teamRosterCard').innerHTML = `
        <div class="card-header">
          <h3 class="card-title">Squad (${(t.players || []).length})</h3>
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;">
            Upload Logo <input type="file" accept="image/*" id="teamLogoFileInp" class="hidden" />
          </label>
        </div>
        <div class="flex-gap mb-2">
          <select class="form-control" id="addPlayerToTeamSel" style="flex:1;">
            ${avail.map((p) => `<option value="${p._id}">${ApnaUI.escapeHtml(p.name)} (${ApnaUI.escapeHtml(p.village)})</option>`).join('')}
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="addExistingPlayerBtn">+ Add</button>
        </div>
        <div>
          ${(t.players || []).map((p) => `
            <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border-color);">
              <div>
                <a href="/player.html?id=${p._id}"><strong>${ApnaUI.escapeHtml(p.name)}</strong></a>
                <div class="text-sm text-muted">${ApnaUI.escapeHtml(p.role)} • #${p.jerseyNumber ?? '-'}</div>
              </div>
              <div class="flex-gap">
                <button type="button" class="btn btn-secondary btn-sm" onclick="setTeamCap('${t._id}','${p._id}')">Set C</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="removePlayer('${t._id}','${p._id}')">Remove</button>
              </div>
            </div>
          `).join('') || '<div class="empty-state text-sm">No players in squad yet.</div>'}
        </div>
      `;

      document.getElementById('addExistingPlayerBtn').onclick = async () => {
        const pid = document.getElementById('addPlayerToTeamSel').value;
        if (!pid) return;
        try {
          await ApnaAPI.post(`/api/teams/${t._id}/players`, { playerId: pid });
          ApnaUI.showToast('Player added to team.');
          await loadTeamDetail(t._id);
        } catch (err) {
          ApnaUI.showToast(err.message, 'error');
        }
      };

      document.getElementById('teamLogoFileInp').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('logo', file);
        try {
          await ApnaAPI.upload(`/api/teams/${t._id}/logo`, fd);
          ApnaUI.showToast('Team logo updated!');
          await loadTeamDetail(t._id);
        } catch (err) {
          ApnaUI.showToast(err.message, 'error');
        }
      };

      const matches = tRes.matches || [];
      document.getElementById('teamHistoryCard').innerHTML = `
        <div class="card-header"><h3 class="card-title">Team Match History</h3></div>
        ${matches.length ? matches.map((m) => `
          <div class="fixture-card">
            <div>
              <strong>${ApnaUI.escapeHtml(m.title)}</strong>
              <div class="text-sm text-muted">${ApnaUI.escapeHtml((m.result && m.result.marginText) || m.status)}</div>
            </div>
            <a href="/scorecard.html?matchId=${m._id}" class="btn btn-secondary btn-sm">Scorecard</a>
          </div>
        `).join('') : '<div class="empty-state text-sm">No matches played yet.</div>'}
      `;
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  window.setTeamCap = async (teamId, playerId) => {
    try {
      await ApnaAPI.put(`/api/teams/${teamId}`, { captainId: playerId });
      ApnaUI.showToast('Team captain updated.');
      await loadTeamDetail(teamId);
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  };

  window.removePlayer = async (teamId, playerId) => {
    if (!confirm('Remove player from team?')) return;
    try {
      await ApnaAPI.del(`/api/teams/${teamId}/players/${playerId}`);
      ApnaUI.showToast('Player removed.');
      await loadTeamDetail(teamId);
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  };
}());
