/**
 * ApnaScore Cricket Ground Tools
 * 1. Screen Wake Lock & Sunlight Mode (High-contrast outdoor glare view)
 * 2. Self-contained Web Audio API & Haptic Engine (Zero asset dependencies)
 * 3. Digital Coin Toss (Virtual Sikka with 3D Flip Physics)
 * 4. Automatic Man of the Match (MOM) Cricket Impact Calculator
 * 5. One-Click WhatsApp Formatted Score Text & Link Generator
 * 6. High-Res HTML5 Canvas WhatsApp Story / Status Match Poster
 * 7. FIFA / IPL Style Player Ultimate Card Generator & Modal
 */
(function (root) {
  'use strict';

  // =========================================================================
  // 1. WEB AUDIO API & HAPTIC ENGINE (Zero External Files, 100% Offline)
  // =========================================================================
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function isSoundEnabled() {
    return localStorage.getItem('apna_sound_effects') !== 'false';
  }

  function toggleSound() {
    const next = !isSoundEnabled();
    localStorage.setItem('apna_sound_effects', next ? 'true' : 'false');
    if (next) playSound('crack');
    return next;
  }

  function vibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (_) {}
  }

  function playSound(type) {
    if (!isSoundEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === 'crack') {
        // Crisp willow bat crack on normal delivery
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.045);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        vibrate(30);
      } else if (type === 'four') {
        // Uplifting 3-tone boundary chime (C5 -> E5 -> G5)
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteStart = now + idx * 0.07;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteStart);
          gain.gain.setValueAtTime(0.28, noteStart);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.18);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteStart);
          osc.stop(noteStart + 0.2);
        });
        vibrate([50, 40, 70]);
      } else if (type === 'six') {
        // Celebratory Sixer Fanfare + haptic pulse
        const notes = [392.00, 523.25, 659.25, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteStart = now + idx * 0.08;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteStart);
          gain.gain.setValueAtTime(0.32, noteStart);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(noteStart);
          osc.stop(noteStart + 0.26);
        });
        vibrate([100, 50, 150]);
      } else if (type === 'wicket') {
        // Umpire out frequency sweep + alarm whistle
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(750, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.28);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.32);
        vibrate([180, 80, 220]);
      } else if (type === 'extra') {
        // Buzzer warning tone for Wide / No-ball
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.setValueAtTime(260, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
        vibrate(80);
      } else if (type === 'flip') {
        // Metallic coin flip ping
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1320, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.35);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.42);
        vibrate([40, 30, 40]);
      } else if (type === 'undo') {
        // Rewind blip
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(450, now + 0.09);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
      }
    } catch (_) {}
  }

  // =========================================================================
  // 2. SCREEN WAKE LOCK & HIGH-CONTRAST SUNLIGHT MODE
  // =========================================================================
  let wakeLockSentinel = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && navigator.wakeLock.request) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(() => {});
      wakeLockSentinel = null;
    }
  }

  function initGroundExperience() {
    // 1. Screen Wake Lock on active page
    requestWakeLock();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    });

    // 2. Sunlight Mode state restore
    if (localStorage.getItem('apna_sunlight_mode') === 'true') {
      document.body.classList.add('sunlight-mode');
    }
  }

  function toggleSunlightMode() {
    const isSunlight = document.body.classList.toggle('sunlight-mode');
    localStorage.setItem('apna_sunlight_mode', isSunlight ? 'true' : 'false');
    root.ApnaUI?.showToast(isSunlight ? '☀️ Sunlight Mode: Active' : '🌙 Standard Mode', 'info');
    return isSunlight;
  }

  // =========================================================================
  // 3. DIGITAL COIN TOSS (VIRTUAL SIKKA)
  // =========================================================================
  function showCoinTossModal({
    teamAName = 'Team A',
    teamBName = 'Team B',
    onComplete = null
  } = {}) {
    let backdrop = document.getElementById('apnaCoinTossModalBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'apnaCoinTossModalBackdrop';
      backdrop.className = 'modal-backdrop';
      document.body.appendChild(backdrop);
    }

    let callerTeam = 'A';
    let chosenFace = 'heads'; // 'heads' or 'tails'
    let isFlipping = false;

    function render() {
      backdrop.innerHTML = `
        <div class="modal-dialog coin-toss-dialog">
          <div class="modal-header">
            <h3 class="modal-title">🪙 Digital Coin Toss (सिक्का उछालो)</h3>
            <button type="button" class="icon-btn" id="coinTossCloseBtn">✕</button>
          </div>

          <div class="coin-toss-content">
            <div class="coin-call-selector mb-2">
              <label class="form-label" style="text-align:center;display:block;">Who is calling the toss?</label>
              <div class="choice-toggle-grid" style="grid-template-columns:1fr 1fr;">
                <button type="button" class="choice-pill-btn ${callerTeam === 'A' ? 'selected' : ''}" id="callTeamABtn">
                  ${root.ApnaUI.escapeHtml(teamAName)}
                </button>
                <button type="button" class="choice-pill-btn ${callerTeam === 'B' ? 'selected' : ''}" id="callTeamBBtn">
                  ${root.ApnaUI.escapeHtml(teamBName)}
                </button>
              </div>

              <div class="coin-face-call mt-1" style="display:flex;justify-content:center;gap:12px;">
                <label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;">
                  <input type="radio" name="coinFaceChoice" value="heads" ${chosenFace === 'heads' ? 'checked' : ''} />
                  Heads (चित्त)
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;">
                  <input type="radio" name="coinFaceChoice" value="tails" ${chosenFace === 'tails' ? 'checked' : ''} />
                  Tails (पट्ट)
                </label>
              </div>
            </div>

            <!-- 3D Coin Graphic -->
            <div class="coin-scene">
              <div class="coin-3d" id="virtualCoin">
                <div class="coin-face coin-front">
                  <div class="coin-inner">
                    <span class="coin-symbol">🏏</span>
                    <span class="coin-text">HEADS</span>
                  </div>
                </div>
                <div class="coin-face coin-back">
                  <div class="coin-inner">
                    <span class="coin-symbol">🏆</span>
                    <span class="coin-text">TAILS</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="coin-result-box hidden" id="coinResultBanner"></div>

            <div class="coin-decision-actions hidden" id="coinDecisionRow">
              <p class="text-sm text-muted" style="margin:6px 0;text-align:center;">Winner picks what to do first:</p>
              <div class="choice-toggle-grid" style="grid-template-columns:1fr 1fr;">
                <button type="button" class="btn btn-primary" id="tossPickBatBtn">🏏 Batting First</button>
                <button type="button" class="btn btn-primary" id="tossPickBowlBtn">⚾ Bowling First</button>
              </div>
            </div>

            <div class="coin-flip-btn-row mt-2" style="text-align:center;">
              <button type="button" class="btn btn-lime btn-lg" id="startCoinFlipBtn" style="min-width:200px;">
                🪙 Flip Coin (उछालो)
              </button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('coinTossCloseBtn').onclick = () => backdrop.classList.remove('open');
      document.getElementById('callTeamABtn').onclick = () => { callerTeam = 'A'; render(); };
      document.getElementById('callTeamBBtn').onclick = () => { callerTeam = 'B'; render(); };

      document.querySelectorAll('input[name="coinFaceChoice"]').forEach((r) => {
        r.onchange = (e) => { chosenFace = e.target.value; };
      });

      document.getElementById('startCoinFlipBtn').onclick = performFlip;
    }

    function performFlip() {
      if (isFlipping) return;
      isFlipping = true;
      const coin = document.getElementById('virtualCoin');
      const flipBtn = document.getElementById('startCoinFlipBtn');
      const resBanner = document.getElementById('coinResultBanner');
      const decisionRow = document.getElementById('coinDecisionRow');

      flipBtn.disabled = true;
      resBanner.classList.add('hidden');
      decisionRow.classList.add('hidden');

      playSound('flip');

      // Random result
      const isHeads = Math.random() >= 0.5;
      const outcomeFace = isHeads ? 'heads' : 'tails';
      const rotations = 5 * 360 + (isHeads ? 0 : 180);

      coin.style.transition = 'transform 1.8s cubic-bezier(0.15, 0.9, 0.25, 1)';
      coin.style.transform = `rotateY(${rotations}deg) scale(1.1)`;

      setTimeout(() => {
        isFlipping = false;
        flipBtn.disabled = false;
        flipBtn.textContent = '🪙 Flip Again';
        coin.style.transition = 'transform 0.3s ease';
        coin.style.transform = `rotateY(${isHeads ? 0 : 180}deg) scale(1)`;

        const callerWon = chosenFace === outcomeFace;
        const winnerSide = callerWon ? callerTeam : (callerTeam === 'A' ? 'B' : 'A');
        const winnerName = winnerSide === 'A' ? teamAName : teamBName;

        playSound('four');

        resBanner.className = 'coin-result-box';
        resBanner.innerHTML = `
          <div style="font-size:1.15rem;font-weight:800;color:var(--brand-primary);margin-bottom:4px;">
            It's ${outcomeFace.toUpperCase()}!
          </div>
          <div style="font-weight:700;">
            🎉 <strong>${root.ApnaUI.escapeHtml(winnerName)}</strong> won the toss!
          </div>
        `;
        resBanner.classList.remove('hidden');
        decisionRow.classList.remove('hidden');

        document.getElementById('tossPickBatBtn').onclick = () => {
          backdrop.classList.remove('open');
          if (onComplete) onComplete({ winnerSide, winnerName, decision: 'bat' });
        };
        document.getElementById('tossPickBowlBtn').onclick = () => {
          backdrop.classList.remove('open');
          if (onComplete) onComplete({ winnerSide, winnerName, decision: 'bowl' });
        };
      }, 1850);
    }

    render();
    backdrop.classList.add('open');
  }

  // =========================================================================
  // 4. AUTOMATIC MAN OF THE MATCH (MOM) CALCULATOR
  // =========================================================================
  function calculateMatchMOM(matchDoc, inningsList = [], deliveriesList = []) {
    if (!matchDoc) return null;
    const scores = {}; // playerId -> { name, teamName, points, runs, balls, fours, sixes, wickets, maidens, dots, runsConceded, oversBowled, catches, runOuts }

    function getPlayerRecord(id, name, teamName) {
      const pId = String(id || name || 'unknown');
      if (!scores[pId]) {
        scores[pId] = {
          id: pId,
          name: name || 'Player',
          teamName: teamName || '',
          points: 0,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          wickets: 0,
          maidens: 0,
          dots: 0,
          runsConceded: 0,
          oversBowled: 0,
          catches: 0,
          runOuts: 0
        };
      }
      return scores[pId];
    }

    // Process from deliveries
    const deliveries = Array.isArray(deliveriesList) ? deliveriesList : [];
    deliveries.forEach((d) => {
      if (d.isVoided) return;
      // Batsman
      if (d.strikerId || d.strikerName) {
        const bat = getPlayerRecord(d.strikerId, d.strikerName, d.battingTeamName);
        const runs = Number(d.runsBat || 0);
        bat.runs += runs;
        if (d.isLegalDelivery !== false) bat.balls += 1;
        if (runs === 4) bat.fours += 1;
        if (runs === 6) bat.sixes += 1;
      }

      // Bowler
      if (d.bowlerId || d.bowlerName) {
        const bwl = getPlayerRecord(d.bowlerId, d.bowlerName, d.bowlingTeamName);
        const charge = Number(d.runsChargedToBowler || (d.runsBat || 0) + (d.runsExtra || 0));
        bwl.runsConceded += charge;
        if (d.runsBat === 0 && (!d.runsExtra || d.runsExtra === 0)) bwl.dots += 1;
        if (d.isWicket && !['run_out', 'retired_hurt', 'retired_out', 'timed_out'].includes(d.wicketType)) {
          bwl.wickets += 1;
        }
      }

      // Fielder
      if (d.fielderId || d.fielderName) {
        const fld = getPlayerRecord(d.fielderId, d.fielderName, d.bowlingTeamName);
        if (d.wicketType === 'caught' || d.wicketType === 'caught_and_bowled') fld.catches += 1;
        if (d.wicketType === 'run_out' || d.wicketType === 'stumped') fld.runOuts += 1;
      }
    });

    // Score calculation
    const teamAWon = matchDoc.result?.winnerTeamId && String(matchDoc.result.winnerTeamId) === String(matchDoc.teamA?.teamId);
    const winningTeamName = matchDoc.result?.winnerTeamName || (teamAWon ? matchDoc.teamA?.name : matchDoc.teamB?.name) || '';

    Object.values(scores).forEach((p) => {
      let pts = 0;

      // Batting pts
      pts += p.runs * 1;
      pts += p.fours * 2;
      pts += p.sixes * 4;
      if (p.runs >= 15 && p.balls > 0) {
        const sr = (p.runs / p.balls) * 100;
        if (sr >= 200) pts += 15;
        else if (sr >= 150) pts += 10;
        else if (sr >= 120) pts += 5;
      }
      if (p.runs >= 50) pts += 25;
      else if (p.runs >= 30) pts += 10;

      // Bowling pts
      pts += p.wickets * 25;
      pts += p.dots * 1;
      if (p.wickets >= 5) pts += 50;
      else if (p.wickets >= 3) pts += 20;

      // Fielding pts
      pts += p.catches * 10;
      pts += p.runOuts * 15;

      // Winning team boost
      if (winningTeamName && p.teamName && p.teamName.toLowerCase() === winningTeamName.toLowerCase()) {
        pts += 10;
      }

      p.points = Math.round(pts);
    });

    const ranked = Object.values(scores).sort((a, b) => b.points - a.points);
    if (!ranked.length) return null;

    const winner = ranked[0];
    let highlight = [];
    if (winner.runs > 0) highlight.push(`${winner.runs} runs (${winner.balls}b)`);
    if (winner.wickets > 0) highlight.push(`${winner.wickets} wkts`);
    if (winner.catches > 0) highlight.push(`${winner.catches} catches`);

    return {
      playerId: winner.id,
      playerName: winner.name,
      teamName: winner.teamName,
      points: winner.points,
      summary: highlight.join(', ') || `${winner.points} Impact Pts`,
      allRanked: ranked.slice(0, 5)
    };
  }

  // =========================================================================
  // 5. ONE-CLICK WHATSAPP FORMATTED SCORE TEXT & LINK GENERATOR
  // =========================================================================
  function buildWhatsAppScoreText(match, liveData = {}) {
    if (!match) return '';
    const origin = window.location.origin;
    const shareLink = `${origin}/public-match.html?id=${match.shareCode || match._id}`;
    const title = match.title || `${match.teamA?.name || 'Team A'} vs ${match.teamB?.name || 'Team B'}`;

    const scoreStr = liveData.score || '0/0';
    const oversStr = liveData.overs || '0.0';
    const battingTeam = liveData.battingTeam || match.teamA?.name || 'Team';
    const equation = liveData.equation || '';
    const striker = liveData.striker ? `• ${liveData.striker.name}*: ${liveData.striker.runs} (${liveData.striker.balls}b)` : '';
    const nonStriker = liveData.nonStriker ? `• ${liveData.nonStriker.name}: ${liveData.nonStriker.runs} (${liveData.nonStriker.balls}b)` : '';
    const bowler = liveData.bowler ? `⚾ Bowler: ${liveData.bowler.name} ${liveData.bowler.overs} ov, ${liveData.bowler.wickets}/${liveData.bowler.runs}` : '';

    return [
      `🏏 *${title}*`,
      match.village ? `📍 ${match.village}` : '',
      `━━━━━━━━━━━━━━━━`,
      `📊 *${battingTeam}*: ${scoreStr} (${oversStr} ov)`,
      equation ? `🔥 *${equation}*` : '',
      striker || nonStriker ? `\n🏏 *On Crease:*` : '',
      striker,
      nonStriker,
      bowler ? `\n${bowler}` : '',
      `━━━━━━━━━━━━━━━━`,
      `🔴 *Live Ball-by-Ball Score Dekho:*`,
      `${shareLink}`,
      `\n_Scored on ApnaScore (Apne Gaon ka Apna Scorer)_`
    ].filter(Boolean).join('\n');
  }

  function shareToWhatsApp(text) {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function copyTextToClipboard(text, successMsg = 'Score copied for WhatsApp!') {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        root.ApnaUI?.showToast(successMsg, 'success');
        return true;
      }
    } catch (_) {}
    // Fallback
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    root.ApnaUI?.showToast(successMsg, 'success');
    return true;
  }

  // =========================================================================
  // 6. WHATSAPP STORY / STATUS MATCH POSTER GENERATOR (HTML5 Canvas)
  // =========================================================================
  async function generateMatchPosterCanvas(match, statsData = {}) {
    const canvas = document.createElement('canvas');
    // 9:16 Instagram & WhatsApp Story Ratio (1080 x 1920)
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    // 1. Background: Deep cricket stadium green gradient
    const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
    grad.addColorStop(0, '#0E3B21');
    grad.addColorStop(0.4, '#072414');
    grad.addColorStop(1, '#021109');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);

    // 2. Stadium Floodlight Radials
    const glow1 = ctx.createRadialGradient(200, 200, 10, 200, 200, 600);
    glow1.addColorStop(0, 'rgba(46, 204, 113, 0.25)');
    glow1.addColorStop(1, 'rgba(46, 204, 113, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, 1080, 1000);

    const glow2 = ctx.createRadialGradient(880, 400, 10, 880, 400, 600);
    glow2.addColorStop(0, 'rgba(32, 139, 78, 0.2)');
    glow2.addColorStop(1, 'rgba(32, 139, 78, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, 1080, 1000);

    // 3. Border accent
    ctx.strokeStyle = '#208B4E';
    ctx.lineWidth = 14;
    ctx.strokeRect(30, 30, 1020, 1860);

    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(42, 42, 996, 1836);

    // 4. Header Badge: APNASCORE
    ctx.fillStyle = '#208B4E';
    ctx.beginPath();
    ctx.roundRect(340, 90, 400, 70, 35);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('APNASCORE', 540, 138);

    ctx.fillStyle = '#A3E635';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Apne Gaon ka Apna Scorer', 540, 205);

    // 5. Match Title & Village
    const matchTitle = match.title || `${match.teamA?.name || 'Team A'} vs ${match.teamB?.name || 'Team B'}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(matchTitle, 540, 290);

    if (match.village) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '28px sans-serif';
      ctx.fillText(`📍 ${match.village}`, 540, 340);
    }

    // 6. Teams & Scores Card Container
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.roundRect(80, 390, 920, 440, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Team A Row
    const teamAName = (match.teamA?.name || 'Team A').toUpperCase();
    const teamBName = (match.teamB?.name || 'Team B').toUpperCase();
    const scoreA = statsData.scoreA || '142/4';
    const oversA = statsData.oversA || '10.0 ov';
    const scoreB = statsData.scoreB || '98/7';
    const oversB = statsData.oversB || '8.2 ov';

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(teamAName, 120, 490);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#A3E635';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(scoreA, 820, 490);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '28px sans-serif';
    ctx.fillText(oversA, 960, 490);

    // Divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(120, 560);
    ctx.lineTo(960, 560);
    ctx.stroke();

    // Team B Row
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(teamBName, 120, 670);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#A3E635';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(scoreB, 820, 670);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '28px sans-serif';
    ctx.fillText(oversB, 960, 670);

    // Match Result Banner
    const resultText = statsData.resultText || match.result?.note || 'Match Completed';
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.roundRect(80, 860, 920, 100, 20);
    ctx.fill();

    ctx.fillStyle = '#061D10';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🏆 ${resultText}`, 540, 925);

    // 7. Top Performers Section
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.roundRect(80, 1000, 920, 540, 24);
    ctx.fill();

    ctx.fillStyle = '#A3E635';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOP PERFORMERS', 120, 1060);

    // Batting highlight
    const topBat = statsData.topBat || 'Raju: 48* (21b, 4x4, 3x6)';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('🏏 Best Batting:', 120, 1130);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '32px sans-serif';
    ctx.fillText(topBat, 160, 1180);

    // Bowling highlight
    const topBowl = statsData.topBowl || 'Suresh: 3/14 (2.0 ov)';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('⚾ Best Bowling:', 120, 1260);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '32px sans-serif';
    ctx.fillText(topBowl, 160, 1310);

    // Man of the Match Highlight
    const momName = statsData.momName || 'Raju';
    const momPoints = statsData.momPoints || '68 Impact Pts';

    ctx.fillStyle = '#FEF08A';
    ctx.beginPath();
    ctx.roundRect(120, 1370, 840, 130, 20);
    ctx.fill();

    ctx.fillStyle = '#713F12';
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('⭐ MAN OF THE MATCH ⭐', 540, 1415);
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(`${momName} • ${momPoints}`, 540, 1465);

    // 8. Footer Call To Action
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('Track live matches & local tournaments on ApnaScore', 540, 1680);

    ctx.fillStyle = '#208B4E';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(window.location.host || 'apnascore.in', 540, 1740);

    return canvas;
  }

  function showPosterModal(canvas, matchTitle = 'ApnaScore Match') {
    let backdrop = document.getElementById('apnaPosterModalBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'apnaPosterModalBackdrop';
      backdrop.className = 'modal-backdrop';
      document.body.appendChild(backdrop);
    }

    const dataUrl = canvas.toDataURL('image/png');

    backdrop.innerHTML = `
      <div class="modal-dialog" style="max-width:480px;text-align:center;">
        <div class="modal-header">
          <h3 class="modal-title">📸 Match Story Poster</h3>
          <button type="button" class="icon-btn" id="posterCloseBtn">✕</button>
        </div>
        <div style="max-height:65vh;overflow-y:auto;border-radius:12px;margin:8px 0;background:#000;">
          <img src="${dataUrl}" alt="Match Poster" style="width:100%;height:auto;display:block;border-radius:12px;" />
        </div>
        <div class="modal-footer" style="justify-content:center;gap:10px;">
          <a href="${dataUrl}" download="ApnaScore_${Date.now()}.png" class="btn btn-primary btn-lg">
            ⬇️ Download Poster
          </a>
          <button type="button" class="btn btn-lime btn-lg" id="posterShareBtn">
            📲 Share to WhatsApp
          </button>
        </div>
      </div>
    `;

    document.getElementById('posterCloseBtn').onclick = () => backdrop.classList.remove('open');
    document.getElementById('posterShareBtn').onclick = async () => {
      try {
        canvas.toBlob(async (blob) => {
          if (blob && navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'match.png', { type: 'image/png' })] })) {
            const file = new File([blob], `${matchTitle.replace(/\s+/g, '_')}_poster.png`, { type: 'image/png' });
            await navigator.share({
              title: matchTitle,
              text: `Check out the match result on ApnaScore!`,
              files: [file]
            });
          } else {
            // Fallback: download
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `ApnaScore_Match.png`;
            a.click();
            root.ApnaUI?.showToast('Poster downloaded! Share it directly to WhatsApp Status.', 'success');
          }
        }, 'image/png');
      } catch (_) {
        root.ApnaUI?.showToast('Use Download button to save poster.', 'info');
      }
    };

    backdrop.classList.add('open');
  }

  // =========================================================================
  // 7. FIFA / IPL STYLE ULTIMATE PLAYER CARD
  // =========================================================================
  function getDesiPlayerBadge(stats) {
    const sr = Number(stats.strikeRate || 0);
    const sixes = Number(stats.sixes || 0);
    const wickets = Number(stats.wickets || 0);
    const runs = Number(stats.totalRuns || stats.runs || 0);
    const eco = Number(stats.economy || 0);

    if (sixes >= 15 || sr >= 170) return { title: 'Six Machine', icon: '🚀', desc: 'Boundary Specialist' };
    if (wickets >= 15 && eco <= 6.5) return { title: 'Yorker King', icon: '🎯', desc: 'Death Overs Specialist' };
    if (runs >= 200 && wickets >= 8) return { title: 'Gaon ka All-Rounder', icon: '⚡', desc: 'Complete Match Winner' };
    if (sr >= 140 && runs >= 100) return { title: 'Gaon ka Finisher', icon: '🔥', desc: 'Clutch Run Chaser' };
    if (wickets >= 10) return { title: 'Speed Gun', icon: '🌪️', desc: 'Pace Bowler' };
    return { title: 'Mr. Dependable', icon: '🛡️', desc: 'The Wall of Team' };
  }

  function calculatePlayerRating(stats) {
    const runs = Number(stats.totalRuns || stats.runs || 0);
    const avg = Number(stats.average || 25);
    const sr = Number(stats.strikeRate || 120);
    const wickets = Number(stats.wickets || 0);
    const eco = Number(stats.economy || 8.0);

    // 0 - 99 attributes
    const bat = Math.min(99, Math.max(50, Math.round(50 + (avg * 1.2) + (runs > 100 ? 10 : runs / 10))));
    const pwr = Math.min(99, Math.max(50, Math.round(40 + (sr / 3) + ((stats.sixes || 0) * 2))));
    const acc = Math.min(99, Math.max(50, Math.round(55 + (avg * 0.8))));
    const bwl = Math.min(99, Math.max(50, Math.round(50 + (wickets * 3.5))));
    const ecoScore = Math.min(99, Math.max(50, Math.round(95 - (eco * 4))));
    const clu = Math.min(99, Math.max(50, Math.round((bat + bwl) / 2 + 5)));

    const ovr = Math.min(99, Math.max(65, Math.round(Math.max(bat, bwl) * 0.6 + (pwr + acc + clu) / 3 * 0.4)));

    return { ovr, bat, pwr, acc, bwl, eco: ecoScore, clu };
  }

  function showPlayerCardModal(player, stats = {}) {
    let backdrop = document.getElementById('apnaPlayerCardModalBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'apnaPlayerCardModalBackdrop';
      backdrop.className = 'modal-backdrop';
      document.body.appendChild(backdrop);
    }

    const ratings = calculatePlayerRating(stats);
    const badge = getDesiPlayerBadge(stats);
    const pName = player.name || 'Cricketer';
    const pVillage = player.village || player.teamName || 'Local Village';
    const photoUrl = player.photoUrl || '/assets/icons/apnascore-icon.png';

    backdrop.innerHTML = `
      <div class="modal-dialog" style="max-width:440px;background:transparent;box-shadow:none;border:none;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button type="button" class="icon-btn" id="playerCardCloseBtn" style="background:#fff;border-radius:50%;">✕</button>
        </div>

        <!-- FIFA ULTIMATE CRICKET CARD -->
        <div class="fifa-card" id="fifaCardEl">
          <div class="fifa-card-inner">
            <div class="fifa-top-row">
              <div class="fifa-ovr-wrap">
                <span class="fifa-ovr">${ratings.ovr}</span>
                <span class="fifa-pos">${player.role ? player.role.slice(0, 3).toUpperCase() : 'BAT'}</span>
                <span class="fifa-flag">🏏</span>
              </div>
              <div class="fifa-avatar-wrap">
                <img src="${photoUrl}" alt="${root.ApnaUI.escapeHtml(pName)}" class="fifa-avatar-img" />
              </div>
            </div>

            <div class="fifa-name-banner">
              <div class="fifa-name">${root.ApnaUI.escapeHtml(pName).toUpperCase()}</div>
              <div class="fifa-badge-pill">${badge.icon} ${badge.title}</div>
              <div class="fifa-club">${root.ApnaUI.escapeHtml(pVillage)}</div>
            </div>

            <div class="fifa-divider"></div>

            <div class="fifa-stats-grid">
              <div class="fifa-stat"><span class="fifa-val">${ratings.bat}</span><span class="fifa-lbl">BAT</span></div>
              <div class="fifa-stat"><span class="fifa-val">${ratings.pwr}</span><span class="fifa-lbl">PWR</span></div>
              <div class="fifa-stat"><span class="fifa-val">${ratings.acc}</span><span class="fifa-lbl">ACC</span></div>
              <div class="fifa-stat"><span class="fifa-val">${ratings.bwl}</span><span class="fifa-lbl">BWL</span></div>
              <div class="fifa-stat"><span class="fifa-val">${ratings.eco}</span><span class="fifa-lbl">ECO</span></div>
              <div class="fifa-stat"><span class="fifa-val">${ratings.clu}</span><span class="fifa-lbl">CLU</span></div>
            </div>

            <div class="fifa-footer-brand">APNASCORE ULTIMATE</div>
          </div>
        </div>

        <div style="display:flex;justify-content:center;gap:12px;margin-top:16px;">
          <button type="button" class="btn btn-lime" id="shareCardWaBtn">📲 Share Player Card</button>
        </div>
      </div>
    `;

    document.getElementById('playerCardCloseBtn').onclick = () => backdrop.classList.remove('open');
    document.getElementById('shareCardWaBtn').onclick = () => {
      const shareTxt = `🏏 *${pName} Player Card (OVR: ${ratings.ovr})*\n🔥 Badge: ${badge.icon} ${badge.title}\n📍 Village: ${pVillage}\n\nCheck full stats on ApnaScore: ${window.location.origin}/player.html`;
      shareToWhatsApp(shareTxt);
    };

    backdrop.classList.add('open');
  }

  // =========================================================================
  // PUBLIC EXPORTS
  // =========================================================================
  root.ApnaGround = {
    init: initGroundExperience,
    requestWakeLock,
    releaseWakeLock,
    toggleSunlightMode
  };

  root.ApnaAudio = {
    play: playSound,
    toggleSound,
    isSoundEnabled,
    vibrate
  };

  root.ApnaToss = {
    showModal: showCoinTossModal
  };

  root.ApnaMOM = {
    calculate: calculateMatchMOM
  };

  root.ApnaWhatsApp = {
    buildText: buildWhatsAppScoreText,
    share: shareToWhatsApp,
    copy: copyTextToClipboard
  };

  root.ApnaPoster = {
    generateCanvas: generateMatchPosterCanvas,
    showModal: showPosterModal
  };

  root.ApnaPlayerCard = {
    showModal: showPlayerCardModal,
    getBadge: getDesiPlayerBadge,
    getRating: calculatePlayerRating
  };

})(window);
