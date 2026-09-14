// =====================================================================
// ⚡ ZAR BROWSER — RENDERER CONTROLLER
// "Optimization before beauty. Zero customization. Just speed."
// =====================================================================

// State tracking
let activeTabId = null;
const tabData = {}; // Maps tabId -> { url, title, pinned, discarded }

// DOM Elements
const winMinimize = document.getElementById('win-minimize');
const winMaximize = document.getElementById('win-maximize');
const winClose = document.getElementById('win-close');

const navBack = document.getElementById('nav-back');
const navForward = document.getElementById('nav-forward');
const navReload = document.getElementById('nav-reload');
const navHome = document.getElementById('nav-home');
const urlInput = document.getElementById('url-input');
const loadingProgress = document.getElementById('loading-progress');

const addTabBtn = document.getElementById('add-tab-btn');
const tabsList = document.getElementById('tabs-list');

const cleanCacheBtn = document.getElementById('clean-cache-btn');

const quickSettingsBtn = document.getElementById('quick-settings-btn');
const quickSettingsDropdown = document.getElementById('quick-settings-dropdown');

const homepageOverlay = document.getElementById('homepage-overlay');
const homepageSearchInput = document.getElementById('homepage-search-input');

// =====================================================================
// 🪟 1. WINDOW CONTROLS
// =====================================================================
winMinimize.addEventListener('click', () => window.api.minimizeWindow());
winMaximize.addEventListener('click', () => window.api.maximizeWindow());
winClose.addEventListener('click', () => window.api.closeWindow());

// =====================================================================
// 🧭 2. NAVIGATION & URL BAR
// =====================================================================
navBack.addEventListener('click', () => window.api.goBack());
navForward.addEventListener('click', () => window.api.goForward());
navReload.addEventListener('click', () => window.api.reload());
navHome.addEventListener('click', () => window.api.goHome());

function navigate(rawInput) {
  const query = (rawInput || '').trim();
  if (query) {
    window.api.navigateTo(query);
  }
}

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(urlInput.value);
    urlInput.blur();
  } else if (e.key === 'Escape') {
    const tab = tabData[activeTabId];
    urlInput.value = tab ? tab.url || '' : '';
    urlInput.blur();
  }
});

urlInput.addEventListener('focus', () => {
  urlInput.select();
});

// =====================================================================
// 🏠 3. HOMEPAGE OVERLAY LOGIC
// =====================================================================
function updateHomepageVisibility() {
  const tab = tabData[activeTabId];
  const hasLiveUrl = tab && tab.url && tab.url.trim() !== '' && !tab.url.startsWith('about:blank') && !tab.discarded;

  if (hasLiveUrl) {
    homepageOverlay.classList.add('hidden');
  } else {
    homepageOverlay.classList.remove('hidden');
    if (document.activeElement !== urlInput) {
      homepageSearchInput.focus();
    }
  }
}

homepageSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = homepageSearchInput.value.trim();
    if (val) {
      navigate(val);
      homepageSearchInput.value = '';
    }
  }
});

document.querySelectorAll('.shortcut-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const url = el.getAttribute('data-url');
    if (url) navigate(url);
  });
});

// =====================================================================
// 🖼️ 4. FAVICON LOADER
// =====================================================================
function extractDomain(url) {
  try {
    return new URL(url).hostname || '';
  } catch (e) {
    return '';
  }
}

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2371717a'%3E%3Ccircle cx='12' cy='12' r='8'/%3E%3C/svg%3E";

function loadFavicon(imgEl, domain) {
  if (!domain) {
    imgEl.src = FALLBACK_FAVICON;
    imgEl.classList.add('loaded');
    return;
  }
  const sources = [
    `https://icon.horse/icon/${domain}`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=16`,
    `https://${domain}/favicon.ico`
  ];
  let idx = 0;
  function tryNext() {
    if (idx >= sources.length) {
      imgEl.src = FALLBACK_FAVICON;
      imgEl.classList.add('loaded');
      return;
    }
    imgEl.src = sources[idx++];
  }
  imgEl.onload = () => imgEl.classList.add('loaded');
  imgEl.onerror = tryNext;
  tryNext();
}

