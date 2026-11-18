const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('textCoreTest', {
  drag: (from, to) => ipcRenderer.invoke('ivo-text-core-drag', from, to),
  select: (gesture) => ipcRenderer.invoke('ivo-text-core-select', gesture),
  key: (key, modifiers = []) => ipcRenderer.invoke('ivo-text-core-key', key, modifiers),
  type: (text) => ipcRenderer.invoke('ivo-text-core-type', text),
  save: (archive) => ipcRenderer.invoke('ivo-text-core-save', archive),
  load: () => ipcRenderer.invoke('ivo-text-core-load'),
});
