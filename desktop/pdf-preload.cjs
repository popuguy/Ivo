const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ivoPDF', {
  snapshot: () => ipcRenderer.invoke('ivo:pdf-snapshot'),
  ready: (result) => ipcRenderer.invoke('ivo:pdf-ready', result),
});
contextBridge.exposeInMainWorld(
  'ivoTextComposition',
  Object.freeze({
    compose: (request) => ipcRenderer.invoke('ivo:text-composition', 'compose', request),
    pdf: (token, options = {}) => ipcRenderer.invoke('ivo:text-composition', 'pdf', token, options),
  }),
);
