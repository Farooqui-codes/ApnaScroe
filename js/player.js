/**
 * ApnaScore Player Management Controller
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'players', pageTitle: 'Players' });
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (id) {
      document.getElementById('playerListView').classList.add('hidden');
      document.getElementById('playerDetailView').classList.remove('hidden');
      await loadPlayerDetail(id);
    } else {
      await loadTeamsDropdown();
      document.getElementById('openCreatePlayerBtn').addEventListener('click', async () => {
        if (!ApnaAuth.isAuthenticatedOrGuest()) await ApnaAuth.continueAsGuest(null);
        document.getElementById('createPlayerModal').classList.add('open');
      });
      document.getElementById('pSearchInput').addEventListener('input', loadPlayers);
      document.getElementById('pVillageFilter').addEventListener('input', loadPlayers);
      document.getElementById('pRoleFilter').addEventListener('change', loadPlayers);
      document.getElementById('createPlayerForm').addEventListener('submit', createPlayer);
      await loadPlayers();
      if (params.get('action') === 'create') {
        if (!ApnaAuth.isAuthenticatedOrGuest()) await ApnaAuth.continueAsGuest(null);
        document.getElementById('createPlayerModal').classList.add('open');
      }
    }
  });

  async function loadTeamsDropdown() {
    try {
      const res = await ApnaAPI.get('/api/teams');
      const sel = document.getElementById('cpTeam');
      sel.innerHTML = '<option value="">No Team Yet</option>' +
        (res.teams || []).map((t) => `<option value="${t._id}">${ApnaUI.escapeHtml(t.name)} (${ApnaUI.escapeHtml(t.village)})</option>`).join('');
    } catch (_) {}
  }

  async function createPlayer(e) {
    e.preventDefault();
    const clientId = 'lplayer_' + Date.now();
    const payload = {
      name: document.getElementById('cpName').value.trim(),
      village: document.getElementById('cpVillage').value.trim(),
      age: document.getElementById('cpAge').value || null,
      jerseyNumber: document.getElementById('cpJersey').value || null,
      role: document.getElementById('cpRole').value,
      teamId: document.getElementById('cpTeam').value || null,
      battingStyle: document.getElementById('cpBatStyle').value,
      bowlingStyle: document.getElementById('cpBowlStyle').value,
      clientId
    };
    try {
      const res = await ApnaAPI.post('/api/players', payload);
      await ApnaOffline.savePlayerLocally(Object.assign({}, res.player, { localId: res.player._id }));
      document.getElementById('createPlayerModal').classList.remove('open');
      ApnaUI.showToast(res.reusedExisting ? res.message : `Player "${res.player.name}" created!`);
      await loadPlayers();
    } catch (err) {
      if (err.isOffline || !navigator.onLine) {
        const lp = await ApnaOffline.savePlayerLocally({ ...payload, _id: clientId, localId: clientId });
        document.getElementById('createPlayerModal').classList.remove('open');
        ApnaUI.showToast(`Offline: Player "${lp.name}" saved locally!`);
        await loadPlayers();
      } else {
        ApnaUI.showToast(err.message, 'error');
      }
    }
  }

  async function loadPlayers() {
    const grid = document.getElementById('playersGrid');
    const qs = new URLSearchParams();
    const s = document.getElementById('pSearchInput').value.trim();
    const v = document.getElementById('pVillageFilter').value.trim();
    const r = document.getElementById('pRoleFilter').value;
    if (s) qs.set('search', s);
    if (v) qs.set('village', v);
    if (r) qs.set('role', r);

    try {
      const [res, localPlayers] = await Promise.all([
        ApnaAPI.get(`/api/players?${qs.toString()}`).catch(() => ({ players: [] })),
        ApnaOffline.getLocalPlayers().catch(() => [])
      ]);
      const list = [...(res.players || [])];
      for (const lp of localPlayers) {
        if (!lp.migrated && !list.some((p) => String(p._id) === String(lp._id) || (lp.clientId && p.clientId === lp.clientId))) {
          list.unshift(Object.assign({}, lp, { _id: lp._id || lp.localId }));
        }
      }
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state">No players found. Click "+ Add Player" to register one!</div>`;
        return;
      }
      window._lastPlayerList = list;
      grid.innerHTML = list.map((p, idx) => `
        <div class="card">
          <div class="flex-between">
            <div class="flex-gap">
              <img src="${ApnaUI.escapeHtml(p.photoUrl || '/assets/icons/apnascore-icon.png')}" class="avatar-circle" alt="Player" />
              <div>
                <strong>${ApnaUI.escapeHtml(p.name)}</strong>
                <div class="text-sm text-muted">${ApnaUI.escapeHtml(p.village)} • ${ApnaUI.escapeHtml(p.role)}</div>
              </div>
            </div>
            <span class="badge badge-neutral">#${p.jerseyNumber ?? '-'}</span>
          </div>
          <div class="flex-between text-sm mt-2">
            <span>Runs: <strong>${p.stats?.runs || 0}</strong></span>
            <span>Wkts: <strong>${p.stats?.wickets || 0}</strong></span>
            <span>SR: <strong>${(p.stats?.strikeRate || 0).toFixed(1)}</strong></span>
          </div>
          <div class="flex-gap mt-2">
            <a href="/player.html?id=${p._id}" class="btn btn-secondary btn-sm">View Profile</a>
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.viewPlayerCardFromList && window.viewPlayerCardFromList(${idx})"><i class="fa-solid fa-id-card"></i> Card</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  window.viewPlayerCardFromList = function(idx) {
    const p = window._lastPlayerList && window._lastPlayerList[idx];
    if (!p || !window.ApnaPlayerCard) return;
    const st = p.stats || {};
    window.ApnaPlayerCard.showModal({
      name: p.name,
      team: (p.teams && p.teams[0] && p.teams[0].name) || p.village || 'Gaon XI',
      role: p.role,
      jerseyNumber: p.jerseyNumber,
      photoUrl: p.photoUrl,
      village: p.village,
      stats: st
    }, {
      runs: st.runs || 0,
      balls: st.balls || 0,
      fours: st.fours || 0,
      sixes: st.sixes || 0,
      strikeRate: st.strikeRate || 0,
      overs: Math.floor((st.ballsBowled || 0) / 6) + '.' + ((st.ballsBowled || 0) % 6),
      maidens: st.maidens || 0,
      runsConceded: st.runsConceded || 0,
      wickets: st.wickets || 0,
      economy: st.economy || 0,
      catches: st.catches || 0
    });
  };

  async function loadPlayerDetail(id) {
    try {
      const res = await ApnaAPI.get(`/api/players/${id}`);
      const p = res.player;
      const st = p.stats || {};
      const bestBowl = st.bestBowlingWickets > 0 ? `${st.bestBowlingWickets}/${st.bestBowlingRuns}` : '-';

      document.getElementById('playerProfileHeader').innerHTML = `
        <img src="${ApnaUI.escapeHtml(p.photoUrl || '/assets/icons/apnascore-icon.png')}" class="avatar-circle" style="width:72px;height:72px;" alt="Player" />
        <div>
          <h2 style="margin:0;">${ApnaUI.escapeHtml(p.name)} ${p.jerseyNumber !== null && p.jerseyNumber !== undefined ? `#${p.jerseyNumber}` : ''}</h2>
          <div class="text-sm text-muted">${ApnaUI.escapeHtml(p.village)} • ${ApnaUI.escapeHtml(p.role)} • ${ApnaUI.escapeHtml(p.battingStyle)} • ${ApnaUI.escapeHtml(p.bowlingStyle)}</div>
          <div class="text-sm mt-1">Teams: ${(p.teams || []).map((t) => `<a href="/team.html?id=${t._id}" class="badge badge-success">${ApnaUI.escapeHtml(t.name)}</a>`).join(' ') || 'Unassigned'}</div>
          <div class="mt-2">
            <button type="button" class="btn btn-primary btn-sm" id="btnViewPlayerCard"><i class="fa-solid fa-id-card"></i> View Ultimate Player Card</button>
          </div>
        </div>
      `;

      const cardBtn = document.getElementById('btnViewPlayerCard');
      if (cardBtn && window.ApnaPlayerCard) {
        cardBtn.addEventListener('click', () => {
          window.ApnaPlayerCard.showModal({
            name: p.name,
            team: (p.teams && p.teams[0] && p.teams[0].name) || p.village || 'Gaon XI',
            role: p.role,
            jerseyNumber: p.jerseyNumber,
            photoUrl: p.photoUrl,
            village: p.village,
            stats: st
          }, {
            runs: st.runs || 0,
            balls: st.balls || 0,
            fours: st.fours || 0,
            sixes: st.sixes || 0,
            strikeRate: st.strikeRate || 0,
            overs: Math.floor((st.ballsBowled || 0) / 6) + '.' + ((st.ballsBowled || 0) % 6),
            maidens: st.maidens || 0,
            runsConceded: st.runsConceded || 0,
            wickets: st.wickets || 0,
            economy: st.economy || 0,
            catches: st.catches || 0
          });
        });
      }

      document.getElementById('playerCareerStatsGrid').innerHTML = `
        <div class="card">
          <div class="card-header"><h3 class="card-title">Batting Career</h3></div>
          <div class="table-wrap">
            <table class="data-table">
              <tbody>
                <tr><td>Matches / Innings</td><td class="num"><strong>${st.matches || 0} / ${st.innings || 0}</strong></td></tr>
                <tr><td>Total Runs</td><td class="num"><strong>${st.runs || 0}</strong></td></tr>
                <tr><td>Highest Score</td><td class="num"><strong>${st.highestScore || 0}${st.highestNotOut ? '*' : ''}</strong></td></tr>
                <tr><td>Average / Strike Rate</td><td class="num"><strong>${(st.average || 0).toFixed(2)} / ${(st.strikeRate || 0).toFixed(1)}</strong></td></tr>
                <tr><td>Fours / Sixes</td><td class="num"><strong>${st.fours || 0} / ${st.sixes || 0}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Bowling & Fielding Career</h3></div>
          <div class="table-wrap">
            <table class="data-table">
              <tbody>
                <tr><td>Overs Bowled</td><td class="num"><strong>${ApnaScoringEngine.formatOvers(st.oversBowledBalls || 0, 6)}</strong></td></tr>
                <tr><td>Wickets</td><td class="num"><strong>${st.wickets || 0}</strong></td></tr>
                <tr><td>Best Bowling</td><td class="num"><strong>${bestBowl}</strong></td></tr>
                <tr><td>Economy / Average</td><td class="num"><strong>${(st.economy || 0).toFixed(2)} / ${(st.bowlingAverage || 0).toFixed(2)}</strong></td></tr>
                <tr><td>Catches / POTM Awards</td><td class="num"><strong>${st.catches || 0} / ${st.potmAwards || 0}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('playerPhotoFileInp').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('photo', file);
        try {
          await ApnaAPI.upload(`/api/players/${p._id}/photo`, fd);
          ApnaUI.showToast('Photo updated!');
          await loadPlayerDetail(p._id);
        } catch (err) {
          ApnaUI.showToast(err.message, 'error');
        }
      };
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }
}());
