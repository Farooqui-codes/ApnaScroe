/**
 * ApnaScore Shared Shell, Navigation, Theme, Toasts, and PWA Boot
 */
(function (root) {
  'use strict';

  const THEME_KEY = 'apnascore_theme';

  const SIDEBAR_ITEMS = [
    { id: 'dashboard', label: 'Home', href: '/dashboard.html', icon: 'home', section: 'Main' },
    { id: 'match-create', label: 'Simple Match', href: '/match-create.html', icon: 'plusBat', section: 'Main' },
    { id: 'my-matches', label: 'My Matches', href: '/my-matches.html', icon: 'radio', section: 'Main' },
    { id: 'live', label: 'Live Scorer', href: '/live-score.html', icon: 'radio', section: 'Main' },
    { id: 'tournaments', label: 'Tournaments', href: '/tournament.html', icon: 'trophy', section: 'Tournaments & Teams' },
    { id: 'teams', label: 'Teams', href: '/team.html', icon: 'shield', section: 'Tournaments & Teams' },
    { id: 'players', label: 'Players', href: '/player.html', icon: 'users', section: 'Tournaments & Teams' },
    { id: 'scorecards', label: 'Scorecards', href: '/scorecard.html', icon: 'fileText', section: 'Records' },
    { id: 'statistics', label: 'Statistics', href: '/statistics.html', icon: 'barChart', section: 'Records' },
    { id: 'leaderboards', label: 'Leaderboards', href: '/leaderboards.html', icon: 'award', section: 'Records' },
    { id: 'settings', label: 'Settings', href: '/settings.html', icon: 'settings', section: 'Account' },
    { id: 'profile', label: 'Profile', href: '/profile.html', icon: 'user', section: 'Account' }
  ];

  const BOTTOM_TABS = [
    { id: 'dashboard', label: 'Home', href: '/dashboard.html', icon: 'home' },
    { id: 'my-matches', label: 'Live', href: '/my-matches.html?filter=live', icon: 'radio' },
    { id: 'match-create', label: 'Score', href: '/match-create.html', icon: 'plusBat', isCenter: true },
    { id: 'tournaments', label: 'Tournaments', href: '/tournament.html', icon: 'trophy' },
    { id: 'profile', label: 'Profile', href: '/profile.html', icon: 'user' }
  ];

  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_KEY, t);
    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn && root.ApnaIcons) {
      toggleBtn.innerHTML = root.ApnaIcons.icon(t === 'dark' ? 'sun' : 'moon', 18);
      toggleBtn.title = t === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    const themeSel = document.getElementById('setTheme');
    if (themeSel && themeSel.value !== t) {
      themeSel.value = t;
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    applyTheme(saved);
  }

  function toggleTheme() {
    const curr = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(curr === 'dark' ? 'light' : 'dark');
  }

  function showToast(message, type = 'success') {
    let container = document.getElementById('apnaToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'apnaToastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3800);
  }

  function renderNavLinks(activeId) {
    const sections = {};
    for (const item of SIDEBAR_ITEMS) {
      if (!sections[item.section]) sections[item.section] = [];
      sections[item.section].push(item);
    }
    let html = '';
    for (const [sec, items] of Object.entries(sections)) {
      html += `<div class="nav-section-title">${sec}</div>`;
      for (const item of items) {
        const active = item.id === activeId ? 'active' : '';
        html += `<a href="${item.href}" class="nav-item ${active}">${root.ApnaIcons.icon(item.icon, 20)}<span class="nav-label">${item.label}</span></a>`;
      }
    }
    return html;
  }

  function initShell({ activePage = 'dashboard', pageTitle = 'ApnaScore', requireAuth = false } = {}) {
    initTheme();
    if (requireAuth && root.ApnaAuth && !root.ApnaAuth.requireAuth()) return false;

    const appRoot = document.getElementById('appShell');
    if (!appRoot) return true;

    const existingMain = appRoot.querySelector('.main-content-slot');
    const innerContent = existingMain ? existingMain.innerHTML : appRoot.innerHTML;

    const user = root.ApnaAuth ? root.ApnaAuth.getUser() : null;
    const isCollapsed = localStorage.getItem('apnascore_sidebar_collapsed') === '1';
    if (isCollapsed) document.body.classList.add('sidebar-collapsed');

    const navHtml = renderNavLinks(activePage);
    const bottomHtml = BOTTOM_TABS.map((tab) => {
      const active = tab.id === activePage ? 'active' : '';
      if (tab.isCenter) {
        return `<a href="${tab.href}" class="bottom-tab bottom-tab-center ${active}"><span class="bottom-tab-center-pill">${root.ApnaIcons.icon(tab.icon, 20)}</span><span class="bottom-tab-label">${tab.label}</span></a>`;
      }
      return `<a href="${tab.href}" class="bottom-tab ${active}">${root.ApnaIcons.icon(tab.icon, 21)}<span>${tab.label}</span></a>`;
    }).join('');

    appRoot.className = 'app-shell';
    appRoot.innerHTML = `
      <aside class="sidebar ${isCollapsed ? 'collapsed' : ''}" id="desktopSidebar">
        <div class="sidebar-header">
          <a href="/dashboard.html" class="brand-lockup">
            <img src="/assets/logos/apnascore-logo.png" alt="ApnaScore" class="brand-logo-img" />
            <div class="brand-text-wrap">
              <span class="brand-title">ApnaScore</span>
              <span class="brand-tagline">Your Local Cricket Scorer</span>
            </div>
          </a>
        </div>
        <nav class="sidebar-nav">${navHtml}</nav>
      </aside>

      <div class="mobile-drawer-backdrop" id="mobileDrawerBackdrop"></div>
      <aside class="mobile-drawer" id="mobileDrawer">
        <div class="sidebar-header">
          <a href="/dashboard.html" class="brand-lockup">
            <img src="/assets/logos/apnascore-logo.png" alt="ApnaScore" class="brand-logo-img" />
            <div class="brand-text-wrap">
              <span class="brand-title">ApnaScore</span>
              <span class="brand-tagline">Your Local Cricket Scorer</span>
            </div>
          </a>
          <button class="icon-btn" id="closeDrawerBtn" aria-label="Close menu">${root.ApnaIcons.icon('x', 18)}</button>
        </div>
        <nav class="sidebar-nav">${navHtml}</nav>
      </aside>

      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <button class="icon-btn desktop-sidebar-toggle" id="sidebarCollapseBtn" aria-label="Toggle sidebar">${root.ApnaIcons.icon('menu', 18)}</button>
            <button class="icon-btn topbar-mobile-brand" id="openDrawerBtn" aria-label="Open menu">${root.ApnaIcons.icon('menu', 18)}</button>
            <a href="/dashboard.html" class="topbar-mobile-brand">
              <img src="/assets/icons/apnascore-icon.png" alt="ApnaScore" style="width:32px;height:32px;border-radius:8px;object-fit:contain;" />
            </a>
            <span class="topbar-page-title">${pageTitle}</span>
          </div>
          <div class="topbar-actions">
            <button type="button" class="btn btn-lime btn-sm hidden" id="pwaInstallBtn" aria-label="Install ApnaScore App">Install App</button>
            <button class="sync-pill online" id="globalSyncPill" title="Click to sync pending offline matches">
              <span class="sync-icon">${root.ApnaIcons.icon('wifi', 15)}</span>
              <span class="sync-label-text">Online</span>
            </button>
            <button class="icon-btn" id="themeToggleBtn" aria-label="Toggle dark mode"></button>
            ${
              user
                ? `<a href="/profile.html" class="btn btn-secondary btn-sm hide-on-mobile">${escapeHtml(user.name.split(' ')[0])}</a>`
                : (root.ApnaAuth && root.ApnaAuth.isGuest()
                  ? `<a href="/profile.html" class="badge badge-warning" title="Guest Mode active">Guest Mode</a><a href="/register.html" class="btn btn-primary btn-sm hide-on-mobile">Create Account</a>`
                  : `<a href="/login.html" class="btn btn-primary btn-sm">Login</a>`)
            }
          </div>
        </header>
        <main class="page-content" id="pageContentSlot">${innerContent}</main>
      </div>

      <nav class="mobile-bottom-nav" aria-label="Primary Mobile Navigation">${bottomHtml}</nav>
    `;

    applyTheme(localStorage.getItem(THEME_KEY) || 'light');

    // Bind Shell Controls
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
    document.getElementById('sidebarCollapseBtn')?.addEventListener('click', () => {
      const sb = document.getElementById('desktopSidebar');
      sb.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('apnascore_sidebar_collapsed', sb.classList.contains('collapsed') ? '1' : '0');
    });

    const drawer = document.getElementById('mobileDrawer');
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    const toggleDrawer = (open) => {
      drawer?.classList.toggle('open', open);
      backdrop?.classList.toggle('open', open);
    };
    document.getElementById('openDrawerBtn')?.addEventListener('click', () => toggleDrawer(true));
    document.getElementById('closeDrawerBtn')?.addEventListener('click', () => toggleDrawer(false));
    backdrop?.addEventListener('click', () => toggleDrawer(false));

    // Sync status pill binding
    const syncPill = document.getElementById('globalSyncPill');
    if (syncPill && root.ApnaOffline) {
      syncPill.addEventListener('click', async () => {
        const res = await root.ApnaOffline.syncAllPending();
        if (res.error) showToast(`Sync issue: ${res.error}`, 'warning');
        else if (res.synced > 0) showToast(`Synced ${res.synced} offline scoring event(s).`);
        else showToast('All local scores are up to date.');
      });

      root.ApnaOffline.onStatusChange((st) => {
        syncPill.className = `sync-pill ${st.state}`;
        const iconSpan = syncPill.querySelector('.sync-icon');
        const labelSpan = syncPill.querySelector('.sync-label-text');
        if (iconSpan) iconSpan.innerHTML = root.ApnaIcons.icon(st.online ? 'wifi' : 'wifiOff', 15);
        if (labelSpan) {
          if (!st.online) labelSpan.textContent = `Offline (${st.pendingCount})`;
          else if (st.isSyncing) labelSpan.textContent = 'Syncing...';
          else if (st.state === 'failed') labelSpan.textContent = `Sync Failed (${st.pendingCount})`;
          else if (st.state === 'synced') labelSpan.textContent = 'Synced';
          else labelSpan.textContent = st.pendingCount > 0 ? `Pending (${st.pendingCount})` : 'Online';
        }
      });
    }

    // Register PWA Service Worker & Install Prompt ("Add to Home Screen")
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }

    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn && root.__apnaInstallPrompt) {
      installBtn.classList.remove('hidden');
    }
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        const promptEvt = root.__apnaInstallPrompt;
        if (!promptEvt) return;
        promptEvt.prompt();
        await promptEvt.userChoice.catch(() => {});
        root.__apnaInstallPrompt = null;
        installBtn.classList.add('hidden');
      });
    }

    return true;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      root.__apnaInstallPrompt = e;
      document.getElementById('pwaInstallBtn')?.classList.remove('hidden');
    });
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  root.ApnaUI = {
    initShell,
    applyTheme,
    toggleTheme,
    showToast,
    escapeHtml
  };
}(window));
