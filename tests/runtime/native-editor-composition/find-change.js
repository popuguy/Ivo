import { logicalText } from '../../../src/shared/dom/text-selection.js';

/** Search a phrase that genuinely spans two different native-composed pages. */
export async function verifyNativeFindChange({ editor, host, flow, seam }) {
  const source = document.createElement('div');
  source.innerHTML = flow.html;
  const text = logicalText(source),
    needle = text.slice(seam - 3, seam + 5);
  if (needle.length !== 8 || needle.includes('\n'))
    throw new Error(
      'Expected a phrase crossing native frame boundary at ' + seam + ': ' + JSON.stringify(needle),
    );
  const view = editor.captureView();
  try {
    await editor.command('find-change');
    const panel = host.querySelector('.canvas-find-change');
    for (const mode of ['text', 'grep']) {
      panel.querySelector(`[data-find-mode="${mode}"]`).click();
      panel.elements.needle.value =
        mode === 'text' ? needle : '(' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')';
      panel.elements.needle.dispatchEvent(new Event('input', { bubbles: true }));
      panel.querySelector('[data-find-action="next"]').click();
      const stop = performance.now() + 4000;
      while (panel.hasAttribute('aria-busy') && performance.now() < stop)
        await new Promise((r) => setTimeout(r, 10));
      for (
        let count = 1;
        count < Number(panel.querySelector('output').value.split(' of ')[1]) &&
        editor.captureView().textSelection?.anchor.index !== seam - 3;
        count++
      )
        panel.querySelector('[data-find-action="next"]').click();
      if (
        !panel.querySelector('output').value.includes(' of ') ||
        editor.captureView().textSelection?.anchor.index !== seam - 3 ||
        editor.captureView().textSelection?.focus.index !== seam + 5 ||
        host.querySelectorAll('[data-native-selection="range"]').length < 2
      ) {
        throw new Error(
          'Find Next did not select both native page fragments at ' +
            seam +
            ': ' +
            JSON.stringify([
              panel.querySelector('output').value,
              editor.captureView().textSelection,
              host.querySelectorAll('[data-native-selection="range"]').length,
            ]),
        );
      }
    }
    panel.querySelector('[data-find-action="done"]').click();
  } finally {
    editor.restoreView(view);
  }
}
