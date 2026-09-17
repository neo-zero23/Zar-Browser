const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const ZarDB = require('./db');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const { applyChromiumSwitches } = require('./optimizations');

// Switches centralizados (ver optimizations.js). Llamar antes de ready.
applyChromiumSwitches(app);

// WhatsApp Web rejects Electron's default UA ("browser not supported").
// Fallback to a Chrome UA with the running Chromium major (dynamic via
// process.versions.chrome, never hardcoded like Neutron's Chrome/124).
const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// =====================================================================
// 🌐 CONSTANTS & STATE
// =====================================================================
const PARTITION = 'persist:zar';
const TOP_OFFSET = 78; // Titlebar (38px) + Toolbar (40px)
const DEFAULT_DISCARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Tab discarding is configurable (settings page). No timer when off.
let tabDiscardTimeoutMs = DEFAULT_DISCARD_TIMEOUT_MS;
let discardTimer = null;
function applyDiscardingSettings() {
  if (discardTimer) { clearInterval(discardTimer); discardTimer = null; }
  if (settings.tabDiscardingEnabled) {
    discardTimer = setInterval(checkIdleTabs, 60000);
  }
}

let mainWindow = null;
let tabs = [];
let activeTabId = null;
let adBlocker = null;

// =====================================================================
// 🛡️ AD-BLOCKER (@ghostery/adblocker-electron, disk cache)
// API igual que @cliqz (fromLists/fromCached/serialize/deserialize).
// Name-versioned cache: the @cliqz v1 bin is never read by @ghostery
// v2 (plus deserialize validates ENGINE_VERSION + checksum and regenerates alone).
// =====================================================================
async function initAdBlocker() {
  try {
    const cachePath = path.join(app.getPath('userData'), 'adblock-cache-ghostery.bin');
    // Refresh every 7 days: old bin -> delete to force re-download
    try {
      const st = await fs.promises.stat(cachePath);
      if (Date.now() - st.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
        await fs.promises.unlink(cachePath);
      }
    } catch (e) { /* first run, no cache */ }
    const blocker = await ElectronBlocker.fromLists(fetch, [
      'https://easylist.to/easylist/easylist.txt',
      'https://easylist.to/easylist/easyprivacy.txt'
    ], {
      enableCompression: true,
      guessRequestTypeFromUrl: true,
      loadNetworkFilters: true
    }, {
      path: cachePath,
      read: fs.promises.readFile,
      write: fs.promises.writeFile
    });
    adBlocker = blocker;
    // Zar partition only, NOT defaultSession
    adBlocker.enableBlockingInSession(session.fromPartition(PARTITION));
    console.log('[Zar AdBlocker] OK');
  } catch (err) {
    // Fallback: no adblock, boot continues
    console.error('[Zar AdBlocker] sin adblock, sigo:', err.message);
  }
}

