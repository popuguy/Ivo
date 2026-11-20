import { installDesktopPalettes } from '../../../src/features/editor/ui/desktop-palettes.js';

// Real DOM controls, including form values that don't produce mutation records.
export async function verifyPalettePublication(assert) {
  const content = document.createElement('div');
  content.innerHTML =
    '<button>Apply</button><input value="12"><select><option>A</option><option>B</option></select>';
  document.body.append(content);
  const events = [];
  let configure,
    act,
    scope = 'first',
    reads = 0,
    clones = 0,
    clicks = 0;
  const clone = content.cloneNode;
  content.cloneNode = function (...args) {
    clones++;
    return clone.apply(this, args);
  };
  content.querySelector('button').addEventListener('click', () => clicks++);
  const editor = {
    setExternalPanels() {},
    paletteContext() {
      reads++;
      return { title: 'Text frame', scope, entries: [{ kind: 'properties', content }] };
    },
  };
  const publisher = installDesktopPalettes(
    {
      publish: (value) => events.push(value),
      onConfiguration: (fn) => (configure = fn),
      onAction: (fn) => (act = fn),
      onDockPointer() {},
    },
    () => editor,
  );
  async function until(check) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Detached inspector did not publish');
  }
  const configuration = { epoch: 2, active: true, passive: false, kinds: ['properties', 'layers'] };
  try {
    configure(configuration);
    for (let i = 0; i < 20; i++) publisher.refresh();
    await Promise.resolve();
    assert(
      !reads && !clones,
      'Inspector blocked the input microtask with a selection read or DOM copy',
    );
    await until(() => events.length === 2);
    assert(
      reads === 1 && clones === 1,
      'A single input turn should sample the text selection once for all palettes',
    );
    const first = events[0].view;
    const input = content.querySelector('input');
    input.setAttribute('value', '12');
    scope = 'second';
    publisher.refresh();
    await until(() => events.length === 3);
    assert(
      !('html' in events[2].view) && clones === 1,
      'Moving the caret copied unchanged font menus',
    );
    input.value = '19';
    content.querySelector('select').selectedIndex = 1;
    publisher.refresh();
    await until(() => events.length === 4);
    assert(
      events[3].view.html.includes('value="19"') && /selected[^>]*>B</.test(events[3].view.html),
      'Detached fields failed to mirror live values',
    );
    const send = (revision) =>
      act({ epoch: 2, kind: 'properties', type: 'click', index: 0, revision });
    send(first.revision);
    assert(clicks === 0, 'Stale edit reached the next selection');
    send(events[3].view.revision);
    assert(clicks === 1, 'Current palette revision failed');
    scope = 'third';
    send(events[3].view.revision);
    assert(clicks === 1, 'Action preceding the scheduled paint reached the wrong caret');
  } finally {
    configure({ ...configuration, kinds: [] });
    content.remove();
  }
}
