const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeEditorTest', {
  compose: (request) => ipcRenderer.invoke('ivo:text-composition', 'compose', request),
  insert: (text) => ipcRenderer.invoke('ivo-native-editor-test', 'insert', text),
  key: (key, modifiers = []) =>
    ipcRenderer.invoke('ivo-native-editor-test', 'key', { key, modifiers }),
  drag: (from, to) => ipcRenderer.invoke('ivo-native-editor-test', 'drag', { from, to }),
  doubleClick: (point) => ipcRenderer.invoke('ivo-native-editor-test', 'doubleClick', point),
  select: (gesture) => ipcRenderer.invoke('ivo-native-editor-test', 'select', gesture),
  save: (archive) => ipcRenderer.invoke('ivo-native-editor-test', 'save', archive),
  load: () => ipcRenderer.invoke('ivo-native-editor-test', 'load'),
  capture: (name) => ipcRenderer.invoke('ivo-native-editor-test', 'capture', name),
});
