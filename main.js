const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const ZarDB = require('./db');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const { applyChromiumSwitches } = require('./optimizations');

// Switches centralizados (ver optimizations.js). Llamar antes de ready.
applyChromiumSwitches(app);

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
// 🛡️ AD-BLOCKER (@ghostery/adblocker-electron, caché en disco)
// API igual que @cliqz (fromLists/fromCached/serialize/deserialize).
// Caché versionada por nombre: el bin de @cliqz v1 nunca lo lee @ghostery
// v2 (además deserialize valida ENGINE_VERSION + checksum y regenera solo).
// =====================================================================
async function initAdBlocker() {
  try {
    const cachePath = path.join(app.getPath('userData'), 'adblock-cache-ghostery.bin');
    // Refresh cada 7 días: bin viejo -> borrar para forzar re-descarga
    try {
      const st = await fs.promises.stat(cachePath);
      if (Date.now() - st.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
        await fs.promises.unlink(cachePath);
      }
    } catch (e) { /* primera vez, sin caché */ }
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
    // Solo partición Zar, NO defaultSession
    adBlocker.enableBlockingInSession(session.fromPartition(PARTITION));
    console.log('[Zar AdBlocker] OK');
  } catch (err) {
    // Fallback: sin adblock, el arranque sigue
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

  ensureBubbleOnTop();

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
  ensureBubbleOnTop();

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

// Zoom nativo Chromium con niveles estándar enteros (-3..+5).
// Evita niveles raros tipo 110% que deja el +0.5 flotante.
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
// ⬇️ DESCARGAS MÍNIMAS (solo activas, sin historial)
// Copiado de Brave/Chromium (bubble anclado DENTRO de la ventana):
// - brave-core: DownloadToolbarButtonView + DownloadBubbleUIController.
//   El bubble NO es una ventana del SO, es un panel anclado al botón ⬇
//   del toolbar que se auto-abre al iniciar una descarga.
// - Aquí igual: un WebContentsView de 300x260 anclado arriba-derecha
//   (y=TOP_OFFSET). La ventana BrowserWindow anterior fallaba porque en
//   Wayland el compositor (KWin) ignora x/y y centra todo (docs Electron
//   "platform notices" + issues #48833/#52204). Dentro de la ventana las
//   coordenadas sí son exactas.
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

// Las tab views se re-añaden al cambiar/navegar; el bubble va encima.
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
    // Sin focus: la página sigue recibiendo el teclado (equivale al
    // ShowInactive de Chromium, no roba foco al auto-abrir).
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
      // Limpieza a los 5s
      setTimeout(() => activeDownloads.delete(id), 5000);
    });
    // Auto-abre el bubble al iniciar (como Brave), sin robar foco
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
  initDownloads();
  createMainWindow();

  // Flag --open-url="https://..." para benchmark/automatización.
  // Ej: npm start -- --open-url="https://youtube.com"
  const openArg = process.argv.find(a => a.startsWith('--open-url='));
  const startUrl = openArg ? openArg.slice('--open-url='.length) : '';

  mainWindow.webContents.once('dom-ready', () => {
    createTab(startUrl);
  });
}).catch(err => {
  console.error('[Zar] Startup error:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
