import { app, BrowserWindow, screen } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { addMagazineCredits, mastheadText } from './magazine.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'ivo-window-responsiveness-'));
process.env.IVO_USER_DATA_DIR = path.join(directory, 'Profile');
process.env.IVO_ATLAS_DIR = path.join(directory, 'Vault');
app.setPath('userData', process.env.IVO_USER_DATA_DIR);
const scene = process.env.IVO_RESPONSIVENESS_SCENE || 'linked';
assert.ok(['linked', 'magazine', 'formatted'].includes(scene));
const magazine = scene === 'magazine';
const doc = createSceneDocument('Disposable responsiveness test', { width: 612, height: 792 });
enablePublishing(doc);
const paragraph =
  'A carefully arranged note contains practical text, measured spacing and clear document links. It should remain responsive while editing and arranging objects.';
const html = magazine
  ? mastheadText()
  : Array.from({ length: 32 }, (_, i) => {
      let run = paragraph + ' ' + String(i).padStart(2, '0') + '.';
      if (scene === 'formatted') {
        for (let j = 0; j < 40; j++) {
          const tag = ['liga', 'smcp', 'onum', 'dlig', 'salt'][j % 5];
          run = `<span data-ivo-${tag}="${j % 2 === 0}">${run}</span>`;
        }
      }
      return '<p>' + run + '</p>';
    }).join('');