// =====================================================================
// 📑 5. TAB MANAGEMENT & LIFECYCLE
// =====================================================================
addTabBtn.addEventListener('click', () => {
  window.api.createTab('');
});

window.api.onTabCreated(({ tabId, url, title, pinned }) => {
  tabData[tabId] = { url: url || '', title: title || 'Nueva pestaña', pinned: !!pinned, discarded: false };

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item' + (pinned ? ' pinned' : '');
  tabEl.id = `tab-${tabId}`;
  tabEl.innerHTML = `
    <img class="tab-favicon" alt="">
    <span class="tab-title-text">${title || 'Nueva pestaña'}</span>
    <span class="tab-pin">📌</span>
    <button class="tab-close" title="Cerrar pestaña">✕</button>
  `;

  const domain = extractDomain(url);
  const favicon = tabEl.querySelector('.tab-favicon');
  if (domain) {
    loadFavicon(favicon, domain);
  } else {
    favicon.src = FALLBACK_FAVICON;
    favicon.classList.add('loaded');
  }

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      e.stopPropagation();
      if (!tabData[tabId]?.pinned) {
        window.api.closeTab(tabId);
      }
    } else {
      window.api.switchTab(tabId);
    }
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.api.showContextMenu(tabId);
  });

  tabsList.appendChild(tabEl);
});

