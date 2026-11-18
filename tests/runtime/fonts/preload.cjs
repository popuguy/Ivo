const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'ivoFontTest',
  Object.fromEntries(
    ['list', 'read', 'saveAsset', 'saveDocument', 'loadAssets', 'loadDocuments'].map((method) => [
      method,
      (value) => ipcRenderer.invoke('ivo-font-test', method, value),
    ]),
  ),
);