// =====================================================================
// 🪟 MAIN BROWSER WINDOW
// =====================================================================
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.on('resize', () => {
    const tab = getActiveTab();
    if (tab && tab.view && isWebviewVisible(tab)) {
      updateViewBounds(tab.view);
    }
    updateBubbleBounds();
  });

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', false);
    }
  });

  // Al volver a la ventana: si la activa quedó descartada, restaurarla.
  // Sin esto el overlay se queda pegado hasta cambiar de tab a mano.
  mainWindow.on('focus', () => {
    const tab = getActiveTab();
    if (tab && tab.discarded && tab.id === activeTabId) {
      switchTab(tab.id);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function updateViewBounds(view) {
  if (!view || !mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  view.setBounds({
    x: 0,
    y: TOP_OFFSET,
    width: bounds.width,
    height: Math.max(0, bounds.height - TOP_OFFSET)
  });
}

function isWebviewVisible(tab) {
  return tab && tab.url && tab.url.trim() !== '' && !tab.url.startsWith('about:blank') && !tab.discarded;
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

// =====================================================================
// 💾 SESSION (restores tabs on open, silent, last session only)
// =====================================================================
function sessionPath() {
  return path.join(app.getPath('userData'), 'zar-session.json');
}

function isSessionUrl(u) {
  return !!u && (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('file://'));
}

function tabSessionData(t) {
  // If discarded, tab.url is already about:blank -> use the saved one
  const url = (t.discarded && t.savedUrl) ? t.savedUrl : t.url;
  const title = (t.discarded && t.savedTitle) ? t.savedTitle : t.title;
  return isSessionUrl(url) ? { url, title: title || url } : null;
}

function saveSession() {
  try {
    const real = tabs.map(tabSessionData).filter(Boolean);
    // Homepage only -> nothing to save (deletes previous remainder)
    if (real.length === 0) {
      try { fs.unlinkSync(sessionPath()); } catch (e) { }
      return;
    }
    const realIds = tabs.filter(t => tabSessionData(t)).map(t => t.id);
    const activeIndex = Math.max(0, realIds.indexOf(activeTabId));
    fs.writeFileSync(sessionPath(), JSON.stringify({ tabs: real, activeIndex }));
  } catch (e) { }
}

function loadSession() {
  try {
    const s = JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
    if (!s || !Array.isArray(s.tabs) || s.tabs.length === 0) return null;
    const clean = s.tabs.filter(t => t && isSessionUrl(t.url));
    if (clean.length === 0) return null;
    const n = clean.length;
    const ai = (typeof s.activeIndex === 'number') ? Math.min(Math.max(0, s.activeIndex), n - 1) : 0;
    return { tabs: clean, activeIndex: ai };
  } catch (e) {
    return null; // no existe o corrupto -> homepage
  }
}

// =====================================================================
// 📑 TAB MANAGEMENT
// =====================================================================
function createTab(initialUrl = '') {
  const tabId = Date.now().toString();
  const rawUrl = (initialUrl || '').trim();

  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });

  const tab = {
    id: tabId,
    view,
    url: rawUrl,
    title: rawUrl ? 'Loading...' : 'New tab',
    pinned: false,
    discarded: false,
    savedUrl: null,
    savedTitle: null,
    lastActive: Date.now()
  };

  tabs.push(tab);

  const wc = view.webContents;

  // Context Menu for web page
  wc.on('context-menu', (event, params) => {
    if (wc.isDestroyed()) return;
    const nav = wc.navigationHistory;
    const template = [
      ...(nav.canGoBack() ? [{ label: 'Back', click: () => !wc.isDestroyed() && nav.goBack() }] : []),
      ...(nav.canGoForward() ? [{ label: 'Forward', click: () => !wc.isDestroyed() && nav.goForward() }] : []),
      ...(nav.canGoBack() || nav.canGoForward() ? [{ type: 'separator' }] : []),
      { label: 'Reload', click: () => !wc.isDestroyed() && wc.reload() },
      { type: 'separator' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { label: 'Select all', role: 'selectAll' },
      ...(params.mediaType === 'image' ? [
        { type: 'separator' },
        // NOTE: must use the TAB's webContents (params.x/y are tab-relative).
        // mainWindow.webContents would capture the UI chrome at wrong coords.
        { label: 'Copy image', click: () => { if (!wc.isDestroyed()) wc.copyImageAt(params.x, params.y); } },
        { label: 'Save image', click: () => wc.downloadURL(params.srcURL) }
      ] : []),
      ...(params.linkURL ? [
        { type: 'separator' },
        { label: 'Save link as...', click: () => wc.downloadURL(params.linkURL) }
      ] : []),
      { type: 'separator' },
      { label: 'Inspect element', click: () => !wc.isDestroyed() && wc.inspectElement(params.x, params.y) }
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  wc.on('did-start-navigation', (event, navUrl, isInPlace, isMainFrame) => {
    if (isMainFrame) {
      // Discard blanking must not touch state (preserve url/savedUrl)
      if (tab.discarded && (!navUrl || navUrl.startsWith('about:'))) return;
      tab.url = navUrl;
      tab.lastActive = Date.now();
      tab.discarded = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tab-url-changed', { tabId, url: navUrl });
      }
      sendNavState(tabId);
    }
  });

  wc.on('page-title-updated', (event, title) => {
    tab.title = title;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-title-changed', { tabId, title });
    }
  });

  wc.on('did-start-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-loading-started', { tabId });
    }
  });

  wc.on('did-stop-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-loading-finished', { tabId });
    }
    sendNavState(tabId);
    if (!wc.isDestroyed()) {
      const currentUrl = wc.getURL();
      const currentTitle = wc.getTitle();
      if (currentUrl && (currentUrl.startsWith('http://') || currentUrl.startsWith('https://'))) {
        ZarDB.recordVisit(currentUrl, currentTitle);
      }
    }
  });

  wc.on('render-process-gone', (event, details) => {
    console.warn(`[Zar] Renderer process gone (${details.reason}) on tab ${tabId}`);
    if (!wc.isDestroyed()) wc.reload();
  });

  wc.setWindowOpenHandler((details) => {
    createTab(details.url);
    return { action: 'deny' };
  });

  if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('file://'))) {
    wc.loadURL(rawUrl);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-created', {
      tabId,
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned
    });
  }

  switchTab(tabId);
  return tabId;
}

