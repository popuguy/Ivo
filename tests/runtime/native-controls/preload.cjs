const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('controlsTest', {
  key: (key, modifiers = []) => ipcRenderer.invoke('controls-input', 'key', { key, modifiers }),
  insert: (text) => ipcRenderer.invoke('controls-input', 'insert', text),
});
