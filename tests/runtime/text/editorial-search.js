import {
  changeTextMatches,
  findTextMatches,
  plannedReplacement,
} from '../../../src/features/editor/text/find-change.js';
import { createFindChangePanel } from '../../../src/features/editor/ui/find-change-panel.js';

function assert(value, message) {
  if (!value) throw new Error('Editorial search: ' + message);
}
const documentWith = (html) => ({
  id: 'flow',
  html,
  frames: [{ id: 'frame' }],
  doc: {},
  defaults: {},
});
const search = (owners, query, selection) =>
  findTextMatches(
    owners,
    { mode: 'grep', caseSensitive: true, ...query },
    selection,
    new AbortController().signal,
  );

export async function verifyEditorialSearch() {
  const owner = documentWith(
    '<p><em>Áda</em> <a data-doc-id="link">García</a></p><p>Другой<br>ряд</p>',
  );
  const find = (needle, options) => search([owner], { needle, ...options });
  const matches = await find(String.raw`(\w+) (\w+)`);
  const edit = (matches, template, format) =>
    changeTextMatches(
      owner.html,
      matches.map((m) => plannedReplacement(m, template, format)),
      undefined,
      format,
      owner,
    );
  const root = document.createElement('div');
  root.innerHTML = edit(matches, '$2, $1');
  assert(
    root.firstChild.textContent === 'García, Áda' &&
      root.querySelector('a').textContent === 'García' &&
      root.querySelector('em').textContent === 'Áda',
    'capture reordering moves links and italics with their words: ' + root.innerHTML,
  );
  const prefix = await find('^');
  root.innerHTML = edit(prefix, '• ');
  assert(
    root.children.length === 2 && [...root.children].every((p) => p.textContent.startsWith('• ')),
    'one zero-width insertion per paragraph',
  );
  root.innerHTML = edit(await find(String.raw`\n`), String.raw`\r`);
  assert(
    root.children.length === 3 && root.lastChild.textContent === 'ряд' && !root.querySelector('br'),
    'forced break becomes a paragraph',
  );
  root.innerHTML = edit(await find(String.raw`(García\rДругой)`), '[$1]');
  assert(
    root.children.length === 2 &&
      root.children[0].textContent.endsWith('[García') &&
      root.children[1].textContent.startsWith('Другой]') &&
      root.querySelector('br'),
    'captured paragraph break retains both paragraphs',
  );
  root.innerHTML = edit(await find('Áda', { findFormat: 'italic' }), '', 'underline');
  assert(
    root.querySelector('em [data-ivo-underline="true"]').textContent === 'Áda',
    'format-only change keeps source markup',
  );
  assert(
    !(await find('Áda García', { findFormat: 'italic' })).length,
    'all characters must match the find format',
  );
  const clipped = await search(
    [owner],
    { findFormat: 'italic' },
    { id: 'flow', searchStart: 1, searchEnd: 3 },
  );
  assert(
    clipped.length === 1 && clipped[0].text === 'da',
    'format only respects partial text selection',
  );
  const inherited = {
    ...documentWith('<p>a<span data-ivo-italic="false">b</span>c</p>'),
    defaults: { italic: true },
  };
  assert(
    (await search([inherited], { findFormat: 'italic' })).map((m) => m.text).join('/') === 'a/c',
    'frame defaults and explicit regular runs agree with inspector',
  );
  const named = documentWith(
    '<p data-ivo-pstyle="caption">A <a data-doc-id="ref"><span data-ivo-cstyle="credit">credit</span></a></p>',
  );
  named.doc.publishing = {
    paragraphStyles: [{ id: 'caption', name: 'Caption', attributes: { italic: true } }],
    characterStyles: [
      { id: 'credit', name: 'Credit', attributes: { bold: true } },
      { id: 'brand', name: 'Brand', attributes: { underline: true } },
    ],
  };
  assert(
    (await search([named], { findFormat: 'paragraphStyle/caption' }))[0].text === 'A credit',
    'named paragraph filter covers its inline runs',
  );
  const credit = (await search([named], { findFormat: 'characterStyle/credit' }))[0];
  const change = plannedReplacement(credit, '', 'characterStyle/brand');
  const updated = {
    ...named,
    html: changeTextMatches(named.html, [change], undefined, 'characterStyle/brand', named),
  };
  assert(
    (await search([updated], { findFormat: 'characterStyle/brand' }))[0].text === 'credit' &&
      updated.html.includes('data-doc-id="ref"'),
    'character style replacement is live and retains the document link',
  );
  const at = matches[0].end - 'García'.length;
  assert(
    !(
      await search([{ ...owner, regions: [{ start: at, end: matches[0].end }] }], {
        needle: '(?<=(Áda) )García',
      })
    ).length,
    'a capture in locked text cannot be copied',
  );

  const host = document.createElement('div');
  document.body.append(host);
  const model = documentWith('<p>Cost 20</p><p>Cost 90</p>');
  const previous = [];
  const ui = createFindChangePanel({
    host,
    context: () => ({}),
    sources: () => [model].map((o) => ({ ...o })),
    allowed: () => true,
    reveal() {},
    finished() {},
    change(changes) {
      previous.push(model.html);
      model.html = changes[0].html;
    },
  });
  try {
    ui.open();
    const panel = () => host.querySelector('form');
    const control = (name) => panel().elements.namedItem(name);
    const set = (name, value) => {
      control(name).value = value;
      control(name).dispatchEvent(new Event('input', { bubbles: true }));
    };
    const action = (name) =>
      panel()
        .querySelector('[data-find-action="' + name + '"]')
        .click();
    const status = () => panel().querySelector('output').value;
    const settled = async () => {
      const stop = performance.now() + 4200;
      while (panel().hasAttribute('aria-busy') && performance.now() < stop)
        await new Promise((r) => setTimeout(r, 12));
      assert(!panel().hasAttribute('aria-busy'), 'search settles');
    };
    function insertCharacter(name, token) {
      const menu = panel().querySelector('[data-find-characters="' + name + '"]');
      menu.value = token;
      assert(menu.value === token, 'missing character option ' + token);
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const original = model.html;
    model.html = '<p><em>Cut</em><br>and\u00a0sew</p>';
    set('needle', 'Cut?and');
    control('needle').setSelectionRange(3, 4);
    insertCharacter('needle', '^n');
    assert(
      control('needle').value === 'Cut^nand' && control('needle').selectionStart === 5,
      'insertion replaces the selected range and returns the caret',
    );
    set('replacement', 'Cut');
    insertCharacter('replacement', '^p');
    action('all');
    assert(
      model.html.includes('</p><p>') &&
        !model.html.includes('<br>') &&
        model.html.includes('<em>Cut</em>'),
      'Text menu creates a real paragraph and retains emphasis: ' + model.html,
    );
    panel().querySelector('[data-find-mode="grep"]').click();
    set('needle', '');
    insertCharacter('needle', '~s');
    set('replacement', '');
    insertCharacter('replacement', '~_');
    action('all');
    await settled();
    assert(model.html.includes('—sew'), 'GREP menu replaces the nonbreaking space with an em dash');
    previous.length = 0;
    model.html = original;
    set('needle', '^');
    action('next');
    await settled();
    assert(status() === '1 of 2', status());
    action('next');
    await settled();
    assert(status() === '2 of 2', 'forward empty-hit progress');
    set('direction', 'backward');
    action('next');
    await settled();
    assert(status() === '1 of 2', 'backward empty-hit progress');
    set('needle', String.raw`Cost (\d+)`);
    set('replacement', '$$$1');
    control('save-query').click();
    set('query-name', 'Editorial fixture');
    control('confirm-query').click();
    assert(status() === 'Query saved.', status());
    ui.close();
    ui.open();
    control('query').value = 'Saved queries/Editorial fixture';
    control('query').dispatchEvent(new Event('change'));
    assert(
      control('needle').value === String.raw`Cost (\d+)` && control('replacement').value === '$$$1',
      'saved query restores captures and substitution',
    );
    action('all');
    await settled();
    assert(
      previous.length === 1 && model.html === '<p>$20</p><p>$90</p>',
      'bulk changes form one edit: ' + status() + ' ' + model.html,
    );
    set('needle', '[');
    action('all');
    await settled();
    assert(previous.length === 1 && status() !== 'Searching…', 'invalid pattern cannot edit');
    set('needle', '20');
    set('replacement', 'twenty');
    action('all');
    model.html = '<p>New text</p>';
    await settled();
    assert(
      previous.length === 1 && status().includes('changed during'),
      'stale worker cannot overwrite other edits',
    );
    model.html = '<p>' + 'a'.repeat(10000) + '!</p>';
    set('needle', '(a+)+$');
    action('all');
    await new Promise((r) => setTimeout(r, 20));
    assert(panel().hasAttribute('aria-busy'), 'editor remains responsive while matching');
    set('needle', '!');
    action('next');
    await settled();
    assert(status() === '1 of 1', 'new search cancels slow pattern');
    set('needle', '(a+)+$');
    action('all');
    await settled();
    assert(
      status().includes('timed out') && previous.length === 1,
      'bounded worker timeout works without an edit',
    );
    control('query').value = 'Saved queries/Editorial fixture';
    control('query').dispatchEvent(new Event('change'));
    control('delete-query').click();
    ui.close();
    ui.open();
    assert(
      ![...control('query').options].some((o) => o.text === 'Editorial fixture'),
      'deleted preference stays deleted',
    );
  } finally {
    ui.close();
    host.remove();
  }
}
