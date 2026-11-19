import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openVault } from '../../../desktop/vault.mjs';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { observeRenderedActions } from './rendered-pixels.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'ivo-window-responsiveness-'));
process.env.IVO_USER_DATA_DIR = path.join(directory, 'Profile');
process.env.IVO_ATLAS_DIR = path.join(directory, 'Vault');
app.setPath('userData', process.env.IVO_USER_DATA_DIR);
const doc = createSceneDocument('Disposable responsiveness test', { width: 612, height: 792 });
enablePublishing(doc);
const paragraph =
  'A carefully arranged note contains practical text, measured spacing and clear document links. It should remain responsive while editing and arranging objects.';
const html = Array.from(
  { length: 32 },
  (_, i) => '<p>' + paragraph + ' ' + String(i).padStart(2, '0') + '.</p>',
).join('');
const frames = [];
for (let i = 0; i < 3; i++) {
  const page = i ? addPage(doc, doc.pages.at(-1).id) : doc.pages[0];
  frames.push(
    insertObject(doc, 'text', page.id, {
      x: 45,
      y: 45,
      w: 520,
      h: 660,
      fontSize: 16,
      leading: 20,
      textStyle: 'cmu-serif',
      html: i ? '' : html,
    }),
  );
}
const flow = startTextFlow(doc, frames[0].id, { automaticPages: false });
for (let i = 1; i < frames.length; i++) threadFrame(doc, frames[i - 1].id, frames[i].id);
const composer = process.env.IVO_RESPONSIVENESS_COMPOSER || 'paragraph';
assert.ok(['browser', 'paragraph', 'single-line'].includes(composer));
if (composer !== 'browser') enableNativeComposition(doc, flow, composer);
for (let i = 0; i < 30; i++)
  insertObject(doc, 'polygon', doc.pages[0].id, {
    x: 40 + (i % 10) * 45,
    y: 710 + Math.floor(i / 10) * 15,
    w: 30,
    h: 10,
  });
