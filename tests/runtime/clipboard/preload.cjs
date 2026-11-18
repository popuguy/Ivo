const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clipboardTest', {
  edit: (command) => ipcRenderer.invoke('ivo-test-native-edit', command),
});
