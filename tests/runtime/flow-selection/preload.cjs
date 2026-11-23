const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('textCoreTest', {
  drag: (from, to, modifier) => ipcRenderer.invoke('ivo-text-core-drag', from, to, modifier),
  select: (gesture) => ipcRenderer.invoke('ivo-text-core-select', gesture),
  key: (key, modifiers = []) => ipcRenderer.invoke('ivo-text-core-key', key, modifiers),
  type: (text) => ipcRenderer.invoke('ivo-text-core-type', text),
  ime: (stage) => ipcRenderer.invoke('ivo-text-core-ime', stage),
  save: (archive) => ipcRenderer.invoke('ivo-text-core-save', archive),
  load: () => ipcRenderer.invoke('ivo-text-core-load'),
});