markTypographyVersion(doc);
const vault = await openVault(process.env.IVO_ATLAS_DIR);
await vault.saveImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 260; i++) {
    const value = await check();
    if (value) return value;
    await pause(25);
  }
  throw Error('Timed out waiting for ' + label);
}
function stats(values) {
  const times = values.map((v) => v.ms).sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return {
    median: (times[mid] + times[(times.length - 1) >> 1]) / 2,
    p95: times[Math.ceil(times.length * 0.95) - 1],
    min: times[0],
    max: times.at(-1),
    samples: values,
  };
}
void (async () => {
  let exitCode = 1,
    samples;
  try {
    await import('../../../desktop/main.mjs');
    const win = await until(
      () =>
        BrowserWindow.getAllWindows().find(
          (w) =>
            w.webContents.getURL().startsWith('ivo://app/index.html') &&
            !w.webContents.getURL().includes('#vault-manager'),
        ),
      'production window',
    );
    const wc = win.webContents,
      execute = (s) => wc.executeJavaScript(s, true);
    await until(() => execute("!!document.querySelector('.workspace-pane')"), 'workspace');
    await until(() => execute('ivoNative.windows.info().then(s=>s.active)'), 'vault writer');
    wc.send('ivo:command', 'toggle-edit');
    await until(
      () =>
        execute(
          composer === 'browser'
            ? "!!document.querySelector('.scene-editing [data-flow-text]')"
            : "!!document.querySelector('.scene-editing svg[data-composed-text] use')",
        ),
      'composed edit view',
    );
    await execute(`document.querySelector('[data-canvas-panel="layers"]').click()`);
    await execute(
      `document.querySelector('[data-layer-disclosure][aria-expanded="false"]:enabled').click()`,
    );
    const viewport = await execute('({width:innerWidth,height:innerHeight})');
    samples = observeRenderedActions(wc, viewport);
    const rect = (selector) =>
      execute(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
      );
    const lockSelector = `[data-object-toggle="locked"][data-object-id="${doc.blocks.at(-1).id}"]`;
    await execute(
      `document.querySelector(${JSON.stringify(lockSelector)}).scrollIntoView({block:'nearest'})`,
    );
    const lock = await rect(lockSelector),
      click = (point, count = 1) => {
        for (const type of ['mouseDown', 'mouseUp'])
          wc.sendInputEvent({ type, ...point, button: 'left', clickCount: count });
      };
    const point = {
      x: Math.round(lock.x + lock.width / 2),
      y: Math.round(lock.y + lock.height / 2),
    };
    wc.sendInputEvent({ type: 'mouseMove', ...point });
    await pause(160);
    const locks = [],
      unlocks = [],
      typed = [],
      deleted = [];
    for (let i = 0; i < 16; i++) {
      const result = await samples.measure(lock, () => click(point));
      (i % 2 ? unlocks : locks).push(result);
      assert.equal(
        await execute(
          `document.querySelector(${JSON.stringify(lockSelector)}).getAttribute('aria-label')`,
        ),
        i % 2 ? 'Lock object' : 'Unlock object',
      );
    }
    // A held press previews the outcome, and release outside the button cancels it.
    const buttonState = () =>
      execute(
        `(()=>{const b=document.querySelector(${JSON.stringify(lockSelector)});return {locked:b.getAttribute('aria-pressed'),closed:getComputedStyle(b.querySelector('.layer-lock-closed')).display!=='none'}})()`,
      );
    wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    await until(async () => {
      const s = await buttonState();
      return s.closed && s.locked === 'false';
    }, 'lock feedback before release');
    const away = { x: point.x - 28, y: point.y };
    wc.sendInputEvent({
      type: 'mouseMove',
      ...away,
      button: 'left',
      modifiers: ['leftButtonDown'],
    });
    wc.sendInputEvent({ type: 'mouseUp', ...away, button: 'left', clickCount: 1 });
    await until(async () => {
      const s = await buttonState();
      return s.locked === 'false' && !s.closed;
    }, 'canceled lock press');
    const glyphRect = async (offset) => {
      if (composer !== 'browser')
        return rect(`[data-line-start="0"] use[data-glyph-offset="${offset}"]`);
      return execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),element=input?.isContentEditable?input:document.querySelector('[data-flow-text]'),walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=document.createRange();range.setStart(node,${offset});range.setEnd(node,${offset + 1});const r=range.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`,
      );
    };
    const glyph = await glyphRect(5);
    const textPoint = {
      x: Math.round(glyph.x + glyph.width / 2),
      y: Math.round(glyph.y + glyph.height / 2),
    };
    wc.sendInputEvent({ type: 'mouseMove', ...textPoint });
    click(textPoint);
    click(textPoint, 2);
    await until(
      () =>
        execute(
          "document.querySelector('.canvas-flow-input')?.isContentEditable && document.activeElement===document.querySelector('.canvas-flow-input')",
        ),
      'editable text',
    );
    async function caret(offset) {
      await execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),walker=document.createTreeWalker(input,NodeFilter.SHOW_TEXT),node=walker.nextNode();getSelection().collapse(node,${offset});})()`,
      );
      await pause(70);
    }
    await caret(5);
    const ink = await glyphRect(8);
    const inkRegion = { ...ink, width: 190 };
    for (const letter of 'modification')
      typed.push(await samples.measure(inkRegion, () => wc.insertText(letter)));
    await caret(50);
    const first = await glyphRect(0);
    const deletionRegion = { x: first.x + 20, y: first.y, width: 400, height: 72 };
    for (let i = 0; i < 12; i++) {
      deleted.push(
        await samples.measure(deletionRegion, () => {
          for (const type of ['keyDown', 'keyUp'])
            wc.sendInputEvent({ type, keyCode: 'Backspace' });
        }),
      );
    }
    // Wait for the real autosave and compare exact text, including the edited middle.
    const inserted = paragraph.slice(0, 5) + 'modification' + paragraph.slice(5);
    const expected = inserted.slice(0, 38) + inserted.slice(50);
    const savedText = async () => {
      const disk = await openVault(process.env.IVO_ATLAS_DIR);
      const data = (await disk.loadDocuments())[0].textFlows[0].html;
      return execute(
        `new DOMParser().parseFromString(${JSON.stringify(data)},'text/html').body.textContent`,
      );
    };
    const editedText = await execute("document.querySelector('.canvas-flow-input').textContent");
    assert.ok(
      editedText.includes(expected),
      JSON.stringify({ edited: editedText.slice(0, 200), expected }),
    );
    await until(async () => (await savedText()) === editedText, 'exact persisted edits');
    const beforeBurst = await execute("document.querySelector('.canvas-flow-input').textContent");
    await caret(5);
    for (const c of 'rapidinput') await wc.insertText(c);
    const savedBurst = beforeBurst.slice(0, 5) + 'rapidinput' + beforeBurst.slice(5);
    await until(
      () =>
        execute("document.querySelector('.canvas-flow-input').textContent").then(
          (text) => text === savedBurst,
        ),
      'complete burst input',
    );
    if (composer !== 'browser')
      await until(
        () =>
          execute(
            "[...document.querySelectorAll('svg[data-composed-text]')].map(e=>e.getAttribute('aria-label')).join('').includes('rapidinput')",
          ),
        'painted burst',
      );
    await until(async () => (await savedText()) === savedBurst, 'persisted burst');
    let pageEnd;
    if (composer === 'paragraph') {
      await execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),walker=document.createTreeWalker(input,NodeFilter.SHOW_TEXT);let last,node;while((node=walker.nextNode()))last=node;getSelection().collapse(last,last.length);})()`,
      );
      await pause(160);
      await wc.insertText('x');
      const lastGlyph = () =>
        execute(
          `(()=>{const cols=[...document.querySelectorAll('[data-flow-frame] svg[data-composed-text]')];const col=cols.at(-1);if(!col?.getAttribute('aria-label')?.trimEnd().endsWith('x'))return null;const r=[...col.querySelectorAll('use')].at(-1).getBoundingClientRect();return {x:r.x+1,y:r.y,width:Math.max(2,r.width-2),height:r.height};})()`,
        );
      const endRegion = await until(lastGlyph, 'visible last-page glyph');
      const insert = [],
        backspace = [];
      for (let i = 0; i < 6; i++) {
        backspace.push(
          await samples.measure(endRegion, () => {
            for (const type of ['keyDown', 'keyUp'])
              wc.sendInputEvent({ type, keyCode: 'Backspace' });
          }),
        );
        insert.push(await samples.measure(endRegion, () => wc.insertText('x')));
      }
      await until(async () => (await savedText()) === savedBurst + 'x', 'final page persisted');
      pageEnd = { insert: stats(insert), backspace: stats(backspace) };
    }
    const report = {
      composer,
      pages: 3,
      objects: doc.blocks.length,
      characters: flow.html.replace(/<[^>]+>/g, '').length,
      lock: stats(locks),
      unlock: stats(unlocks),
      insert: stats(typed),
      backspace: stats(deleted),
      burst: true,
      pageEnd,
    };
    console.log(JSON.stringify(report, null, 2));
    // Reference Mac budgets apply to typical input-to-compositor feedback.
    // Keep every sample so occasional slow frames remain visible.
    if (process.env.IVO_LATENCY_BUDGET === '1') {
      for (const action of ['lock', 'unlock'])
        assert.ok(report[action].median <= 25, action + ' exceeded 25 ms median');
      for (const action of ['insert', 'backspace']) {
        assert.ok(report[action].median <= 80, action + ' exceeded 80 ms median');
        if (pageEnd)
          assert.ok(pageEnd[action].median <= 65, 'Page-end ' + action + ' exceeded 65 ms median');
      }
    }
    exitCode = 0;
  } catch (error) {
    console.error(error.stack);
  } finally {
    samples?.close();
    app.removeAllListeners('window-all-closed');
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(exitCode);
  }
})();
