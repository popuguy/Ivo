/** Check the actual controls and glyphs in the mounted editor, including a portaled popover. */
export function verifyLightPalette(host, assert) {
  const style = (selector) => getComputedStyle(host.querySelector(selector));
  assert(
    style('.scene-editor').backgroundColor === 'rgb(220, 220, 220)',
    'Normal pasteboard lost its Light color',
  );
  assert(
    style('.context-panel-group').backgroundColor === 'rgb(240, 240, 240)',
    'Publishing dock lost the Light background',
  );
  assert(
    style('.type-options-popover').backgroundColor === 'rgb(240, 240, 240)',
    'OpenType popover diverged from the dock palette',
  );
  assert(
    style('.property-number').backgroundColor === 'rgb(255, 255, 255)' &&
      style('.indesign-properties select').colorScheme === 'light',
    'Character inputs retained dark native chrome',
  );
  assert(
    style('.canvas-contextual-bar select').colorScheme === 'light',
    'Contextual bar retained a dark menu',
  );
  assert(
    style('[data-scene-text]').color === 'rgb(52, 78, 107)',
    'Interface palette recolored authored type',
  );
  const glyph = host.querySelector('.context-panel-group [data-icon-name="type-leading"]');
  if (glyph.dataset.iconSource === 'Obsidian/Lucide') {
    assert(
      getComputedStyle(glyph).filter.includes('brightness(0)'),
      'Public control icon lost its Light ink',
    );
  } else {
    assert(getComputedStyle(glyph).filter === 'none', 'Native artwork was recolored by the dock');
  }
}