const frames = [];
for (let i = 0; i < (magazine ? 1 : 3); i++) {
  const page = i ? addPage(doc, doc.pages.at(-1).id) : doc.pages[0];
  frames.push(
    insertObject(doc, 'text', page.id, {
      x: 45,
      y: 45,
      w: 520,
      h: magazine ? 300 : 660,
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
const panel = process.env.IVO_RESPONSIVENESS_PANEL || 'properties';
assert.ok(['properties', 'detached-properties', 'layers'].includes(panel));
if (composer !== 'browser') enableNativeComposition(doc, flow, composer);
if (magazine) {
  assert.equal(composer, 'paragraph');
  addMagazineCredits(doc, composer);
}
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
const otherFlows = (document) => document.textFlows.filter((item) => item.id !== flow.id);
const originalCredits = magazine ? otherFlows((await vault.loadDocuments())[0]) : null;
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
    samples,
    report;
  const reportPath = process.env.IVO_RESPONSIVENESS_REPORT;
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
      execute = (s) =>
        wc.executeJavaScript(s, true).catch((error) => {
          throw new Error(s.slice(0, 240) + '\n' + error.message, { cause: error });
        });
    async function focusDocument() {
      let nextAttempt = 0;
      await until(async () => {
        if (
          (process.platform !== 'darwin' || app.isActive()) &&
          win.isFocused() &&
          (await execute('document.hasFocus()'))
        )
          return true;
        if (performance.now() >= nextAttempt) {
          app.focus({ steal: true });
          win.show();
          win.focus();
          wc.focus();
          nextAttempt = performance.now() + 500;
        }
        return false;
      }, 'keyboard focus on document');
    }
    await until(() => execute("!!document.querySelector('.workspace-pane')"), 'workspace');
    await until(() => execute('ivoNative.windows.info().then(s=>s.active)'), 'vault writer');
    await focusDocument();
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
    if (magazine) {
      await until(
        () =>
          execute(
            "document.querySelectorAll('[data-flow-frame] svg[data-composed-text]').length === 72",
          ),
        'all 72 composed frames',
      );
    }
    // The compact desktop layout initially hides its inspector. Open it via the
    // Window menu before measuring, so coordinates belong to an actual control.
    wc.send('ivo:command', 'show-panel-layers');
    await until(
      () => execute("!!document.querySelector('[data-layer-disclosure]')?.getClientRects().length"),
      'Layers panel on screen',
    );
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
    assert.ok(
      await execute(
        `document.querySelector(${JSON.stringify(lockSelector)}).contains(document.elementFromPoint(${point.x}, ${point.y}))`,
      ),
      'The lock control must receive pointer input at its measured position',
    );
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
    if (panel === 'properties') {
      await execute(`document.querySelector('[data-canvas-panel="properties"]').click()`);
    } else if (panel === 'detached-properties') {
      await focusDocument();
      assert.equal(await execute("ivoNative.palettes.open('properties')"), true);
      const inspector = await until(
        () =>
          BrowserWindow.getAllWindows().find((item) =>
            item.webContents.getURL().startsWith('ivo://app/palette.html'),
          ),
        'floating Properties window',
      );
      await until(
        () =>
          inspector.isVisible() &&
          !inspector.webContents.isLoading() &&
          inspector.webContents.executeJavaScript(
            "!!document.querySelector('[data-palette-control]')",
          ),
        'floating Properties controls',
      ).catch(async (error) => {
        console.error('Floating Properties state', {
          appActive: process.platform === 'darwin' ? app.isActive() : null,
          visible: inspector.isVisible(),
          ownerFocused: win.isFocused(),
          editor: await execute("document.querySelector('.scene-editor')?.className"),
          view: await inspector.webContents.executeJavaScript(
            "ivoPalette.initial().then(p=>[p?.kind,!!p?.view,document.querySelector('[data-palette-context]')?.textContent])",
          ),
        });
        throw error;
      });
      await focusDocument();
    }
    function typeKey(letter) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: letter });
      wc.sendInputEvent({ type: 'char', keyCode: letter });
      wc.sendInputEvent({ type: 'keyUp', keyCode: letter });
    }
    const activeInk = `[data-flow-frame="${frames[0].id}"] [data-line-start="0"]`;
    const glyphRect = async (offset) => {
      if (composer !== 'browser') return rect(`${activeInk} use[data-glyph-offset="${offset}"]`);
      return execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),element=input?.isContentEditable?input:document.querySelector('[data-flow-text]'),walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=document.createRange();range.setStart(node,${offset});range.setEnd(node,${offset + 1});const r=range.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`,
      );
    };
    // Undocking changes the center viewport while focus moves back from the
    // panel. Address the glyph after the document owns input at its new position.
    let priorGlyph;
    const glyph = await until(async () => {
      const next = await glyphRect(5);
      const stable =
        priorGlyph && ['x', 'y', 'width', 'height'].every((k) => next[k] === priorGlyph[k]);
      priorGlyph = next;
      if (!stable || !next.width || !next.height) return null;
      const onFrame = await execute(
        `document.elementFromPoint(${next.x + next.width / 2},${next.y + next.height / 2})?.closest('[data-flow-frame]')?.dataset.flowFrame === ${JSON.stringify(frames[0].id)} && !document.querySelector('.canvas-viewport').closest('[inert]')`,
      );
      return onFrame && next;
    }, 'clickable glyph in the settled document');
    await focusDocument();
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
    ).catch(async (error) => {
      console.error('Text focus after click', {
        appActive: process.platform === 'darwin' ? app.isActive() : null,
        ownerFocused: win.isFocused(),
        editor: await execute(
          `({focus:document.activeElement?.className,input:document.querySelector('.canvas-flow-input')?.isContentEditable,target:document.elementFromPoint(${textPoint.x},${textPoint.y})?.closest('[data-flow-frame]')?.dataset.flowFrame, intended:${JSON.stringify(frames[0].id)}})`,
        ),
      });
      throw error;
    });
    async function caret(offset) {
      await execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),walker=document.createTreeWalker(input,NodeFilter.SHOW_TEXT);
          let node, remaining=${offset};while ((node=walker.nextNode())) {
            if(remaining<=node.length){getSelection().collapse(node,remaining);return;} remaining-=node.length;
          }throw Error('Missing text offset');})()`,
      );
      await pause(70);
    }
    await caret(5);
    if (magazine)
      await execute(`window.untouchedCredits = [...document.querySelectorAll('[data-flow-frame]')]
        .filter(node => node.dataset.flowFrame !== ${JSON.stringify(frames[0].id)})
        .map(node => ({node:node.querySelector('svg'), frame:node, label:node.querySelector('svg').getAttribute('aria-label'),
          token:node.querySelector('svg').dataset.compositionToken}));`);
    const original = await execute("document.querySelector('.canvas-flow-input').textContent");
    if (scene === 'formatted') {
      assert.equal(composer, 'browser');
      assert.ok(
        await execute(
          "document.querySelector('.canvas-flow-input').querySelectorAll('[data-ivo-salt]').length === 32",
        ),
        'Old feature edits compact to one effective run per paragraph',
      );
    }
    const ink = await glyphRect(8);
    const inkRegion = { ...ink, width: 190 };
    // At least twenty observations distinguish the nearest-rank p95 from a
    // single worst-case compositor callback. Keep the maximum in the report.
    const typedWord = 'modificationtypographics';
    for (const letter of typedWord)
      typed.push(
        await samples.measure(
          inkRegion,
          () => typeKey(letter),
          'Insert ' + letter + ' at ' + (5 + typed.length),
        ),
      );
    // Leave a sentinel after the measured word. Each deletion now removes a
    // visible letter and creates a source never seen during the insert trials.
    typeKey('z');
    const marked = original.slice(0, 5) + typedWord + 'z' + original.slice(5);
    await until(
      async () =>
        (await execute("document.querySelector('.canvas-flow-input').textContent")) === marked,
      'independent deletion source',
    );
    await caret(5 + typedWord.length);
    const first = await glyphRect(0);
    const deletionRegion = { x: first.x + 20, y: first.y, width: 400, height: 72 };
    for (let i = 0; i < typedWord.length; i++) {
      deleted.push(
        await samples.measure(
          deletionRegion,
          () => {
            for (const type of ['keyDown', 'keyUp'])
              wc.sendInputEvent({ type, keyCode: 'Backspace' });
          },
          'Delete ' + typedWord.at(-i - 1) + ' at ' + (5 + typedWord.length - i),
        ),
      );
    }
    // Wait for the real autosave and compare exact text, including the edited middle.
    const expected = original.slice(0, 5) + 'z' + original.slice(5);
    const savedText = async () => {
      const disk = await openVault(process.env.IVO_ATLAS_DIR);
      const data = (await disk.loadDocuments())[0].textFlows[0].html;
      return execute(
        `new DOMParser().parseFromString(${JSON.stringify(data)},'text/html').body.textContent`,
      );
    };
    const editedText = await execute("document.querySelector('.canvas-flow-input').textContent");
    assert.equal(editedText, expected, 'Every individual key edited the expected source offset');
    await until(async () => (await savedText()) === editedText, 'exact persisted edits');
    const beforeBurst = await execute("document.querySelector('.canvas-flow-input').textContent");
    await caret(5);
    const word = 'rapidinputswatch';
    if (composer !== 'browser') {
      // Check the actual published vector-column text for each intermediate
      // plan. Each displayed sequence must be an exact prefix of these edits.
      const prefixes = Array.from({ length: word.length + 1 }, (_, i) =>
        (beforeBurst.slice(0, 5) + word.slice(0, i) + beforeBurst.slice(5)).slice(0, 90),
      );
      await execute(`(() => {
        const column = document.querySelector('[data-flow-frame] svg[data-composed-text]');
        const expected = ${JSON.stringify(prefixes)};
        const seen = [];
        const read = () => seen.push(expected.indexOf(column.getAttribute('aria-label').slice(0, 90)));
        const observer = new MutationObserver(read);
        observer.observe(column, {attributes: true, attributeFilter:['aria-label']});
        read();
        window.finishBurstCheck = () => { observer.disconnect(); read(); return seen; };
      })()`);
    }
    const burstGlyph =
      composer === 'browser'
        ? await glyphRect(32)
        : await execute(`
      (() => {
        const glyph = [...document.querySelectorAll(${JSON.stringify(activeInk + ' use')})]
          .find((node) => Number(node.dataset.glyphOffset) >= 28);
        const r = glyph.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height};
      })()`);
    const burst = await samples.measureBurst({ ...burstGlyph, width: 100 }, word, typeKey, 24);
    const savedBurst = beforeBurst.slice(0, 5) + word + beforeBurst.slice(5);
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
            `[...document.querySelectorAll('[data-flow-frame] svg[data-composed-text]')].map(e=>e.getAttribute('aria-label')).join('').startsWith(${JSON.stringify(savedBurst.slice(0, 90))})`,
          ),
        'painted burst',
      );
    if (composer !== 'browser') {
      const shown = await execute('window.finishBurstCheck()');
      assert.equal(shown[0], 0);
      assert.equal(shown.at(-1), word.length);
      assert.ok(
        shown.every((n, i) => n >= 0 && (!i || n >= shown[i - 1])),
        'An intermediate native column showed incorrect text or moved backwards',
      );
    }
    await until(async () => (await savedText()) === savedBurst, 'persisted burst');
    let pageEnd;
    if (composer === 'paragraph' && !magazine) {
      await execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),walker=document.createTreeWalker(input,NodeFilter.SHOW_TEXT);let last,node;while((node=walker.nextNode()))last=node;getSelection().collapse(last,last.length);})()`,
      );
      await pause(160);
      typeKey('x');
      const lastGlyph = () =>
        execute(
          `(()=>{const cols=[...document.querySelectorAll('[data-flow-frame] svg[data-composed-text]')];const col=cols.at(-1);if(!col?.getAttribute('aria-label')?.trimEnd().endsWith('x'))return null;const r=[...col.querySelectorAll('use')].at(-1).getBoundingClientRect();return {x:r.x+1,y:r.y,width:Math.max(2,r.width-2),height:r.height};})()`,
        );
      // Layout can publish its final-page glyph before the window has painted
      // the warm-up edit or finished following the caret onto that page.
      const endRegion = await until(async () => {
        const first = await lastGlyph();
        if (!first || !(await samples.containsInk(first))) return null;
        const current = await lastGlyph();
        return current && JSON.stringify(first) === JSON.stringify(current) ? current : null;
      }, 'painted last-page glyph at its final position').catch(async (error) => {
        const image = await wc.capturePage();
        if (process.env.IVO_RESPONSIVENESS_CAPTURE)
          await writeFile(process.env.IVO_RESPONSIVENESS_CAPTURE, image.toPNG());
        console.error('Last-page capture', {
          viewport,
          window: win.getBounds(),
          capture: image.getSize(),
          display: screen.getDisplayMatching(win.getBounds()).bounds,
          glyph: await lastGlyph(),
          layout: await execute(`(() => {
            const bounds = s => document.querySelector(s)?.getBoundingClientRect().toJSON();
            const input = document.querySelector('.canvas-flow-input');
            return { surface:bounds('.canvas-viewport'), caret:bounds('[data-native-selection="caret"]'),
              frame:input?.dataset.sceneText, sourceLength:input?.textContent.length,
              columns:[...document.querySelectorAll('[data-flow-frame] svg[data-composed-text]')].map(e=>[e.closest('[data-flow-frame]').dataset.flowFrame,e.getAttribute('aria-label')?.slice(-12),e.getBoundingClientRect().top]) };
          })()`),
        });
        throw error;
      });
      const insert = [],
        backspace = [];
      for (let i = 0; i < 6; i++) {
        backspace.push(
          await samples.measure(endRegion, () => {
            for (const type of ['keyDown', 'keyUp'])
              wc.sendInputEvent({ type, keyCode: 'Backspace' });
          }),
        );
        insert.push(await samples.measure(endRegion, () => typeKey('x')));
      }
      await until(async () => (await savedText()) === savedBurst + 'x', 'final page persisted');
      pageEnd = { insert: stats(insert), backspace: stats(backspace) };
    }
    if (magazine) {
      assert.equal(
        await execute(`window.untouchedCredits.filter(({node,frame,label,token}) =>
        node.isConnected && frame.querySelector('svg') === node && node.getAttribute('aria-label') === label &&
        node.dataset.compositionToken === token).length`),
        71,
        'Unedited credits retained their native ink',
      );
      const [saved] = await (await openVault(process.env.IVO_ATLAS_DIR)).loadDocuments();
      assert.deepEqual(otherFlows(saved), originalCredits, 'Independent saved sources');
    }
    report = {
      composer,
      panel,
      scene,
      flows: doc.textFlows.length,
      pages: doc.pages.length,
      objects: doc.blocks.length,
      characters: flow.html.replace(/<[^>]+>/g, '').length,
      lock: stats(locks),
      unlock: stats(unlocks),
      insert: stats(typed),
      backspace: stats(deleted),
      burst,
      pageEnd,
    };
    if (process.env.IVO_LATENCY_BUDGET === '1') {
      const check = (label, result, median, p95) => {
        assert.ok(
          result.samples.every((v) => !v.upperBoundOnly),
          label + ' did not yield a first matching rendered frame for every input',
        );
        assert.ok(result.median <= median, label + ' exceeded ' + median + ' ms median');
        assert.ok(result.p95 <= p95, label + ' exceeded ' + p95 + ' ms p95');
      };
      for (const action of ['lock', 'unlock']) check(action, report[action], 25, 65);
      const [median, p95] = { browser: [35, 70], 'single-line': [65, 115], paragraph: [80, 120] }[
        composer
      ];
      for (const action of ['insert', 'backspace']) {
        check(action, report[action], median, p95);
        if (pageEnd) check('Page-end ' + action, pageEnd[action], 65, 100);
      }
      if (magazine)
        assert.ok(
          report.insert.samples[0].ms <= 135,
          'First magazine edit after using Layers exceeded 135 ms',
        );
      assert.ok(burst.whileTyping >= 2, 'Glyphs must advance during sustained typing');
      const gap = composer === 'browser' ? 90 : 135;
      assert.ok(
        burst.longestPause <= gap && burst.finish <= gap,
        'Sustained typing exceeded ' + gap + ' ms between visible changes or to final ink',
      );
    }
    exitCode = 0;
  } catch (error) {
    console.error(error.stack);
    report = { ...report, composer, panel, scene, error: error.message };
  } finally {
    samples?.close();
    const json = JSON.stringify({ ...report, passed: exitCode === 0 }, null, 2) + '\n';
    console.log(json);
    if (reportPath) {
      try {
        await writeFile(reportPath, json);
      } catch (error) {
        console.error(error);
        exitCode = 1;
      }
    }
    app.removeAllListeners('window-all-closed');
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(exitCode);
  }
})();
