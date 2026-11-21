import assert from 'node:assert/strict';
import { screen } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const evaluate = (win, script) => win.webContents.executeJavaScript(script);
const painted = (win) =>
  evaluate(win, 'new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');

export async function collapsedToHeader(win) {
  const bottom = await evaluate(
    win,
    `(() => {
    const header = document.querySelector('.context-panel-header');
    const group = header.parentElement;
    const inset = parseFloat(getComputedStyle(group.parentElement).paddingBottom);
    return Math.ceil(header.getBoundingClientRect().bottom + parseFloat(getComputedStyle(group).borderBottomWidth) + inset);
  })()`,
  );
  return bottom > 32 && win.getContentBounds().height === bottom;
}

async function assertAlpha(win) {
  const bitmap = async () => {
    await painted(win);
    const image = (await win.webContents.capturePage()).resize({
      width: win.getContentBounds().width,
    });
    const { width, height } = image.getSize();
    const data = image.toBitmap({ scaleFactor: 1 });
    assert.equal(data.length, width * height * 4);
    return (x, y) => data[(width * y + x) * 4 + 3];
  };
  const { width, height } = win.getContentBounds();
  const x = Math.floor(width / 2);
  const alpha = await bitmap();
  assert.equal(alpha(0, 0), 0, 'The native palette canvas must preserve fully clear pixels');
  assert.equal(alpha(x, height - 12), 255, 'Panel surface is opaque by default');
  const edge = Array.from({ length: 6 }, (_, i) => alpha(x, height - 6 + i));
  assert.ok(
    new Set(edge.filter((a) => a > 0 && a < 255)).size >= 2 && edge.at(-1) === 0,
    'Expected a graduated shadow fading into clear pixels: ' + edge,
  );
  await evaluate(
    win,
    "document.documentElement.style.setProperty('--panel-surface-fill','rgb(80 125 180 / 50%)')",
  );
  try {
    const tinted = await bitmap();
    // Controls have their own paint. Sample many interior points to distinguish
    // a translucent body with opaque controls from dimming the whole window.
    const interior = [];
    for (let y = 52; y < height - 10; y += 8)
      for (let x = 9; x < width - 10; x += 8) interior.push(tinted(x, y));
    assert.ok(
      interior.filter((a) => Math.abs(a - 128) <= 1).length > 50 &&
        interior.filter((a) => a === 255).length > 50,
      'Expected a translucent surface and opaque controls, alpha values: ' +
        [...new Set(interior)].join(','),
    );
  } finally {
    await evaluate(win, "document.documentElement.style.removeProperty('--panel-surface-fill')");
  }
}

async function assertMacOrder(front, behind) {
  const ids = [front, behind].map((win) => Number(win.getMediaSourceId().split(':')[1]));
  assert.ok(ids.every(Number.isSafeInteger));
  // WindowServer returns front-to-back order. Only the two fixture window IDs leave this process.
  const swift = `import CoreGraphics
  let wanted = Set([${ids.join(',')}])
  let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
  print(windows.compactMap { $0[kCGWindowNumber as String] as? Int }.filter(wanted.contains).map(String.init).joined(separator: ","))`;
  const { stdout } = await run('/usr/bin/swift', ['-e', swift]);
  assert.equal(stdout.trim(), ids.join(','), 'WindowServer stacking must follow palette focus');
}

export async function verifyPaletteSurfaces(props, pages, wait) {
  const original = pages.getBounds();
  const overlap = props.getBounds();
  pages.setBounds({ ...overlap, x: overlap.x - 40 });
  try {
    for (const [front, behind] of [
      [pages, props],
      [props, pages],
    ]) {
      front.focus();
      await wait(() => front.isFocused(), 'Focused one of two overlapping utility windows');
      if (process.platform === 'darwin') await assertMacOrder(front, behind);
    }
    await evaluate(props, "document.querySelector('.palette-surface').focus()");
    for (const type of ['keyDown', 'keyUp'])
      props.webContents.sendInputEvent({ type, keyCode: 'Tab' });
    const closeStyle = () =>
      evaluate(
        props,
        `(() => {
      const close = document.querySelector('[data-palette-close]');
      return {active:document.activeElement === close, ring:getComputedStyle(close).outlineStyle};
    })()`,
      );
    await wait(async () => {
      const s = await closeStyle();
      return s.active && s.ring === 'solid';
    }, 'Deliberate keyboard focus is visible on Close');
    const point = await evaluate(
      props,
      `(() => {
      const r = document.querySelector('[data-palette-handle]').getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
    })()`,
    );
    const pressGrip = async () => {
      for (const type of ['mouseDown', 'mouseUp'])
        props.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
      await painted(props);
    };
    await pressGrip();
    assert.deepEqual(
      await closeStyle(),
      { active: false, ring: 'none' },
      'Pressing the drag handle clears focus from Close',
    );
    await evaluate(props, "document.querySelector('[data-page-prop=width]').focus()");
    await pressGrip();
    assert.ok(
      await evaluate(props, "document.activeElement.matches('[data-page-prop=width]')"),
      'The drag handle preserves the inspector field receiving input',
    );
    if (process.platform === 'darwin') {
      await assertAlpha(props);
      if (process.env.IVO_TEST_PANEL_BACKDROP === '1') {
        // Put the palette on the opposite side of the display from its document.
        // A same-app document behind it could conceal a broken native shadow.
        const owner = props.getParentWindow();
        const docBounds = owner.getBounds();
        const display = screen.getDisplayMatching(docBounds).workArea;
        const size = props.getBounds();
        try {
          owner.setBounds({
            x: display.x,
            y: display.y + 20,
            width: Math.floor(display.width / 2),
            height: Math.min(docBounds.height, display.height - 40),
          });
          props.setPosition(display.x + display.width - size.width - 30, display.y + 60);
          await wait(
            () => props.getBounds().x > owner.getBounds().x + owner.getBounds().width,
            'Palette over a different application',
          );
          await painted(props);
          const probe = fileURLToPath(new URL('./palette-backdrop.swift', import.meta.url));
          const { stdout } = await run('/usr/bin/swift', [
            probe,
            props.getMediaSourceId().split(':')[1],
            String(process.pid),
          ]).catch((e) => {
            throw new Error(
              'Two-window compositing check exited ' + e.code + ' ' + e.stdout + ' ' + e.stderr,
            );
          });
          console.log('IVO_NATIVE_PANEL_BACKDROP', stdout.trim());
        } finally {
          owner.setBounds(docBounds);
          props.setBounds(size);
        }
      }
    }
  } finally {
    pages.setBounds(original);
  }
}
