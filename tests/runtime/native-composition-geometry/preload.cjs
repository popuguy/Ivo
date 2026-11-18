const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeInputTest', {
  compose: (source) => ipcRenderer.invoke('ivo-native-input-test', 'compose', source),
  insert: (text) => ipcRenderer.invoke('ivo-native-input-test', 'insert', text),
  drag: (from, to) => ipcRenderer.invoke('ivo-native-input-test', 'drag', { from, to }),
});
