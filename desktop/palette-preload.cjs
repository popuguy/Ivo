const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ivoPalette', {
  ready: () => ipcRenderer.send('ivo:palette-ready'),
  painted: () => ipcRenderer.send('ivo:palette-painted'),
  initial: () => ipcRenderer.invoke('ivo:palette-initial'),
  onView: (callback) =>
    ipcRenderer.on('ivo:palette-view', (_event, view, kind, published) =>
      callback(view, kind, published),
    ),
  act: (value) => ipcRenderer.send('ivo:palette-action', value),
  fieldFocus: (editing) => ipcRenderer.send('ivo:palette-field', editing),
  dock: () => ipcRenderer.send('ivo:palette-close'),
  menu: (x, y) => ipcRenderer.invoke('ivo:palette-menu', x, y),
  drag: (value) => ipcRenderer.send('ivo:palette-drag', value),
  collapse: (value) => ipcRenderer.send('ivo:palette-collapse', value),
  close: () => ipcRenderer.send('ivo:palette-hide'),
});
