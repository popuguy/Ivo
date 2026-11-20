/** Renderer menu state contains booleans only; never document source or executable data. */
export function editorMenuState(value) {
  const canvasView = value?.canvasView === true;
  const canvasEditing = canvasView && value?.canvasEditing === true;
  return {
    canvasView,
    canvasEditing,
    canShowContextual: canvasEditing && value?.canShowContextual === true,
    canArrange: canvasView && value?.canArrange === true,
    smartGuides: value?.smartGuides === true,
  };
}