function switchTab(tabId) {
  activeTabId = tabId;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  tab.lastActive = Date.now();
  if (tab.discarded) {
    restoreTab(tab);
  }

  tabs.forEach(t => {
    if (!t.view || t.view.webContents.isDestroyed()) return;

    if (t.id === tabId) {
      if (isWebviewVisible(t)) {
        try {
          mainWindow.contentView.addChildView(t.view);
          updateViewBounds(t.view);
          t.view.webContents.focus();
        } catch (e) { }
      } else {
        // Tab has no URL (shows homepage overlay) -> remove view from contentView
        try {
          mainWindow.contentView.removeChildView(t.view);
        } catch (e) { }
      }
    } else {
      // Inactive tab -> unmount view
      try {
        mainWindow.contentView.removeChildView(t.view);
      } catch (e) { }
    }
  });

  ensureBubbleOnTop();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-switched', { tabId, url: tab.url, title: tab.title });
  }
  sendNavState(tabId);
}

function closeTab(tabId) {
  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const tab = tabs[index];
  if (tab.view && !tab.view.webContents.isDestroyed()) {
    try {
      mainWindow.contentView.removeChildView(tab.view);
      tab.view.webContents.stop();
      tab.view.webContents.close();
    } catch (e) { }
    tab.view = null;
  }

  tabs.splice(index, 1);
  saveSession(); // saves after every close (in case of crash)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-closed', { tabId });
  }

  if (tabs.length === 0) {
    createTab('');
  } else if (activeTabId === tabId) {
    const nextIndex = Math.min(index, tabs.length - 1);
    switchTab(tabs[nextIndex].id);
  }
}

function toggleTabPin(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-pinned-updated', { tabId, pinned: tab.pinned });
  }
}

ipcMain.on('toggle-pin', () => {
  if (activeTabId) toggleTabPin(activeTabId);
});

ipcMain.on('cycle-tab', (event, dir) => {
  if (tabs.length < 2) return;
  const i = tabs.findIndex(t => t.id === activeTabId);
  const n = tabs.length;
  switchTab(tabs[((i < 0 ? 0 : i) + (dir === -1 ? -1 : 1) + n) % n].id);
});

// =====================================================================
// 💤 NATIVE TAB DISCARDING (RAM SAVER)
// =====================================================================
function checkIdleTabs() {
  const now = Date.now();
  tabs.forEach(tab => {
    if (tab.id === activeTabId || tab.pinned || tab.discarded || !tab.url) return;
    if (now - tab.lastActive >= tabDiscardTimeoutMs) {
      discardTab(tab);
    }
  });
}

function discardTab(tab) {
  if (!tab || tab.discarded || tab.id === activeTabId || !tab.view || tab.view.webContents.isDestroyed()) return;
  tab.savedUrl = tab.url;
  tab.savedTitle = tab.title;
  tab.discarded = true;

  try {
    mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.setAudioMuted(true);
    tab.view.webContents.loadURL('about:blank');
  } catch (e) { }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-discarded', { tabId: tab.id, title: tab.savedTitle });
  }
}

function restoreTab(tab) {
  if (!tab || !tab.discarded || !tab.view || tab.view.webContents.isDestroyed()) return;
  tab.discarded = false;

  if (tab.savedUrl) {
    tab.url = tab.savedUrl;
    tab.title = tab.savedTitle || tab.title;
    try {
      tab.view.webContents.setAudioMuted(false);
      tab.view.webContents.loadURL(tab.savedUrl);
    } catch (e) { }
  }

  tab.savedUrl = null;
  tab.savedTitle = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-restored', { tabId: tab.id });
  }
}

