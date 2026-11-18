const { contextBridge, ipcRenderer, webFrame } = require('electron');
const textComposition = Object.freeze({
  compose: (request) => ipcRenderer.invoke('ivo:text-composition', 'compose', request),
  pdf: (token, options = {}) => ipcRenderer.invoke('ivo:text-composition', 'pdf', token, options),
});
contextBridge.exposeInMainWorld('ivoTextComposition', textComposition);
const methods = [
  'loadDocuments',
  'saveDocument',
  'loadAssets',
  'saveAsset',
  'loadAsset',
  'getMeta',
  'putMeta',
  'saveImport',
  'changeLibrary',
];
contextBridge.exposeInMainWorld('ivoNative', {
  platform: 'macos',
  textComposition,
  fonts: Object.freeze({
    list: (refresh = false) => ipcRenderer.invoke('ivo:fonts', 'list', refresh),
    read: (postscript) => ipcRenderer.invoke('ivo:fonts', 'read', postscript),
  }),
  vaults: Object.freeze(
    Object.fromEntries(
      ['info', 'list', 'open', 'choose', 'create', 'forget', 'manager', 'menu', 'show'].map(
        (action) => [action, (value) => ipcRenderer.invoke('ivo:vaults', action, value)],
      ),
    ),
  ),
  windows: Object.freeze({
    info: () => ipcRenderer.invoke('ivo:windows', 'info'),
    ready: () => ipcRenderer.invoke('ivo:windows', 'ready'),
    failed: () => ipcRenderer.invoke('ivo:windows', 'failed'),
    open: (value) => ipcRenderer.invoke('ivo:windows', 'open', value),
    close: () => ipcRenderer.invoke('ivo:windows', 'close'),
    drag: (phase, value) => ipcRenderer.send('ivo:window-drag', phase, value),
  }),
  documents: Object.freeze({
    info: (id) => ipcRenderer.invoke('ivo:document-file', 'info', id),
    reveal: (id) => ipcRenderer.invoke('ivo:document-file', 'reveal', id),
    copyPath: (id, kind) => ipcRenderer.invoke('ivo:document-file', 'copy-path', id, kind),
    copyLink: (id) => ipcRenderer.invoke('ivo:document-file', 'copy-link', id),
    openPreview: (snapshot) => ipcRenderer.invoke('ivo:document-preview', snapshot),
  }),
  zoomFactor: () => webFrame.getZoomFactor(),
  store: Object.fromEntries(
    methods.map((method) => [method, (...args) => ipcRenderer.invoke('ivo:store', method, args)]),
  ),
  onVaultsChanged: (callback) => ipcRenderer.on('ivo:vault-list-changed', () => callback()),
  onStoreChanged: (callback) =>
    ipcRenderer.on('ivo:store-changed', (_event, value) => callback(value)),
  onWindowState: (callback) =>
    ipcRenderer.on('ivo:window-state', async (_event, value) => {
      let success = false;
      try {
        success = (await callback(value)) !== false;
      } catch {}
      if (value?.token) ipcRenderer.send('ivo:window-ack', value.token, success);
    }),
  onPrepareWindowRelease: (callback) =>
    ipcRenderer.on('ivo:prepare-window-release', async (_event, value) => {
      let success = false;
      try {
        success = (await callback(value)) === true;
      } catch {}
      ipcRenderer.send('ivo:window-ack', value?.token, success);
    }),
  onTabTransfer: (callback) =>
    ipcRenderer.on('ivo:tab-transfer', async (_event, value) => {
      let success = false;
      try {
        success = (await callback(value)) === true;
      } catch {}
      ipcRenderer.send('ivo:window-ack', value?.token, success);
    }),
  onCommand: (callback) => ipcRenderer.on('ivo:command', (_event, name) => callback(name)),
  updateHistory: (state) => ipcRenderer.send('ivo:history-state', state),
  showContextMenu: (context) => ipcRenderer.invoke('ivo:context-menu', context),
  showNavigationMenu: (items) => ipcRenderer.invoke('ivo:navigation-menu', items),
  exportPDF: (snapshot) => ipcRenderer.invoke('ivo:export-pdf', snapshot),
  showFolder: () => ipcRenderer.invoke('ivo:show-folder'),
  onPrepareClose: (callback) =>
    ipcRenderer.on('ivo:prepare-close', async () => {
      try {
        ipcRenderer.send('ivo:close-ready', await callback());
      } catch {
        ipcRenderer.send('ivo:close-ready', false);
      }
    }),
});
