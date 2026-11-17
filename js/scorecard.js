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
      const waBtn = document.getElementById('shareWaCardBtn');
      if (waBtn) {
        const innSummary = innings.map((i) => `${i.battingTeamName}: ${i.totalRuns}/${i.wickets} (${i.oversString} ov)`).join(' vs ');
        const resTxt = (match.result && match.result.marginText) || match.status.toUpperCase();
        const shareUrl = match.isPublic && match.matchCode
          ? `${window.location.origin}/public-match.html?id=${encodeURIComponent(match.matchCode)}`
          : window.location.href;
        waBtn.href = `https://wa.me/?text=${encodeURIComponent(`🏏 ${match.title}\n${innSummary}\n${resTxt}\nScorecard: ${shareUrl}`)}`;
      }

      // WhatsApp Story Poster & WhatsApp Score Text
      const storyBtn = document.getElementById('storyPosterBtn');
      if (storyBtn) {
        storyBtn.onclick = () => {
          if (!window.ApnaPoster) return;
          const mom = window.ApnaMOM?.calculate(match, innings, match.deliveries || []);
          const scoreA = innings[0] ? `${innings[0].totalRuns || 0}/${innings[0].wickets || 0}` : '0/0';
          const oversA = innings[0] ? `${innings[0].oversString || '0.0'} ov` : '0.0 ov';
          const scoreB = innings[1] ? `${innings[1].totalRuns || 0}/${innings[1].wickets || 0}` : '-';
          const oversB = innings[1] ? `${innings[1].oversString || '0.0'} ov` : '-';

          let bestBat = null;
          let bestBowl = null;
          innings.forEach((inn) => {
            const st = inn.computedState || {};
            Object.values(st.battingStats || {}).forEach((b) => {
              if (!bestBat || b.runs > bestBat.runs) bestBat = b;
            });
            Object.values(st.bowlingStats || {}).forEach((bw) => {
              if (!bestBowl || bw.wickets > bestBowl.wickets) bestBowl = bw;
            });
          });

          window.ApnaPoster.generateCanvas(match, {
            scoreA,
            oversA,
            scoreB,
            oversB,
            topBat: bestBat ? `${bestBat.name}: ${bestBat.runs} (${bestBat.balls}b, ${bestBat.fours}x4, ${bestBat.sixes}x6)` : 'Cricket Match',
            topBowl: bestBowl ? `${bestBowl.name}: ${bestBowl.wickets}/${bestBowl.runs} (${bestBowl.overs} ov)` : '-',
            momName: match.result?.playerOfMatchName || mom?.playerName || bestBat?.name || 'Star Player',
            momPoints: mom ? `${mom.points} Impact Pts` : 'Key Player',
            resultText: (match.result && match.result.marginText) || 'Match Scorecard'
          }).then((canvas) => {
            window.ApnaPoster.showModal(canvas, match.title);
          });
        };
      }

      const waScoreBtn = document.getElementById('waScoreBtn');
      if (waScoreBtn) {
        waScoreBtn.onclick = () => {
          if (!window.ApnaWhatsApp) return;
          const lastInn = innings[innings.length - 1] || innings[0] || {};
          const txt = window.ApnaWhatsApp.buildText(match, {
            score: `${lastInn.totalRuns || 0}/${lastInn.wickets || 0}`,
            overs: `${lastInn.oversString || '0.0'}`,
            battingTeam: lastInn.battingTeamName || match.teamA?.name,
            equation: (match.result && match.result.marginText) || ''
          });
          window.ApnaWhatsApp.copy(txt, 'Score text copied! Opening WhatsApp...');
          window.ApnaWhatsApp.share(txt);
        };
      }
    } catch (err) {
      document.getElementById('scorecardRenderRoot').innerHTML = `<div class="card empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  function renderScorecard(match, inningsList) {
    const root = document.getElementById('scorecardRenderRoot');
    const mom = window.ApnaMOM?.calculate(match, inningsList, match.deliveries || []);
    const potmName = match.result?.playerOfMatchName || mom?.playerName;

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
        ${potmName ? `
          <div class="mt-2" style="background:var(--success-bg);border:1px solid var(--brand-primary);border-radius:var(--radius-sm);padding:8px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div>
              <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;color:var(--brand-primary);letter-spacing:0.04em;">⭐ MAN OF THE MATCH</span>
              <div style="font-size:1.05rem;font-weight:800;color:var(--text-primary);">${ApnaUI.escapeHtml(potmName)} ${mom ? `<span class="badge badge-lime" style="font-size:0.75rem;">${mom.points} Impact Pts</span>` : ''}</div>
              ${mom ? `<div class="text-sm text-muted">${ApnaUI.escapeHtml(mom.summary)}</div>` : ''}
            </div>
            <button type="button" class="btn btn-lime btn-sm" id="viewMomCardBtn" data-pname="${ApnaUI.escapeHtml(potmName)}">🃏 View Player Card</button>
          </div>
        ` : ''}
      </div>
    `;

    const inningsHtml = inningsList.map((inn) => {
      const st = inn.computedState || {};
      const ext = inn.extrasBreakdown || st.extrasBreakdown || {};
      const batRows = (st.battingOrder || []).map((pid) => {
        const b = st.battingStats[pid] || {};
        return `<tr><td><strong class="player-card-click" style="cursor:pointer;color:var(--brand-primary);" data-pname="${ApnaUI.escapeHtml(b.name)}" data-runs="${b.runs}" data-sr="${b.strikeRate || 0}" data-sixes="${b.sixes || 0}">${ApnaUI.escapeHtml(b.name)}</strong><br><span class="text-sm text-muted">${ApnaUI.escapeHtml(b.dismissalText)}</span></td><td class="num"><strong>${b.runs}</strong></td><td class="num">${b.balls}</td><td class="num">${b.fours}</td><td class="num">${b.sixes}</td><td class="num">${(b.strikeRate || 0).toFixed(1)}</td></tr>`;
      }).join('');
      const bowlRows = (st.bowlingOrder || []).map((pid) => {
        const bw = st.bowlingStats[pid] || {};
        return `<tr><td><strong class="player-card-click" style="cursor:pointer;color:var(--brand-primary);" data-pname="${ApnaUI.escapeHtml(bw.name)}" data-wkts="${bw.wickets}" data-eco="${bw.economy || 0}">${ApnaUI.escapeHtml(bw.name)}</strong></td><td class="num">${bw.overs}</td><td class="num">${bw.maidens}</td><td class="num">${bw.runs}</td><td class="num"><strong>${bw.wickets}</strong></td><td class="num">${(bw.economy || 0).toFixed(2)}</td></tr>`;
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
              <thead><tr><th>Batsman (tap for card)</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead>
              <tbody>${batRows || '<tr><td colspan="6">No batting records</td></tr>'}</tbody>
            </table>
          </div>
          <p class="text-sm text-muted"><strong>Extras:</strong> ${ext.total || 0} (wd ${ext.wides || 0}, nb ${ext.noBalls || 0}, b ${ext.byes || 0}, lb ${ext.legByes || 0}, ot ${ext.overthrows || 0}, pen ${ext.penalties || 0})</p>
          ${fow ? `<p class="text-sm"><strong>Fall of Wickets:</strong> ${ApnaUI.escapeHtml(fow)}</p>` : ''}
          <div class="table-wrap mt-2">
            <table class="data-table">
              <thead><tr><th>Bowler (tap for card)</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead>
              <tbody>${bowlRows || '<tr><td colspan="6">No bowling records</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    root.innerHTML = headerHtml + inningsHtml;

    // Attach Player Card click triggers
    document.querySelectorAll('.player-card-click').forEach((el) => {
      el.addEventListener('click', () => {
        if (!window.ApnaPlayerCard) return;
        const name = el.dataset.pname;
        const runs = Number(el.dataset.runs || 0);
        const sr = Number(el.dataset.sr || 120);
        const sixes = Number(el.dataset.sixes || 0);
        const wickets = Number(el.dataset.wkts || 0);
        const economy = Number(el.dataset.eco || 7.5);
        window.ApnaPlayerCard.showModal({ name, village: match.village || 'Local Village' }, { runs, strikeRate: sr, sixes, wickets, economy });
      });
    });

    document.getElementById('viewMomCardBtn')?.addEventListener('click', () => {
      if (!window.ApnaPlayerCard) return;
      const name = potmName;
      window.ApnaPlayerCard.showModal({ name, village: match.village || 'Match Hero' }, { runs: mom?.runs || 45, wickets: mom?.wickets || 2, strikeRate: 155, sixes: 3 });
    });
  }
  }
}());
