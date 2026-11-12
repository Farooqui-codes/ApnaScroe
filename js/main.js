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
    { id: 'pricing', label: 'Pro Pricing', href: '/pricing.html', icon: 'award', section: 'Account' },
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
        <div class="drawer-status-row" id="drawerOnlineStatus" role="status">
          <span class="status-dot ${navigator.onLine ? 'online' : 'offline'}" id="drawerStatusDot"></span>
          <span id="drawerStatusText">${navigator.onLine ? 'Online' : 'Offline'}</span>
        </div>
        <nav class="sidebar-nav" id="mobileDrawerNav">
          ${navHtml}
          <button type="button" class="nav-item hidden" id="drawerInstallBtn" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;">
            ${root.ApnaIcons.icon('plusBat', 20)}<span class="nav-label">Install App</span>
          </button>
          <div class="drawer-ios-tip hidden" id="drawerIosTip">Install: Tap <strong>Share → Add to Home Screen</strong></div>
        </nav>
      </aside>

      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <button class="icon-btn desktop-sidebar-toggle" id="sidebarCollapseBtn" aria-label="Toggle sidebar">${root.ApnaIcons.icon('menu', 18)}</button>
            <button class="icon-btn topbar-mobile-brand" id="openDrawerBtn" aria-label="Open menu" aria-expanded="false" aria-controls="mobileDrawer">${root.ApnaIcons.icon('menu', 18)}</button>
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
                ? `<div class="profile-menu-wrap">
                    <button type="button" class="profile-trigger-btn" id="profileMenuTrigger" aria-expanded="false" aria-label="Account menu">
                      ${user.avatarUrl
                        ? `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.name)}" class="avatar-initials" />`
                        : `<span class="avatar-initials">${escapeHtml((user.name || 'U').split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2))}</span>`}
                      <span class="hide-on-mobile">${escapeHtml((user.displayName || user.name || 'User').split(' ')[0])}</span>
                    </button>
                    <div class="profile-dropdown" id="profileDropdownMenu">
                      <a href="/profile.html">My Profile</a>
                      <a href="/my-matches.html">My Matches</a>
                      <a href="/tournament.html">My Tournaments</a>
                      <a href="/settings.html">Settings</a>
                      <button type="button" id="topDropdownLogoutBtn" style="color:var(--danger);">Logout</button>
                    </div>
                  </div>`
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

    // Profile Dropdown Bindings
    const pTrig = document.getElementById('profileMenuTrigger');
    const pMenu = document.getElementById('profileDropdownMenu');
    if (pTrig && pMenu) {
      pTrig.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = pMenu.classList.toggle('open');
        pTrig.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', () => {
        pMenu.classList.remove('open');
        pTrig.setAttribute('aria-expanded', 'false');
      });
      document.getElementById('topDropdownLogoutBtn')?.addEventListener('click', () => root.ApnaAuth?.logout());
    }

    // Non-annoying Profile Completion Reminder (once per session, stops after 3 dismissals)
    if (user && activePage !== 'profile') {
      const fields = [
        { ok: Boolean(user.name), label: 'Full Name' },
        { ok: Boolean(user.username), label: 'Username' },
        { ok: Boolean(user.village), label: 'Village/City' },
        { ok: Boolean(user.avatarUrl), label: 'Photo' },
        { ok: Boolean(user.bio), label: 'Bio' },
        { ok: Boolean(user.cricketProfile && user.cricketProfile.playingRole), label: 'Cricket Role' }
      ];
      const doneCount = fields.filter((f) => f.ok).length;
      const pct = Math.round((doneCount / fields.length) * 100);
      const dismissals = Number(localStorage.getItem('apna_prof_dismiss_count') || 0);
      if (pct < 100 && dismissals < 3 && sessionStorage.getItem('apna_prof_prompt_seen') !== '1') {
        sessionStorage.setItem('apna_prof_prompt_seen', '1');
        const missing = fields.filter((f) => !f.ok).slice(0, 2).map((f) => f.label).join(', ');
        const slot = document.getElementById('pageContentSlot');
        if (slot) {
          const banner = document.createElement('div');
          banner.className = 'card mb-2';
          banner.id = 'apnaProfilePromptBanner';
          banner.style.borderLeft = '5px solid var(--brand-primary)';
          banner.innerHTML = `
            <div class="flex-between">
              <div>
                <strong>Apni profile update karein</strong> <span class="badge badge-success">Profile ${pct}% complete</span>
                <div class="text-sm text-muted">Missing: ${escapeHtml(missing)}</div>
              </div>
              <div class="flex-gap">
                <a href="/profile.html" class="btn btn-primary btn-sm">Update Profile</a>
                <button type="button" class="btn btn-secondary btn-sm" id="profPromptLaterBtn">Baad me</button>
              </div>
            </div>
          `;
          slot.prepend(banner);
          document.getElementById('profPromptLaterBtn').onclick = () => {
            localStorage.setItem('apna_prof_dismiss_count', String(dismissals + 1));
            banner.remove();
          };
        }
      }
    }

    // Flush queued offline profile edit if back online
    if (user && navigator.onLine && localStorage.getItem('apnascore_pending_profile') && root.ApnaAPI) {
      try {
        const queued = JSON.parse(localStorage.getItem('apnascore_pending_profile'));
        root.ApnaAPI.put('/api/auth/profile', queued).then((res) => {
          localStorage.removeItem('apnascore_pending_profile');
          if (res?.user) root.ApnaAPI.setSession(root.ApnaAPI.getToken(), res.user);
        }).catch(() => {});
      } catch (_) {}
    }

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
    const openDrawerBtn = document.getElementById('openDrawerBtn');
    const closeDrawerBtn = document.getElementById('closeDrawerBtn');
    const toggleDrawer = (open) => {
      if (!drawer) return;
      drawer.classList.toggle('open', open);
      backdrop?.classList.toggle('open', open);
      openDrawerBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        setTimeout(() => closeDrawerBtn?.focus(), 60);
      } else {
        openDrawerBtn?.focus();
      }
    };
    openDrawerBtn?.addEventListener('click', () => toggleDrawer(true));
    closeDrawerBtn?.addEventListener('click', () => toggleDrawer(false));
    backdrop?.addEventListener('click', () => toggleDrawer(false));
    drawer?.querySelectorAll('a.nav-item').forEach((link) => {
      link.addEventListener('click', () => toggleDrawer(false));
    });
    document.addEventListener('keydown', (e) => {
      if (!drawer || !drawer.classList.contains('open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        toggleDrawer(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusables = Array.from(drawer.querySelectorAll('a[href], button:not([disabled]):not(.hidden)')).filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    const updateDrawerNetwork = () => {
      const dot = document.getElementById('drawerStatusDot');
      const txt = document.getElementById('drawerStatusText');
      const online = navigator.onLine;
      if (dot) dot.className = `status-dot ${online ? 'online' : 'offline'}`;
      if (txt) txt.textContent = online ? 'Online' : 'Offline';
    };
    window.addEventListener('online', updateDrawerNetwork);
    window.addEventListener('offline', updateDrawerNetwork);
    updateDrawerNetwork();

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
    const drawerInstallBtn = document.getElementById('drawerInstallBtn');
    const drawerIosTip = document.getElementById('drawerIosTip');
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

    const syncInstallButtons = () => {
      if (isStandalone) {
        installBtn?.classList.add('hidden');
        drawerInstallBtn?.classList.add('hidden');
        drawerIosTip?.classList.add('hidden');
        return;
      }
      if (root.__apnaInstallPrompt) {
        installBtn?.classList.remove('hidden');
        drawerInstallBtn?.classList.remove('hidden');
        drawerIosTip?.classList.add('hidden');
      } else if (isIosSafari) {
        drawerIosTip?.classList.remove('hidden');
      }
    };
    syncInstallButtons();

    const triggerInstall = async () => {
      const promptEvt = root.__apnaInstallPrompt;
      if (!promptEvt) return;
      promptEvt.prompt();
      await promptEvt.userChoice.catch(() => {});
      root.__apnaInstallPrompt = null;
      installBtn?.classList.add('hidden');
      drawerInstallBtn?.classList.add('hidden');
      toggleDrawer(false);
    };
    installBtn?.addEventListener('click', triggerInstall);
    drawerInstallBtn?.addEventListener('click', triggerInstall);

    return true;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      root.__apnaInstallPrompt = e;
      const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
      if (!isStandalone) {
        document.getElementById('pwaInstallBtn')?.classList.remove('hidden');
        document.getElementById('drawerInstallBtn')?.classList.remove('hidden');
        document.getElementById('drawerIosTip')?.classList.add('hidden');
      }
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
