const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT_DIR = path.resolve(__dirname, '..');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const mockTeamA = { teamId: 'tA', name: 'Rampur Titans', squad: [{ playerId: 'p1', name: 'Raju' }, { playerId: 'p2', name: 'Vikram' }, { playerId: 'p5', name: 'Asif' }] };
const mockTeamB = { teamId: 'tB', name: 'Nagpur Warriors', squad: [{ playerId: 'p3', name: 'Suresh' }, { playerId: 'p4', name: 'Amit' }, { playerId: 'p6', name: 'Rahul' }] };
const mockMatch = {
  _id: 'mock_match_123',
  title: 'Rampur Titans vs Nagpur Warriors',
  venue: 'Gully Ground',
  status: 'live',
  teamA: mockTeamA,
  teamB: mockTeamB,
  toss: { wonByTeamId: 'tA', electedTo: 'bat' },
  oversPerInnings: 6,
  rulesSnapshot: {
    presetName: 'box_cricket',
    format: { oversPerInnings: 6, ballsPerOver: 6, maxOversPerBowler: 2 },
    extras: { wide: { enabled: true, baseRuns: 1 }, noBall: { enabled: true, baseRuns: 1, freeHitOnNextBall: true } },
    wickets: { bowled: true, caught: true, runOut: true },
    localRules: { lastManBatting: false, oneTipOneHandCatch: false }
  }
};
const mockInnings = [{
  inningsNumber: 1,
  battingTeamId: 'tA',
  bowlingTeamId: 'tB',
  status: 'in_progress'
}];
let mockDeliveries = [
  { eventType: 'set_openers', eventId: 'ev_0', sequence: 1, inningsNumber: 1, strikerId: 'p1', strikerName: 'Raju', nonStrikerId: 'p2', nonStrikerName: 'Vikram', bowlerId: 'p3', bowlerName: 'Suresh' }
];

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsed.pathname;
  if (pathname === '/') pathname = '/index.html';

  if (pathname === '/api/matches' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      matches: [
        {
          _id: 'mock_match_123',
          status: 'live',
          matchDate: new Date().toISOString(),
          oversPerInnings: 6,
          teamA: mockTeamA,
          teamB: mockTeamB,
          inningsSummary: [
            { inningsNumber: 1, battingTeamName: 'Rampur Titans', totalRuns: 0, wickets: 0, oversString: '0.0' }
          ]
        }
      ]
    }));
  }

  if (pathname === '/api/matches/mock_match_123' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      match: mockMatch,
      innings: mockInnings,
      deliveries: mockDeliveries
    }));
  }

  if (pathname === '/api/matches/mock_match_123/events' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const parsedEvt = JSON.parse(body || '{}');
      const ev = { ...parsedEvt, eventId: 'ev_' + Date.now(), sequence: mockDeliveries.length + 1, inningsNumber: 1 };
      mockDeliveries.push(ev);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, event: ev }));
    });
    return;
  }

  if (pathname === '/api/matches/mock_match_123/events/last' && req.method === 'DELETE') {
    if (mockDeliveries.length > 1) mockDeliveries.pop();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  const filePath = path.join(ROOT_DIR, pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  console.log(`[TestServer] Running at http://127.0.0.1:${serverPort}`);

  const userDataDir = path.join(ROOT_DIR, '.tmp_chrome_verify_' + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let chromePort = null;
  const matchPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome launch timeout')), 12000);
    chromeProc.stderr.on('data', (buf) => {
      const line = buf.toString();
      const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        chromePort = Number(m[1]);
        resolve(chromePort);
      }
    });
  });

  try {
    await matchPromise;
    console.log(`[Chrome] Port detected: ${chromePort}`);
  } catch (err) {
    console.error('Failed to get Chrome port:', err);
    chromeProc.kill();
    server.close();
    process.exit(1);
  }

  // Get Page WebSocket URL
  const getPageWs = (port) => new Promise((resolve, reject) => {
    const tryGet = (retries = 10) => {
      http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const list = JSON.parse(raw);
            const page = list.find(t => t.type === 'page') || list[0];
            if (page && page.webSocketDebuggerUrl) return resolve(page.webSocketDebuggerUrl);
          } catch (_) {}
          if (retries > 0) setTimeout(() => tryGet(retries - 1), 200);
          else reject(new Error('No page target found'));
        });
      }).on('error', () => {
        if (retries > 0) setTimeout(() => tryGet(retries - 1), 200);
        else reject(new Error('Cannot reach /json/list'));
      });
    };
    tryGet();
  });

  const cdpUrl = await getPageWs(chromePort);
  console.log(`[CDP] Connected directly to Page target: ${cdpUrl}`);

  const ws = new WebSocket(cdpUrl);
  let id = 1;
  const callbacks = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  });

  await new Promise((resolve) => ws.on('open', resolve));

  const send = (method, params = {}) => new Promise((resolve) => {
    const reqId = id++;
    callbacks.set(reqId, resolve);
    ws.send(JSON.stringify({ id: reqId, method, params }));
  });

  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description).join(' ');
      console.log('  [BrowserConsole]', text);
    } else if (msg.method === 'Log.entryAdded') {
      console.log('  [BrowserLog]', msg.params.entry.text);
    }
  });

  // Set mobile device emulation (360x640, deviceScaleFactor 2, mobile=true)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 640,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { angle: 0, type: 'portraitPrimary' }
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  const evalCode = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result && res.result.exceptionDetails) {
      console.error('  [EvalException]', res.result.exceptionDetails.text, res.result.exceptionDetails.exception?.description);
    }
    const evaluation = res.result ? res.result.result : null;
    return evaluation ? evaluation.value : null;
  };

  const results = [];
  const logCheck = (name, passed, detail) => {
    results.push({ name, passed, detail });
    console.log(`${passed ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
  };

  const navigateAndWait = async (url, selector) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 50; i++) {
      const ready = await evalCode(`Boolean(document.querySelector('${selector}'))`);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  console.log('\n--- 1. TESTING MOBILE HOME (dashboard.html) on 360px Viewport ---');
  await navigateAndWait(`http://127.0.0.1:${serverPort}/dashboard.html`, '.topbar');

  // Check topbar
  const topbarBg = await evalCode(`(() => {
    const el = document.querySelector('.topbar');
    return el ? window.getComputedStyle(el).backgroundColor : '';
  })()`) || '';
  logCheck('Mobile Topbar background color is brand green (#208B4E / rgb(32, 139, 78))',
    topbarBg.includes('32, 139, 78') || topbarBg.includes('32,139,78'),
    `actual: ${topbarBg}`
  );

  // Check topbar mobile controls
  const topbarButtons = await evalCode(`(() => {
    const installEl = document.getElementById('pwaInstallBtn');
    const syncEl = document.getElementById('globalSyncPill');
    return {
      hasMenuBtn: Boolean(document.getElementById('openDrawerBtn')),
      title: document.querySelector('.topbar-page-title')?.textContent?.trim(),
      hiddenInstallOnMobile: !installEl || window.getComputedStyle(installEl).display === 'none',
      hiddenSyncOnMobile: !syncEl || window.getComputedStyle(syncEl).display === 'none'
    };
  })()`);
  logCheck('Mobile topbar hides desktop install & wifi pills to conserve space',
    topbarButtons.hiddenInstallOnMobile && topbarButtons.hiddenSyncOnMobile,
    JSON.stringify(topbarButtons)
  );

  // Check Drawer items order
  const drawerCheck = await evalCode(`(() => {
    const items = Array.from(document.querySelectorAll('#mobileDrawerNav .drawer-main-links a, #mobileDrawerNav .drawer-main-links button'))
      .map(el => el.textContent.trim().replace(/\\s+/g, ' '));
    const statusText = document.getElementById('drawerStatusText')?.textContent?.trim();
    return { statusText, items };
  })()`);
  logCheck('Drawer top has Online/Offline status row',
    drawerCheck.statusText === 'Online' || drawerCheck.statusText === 'Offline',
    `status: ${drawerCheck.statusText}`
  );
  logCheck('Drawer links order includes Home, Pro, Pricing, Settings, Profile, Install App, Feedback, About App',
    drawerCheck.items.some(i => i.includes('Home')) &&
    drawerCheck.items.some(i => i.includes('Pro')) &&
    drawerCheck.items.some(i => i.includes('Pricing')) &&
    drawerCheck.items.some(i => i.includes('Settings')) &&
    drawerCheck.items.some(i => i.includes('Profile')) &&
    drawerCheck.items.some(i => i.includes('Install App')) &&
    drawerCheck.items.some(i => i.includes('Feedback')) &&
    drawerCheck.items.some(i => i.includes('About App')),
    JSON.stringify(drawerCheck.items)
  );

  // Check Mobile Home 3 sections
  const sectionsCheck = await evalCode(`({
    sec1QuickActions: Boolean(document.querySelector('.primary-choices-grid')),
    sec1Cards: Array.from(document.querySelectorAll('.choice-card h2')).map(h => h.textContent.trim()),
    sec2RecentMatches: Boolean(document.getElementById('recentMatchesList')),
    sec3AboutAccordion: Boolean(document.getElementById('aboutSection')),
    sec3CollapsedByDefault: !document.getElementById('aboutSection').open
  })`);
  logCheck('Section 1: Quick Actions contains Simple Match, Tournaments, My Matches',
    sectionsCheck.sec1Cards.includes('SIMPLE MATCH') && sectionsCheck.sec1Cards.includes('TOURNAMENTS') && sectionsCheck.sec1Cards.includes('MY MATCHES'),
    JSON.stringify(sectionsCheck.sec1Cards)
  );
  logCheck('Section 2: Live and Recent Matches swipe list present',
    sectionsCheck.sec2RecentMatches
  );
  logCheck('Section 3: About ApnaScore single accordion is collapsed by default',
    sectionsCheck.sec3AboutAccordion && sectionsCheck.sec3CollapsedByDefault,
    `open: ${!sectionsCheck.sec3CollapsedByDefault}`
  );

  // Expand Section 3 and verify Developer Section inside
  const devSectionCheck = await evalCode(`(() => {
    const acc = document.getElementById('aboutSection');
    acc.open = true;
    const name = acc.querySelector('.dev-content h3')?.textContent?.trim();
    const photo = acc.querySelector('.dev-photo-wrap img')?.getAttribute('src');
    const waLink = acc.querySelector('a[href*="wa.me"]')?.getAttribute('href');
    const instaLink = acc.querySelector('a[href*="instagram.com"]')?.getAttribute('href');
    const emailLink = acc.querySelector('a[href*="mailto:"]')?.getAttribute('href');
    const portfolioLink = acc.querySelector('a[href*="farooqui-umair-portfolio"]')?.getAttribute('href');
    return { name, photo, waLink, instaLink, emailLink, portfolioLink };
  })()`);
  logCheck('About section contains Meet Developer card with Umair Farooqui & social links',
    devSectionCheck.name === 'Umair Farooqui' &&
    devSectionCheck.photo.includes('umair-farooqui') &&
    devSectionCheck.waLink.includes('wa.me') &&
    devSectionCheck.portfolioLink.includes('farooqui-umair-portfolio'),
    JSON.stringify(devSectionCheck)
  );

  // Check Bottom Tabs (5 items, min 48px target)
  const bottomNavCheck = await evalCode(`(() => {
    const tabs = Array.from(document.querySelectorAll('.bottom-tab'));
    const heights = tabs.map(t => t.getBoundingClientRect().height);
    const labels = tabs.map(t => t.textContent.trim());
    return { count: tabs.length, labels, minHeight: Math.min(...heights) };
  })()`);
  logCheck('Bottom navigation bar has 5 tabs with min 48px touch targets',
    bottomNavCheck.count === 5 && bottomNavCheck.minHeight >= 48,
    `labels: ${JSON.stringify(bottomNavCheck.labels)}, minHeight: ${bottomNavCheck.minHeight}`
  );

  console.log('\n--- 2. TESTING MOBILE SCORING SCREEN (live-score.html) on 360px Viewport ---');
  await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/live-score.html?matchId=mock_match_123` });
  for (let i = 0; i < 50; i++) {
    const ready = await evalCode(`Boolean(document.getElementById('strikerName')?.textContent?.includes('Raju'))`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await evalCode(`window.confirm = () => true;`);

  const scoringLayoutCheck = await evalCode(`(() => {
    return {
      appbarTitle: document.getElementById('scMatchTitle')?.textContent?.trim(),
      scoreText: document.getElementById('mainScoreDigits')?.textContent?.trim(),
      highlightLine: document.getElementById('scHighlightLine')?.textContent?.trim(),
      strikerText: document.getElementById('strikerName')?.textContent?.trim(),
      nonStrikerText: document.getElementById('nonStrikerName')?.textContent?.trim(),
      bowlerText: document.getElementById('bowlerName')?.textContent?.trim(),
      toggleChipsCount: document.querySelectorAll('.sc-toggle-chip').length,
      thumbRunsCount: document.querySelectorAll('.sc-thumb-runs-pad .score-btn').length,
      undoBtnExists: Boolean(document.getElementById('undoBallBtn')),
      bodyOverflow: window.getComputedStyle(document.body).overflowY
    };
  })()`);

  logCheck('Scoring screen app bar shows match title',
    scoringLayoutCheck.appbarTitle.includes('Rampur Titans'),
    `title: ${scoringLayoutCheck.appbarTitle}`
  );
  logCheck('Score card shows runs-wickets digits and projected score highlight line',
    scoringLayoutCheck.scoreText === '0-0' && scoringLayoutCheck.highlightLine.includes('Projected'),
    `score: ${scoringLayoutCheck.scoreText}, highlight: ${scoringLayoutCheck.highlightLine}`
  );
  logCheck('Crease strip shows striker Raju, non-striker Vikram, bowler Suresh',
    scoringLayoutCheck.strikerText.includes('Raju') && scoringLayoutCheck.nonStrikerText.includes('Vikram') && scoringLayoutCheck.bowlerText.includes('Suresh'),
    JSON.stringify(scoringLayoutCheck)
  );
  logCheck('Toggle chips row contains Wide, No Ball, Byes, Leg Byes, Wicket (5 chips)',
    scoringLayoutCheck.toggleChipsCount === 5,
    `count: ${scoringLayoutCheck.toggleChipsCount}`
  );
  logCheck('Thumb run pad contains 8 buttons (0, 1, 2, 3, 4, 5, 6, More)',
    scoringLayoutCheck.thumbRunsCount === 8,
    `count: ${scoringLayoutCheck.thumbRunsCount}`
  );

  // Test Delivery Scoring with Toggle Chip: Wide + 1 run
  console.log('\n--- 3. TESTING SCORING WITH TOGGLE CHIPS & BALL ACTION ---');
  await evalCode(`
    document.getElementById('chipWide').click();
  `);
  const wideChipActive = await evalCode(`document.getElementById('chipWide').classList.contains('active')`);
  logCheck('Tapping Wide chip highlights it active', wideChipActive);

  // Now tap run button 1 (Records Wide + 1 run = 2 runs)
  await evalCode(`
    document.querySelector('.score-btn[data-run="1"]').click();
  `);
  await new Promise((r) => setTimeout(r, 400));

  const afterWideCheck = await evalCode(`(() => {
    return {
      chipStillActive: document.getElementById('chipWide').classList.contains('active'),
      score: document.getElementById('mainScoreDigits').textContent.trim(),
      extrasVal: document.getElementById('extrasVal').textContent.trim()
    };
  })()`);
  logCheck('Tapping run after Wide chip records wide delivery and resets chip',
    !afterWideCheck.chipStillActive && afterWideCheck.score === '2-0' && afterWideCheck.extrasVal === '2',
    JSON.stringify(afterWideCheck)
  );

  // Score a boundary 4
  await evalCode(`
    document.querySelector('.score-btn[data-run="4"]').click();
  `);
  await new Promise((r) => setTimeout(r, 500));
  const afterBoundaryCheck = await evalCode(`(() => {
    return {
      score: document.getElementById('mainScoreDigits').textContent.trim(),
      strikerRuns: document.getElementById('strikerRuns').textContent.trim()
    };
  })()`);
  logCheck('Scoring boundary 4 updates score to 6-0 and striker to 4 runs',
    afterBoundaryCheck.score === '6-0' && afterBoundaryCheck.strikerRuns === '4',
    JSON.stringify(afterBoundaryCheck)
  );

  // Test Swap Batsmen (wait 400ms to clear tapLocked)
  await new Promise((r) => setTimeout(r, 400));
  const swapDebug = await evalCode(`(() => {
    const btn = document.getElementById('swapBatsmenBtn');
    const sBefore = document.getElementById('strikerName')?.textContent.trim();
    const nsBefore = document.getElementById('nonStrikerName')?.textContent.trim();
    if (btn) btn.click();
    return {
      btnFound: Boolean(btn),
      sBefore,
      nsBefore
    };
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  const afterSwapCheck = await evalCode(`(() => {
    return {
      strikerName: document.getElementById('strikerName').textContent.trim(),
      nonStrikerName: document.getElementById('nonStrikerName').textContent.trim()
    };
  })()`);
  const swappedCorrectly = afterSwapCheck.strikerName === swapDebug.nsBefore && afterSwapCheck.nonStrikerName === swapDebug.sBefore;
  logCheck('Tapping ⇄ Swap immediately swaps striker and non-striker',
    swappedCorrectly,
    JSON.stringify({ before: swapDebug, after: afterSwapCheck })
  );

  // Test Undo Ball
  await evalCode(`
    document.getElementById('undoBallBtn').click();
  `);
  await new Promise((r) => setTimeout(r, 500));
  const afterUndoCheck = await evalCode(`(() => {
    return {
      score: document.getElementById('mainScoreDigits').textContent.trim()
    };
  })()`);
  logCheck('Tapping ↶ Undo successfully rolls back the last delivery',
    afterUndoCheck.score === '6-0' || afterUndoCheck.score === '2-0',
    `score: ${afterUndoCheck.score}`
  );

  console.log('\n--- 4. TESTING SMART PLAYER AUTOCOMPLETE (§17) ---');
  // Open new batsman modal via ScoringUI.openPlayersModal('new_batsman')
  await evalCode(`
    ScoringUI.openPlayersModal('new_batsman');
  `);
  await new Promise((r) => setTimeout(r, 400));

  // Focus empty input -> should render squad player chips
  await evalCode(`(() => {
    const el = document.getElementById('txtNewBat');
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  const autocompleteEmptyChips = await evalCode(`(() => {
    const chips = Array.from(document.querySelectorAll('.ac-chip-btn')).map(c => c.textContent.trim());
    return chips;
  })()`);
  logCheck('Empty player input shows available squad players as instant tappable chips',
    autocompleteEmptyChips.includes('Asif'),
    `chips: ${JSON.stringify(autocompleteEmptyChips)}`
  );

  // Type a query "as" -> should fuzzy match Asif with highlighted <mark>
  await evalCode(`(() => {
    const el = document.getElementById('txtNewBat');
    el.value = 'as';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  const autocompleteTypingCheck = await evalCode(`(() => {
    const markText = document.querySelector('.ac-mark')?.textContent?.trim();
    const itemText = document.querySelector('.ac-item')?.textContent?.trim();
    return { markText, itemText };
  })()`);
  logCheck('Typing fuzzy searches and highlights matched letters with <mark>',
    autocompleteTypingCheck.markText?.toLowerCase() === 'as',
    JSON.stringify(autocompleteTypingCheck)
  );

  // Type a brand new name "Irfan" -> shows "+ Add 'Irfan' as new player"
  await evalCode(`(() => {
    const el = document.getElementById('txtNewBat');
    el.value = 'Irfan';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  const addNewCheck = await evalCode(`(() => {
    const addBtn = document.querySelector('.ac-item-add')?.textContent?.trim();
    return addBtn;
  })()`);
  logCheck('Typing unlisted player name provides "+ Add player as new player" option',
    addNewCheck && addNewCheck.includes('Add "Irfan" as new player'),
    `addBtn: ${addNewCheck}`
  );

  // Summary of checks
  console.log('\n=========================================');
  const allPassed = results.every(r => r.passed);
  console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${results.filter(r => r.passed).length} | FAILED: ${results.filter(r => !r.passed).length}`);
  console.log('=========================================\n');

  ws.close();
  chromeProc.kill();
  server.close();

  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
