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

    const avatarColors = ['cs-avatar-a', 'cs-avatar-b', 'cs-avatar-teal', 'cs-avatar-purple', 'cs-avatar-blue', 'cs-avatar-gray'];

    grid.innerHTML = filtered.map((m, idx) => {
      const inn1 = (m.inningsSummary || [])[0];
      const inn2 = (m.inningsSummary || [])[1];
      const isLive = ['live', 'paused', 'innings_break'].includes(m.status);

      const teamAName = ApnaUI.escapeHtml(m.teamA?.name || (inn1 && inn1.battingTeamName) || 'Host Team');
      const teamBName = ApnaUI.escapeHtml(m.teamB?.name || (inn2 && inn2.battingTeamName) || 'Visitor Team');

      const initialA = (teamAName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'A').toUpperCase();
      const initialB = (teamBName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'B').toUpperCase();

      const colorA = avatarColors[idx % avatarColors.length];
      const colorB = avatarColors[(idx + 1) % avatarColors.length];

      const scoreA = inn1 ? `${inn1.totalRuns}/${inn1.wickets} <span class="ov-dim">(${inn1.oversString || '0.0'})</span>` : `0/0 <span class="ov-dim">(0.0)</span>`;
      const scoreB = inn2 ? `${inn2.totalRuns}/${inn2.wickets} <span class="ov-dim">(${inn2.oversString || '0.0'})</span>` : `0/0 <span class="ov-dim">(0.0)</span>`;

      const d = new Date(m.matchDate || m.createdAt || Date.now());
      const dateFormatted = d.toLocaleDateString('en-GB') + ' - ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let summaryText = m.result?.marginText || '';
      if (!summaryText) {
        const tossTeam = (m.toss?.winner === 'B' || m.tossWinnerSide === 'B') ? teamBName : teamAName;
        const tossDec = (m.toss?.decision || m.tossDecision) === 'bowl' ? 'Bowl' : 'Bat';
        summaryText = `${tossTeam} won the toss and opted to ${tossDec} first.`;
      }

      return `
        <div class="cs-history-card">
          <div class="cs-card-date">${dateFormatted}</div>

          <div class="cs-team-score-row">
            <div class="cs-team-left">
              <span class="cs-avatar-circle ${colorA}">${initialA}</span>
              <span class="cs-team-title">${teamAName}</span>
            </div>
            <div class="cs-team-score-val">${scoreA}</div>
          </div>

          <div class="cs-team-score-row">
            <div class="cs-team-left">
              <span class="cs-avatar-circle ${colorB}">${initialB}</span>
              <span class="cs-team-title">${teamBName}</span>
            </div>
            <div class="cs-team-score-val">${scoreB}</div>
          </div>

          <div class="cs-match-summary-text">${summaryText}</div>

          <div class="cs-match-footer">
            <div class="cs-footer-left-links">
              ${isLive ? `<a href="/live-score.html?matchId=${m._id}" class="cs-footer-link highlight">Resume</a>` : ''}
              <a href="/scorecard.html?matchId=${m._id}" class="cs-footer-link">Scoreboard</a>
            </div>
            <div class="cs-footer-right-icons">
              <a href="/api/scorecards/${m._id}/pdf" target="_blank" class="cs-icon-btn" title="Download Scorecard PDF"><i class="fa-solid fa-file-pdf"></i></a>
              <button type="button" class="cs-icon-btn wa-btn" onclick="window.shareMatchToWhatsApp('${m._id}')" title="Share Scorecard on WhatsApp" style="color:#25D366;"><i class="fa-brands fa-whatsapp"></i></button>
              <button type="button" class="cs-icon-btn delete-btn" onclick="window.confirmDeleteMatch('${m._id}', '${teamAName} vs ${teamBName}')" title="Delete Match"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.shareMatchToWhatsApp = (id) => {
    const match = allUserMatches.find((m) => String(m._id) === String(id));
    if (!match) return;
    const origin = window.location.origin;
    const shareUrl = `${origin}/scorecard.html?matchId=${encodeURIComponent(id)}`;
    const pdfUrl = `${origin}/api/scorecards/${encodeURIComponent(id)}/pdf`;
    const inn1 = (match.inningsSummary || [])[0];
    const inn2 = (match.inningsSummary || [])[1];
    const scoreA = inn1 ? `${inn1.battingTeamName}: ${inn1.totalRuns}/${inn1.wickets} (${inn1.oversString || '0.0'} ov)` : '';
    const scoreB = inn2 ? `${inn2.battingTeamName}: ${inn2.totalRuns}/${inn2.wickets} (${inn2.oversString || '0.0'} ov)` : '';
    const scoreLine = [scoreA, scoreB].filter(Boolean).join('\n') || 'Match in progress';
    const resTxt = (match.result && match.result.marginText) || (match.status ? match.status.toUpperCase() : '');

    const text = [
      `🏏 *${match.title || 'Cricket Match'}*`,
      match.venue ? `📍 Ground: ${match.venue}` : '',
      `━━━━━━━━━━━━━━━━`,
      scoreLine,
      resTxt ? `🏆 *${resTxt}*` : '',
      `━━━━━━━━━━━━━━━━`,
      `📄 *Full Scorecard & PDF:*`,
      shareUrl,
      `📥 *Download Scorecard PDF:*`,
      pdfUrl,
      `\n_Scored on ApnaScore (Apne Gaon ka Apna Scorer)_`
    ].filter(Boolean).join('\n');

    if (window.ApnaWhatsApp) {
      window.ApnaWhatsApp.share(text);
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    }
  };

  window.confirmDeleteMatch = async (id, title) => {
    if (!confirm(`Are you sure you want to delete match "${title}"?`)) return;
    try {
      await ApnaAPI.delete(`/api/matches/${id}`);
      if (window.ApnaOffline) {
        await ApnaOffline.deleteLocalMatch(id).catch(() => {});
      }
      ApnaUI.showToast('Match deleted.');
      await fetchMatches();
    } catch (err) {
      if (window.ApnaOffline) {
        await ApnaOffline.deleteLocalMatch(id).catch(() => {});
        ApnaUI.showToast('Local match deleted.');
        await fetchMatches();
      } else {
        ApnaUI.showToast(err.message, 'error');
      }
    }
  };
}());
