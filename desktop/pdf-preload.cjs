const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ivoPDF', {
  snapshot: () => ipcRenderer.invoke('ivo:pdf-snapshot'),
  ready: (result) => ipcRenderer.invoke('ivo:pdf-ready', result),
});
