const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Tabs
  createTab: (url = '') => ipcRenderer.send('create-tab', url),
  switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),
  closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),

  // Navigation
  navigateTo: (url) => ipcRenderer.send('navigate-to', url),
  goHome: () => ipcRenderer.send('go-home'),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  zoomReset: () => ipcRenderer.send('zoom-reset'),
  openAbout: () => ipcRenderer.send('open-about'),

  // Descargas mínimas
  cancelDownload: (id) => ipcRenderer.send('download-cancel', id),

  // System & DevTools
  clearMemory: () => ipcRenderer.send('clear-memory'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  showContextMenu: (tabId) => ipcRenderer.send('show-context-menu', tabId),

  // Event listeners
  onTabCreated: (cb) => ipcRenderer.on('tab-created', (event, data) => cb(data)),
  onTabSwitched: (cb) => ipcRenderer.on('tab-switched', (event, data) => cb(data)),
  onTabClosed: (cb) => ipcRenderer.on('tab-closed', (event, data) => cb(data)),
  onTabPinnedUpdated: (cb) => ipcRenderer.on('tab-pinned-updated', (event, data) => cb(data)),
  onTabUrlChanged: (cb) => ipcRenderer.on('tab-url-changed', (event, data) => cb(data)),
  onTabTitleChanged: (cb) => ipcRenderer.on('tab-title-changed', (event, data) => cb(data)),
  onTabLoadingStarted: (cb) => ipcRenderer.on('tab-loading-started', (event, data) => cb(data)),
  onTabLoadingFinished: (cb) => ipcRenderer.on('tab-loading-finished', (event, data) => cb(data)),
  onTabDiscarded: (cb) => ipcRenderer.on('tab-discarded', (event, data) => cb(data)),
  onTabRestored: (cb) => ipcRenderer.on('tab-restored', (event, data) => cb(data)),
  onOpenNewTabFromWeb: (cb) => ipcRenderer.on('open-new-tab-from-web', (event, url) => cb(url)),
  onRamUsageUpdated: (cb) => ipcRenderer.on('ram-usage-updated', (event, ramMb) => cb(ramMb)),
  onMemoryCleared: (cb) => ipcRenderer.on('memory-cleared', () => cb()),
  onFullscreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (event, isFullscreen) => cb(isFullscreen)),
  onDownloadUpdated: (cb) => ipcRenderer.on('download-updated', (event, d) => cb(d)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (event, d) => cb(d))
});
