const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wrapTest', {
  capture: () => ipcRenderer.invoke('ivo-text-wrap-test', 'capture'),
  save: (value) => ipcRenderer.invoke('ivo-text-wrap-test', 'save', value),
  load: () => ipcRenderer.invoke('ivo-text-wrap-test', 'load'),
  insert: (value) => ipcRenderer.invoke('ivo-text-wrap-test', 'insert', value),
  key: (key, modifiers = []) => ipcRenderer.invoke('ivo-text-wrap-test', 'key', { key, modifiers }),
  select: (gesture) => ipcRenderer.invoke('ivo-text-wrap-test', 'select', gesture),
});
