/**
 * ApnaScore Scorecard Viewer & PDF Export Controller
 */
(function () {
  'use strict';

  let currentBundle = null;

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'scorecards', pageTitle: 'Scorecards' });
    const params = new URLSearchParams(window.location.search);
    const matchId = params.get('matchId');

    if (matchId) {
      document.getElementById('scorecardListView').classList.add('hidden');
      document.getElementById('scorecardDetailView').classList.remove('hidden');
      await loadScorecardDetail(matchId);
    } else {
      await loadScorecardList();
    }
  });

  async function loadScorecardList() {
    const grid = document.getElementById('scorecardsGrid');
    try {
      const [res, localMatches] = await Promise.all([
        ApnaAPI.get('/api/matches').catch(() => ({ matches: [] })),
        window.ApnaOffline ? ApnaOffline.getAllLocalMatches().catch(() => []) : []
      ]);
      const matches = [...(res.matches || [])];
      for (const lm of localMatches) {
        if (!matches.some((m) => String(m._id) === String(lm.serverMatchId || lm.localId) || (lm.clientMatchId && m.clientMatchId === lm.clientMatchId))) {
          matches.unshift(Object.assign({}, lm.match, { _id: lm.localId, isLocalOnly: true }));
        }
      }
      if (!matches.length) {
        grid.innerHTML = `<div class="empty-state">No matches found yet.</div>`;
        return;
      }
      grid.innerHTML = matches.map((m) => `
        <div class="match-card">
          <div class="flex-between">
            <span class="text-sm text-muted">${new Date(m.matchDate || Date.now()).toLocaleDateString()} • ${ApnaUI.escapeHtml(m.venue || 'Ground')}</span>
            <span class="badge badge-neutral">${ApnaUI.escapeHtml((m.status || 'live').toUpperCase())}</span>
          </div>
          <strong>${ApnaUI.escapeHtml(m.title)}</strong>
          <div class="text-sm" style="color:var(--text-brand);font-weight:600;">${ApnaUI.escapeHtml((m.result && m.result.marginText) || 'In progress')}</div>
          <div class="flex-gap">
            <a href="/scorecard.html?matchId=${m._id}" class="btn btn-primary btn-sm">Open Scorecard</a>
            ${!m.isLocalOnly ? `<a href="/api/scorecards/${m._id}/pdf" target="_blank" class="btn btn-secondary btn-sm">PDF</a>` : ''}
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  async function loadScorecardDetail(matchId) {
    try {
      let match = null;
      let innings = [];
      try {
        if (!String(matchId).startsWith('cm_') && !String(matchId).startsWith('local_')) {
          const res = await ApnaAPI.get(`/api/scorecards/${matchId}`);
          match = res.match;
          innings = res.innings || [];
        }
      } catch (_) {}

      if (!match && window.ApnaOffline) {
        const localRec = await ApnaOffline.getLocalMatch(matchId);
        if (localRec) {
          match = localRec.match;
          const allEvs = await ApnaOffline.getEventsForMatch(localRec.localId);
          innings = (localRec.innings || []).map((inn) => {
            const innEvs = allEvs.filter((e) => Number(e.inningsNumber || 1) === Number(inn.inningsNumber || 1));
            const st = ApnaScoringEngine.replayInnings({ ...inn, rules: match.rulesSnapshot }, innEvs);
            return Object.assign({}, inn, {
              totalRuns: st.totalRuns,
              wickets: st.wickets,
              legalBalls: st.legalBalls,
              oversString: st.oversString,
              extrasBreakdown: st.extrasBreakdown,
              computedState: st
            });
          });
        }
      }

      if (!match) {
        document.getElementById('scorecardRenderRoot').innerHTML = `<div class="card empty-state">Scorecard not found locally or on server.</div>`;
        return;
      }

      currentBundle = { match, innings };
      renderScorecard(match, innings);

      document.getElementById('downloadPdfBtn').onclick = () => ApnaPDF.downloadMatchPDF(matchId, currentBundle);
      document.getElementById('printScorecardBtn').onclick = () => window.print();
      document.getElementById('sharePdfBtn').onclick = () => ApnaPDF.shareMatchPDF(matchId, currentBundle);
    } catch (err) {
      document.getElementById('scorecardRenderRoot').innerHTML = `<div class="card empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  function renderScorecard(match, inningsList) {
    const root = document.getElementById('scorecardRenderRoot');
    const headerHtml = `
      <div class="card mb-2" style="border-top:5px solid var(--brand-primary);">
        <div class="flex-between">
          <div class="flex-gap">
            <img src="/assets/logos/apnascore-logo.png" alt="ApnaScore" style="width:52px;height:52px;object-fit:contain;border-radius:10px;" />
            <div>
              <h2 style="margin:0;">${ApnaUI.escapeHtml(match.title)}</h2>
              <div class="text-sm text-muted">${ApnaUI.escapeHtml(match.venue)} • ${new Date(match.matchDate).toLocaleDateString()} • ${match.oversPerInnings} Overs</div>
            </div>
          </div>
          <span class="badge badge-success">${ApnaUI.escapeHtml(match.status.toUpperCase())}</span>
        </div>
        ${match.toss && match.toss.winnerTeamName ? `<p class="text-sm mt-1"><strong>Toss:</strong> ${ApnaUI.escapeHtml(match.toss.winnerTeamName)} won and elected to ${ApnaUI.escapeHtml(match.toss.decision)}</p>` : ''}
        <p style="font-weight:800;color:var(--text-brand);margin:6px 0 0;">${ApnaUI.escapeHtml((match.result && match.result.marginText) || '')}</p>
        ${match.result && match.result.playerOfMatchName ? `<p class="text-sm mt-1">🏅 <strong>Player of the Match:</strong> ${ApnaUI.escapeHtml(match.result.playerOfMatchName)}</p>` : ''}
      </div>
    `;

    const inningsHtml = inningsList.map((inn) => {
      const st = inn.computedState || {};
      const ext = inn.extrasBreakdown || st.extrasBreakdown || {};
      const batRows = (st.battingOrder || []).map((pid) => {
        const b = st.battingStats[pid] || {};
        return `<tr><td><strong>${ApnaUI.escapeHtml(b.name)}</strong><br><span class="text-sm text-muted">${ApnaUI.escapeHtml(b.dismissalText)}</span></td><td class="num"><strong>${b.runs}</strong></td><td class="num">${b.balls}</td><td class="num">${b.fours}</td><td class="num">${b.sixes}</td><td class="num">${(b.strikeRate || 0).toFixed(1)}</td></tr>`;
      }).join('');
      const bowlRows = (st.bowlingOrder || []).map((pid) => {
        const bw = st.bowlingStats[pid] || {};
        return `<tr><td><strong>${ApnaUI.escapeHtml(bw.name)}</strong></td><td class="num">${bw.overs}</td><td class="num">${bw.maidens}</td><td class="num">${bw.runs}</td><td class="num"><strong>${bw.wickets}</strong></td><td class="num">${(bw.economy || 0).toFixed(2)}</td></tr>`;
      }).join('');
      const fow = (st.fallOfWickets || []).map((f) => `${f.wicketNumber}-${f.score} (${f.playerName}, ${f.overs} ov)`).join(' • ');

      return `
        <div class="card mb-2">
          <div class="card-header">
            <h3 class="card-title">Innings ${inn.inningsNumber}: ${ApnaUI.escapeHtml(inn.battingTeamName)}</h3>
            <span class="badge badge-success" style="font-size:0.95rem;">${inn.totalRuns}/${inn.wickets} (${inn.oversString} ov)</span>
          </div>
          <div class="table-wrap mb-2">
            <table class="data-table">
              <thead><tr><th>Batsman</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead>
              <tbody>${batRows || '<tr><td colspan="6">No batting records</td></tr>'}</tbody>
            </table>
          </div>
          <p class="text-sm text-muted"><strong>Extras:</strong> ${ext.total || 0} (wd ${ext.wides || 0}, nb ${ext.noBalls || 0}, b ${ext.byes || 0}, lb ${ext.legByes || 0}, ot ${ext.overthrows || 0}, pen ${ext.penalties || 0})</p>
          ${fow ? `<p class="text-sm"><strong>Fall of Wickets:</strong> ${ApnaUI.escapeHtml(fow)}</p>` : ''}
          <div class="table-wrap mt-2">
            <table class="data-table">
              <thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead>
              <tbody>${bowlRows || '<tr><td colspan="6">No bowling records</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    root.innerHTML = headerHtml + inningsHtml;
  }
}());