// Timer created by applyDiscardingSettings() at boot (respects settings)

// =====================================================================
// 🔌 IPC EVENT HANDLERS
// =====================================================================
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow && mainWindow.close());

ipcMain.on('toggle-fullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on('toggle-devtools', () => {
  const tab = getActiveTab();
  if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.toggleDevTools();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.toggleDevTools();
  }
});

ipcMain.on('create-tab', (event, url) => createTab(url));
ipcMain.on('switch-tab', (event, tabId) => switchTab(tabId));
ipcMain.on('close-tab', (event, tabId) => closeTab(tabId));

// =====================================================================
// 🔍 SEARCH ENGINE (5 max, persists in zar-settings.json)
// =====================================================================
const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', initial: 'D', url: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', initial: 'G', url: 'https://www.google.com/search?q=' },
  brave: { name: 'Brave', initial: 'B', url: 'https://search.brave.com/search?q=' },
  startpage: { name: 'Startpage', initial: 'S', url: 'https://www.startpage.com/sp/search?query=' },
  // SearXNG has no official instance; searx.be is the classic public one.
  // If it dies, change the URL here (editable field in the future, not today).
  searxng: { name: 'SearXNG', initial: 'X', url: 'https://searx.be/search?q=' }
};
const DEFAULT_ENGINE = 'duckduckgo';

// Settings completos (settings page). Claves validadas al leer/escribir.
const DEFAULT_SETTINGS = {
  searchEngine: DEFAULT_ENGINE,
  homepage: 'about:blank',
  adblockEnabled: true,
  tabDiscardingEnabled: true,
  tabDiscardingTimeout: 5 // minutos
};
let settings = { ...DEFAULT_SETTINGS };

function settingsPath() {
  // On Linux resolves to ~/.config/zar-browser/zar-settings.json
  return path.join(app.getPath('userData'), 'zar-settings.json');
}

function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { /* primera vez */ }
  if (raw && typeof raw === 'object') {
    if (raw.searchEngine && SEARCH_ENGINES[raw.searchEngine]) settings.searchEngine = raw.searchEngine;
    if (typeof raw.homepage === 'string') settings.homepage = raw.homepage.trim();
    if (typeof raw.adblockEnabled === 'boolean') settings.adblockEnabled = raw.adblockEnabled;
    if (typeof raw.tabDiscardingEnabled === 'boolean') settings.tabDiscardingEnabled = raw.tabDiscardingEnabled;
    const t = Number(raw.tabDiscardingTimeout);
    if (Number.isFinite(t)) settings.tabDiscardingTimeout = Math.min(120, Math.max(1, Math.round(t)));
  }
  tabDiscardTimeoutMs = settings.tabDiscardingTimeout * 60 * 1000;
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (e) { }
}

function engineUrl(id) {
  return (SEARCH_ENGINES[id] || SEARCH_ENGINES[DEFAULT_ENGINE]).url;
}

function setEngine(id) {
  if (!id || !SEARCH_ENGINES[id]) return;
  settings.searchEngine = id;
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('search-engine-changed', settings.searchEngine);
  }
}

function broadcastSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-changed', getSettingsPayload());
  }
}

function getSettingsPayload() {
  return {
    ...settings,
    engines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name }))
  };
}

ipcMain.handle('get-search-engine', () => settings.searchEngine);

ipcMain.on('set-search-engine', (event, id) => setEngine(id));

ipcMain.handle('get-settings', () => getSettingsPayload());

ipcMain.on('set-setting', (event, key, value) => {
  if (key === 'searchEngine') { setEngine(value); broadcastSettings(); return; }
  if (key === 'homepage' && typeof value === 'string') {
    settings.homepage = value.trim();
  } else if (key === 'adblockEnabled' && typeof value === 'boolean') {
    settings.adblockEnabled = value;
    applyAdblockSetting();
  } else if (key === 'tabDiscardingEnabled' && typeof value === 'boolean') {
    settings.tabDiscardingEnabled = value;
    applyDiscardingSettings();
  } else if (key === 'tabDiscardingTimeout') {
    const t = Number(value);
    if (!Number.isFinite(t)) return;
    settings.tabDiscardingTimeout = Math.min(120, Math.max(1, Math.round(t)));
    tabDiscardTimeoutMs = settings.tabDiscardingTimeout * 60 * 1000;
  } else {
    return; // unknown key: ignored
  }
  saveSettings();
  broadcastSettings();
});

