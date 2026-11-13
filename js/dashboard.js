/**
 * ApnaScore Simplified Home Screen Controller
 * Displays ONLY real matches owned by the current user/guest and clean empty states.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'dashboard', pageTitle: 'Home' });

    document.querySelectorAll('.choice-icon-box[data-icon]').forEach((el) => {
      el.innerHTML = ApnaIcons.icon(el.getAttribute('data-icon'), 24);
    });

    const user = ApnaAuth.getUser();
    const sub = document.getElementById('homeGreetingSub');
    if (user) {
      sub.textContent = `Welcome, ${user.name}! Choose an option below to start.`;
    } else if (ApnaAuth.isGuest()) {
      sub.textContent = 'Guest Mode • Start a match right away without registration.';
      document.getElementById('guestBannerBox')?.classList.remove('hidden');
    }

    document.getElementById('replayGuideBtn')?.addEventListener('click', () => {
      if (window.ApnaOnboarding) ApnaOnboarding.showOnboarding(true);
    });

    if (window.ApnaOnboarding) {
      ApnaOnboarding.showOnboarding(false);
    }

    await loadUserMatches();
    ApnaAnimations.animateCards('.choice-card');
  });

  async function loadUserMatches() {
    const el = document.getElementById('recentMatchesList');
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
      const existsOnServer = merged.some(
        (m) => String(m._id) === String(lm.serverMatchId || lm.localId) || (lm.clientMatchId && m.clientMatchId === lm.clientMatchId)
      );
      if (!existsOnServer) {
        merged.unshift(Object.assign({}, lm.match, { _id: lm.localId }));
      }
    }

    const activeLiveMatch = merged.find((m) => ['live', 'paused', 'innings_break'].includes(m.status));
    const heroCard = document.getElementById('activeMatchHeroCard');
    if (activeLiveMatch && heroCard) {
      const inn1 = (activeLiveMatch.inningsSummary || [])[0];
      const inn2 = (activeLiveMatch.inningsSummary || [])[1];
      const activeInn = inn2 || inn1;
      const teamAName = activeLiveMatch.teamA?.name || 'Team A';
      const teamBName = activeLiveMatch.teamB?.name || 'Team B';
      const scoreStr = activeInn ? `${activeInn.totalRuns}/${activeInn.wickets}` : '0/0';
      const ovStr = activeInn ? `(${activeInn.oversString} / ${activeLiveMatch.oversPerInnings} ov)` : `(0.0 / ${activeLiveMatch.oversPerInnings} ov)`;

      const teamsEl = document.getElementById('activeMatchTeams');
      const scoreEl = document.getElementById('activeMatchScore');
      const metaEl = document.getElementById('activeMatchMeta');
      const ctaBtn = document.getElementById('activeMatchCtaBtn');
      const scBtn = document.getElementById('activeMatchScorecardBtn');

      if (teamsEl) teamsEl.textContent = `${teamAName} vs ${teamBName}`;
      if (scoreEl) scoreEl.textContent = scoreStr;
      if (metaEl) metaEl.textContent = `${(activeInn && activeInn.battingTeamName) || teamAName} batting • ${ovStr}`;
      if (ctaBtn) ctaBtn.href = `/live-score.html?matchId=${activeLiveMatch._id}`;
      if (scBtn) scBtn.href = `/scorecard.html?matchId=${activeLiveMatch._id}`;

      heroCard.classList.remove('hidden');
    } else if (heroCard) {
      heroCard.classList.add('hidden');
    }

    if (!merged.length) {
      el.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <p style="margin:0 0 8px;font-weight:700;color:var(--text-primary);">Abhi tak koi match nahi, pehla match shuru karo</p>
          <p class="text-sm text-muted" style="margin:0 0 14px;">No matches yet. Start your first cricket match in seconds.</p>
          <a href="/match-create.html" class="btn btn-primary btn-sm btn-ripple">Start Match</a>
        </div>
      `;
      return;
    }

    el.innerHTML = merged.slice(0, 4).map((m) => {
      const inn1 = (m.inningsSummary || [])[0];
      const inn2 = (m.inningsSummary || [])[1];
      const isLive = ['live', 'paused', 'innings_break'].includes(m.status);
      const badge = isLive
        ? `<span class="badge badge-live"><span class="live-dot"></span>LIVE</span>`
        : `<span class="badge badge-neutral">${ApnaUI.escapeHtml((m.status || 'live').toUpperCase())}</span>`;

      const scoreA = inn1 ? `${inn1.totalRuns}/${inn1.wickets} (${inn1.oversString})` : '-';
      const scoreB = inn2 ? `${inn2.totalRuns}/${inn2.wickets} (${inn2.oversString})` : '-';

      return `
        <div class="match-card">
          <div class="flex-between">
            <span class="text-sm text-muted">${new Date(m.matchDate || m.createdAt || Date.now()).toLocaleDateString()} • ${m.oversPerInnings} Ov</span>
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
          <div class="flex-gap mt-1">
            <a href="/live-score.html?matchId=${m._id}" class="btn btn-primary btn-sm">${isLive ? 'Continue Scoring' : 'Open Match'}</a>
            <a href="/scorecard.html?matchId=${m._id}" class="btn btn-secondary btn-sm">View Scorecard</a>
          </div>
        </div>
      `;
    }).join('');
  }
}());
