import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

export async function verifyWrapPanels(host, assert, tick) {
  const doc = createSceneDocument('Wrap panel selections');
  const page = doc.pages[0].id;
  const add = (type) => insertObject(doc, type, page);
  const shape = add('polygon'),
    image = add('image'),
    text = add('text'),
    line = add('rule');
  const notices = [];
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    onNotify: (msg) => notices.push(msg),
    onCommit() {},
    onChange() {},
    source: (s) => s,
  });
  const current = () => host.querySelector('.canvas-panel-content:not([hidden])');
  const control = (selector) => current().querySelector(selector);
  const select = async (...ids) => {
    editor.restoreView({ selection: ids, activePage: page, tool: 'select' });
    await tick();
  };
  const change = async (key, value) => {
    const input = control('[data-text-wrap-offset="' + key + '"]');
    assert(input && !input.disabled, 'Cannot edit ' + key + ' offset');
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  };
  try {
    for (const [ids, expected] of [
      [[], false],
      [[text.id], false],
      [[line.id], false],
      [[shape.id, image.id], false],
      [[image.id], true],
      [[shape.id], true],
    ]) {
      await select(...ids);
      assert(
        !!control('.wrap-mode-row') === expected,
        'Wrong Properties selection context: ' + ids,
      );
    }
    editor.restoreView({
      tool: 'text',
      activeTextId: text.id,
      selection: [text.id],
      activePage: page,
    });
    await tick();
    assert(!control('.wrap-mode-row'), 'Properties showed object wrap while typing');
    await select(shape.id);
    await editor.command('tool-direct');
    await tick();
    const vertex = host.querySelector('[data-vertex]'),
      rect = vertex.getBoundingClientRect();
    const pointer = {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: rect.x + 2,
      clientY: rect.y + 2,
    };
    vertex.dispatchEvent(new PointerEvent('pointerdown', pointer));
    vertex.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
    await tick();
    assert(!control('.wrap-mode-row'), 'Direct-selected anchor exposed object wrap');
    await editor.command('tool-select');
    await tick();
    const buttons = [...current().querySelectorAll('[data-text-wrap-mode]')];
    assert(
      buttons.map((b) => b.querySelector('img')?.dataset.iconName).join(',') ===
        'wrap-none,wrap-box,wrap-shape,wrap-jump,wrap-next',
      'Wrap modes need their five sourced icons',
    );
    assert(
      buttons.every((b) => b.getBoundingClientRect().width === 24),
      'Wrap mode targets must be 24 points wide',
    );
    assert(
      !control('[data-text-wrap="side"]') && !control('[data-text-wrap-offset]'),
      'Compact Properties includes full-panel options',
    );
    control('[data-wrap-more]').click();
    control('[data-text-wrap-mode="contour"]').click();
    await tick();
    assert(
      !control('[data-text-wrap-offset="left"]').disabled,
      'Rectangle contour lost directional offsets',
    );
    await change('top', 5.5);
    assert(
      Object.values(shape.textWrap.offsets).every((v) => v === 5.5),
      'Linked offsets did not move together',
    );
    control('[data-wrap-link]').click();
    await change('right', 3.25);
    assert(
      shape.textWrap.offsets.top === 5.5 && shape.textWrap.offsets.right === 3.25,
      'Unlinked offsets overwrote a neighbor',
    );
    control('[data-text-wrap-offset="right"]')
      .closest('.property-number')
      .querySelector('[data-property-step="1"]')
      .click();
    assert(shape.textWrap.offsets.right === 4.25, 'Fractional offset step failed');
    control('[data-text-wrap="invert"]').click();
    await tick();
    assert(
      shape.textWrap.invert &&
        shape.textWrap.offsets.right === -4.25 &&
        control('[data-text-wrap-offset="right"]').value === '4.25',
      'Invert changed the displayed distance or left the physical direction unchanged',
    );
    control('[data-wrap-link]').click();
    await tick();
    assert(
      Object.values(shape.textWrap.offsets).every((n) => n === -5.5),
      'Relinking must copy the top value to every offset',
    );
    await select(image.id);
    control('[data-text-wrap-mode="contour"]').click();
    await tick();
    assert(
      !control('[data-text-wrap-offset="top"]').disabled &&
        control('[data-text-wrap-offset="left"]').disabled &&
        control('[data-wrap-link]').disabled,
      'Graphic shape needs the uniform contour field',
    );
    await editor.command('show-panel-text-wrap');
    await tick();
    assert(
      control('.wrap-panel') && control('[data-wrap-contour]').value === 'frame',
      'Dedicated panel lacks graphic contour controls',
    );
    const menu = host.querySelector('[data-panel-menu]');
    menu.click();
    host.querySelector('[data-workspace-action="command/toggle-wrap-options"]').click();
    await tick();
    assert(
      !control('[data-text-wrap="side"]'),
      'Hide Options did not collapse the dedicated panel',
    );
    menu.click();
    host.querySelector('[data-workspace-action="command/toggle-wrap-options"]').click();
    await tick();
    await select(text.id);
    assert(
      control('.wrap-mode-row') && !control('[data-text-wrap-mode="bounds"]').disabled,
      'Standalone text frame wrap is inaccessible',
    );
    await select();
    control('[data-text-wrap-mode="jump"]').click();
    await tick();
    assert(
      doc.extensions.ivoTextWrapDefaults.mode === 'jump' && !text.textWrap,
      'Changing defaults modified existing objects',
    );
    assert(
      !control('[data-text-wrap="invert"]').disabled &&
        !control('[data-text-wrap-offset="right"]').disabled,
      'Jump mode lost enabled controls',
    );
    assert(add('rule').textWrap.mode === 'jump', 'New object ignored document wrap defaults');
    menu.click();
    host.querySelector('[data-workspace-action="close-panel"]').click();
    await tick();
    assert(
      host.querySelector('[data-canvas-panel="text-wrap"]').hidden,
      'Closing Text Wrap left a visible tab',
    );
    await editor.command('show-panel-text-wrap');
    await tick();
    assert(
      control('[data-text-wrap-mode="jump"]').getAttribute('aria-pressed') === 'true',
      'Reopened panel lost its document default',
    );
    assert(!notices.length, 'Unexpected wrap panel error: ' + notices.join(', '));
  } finally {
    editor.destroy();
  }
}