window.api.onTabSwitched(({ tabId, url, title }) => {
  activeTabId = tabId;

  document.querySelectorAll('.tab-item').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tabId}`);
  });

  const tab = tabData[tabId];
  if (tab) {
    urlInput.value = tab.url || '';
  }

  updateHomepageVisibility();
});

window.api.onTabClosed(({ tabId }) => {
  delete tabData[tabId];
  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) tabEl.remove();
  updateHomepageVisibility();
});

window.api.onTabPinnedUpdated(({ tabId, pinned }) => {
  if (tabData[tabId]) {
    tabData[tabId].pinned = !!pinned;
  }
  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) {
    tabEl.classList.toggle('pinned', !!pinned);
  }
});

window.api.onTabUrlChanged(({ tabId, url }) => {
  if (tabData[tabId]) {
    tabData[tabId].url = url;
  }

  if (tabId === activeTabId) {
    urlInput.value = url || '';
    updateHomepageVisibility();
  }

  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) {
    const favicon = tabEl.querySelector('.tab-favicon');
    const domain = extractDomain(url);
    if (favicon) {
      if (domain) loadFavicon(favicon, domain);
      else { favicon.src = FALLBACK_FAVICON; favicon.classList.add('loaded'); }
    }
  }
});

window.api.onTabTitleChanged(({ tabId, title }) => {
  if (tabData[tabId]) {
    tabData[tabId].title = title;
  }
  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) {
    const titleSpan = tabEl.querySelector('.tab-title-text');
    if (titleSpan) {
      titleSpan.textContent = title || 'Nueva pestaña';
    }
  }
});

window.api.onTabLoadingStarted(({ tabId }) => {
  if (tabId === activeTabId) {
    loadingProgress.className = 'progress-bar-loading';
    loadingProgress.style.width = '65%';
  }
});

window.api.onTabLoadingFinished(({ tabId }) => {
  if (tabId === activeTabId) {
    loadingProgress.style.width = '100%';
    setTimeout(() => {
      if (tabId === activeTabId) {
        loadingProgress.className = 'progress-bar-hidden';
        loadingProgress.style.width = '0%';
      }
    }, 300);
  }
});

window.api.onTabDiscarded(({ tabId, title }) => {
  if (tabData[tabId]) {
    tabData[tabId].discarded = true;
  }
  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) {
    tabEl.classList.add('discarded');
    const titleSpan = tabEl.querySelector('.tab-title-text');
    if (titleSpan) titleSpan.textContent = `${title} (Suspendida)`;
  }
});

window.api.onTabRestored(({ tabId }) => {
  if (tabData[tabId]) {
    tabData[tabId].discarded = false;
  }
  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) {
    tabEl.classList.remove('discarded');
    const titleSpan = tabEl.querySelector('.tab-title-text');
    if (titleSpan && tabData[tabId]) {
      titleSpan.textContent = tabData[tabId].title || 'Nueva pestaña';
    }
  }
  updateHomepageVisibility();
});

window.api.onOpenNewTabFromWeb((url) => {
  window.api.createTab(url);
});

// =====================================================================
// ⚡ 6. MEMORY PURGE (sin meter; KDE Monitor hace eso mejor)
// =====================================================================
cleanCacheBtn.addEventListener('click', () => {
  window.api.clearMemory();
});

window.api.onMemoryCleared(() => {
  const prevText = cleanCacheBtn.textContent;
  cleanCacheBtn.textContent = '✨';
  setTimeout(() => {
    cleanCacheBtn.textContent = prevText;
  }, 1000);
});

// =====================================================================
// ⚙️ 7. QUICK MENU
// =====================================================================
quickSettingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  quickSettingsDropdown.classList.toggle('hidden');
});

quickSettingsDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.qs-item');
  if (!item) return;
  const action = item.dataset.action;
  quickSettingsDropdown.classList.add('hidden');

  switch (action) {
    case 'new-tab':
      window.api.createTab('');
      break;
    case 'clear-cache':
      window.api.clearMemory();
      break;
    case 'devtools':
      window.api.toggleDevTools();
      break;
    case 'about':
      window.api.openAbout();
      break;
  }
});

document.addEventListener('click', (e) => {
  if (!quickSettingsDropdown.classList.contains('hidden') && !quickSettingsDropdown.contains(e.target) && e.target !== quickSettingsBtn) {
    quickSettingsDropdown.classList.add('hidden');
  }
});

// =====================================================================
// ⌨️ 8. KEYBOARD SHORTCUTS
// =====================================================================
window.addEventListener('keydown', (e) => {
  // F11 = Fullscreen
  if (e.key === 'F11') {
    e.preventDefault();
    window.api.toggleFullscreen();
    return;
  }

  // F12 or Ctrl+Shift+I = DevTools
  if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
    e.preventDefault();
    window.api.toggleDevTools();
    return;
  }

  // Ctrl+T = New Tab
  if ((e.ctrlKey || e.metaKey) && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    window.api.createTab('');
    return;
  }

  // Ctrl+W = Close Tab
  if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    if (activeTabId && !tabData[activeTabId]?.pinned) {
      window.api.closeTab(activeTabId);
    }
    return;
  }

  // Ctrl+L / Alt+D = Focus URL bar
  if (((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) || (e.altKey && (e.key === 'd' || e.key === 'D'))) {
    e.preventDefault();
    urlInput.focus();
    urlInput.select();
    return;
  }

  // Ctrl+R / F5 = Reload
  if (((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) || e.key === 'F5') {
    e.preventDefault();
    window.api.reload();
    return;
  }

  // Zoom nativo (niveles estándar enteros en main)
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); window.api.zoomIn(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === '-')) { e.preventDefault(); window.api.zoomOut(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === '0')) { e.preventDefault(); window.api.zoomReset(); return; }

  // Alt+Left = Back
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    window.api.goBack();
    return;
  }

  // Alt+Right = Forward
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    window.api.goForward();
    return;
  }
});

window.api.onFullscreenChanged((isFullscreen) => {
  document.body.classList.toggle('fullscreen', isFullscreen);
});

// =====================================================================
// ⬇️ 9. DESCARGAS (botón ⬇ abre bubble anclado; anillo = progreso)
// =====================================================================
const dlBtn = document.getElementById('dl-btn');
const dlRing = document.getElementById('dl-ring');
const dlRingCircle = document.getElementById('dl-ring-circle');
const DL_RING_C = 75.4; // 2πr, r=12

dlBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.openDownloadPopup();
});

// Anillo de progreso estilo Brave (los eventos ya llegan a esta ventana)
window.api.onDownloadUpdated((d) => {
  const pct = d.total > 0 ? d.received / d.total : 0;
  dlRingCircle.style.strokeDashoffset = String(DL_RING_C * (1 - Math.min(1, pct)));
  dlRing.classList.remove('hidden');
});

window.api.onDownloadDone(() => {
  dlRingCircle.style.strokeDashoffset = '0';
  setTimeout(() => dlRing.classList.add('hidden'), 3000);
});