ipcMain.on('open-settings', () => {
  createTab('file://' + path.join(__dirname, 'ui', 'settings.html'));
});

ipcMain.on('clear-site-data', async () => {
  try {
    const sess = session.fromPartition(PARTITION);
    await sess.clearCache();
    await sess.clearStorageData({ storages: ['cookies'] });
  } catch (e) { }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('site-data-cleared');
  }
});

// Adblock on/off en caliente (disableBlockingInSession verificado en v2.18.2)
function applyAdblockSetting() {
  const sess = session.fromPartition(PARTITION);
  if (settings.adblockEnabled) {
    if (!adBlocker) initAdBlocker();
    else { try { adBlocker.enableBlockingInSession(sess); } catch (e) { } }
  } else if (adBlocker) {
    try { adBlocker.disableBlockingInSession(sess); } catch (e) { }
  }
}

ipcMain.on('navigate-to', (event, input) => {
  const tab = getActiveTab();
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;

  let targetUrl = (input || '').trim();
  if (!targetUrl) return;

  // Pretty aliases: user types zar://settings, system loads file://
  const alias = targetUrl.replace(/\/$/, '');
  if (alias === 'zar://settings' || alias === 'zar://about') {
    targetUrl = 'file://' + path.join(__dirname, 'ui', alias.slice(6) + '.html');
  }

  if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://') || targetUrl.startsWith('file://')) {
    // Valid scheme
  } else if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
    targetUrl = 'https://' + targetUrl;
  } else {
    targetUrl = `${engineUrl(settings.searchEngine)}${encodeURIComponent(targetUrl)}`;
  }

  tab.url = targetUrl;
  tab.discarded = false;

  try {
    mainWindow.contentView.addChildView(tab.view);
    updateViewBounds(tab.view);
    tab.view.webContents.loadURL(targetUrl);
    tab.view.webContents.focus();
  } catch (e) { }
  ensureBubbleOnTop();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-url-changed', { tabId: tab.id, url: targetUrl });
  }
});

ipcMain.on('go-home', () => {
  const tab = getActiveTab();
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;

  // Custom homepage: if it's a real URL, navigate; else overlay as always
  const hp = (settings.homepage || '').trim();
  if (hp && (hp.startsWith('http://') || hp.startsWith('https://'))) {
    tab.url = hp;
    tab.discarded = false;
    try {
      mainWindow.contentView.addChildView(tab.view);
      updateViewBounds(tab.view);
      tab.view.webContents.loadURL(hp);
      tab.view.webContents.focus();
    } catch (e) { }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-url-changed', { tabId: tab.id, url: hp });
    }
    ensureBubbleOnTop();
    return;
  }

  tab.url = '';
  tab.title = 'New tab';

  try {
    mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.loadURL('about:blank');
  } catch (e) { }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-url-changed', { tabId: tab.id, url: '' });
    mainWindow.webContents.send('tab-title-changed', { tabId: tab.id, title: 'New tab' });
  }
});

ipcMain.on('go-back', () => {
  const tab = getActiveTab();
  const wc = tab?.view?.webContents;
  // webContents.goBack() deprecado -> navigationHistory (verificado 2026)
  if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()) {
    wc.navigationHistory.goBack();
  }
});

ipcMain.on('go-forward', () => {
  const tab = getActiveTab();
  const wc = tab?.view?.webContents;
  if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward()) {
    wc.navigationHistory.goForward();
  }
});

// State to enable/disable ← → (only paints the active tab)
function sendNavState(tabId) {
  if (tabId !== activeTabId) return;
  const tab = tabs.find(t => t.id === tabId);
  const wc = tab?.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nav-state-changed', {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    });
  }
}

ipcMain.on('reload', () => {
  const tab = getActiveTab();
  if (tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.reload();
  }
});

