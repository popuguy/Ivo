const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ivoPalette', {
  ready: () => ipcRenderer.send('ivo:palette-ready'),
  initial: () => ipcRenderer.invoke('ivo:palette-initial'),
  onView: (callback) =>
    ipcRenderer.on('ivo:palette-view', (_event, view, kind) => callback(view, kind)),
  act: (value) => ipcRenderer.send('ivo:palette-action', value),
  fieldFocus: (editing) => ipcRenderer.send('ivo:palette-field', editing),
  dock: () => ipcRenderer.send('ivo:palette-close'),
});
