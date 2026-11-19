/** Renderer menu state contains booleans only; never document source or executable data. */
export function editorMenuState(value) {
  const canvasView = value?.canvasView === true;
  return {
    canvasView,
    canArrange: canvasView && value?.canArrange === true,
    smartGuides: value?.smartGuides === true,
  };
}
