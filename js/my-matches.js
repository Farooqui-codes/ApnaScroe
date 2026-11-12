/**
 * ApnaScore My Matches Controller
 * Strictly displays matches belonging to the current user or guest session.
 */
(function () {
  'use strict';

  let activeFilter = 'all';
  let allUserMatches = [];

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'my-matches', pageTitle: 'My Matches' });

    const params = new URLSearchParams(window.location.search);
    const fParam = params.get('filter');
    if (fParam && ['all', 'live', 'upcoming', 'completed'].includes(fParam)) {
      activeFilter = fParam;
      document.querySelectorAll('#myMatchFilterTabs .tab-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.filter === activeFilter);
      });
    }

    document.querySelectorAll('#myMatchFilterTabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#myMatchFilterTabs .tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        renderFiltered();
      });
    });

    document.getElementById('mmSearchInput').addEventListener('input', renderFiltered);
    document.getElementById('mmKindFilter').addEventListener('change', renderFiltered);

    await fetchMatches();
  });

  async function fetchMatches() {
    const localMatches = window.ApnaOffline ? await ApnaOffline.getAllLocalMatches().catch(() => []) : [];
    const activeLocal = localMatches.filter((lm) => !lm.migrated);

    let serverMatches = [];
    if (ApnaAuth.isAuthenticatedOrGuest()) {
      try {
        const res = await ApnaAPI.get('/api/matches?mine=1');
        serverMatches = res.matches || [];
      } catch (_) {}
    }

    const merged = [...serverMatches];
    for (const lm of activeLocal) {
      const exists = merged.some(
        (m) => String(m._id) === String(lm.serverMatchId || lm.localId) || (lm.clientMatchId && m.clientMatchId === lm.clientMatchId)
      );
      if (!exists) {
        merged.unshift(Object.assign({}, lm.match, { _id: lm.localId, isLocalOnly: true }));
      }
    }

    allUserMatches = merged;
    renderFiltered();
  }

  function renderFiltered() {
    const grid = document.getElementById('myMatchesGrid');
    const q = document.getElementById('mmSearchInput').value.trim().toLowerCase();
    const kind = document.getElementById('mmKindFilter').value;

    const filtered = allUserMatches.filter((m) => {
      if (activeFilter === 'live' && !['live', 'paused', 'innings_break'].includes(m.status)) return false;
      if (activeFilter === 'upcoming' && m.status !== 'upcoming') return false;
      if (activeFilter === 'completed' && !['completed', 'tied', 'abandoned'].includes(m.status)) return false;
      if (kind === 'simple' && m.tournamentId) return false;
      if (kind === 'tournament' && !m.tournamentId) return false;
      if (q) {
        const hay = `${m.title || ''} ${m.teamA?.name || ''} ${m.teamB?.name || ''} ${m.venue || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="card empty-state" style="grid-column:1/-1;">
          <p style="margin:0 0 6px;font-weight:700;color:var(--text-primary);">No matches yet.</p>
          <p class="text-sm text-muted" style="margin:0 0 14px;">Start your first cricket match.</p>
          <a href="/match-create.html" class="btn btn-primary btn-sm">Start Match</a>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((m) => {
      const inn1 = (m.inningsSummary || [])[0];
      const inn2 = (m.inningsSummary || [])[1];
      const isLive = ['live', 'paused', 'innings_break'].includes(m.status);
      const badge = isLive
        ? `<span class="badge badge-live"><span class="live-dot"></span>LIVE</span>`
        : `<span class="badge badge-neutral">${ApnaUI.escapeHtml((m.status || 'upcoming').toUpperCase())}</span>`;

      const scoreA = inn1 ? `${inn1.totalRuns}/${inn1.wickets} (${inn1.oversString} ov)` : '-';
      const scoreB = inn2 ? `${inn2.totalRuns}/${inn2.wickets} (${inn2.oversString} ov)` : '-';
      const dateStr = new Date(m.matchDate || m.createdAt || Date.now()).toLocaleDateString();

      return `
        <div class="match-card">
          <div class="flex-between">
            <span class="text-sm text-muted">${dateStr} • ${m.oversPerInnings} Overs</span>
            ${badge}
          </div>
          <div>
            <div class="match-team-row">
              <span>${ApnaUI.escapeHtml((inn1 && inn1.battingTeamName) || m.teamA?.name || 'Team A')}</span>
              <span class="match-team-score">${scoreA}</span>
            </div>
            <div class="match-team-row mt-1">
              <span>${ApnaUI.escapeHtml((inn2 && inn2.battingTeamName) || m.teamB?.name || 'Team B')}</span>
              <span class="match-team-score">${scoreB}</span>
            </div>
          </div>
          ${m.result?.marginText ? `<div class="text-sm" style="color:var(--text-brand);font-weight:700;">${ApnaUI.escapeHtml(m.result.marginText)}</div>` : ''}
          <div class="flex-gap mt-1">
            <a href="/live-score.html?matchId=${m._id}" class="btn btn-primary btn-sm">${isLive ? 'Score Match' : 'Open Match'}</a>
            <a href="/scorecard.html?matchId=${m._id}" class="btn btn-secondary btn-sm">View Scorecard</a>
          </div>
        </div>
      `;
    }).join('');
  }
}());