// Native Chromium zoom with standard integer levels (-3..+5).
// Avoids weird levels like 110% from float +0.5 steps.
function stepZoom(delta) {
  const wc = getActiveTab()?.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const cur = Math.round(wc.getZoomLevel());
  const next = Math.min(5, Math.max(-3, cur + delta));
  wc.setZoomLevel(next);
}
ipcMain.on('zoom-in', () => stepZoom(1));
ipcMain.on('zoom-out', () => stepZoom(-1));
ipcMain.on('zoom-reset', () => {
  const wc = getActiveTab()?.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.setZoomLevel(0);
});

ipcMain.on('open-about', () => {
  createTab('file://' + path.join(__dirname, 'ui', 'about.html'));
});

// =====================================================================
// ⬇️ MINIMAL DOWNLOADS (active only, no history)
// Copied from Brave/Chromium (bubble anchored INSIDE the window):
// - brave-core: DownloadToolbarButtonView + DownloadBubbleUIController.
//   The bubble is NOT an OS window, it's a panel anchored to the ⬇
//   toolbar button that auto-opens when a download starts.
// - Same here: a 300x260 WebContentsView anchored top-right
//   (y=TOP_OFFSET). The previous BrowserWindow failed because on
//   Wayland the compositor (KWin) ignores x/y and centers everything
//   (Electron docs "platform notices" + issues #48833/#52204). Inside
//   the window, coordinates are exact.
// =====================================================================
const DL_BUBBLE_W = 300;
const DL_BUBBLE_H = 260;
const activeDownloads = new Map(); // id -> { meta, item }
let dlBubble = null; // WebContentsView del bubble
let dlBubbleVisible = false;

function dlSnapshot() {
  return [...activeDownloads.values()].map(d => d.meta);
}

function sendToDlUI(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
  if (dlBubbleVisible && dlBubble && !dlBubble.webContents.isDestroyed()) {
    dlBubble.webContents.send(channel, data);
  }
}

function updateBubbleBounds() {
  if (!dlBubble || !mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  dlBubble.setBounds({
    x: Math.max(0, bounds.width - DL_BUBBLE_W - 12),
    y: TOP_OFFSET,
    width: DL_BUBBLE_W,
    height: DL_BUBBLE_H
  });
}

// Tab views are re-added on switch/navigate; bubble goes on top.
function ensureBubbleOnTop() {
  if (!dlBubbleVisible || !dlBubble || !mainWindow || mainWindow.isDestroyed()) return;
  if (dlBubble.webContents.isDestroyed()) return;
  try {
    mainWindow.contentView.removeChildView(dlBubble);
    mainWindow.contentView.addChildView(dlBubble);
    updateBubbleBounds();
  } catch (e) { }
}

function showBubble() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!dlBubble || dlBubble.webContents.isDestroyed()) {
    dlBubble = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: true
      }
    });
    dlBubble.webContents.loadFile(path.join(__dirname, 'ui', 'download-popup.html'));
    dlBubble.webContents.once('did-finish-load', () => {
      if (dlBubble && !dlBubble.webContents.isDestroyed()) {
        dlBubble.webContents.send('download-list', dlSnapshot());
      }
    });
  }
  dlBubbleVisible = true;
  try {
    mainWindow.contentView.addChildView(dlBubble);
    updateBubbleBounds();
    // No focus: page keeps keyboard (equals Chromium's
    // ShowInactive, doesn't steal focus on auto-open).
    dlBubble.webContents.send('download-list', dlSnapshot());
  } catch (e) { }
}

function hideBubble() {
  dlBubbleVisible = false;
  if (dlBubble && mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(dlBubble); } catch (e) { }
  }
}

function toggleBubble() {
  if (dlBubbleVisible) hideBubble();
  else showBubble();
}

