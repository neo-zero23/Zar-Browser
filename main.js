const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const path = require('path');
const ZarDB = require('./db');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = require('cross-fetch');

// =====================================================================
// ⚡ PERFORMANCE & HARDWARE ACCELERATION SWITCHES
// =====================================================================
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('renderer-process-limit', '4');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-speech-synthesis-api');
app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('no-first-run');
app.commandLine.appendSwitch('no-default-browser-check');

// Hardware video decode & Wayland-friendly GPU rasterization
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiIgnoreDriverChecks');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// =====================================================================
// 🌐 CONSTANTS & STATE
// =====================================================================
const PARTITION = 'persist:zar';
const TOP_OFFSET = 78; // Titlebar (38px) + Toolbar (40px)
const DISCARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let mainWindow = null;
let tabs = [];
let activeTabId = null;
let adBlocker = null;

// =====================================================================
// 🛡️ AD-BLOCKER (@cliqz/adblocker-electron)
// =====================================================================
function initAdBlocker() {
  ElectronBlocker.fromLists(fetch, [
    'https://easylist.to/easylist/easylist.txt',
    'https://easylist.to/easylist/easyprivacy.txt'
  ], {
    enableCompression: true,
    guessRequestTypeFromUrl: true,
    loadNetworkFilters: true
  }).then(blocker => {
    adBlocker = blocker;
    const sess = session.fromPartition(PARTITION);
    adBlocker.enableBlockingInSession(sess);
    adBlocker.enableBlockingInSession(session.defaultSession);
  }).catch(err => {
    console.error('[Zar AdBlocker] Error:', err.message);
  });
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
    icon: path.join(__dirname, 'assets', 'new-logo-256.png'),
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
    title: rawUrl ? 'Cargando...' : 'Nueva pestaña',
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
      ...(nav.canGoBack() ? [{ label: 'Atrás', click: () => !wc.isDestroyed() && nav.goBack() }] : []),
      ...(nav.canGoForward() ? [{ label: 'Adelante', click: () => !wc.isDestroyed() && nav.goForward() }] : []),
      ...(nav.canGoBack() || nav.canGoForward() ? [{ type: 'separator' }] : []),
      { label: 'Recargar', click: () => !wc.isDestroyed() && wc.reload() },
      { type: 'separator' },
      { label: 'Copiar', role: 'copy' },
      { label: 'Pegar', role: 'paste' },
      { label: 'Seleccionar todo', role: 'selectAll' },
      ...(params.mediaType === 'image' ? [
        { type: 'separator' },
        { label: 'Guardar imagen', click: () => wc.downloadURL(params.srcURL) }
      ] : []),
      ...(params.linkURL ? [
        { type: 'separator' },
        { label: 'Guardar enlace como...', click: () => wc.downloadURL(params.linkURL) }
      ] : []),
      { type: 'separator' },
      { label: 'Inspeccionar elemento', click: () => !wc.isDestroyed() && wc.inspectElement(params.x, params.y) }
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  wc.on('did-start-navigation', (event, navUrl, isInPlace, isMainFrame) => {
    if (isMainFrame) {
      tab.url = navUrl;
      tab.lastActive = Date.now();
      tab.discarded = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tab-url-changed', { tabId, url: navUrl });
      }
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

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-switched', { tabId, url: tab.url, title: tab.title });
  }
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

// =====================================================================
// 💤 NATIVE TAB DISCARDING (RAM SAVER)
// =====================================================================
function checkIdleTabs() {
  const now = Date.now();
  tabs.forEach(tab => {
    if (tab.id === activeTabId || tab.pinned || tab.discarded || !tab.url) return;
    if (now - tab.lastActive >= DISCARD_TIMEOUT_MS) {
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

// Check every 60s for tabs idle > 5 minutes
setInterval(checkIdleTabs, 60000);

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

ipcMain.on('navigate-to', (event, input) => {
  const tab = getActiveTab();
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;

  let targetUrl = (input || '').trim();
  if (!targetUrl) return;

  if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://') || targetUrl.startsWith('file://')) {
    // Valid scheme
  } else if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
    targetUrl = 'https://' + targetUrl;
  } else {
    targetUrl = `https://duckduckgo.com/?q=${encodeURIComponent(targetUrl)}`;
  }

  tab.url = targetUrl;
  tab.discarded = false;

  try {
    mainWindow.contentView.addChildView(tab.view);
    updateViewBounds(tab.view);
    tab.view.webContents.loadURL(targetUrl);
    tab.view.webContents.focus();
  } catch (e) { }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-url-changed', { tabId: tab.id, url: targetUrl });
  }
});

ipcMain.on('go-home', () => {
  const tab = getActiveTab();
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;

  tab.url = '';
  tab.title = 'Nueva pestaña';

  try {
    mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.loadURL('about:blank');
  } catch (e) { }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-url-changed', { tabId: tab.id, url: '' });
    mainWindow.webContents.send('tab-title-changed', { tabId: tab.id, title: 'Nueva pestaña' });
  }
});

ipcMain.on('go-back', () => {
  const tab = getActiveTab();
  if (tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.goBack();
  }
});

ipcMain.on('go-forward', () => {
  const tab = getActiveTab();
  if (tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.goForward();
  }
});

ipcMain.on('reload', () => {
  const tab = getActiveTab();
  if (tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.reload();
  }
});

ipcMain.on('clear-memory', () => {
  if (global.gc) {
    global.gc();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('memory-cleared');
  }
});

ipcMain.on('show-context-menu', (event, tabId) => {
  const tab = tabs.find(t => t.id === tabId);
  const menu = Menu.buildFromTemplate([
    { label: 'Nueva pestaña', click: () => createTab('') },
    ...(tab ? [
      { label: tab.pinned ? 'Desanclar pestaña' : 'Anclar pestaña', click: () => toggleTabPin(tabId) },
      { type: 'separator' },
      { label: 'Cerrar pestaña', enabled: !tab.pinned, click: () => closeTab(tabId) }
    ] : [])
  ]);
  menu.popup({ window: mainWindow });
});

// =====================================================================
// 🚀 APP LIFECYCLE
// =====================================================================
app.whenReady().then(async () => {
  ZarDB.init();
  initAdBlocker();
  createMainWindow();

  mainWindow.webContents.once('dom-ready', () => {
    createTab('');
  });

  // Periodically send memory metrics
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const metrics = app.getAppMetrics();
      const totalMemoryKb = metrics.reduce((sum, m) => sum + (m.memory.privateBytes || m.memory.workingSetSize), 0);
      const totalMemoryMb = Math.round(totalMemoryKb / 1024);
      mainWindow.webContents.send('ram-usage-updated', totalMemoryMb);
    }
  }, 2000);
}).catch(err => {
  console.error('[Zar] Startup error:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