function initDownloads() {
  session.fromPartition(PARTITION).on('will-download', (event, item) => {
    const id = Date.now().toString();
    activeDownloads.set(id, {
      item,
      meta: { id, name: item.getFilename(), received: 0, total: item.getTotalBytes(), state: 'active' }
    });
    item.on('updated', (e, state) => {
      const d = activeDownloads.get(id);
      if (d) {
        d.meta.received = item.getReceivedBytes();
        d.meta.total = item.getTotalBytes();
        d.meta.state = state;
        sendToDlUI('download-updated', d.meta);
      }
    });
    item.once('done', (e, state) => {
      const d = activeDownloads.get(id);
      if (d) d.meta.state = state;
      sendToDlUI('download-done', { id, state, name: item.getFilename() });
      // Cleanup after 5s
      setTimeout(() => activeDownloads.delete(id), 5000);
    });
    // Auto-opens the bubble on start (like Brave), no focus steal
    showBubble();
  });
}
ipcMain.on('open-download-popup', () => toggleBubble());
ipcMain.on('close-download-popup', () => hideBubble());
ipcMain.on('download-cancel', (event, id) => {
  const d = activeDownloads.get(id);
  if (d && d.item && !d.item.isDestroyed()) {
    try { d.item.cancel(); } catch (e) { }
  }
  activeDownloads.delete(id);
  sendToDlUI('download-list', [...activeDownloads.values()].map(x => x.meta));
});

function doClearMemory() {
  if (global.gc) {
    global.gc();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('memory-cleared');
  }
}

ipcMain.on('clear-memory', () => doClearMemory());

ipcMain.on('show-context-menu', (event, tabId) => {
  const tab = tabs.find(t => t.id === tabId);
  const menu = Menu.buildFromTemplate([
    { label: 'New tab', click: () => createTab('') },
    ...(tab ? [
      { label: tab.pinned ? 'Unpin tab' : 'Pin tab', click: () => toggleTabPin(tabId) },
      { type: 'separator' },
      { label: 'Close tab', enabled: !tab.pinned, click: () => closeTab(tabId) }
    ] : [])
  ]);
  menu.popup({ window: mainWindow });
});

// Native menus render above WebContentsViews (HTML dropdowns can't).
ipcMain.on('show-quick-menu', () => {
  const menu = Menu.buildFromTemplate([
    { label: 'New tab', click: () => createTab('') },
    { label: 'Free RAM', click: () => doClearMemory() },
    { label: 'Developer tools', click: () => {
      const tab = getActiveTab();
      const wc = tab?.view?.webContents;
      if (wc && !wc.isDestroyed()) wc.toggleDevTools();
    } },
    { label: 'Settings', click: () => createTab('file://' + path.join(__dirname, 'ui', 'settings.html')) },
    { type: 'separator' },
    { label: 'About Zar', click: () => createTab('file://' + path.join(__dirname, 'ui', 'about.html')) }
  ]);
  menu.popup({ window: mainWindow });
});

ipcMain.on('show-engine-menu', () => {
  const menu = Menu.buildFromTemplate(
    Object.entries(SEARCH_ENGINES).map(([id, e]) => ({
      label: e.name,
      type: 'checkbox',
      checked: settings.searchEngine === id,
      click: () => { setEngine(id); broadcastSettings(); }
    }))
  );
  menu.popup({ window: mainWindow });
});

// =====================================================================
// 🚀 APP LIFECYCLE
// =====================================================================
app.whenReady().then(async () => {
  ZarDB.init();
  loadSettings();
  // Clipboard (incl. images) is off by default in Electron. Allow clipboard
  // permissions on the Zar partition; deny the rest (no notification/media popups).
  // Must run after ready: session can't be touched at module top.
  session.fromPartition(PARTITION).setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      return callback(true);
    }
    callback(false);
  });
  if (settings.adblockEnabled) initAdBlocker();
  applyDiscardingSettings();
  initDownloads();
  createMainWindow();

  // Flag --open-url="https://..." for benchmark/automation.
  // Ex: npm start -- --open-url="https://youtube.com"
  const openArg = process.argv.find(a => a.startsWith('--open-url='));
  const startUrl = openArg ? openArg.slice('--open-url='.length) : '';

  mainWindow.webContents.once('dom-ready', () => {
    // --open-url wins (benchmark); else session; else homepage
    if (startUrl) {
      createTab(startUrl);
      return;
    }
    const sess = loadSession();
    if (sess) {
      const base = tabs.length;
      sess.tabs.forEach(t => {
        const id = createTab(t.url);
        const tb = tabs.find(x => x.id === id);
        if (tb && t.title) {
          tb.title = t.title;
          mainWindow.webContents.send('tab-title-changed', { tabId: id, title: t.title });
        }
      });
      switchTab(tabs[base + sess.activeIndex].id);
    } else {
      createTab('');
    }
  });
}).catch(err => {
  console.error('[Zar] Startup error:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => saveSession());
