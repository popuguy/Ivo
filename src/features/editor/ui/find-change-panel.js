import { findTextMatches, applyTextChanges, plannedReplacement } from '../text/find-change.js';

import { findFormats, namedFormats } from '../text/find-format.js';
import { installFindQueries } from './find-queries.js';
import { findCharacters } from '../text/find-characters.js';

/** The scope belongs to the text selection at dialog entry, even as Find Next moves the caret. */
export function createFindChangePanel({
  host,
  context,
  sources,
  reveal,
  change,
  allowed,
  finished,
}) {
  let panel,
    origin,
    hit,
    cursor,
    cache,
    lastSettings,
    resetQuery,
    pending,
    mode = 'text';
  const field = (name) => panel.elements.namedItem(name);
  const button = (name) => panel.querySelector('[data-find-action="' + name + '"]');
  function close(returnFocus = false) {
    if (!panel) return;
    lastSettings = settings();
    cancel();
    panel.remove();
    panel = null;
    cache = null;
    finished(returnFocus);
  }
  const report = (message) => {
    panel.querySelector('output').textContent = message;
  };
  function selectFormat(name, key, styleName) {
    const select = field(name);
    select.value = key || '';
    if (!key || select.value) return;
    const kind = key.split('/')[0] + '/';
    const candidates = [...select.options].filter(
      (o) => o.value.startsWith(kind) && o.text === styleName,
    );
    if (candidates.length === 1) select.value = candidates[0].value;
    else {
      const missing = new Option('Unavailable · ' + (styleName || key), key);
      missing.disabled = true;
      select.add(missing);
      select.value = key;
    }
  }
  function settings() {
    return {
      mode,
      findStyleName: field('find-format').selectedOptions[0]?.text,
      changeStyleName: field('change-format').selectedOptions[0]?.text,
      needle: field('needle').value,
      replacement: field('replacement').value,
      caseSensitive: field('case').checked,
      wholeWord: field('word').checked,
      findFormat: field('find-format').value,
      changeFormat: field('change-format').value,
    };
  }
  function setMode(value) {
    mode = value;
    for (const tab of panel.querySelectorAll('[data-find-mode]'))
      tab.setAttribute('aria-pressed', String(mode === tab.dataset.findMode));
    field('word').disabled = mode === 'grep';
    panel.querySelector('[data-grep-help]').hidden = mode !== 'grep';
    for (const picker of panel.querySelectorAll('[data-find-characters]')) {
      picker.replaceChildren(new Option('⋯', ''));
      for (const [name, entries] of findCharacters) {
        const group = document.createElement('optgroup');
        group.label = name;
        for (const [label, code, , escape] of entries) {
          const token = mode === 'grep' ? (escape ?? '~' + code) : '^' + code;
          group.append(new Option(label, token));
        }
        picker.append(group);
      }
    }
  }
  function applySettings(q) {
    setMode(q.mode);
    field('needle').value = q.needle;
    field('replacement').value = q.replacement;
    field('case').checked = q.caseSensitive ?? mode === 'grep';
    field('word').checked = !!q.wholeWord;
    selectFormat('find-format', q.findFormat, q.findStyleName);
    selectFormat('change-format', q.changeFormat, q.changeStyleName);
    cancel();
    invalidate();
  }
  function cancel() {
    pending?.abort();
    pending = null;
    panel.removeAttribute('aria-busy');
  }
  function clearHit() {
    hit = null;
    button('change').disabled = button('change-find').disabled = true;
  }
  function invalidate() {
    clearHit();
    cache = null;
    cursor = origin.id
      ? { id: origin.id, searchStart: origin.searchStart, searchEnd: origin.searchEnd }
      : null;
    panel.querySelector('output').textContent = '';
    button('next').disabled = button('all').disabled =
      !field('needle').value && !field('find-format').value;
  }
  function currentOwners() {
    const scope = field('scope').value;
    const owners = sources().filter((item) => scope === 'document' || item.id === origin.id);
    if (scope === 'selection' && owners[0]?.html !== origin.html)
      throw new Error('The selected text changed. Reopen Find/Change to search a new selection.');
    return owners;
  }
  function styleSignature(owners) {
    if (!field('find-format').value && !field('change-format').value) return '';
    const doc = owners[0]?.doc;
    return JSON.stringify([
      doc?.publishing?.paragraphStyles,
      doc?.publishing?.characterStyles,
      owners.map(({ defaults }) => [
        defaults.bold,
        defaults.italic,
        defaults.underline,
        defaults.strikethrough,
        defaults.noBreak,
        defaults.characterStyle,
        defaults.paragraphStyle,
      ]),
    ]);
  }
  function sameOwners(current, previous) {
    return (
      current.length === previous.length &&
      current.every((o, i) => {
        const p = previous[i];
        return (
          o.id === p.id &&
          o.html === p.html &&
          o.doc === p.doc &&
          o.frames.length === p.frames.length &&
          o.frames.every((f, j) => f.id === p.frames[j].id) &&
          JSON.stringify(o.regions) === JSON.stringify(p.regions)
        );
      })
    );
  }
  function withMatches(callback) {
    const owners = currentOwners(),
      style = styleSignature(owners);
    if (cache && cache.style === style && sameOwners(owners, cache.owners)) return callback(cache);
    const controller = new AbortController();
    const result = findTextMatches(
      owners,
      settings(),
      field('scope').value === 'selection' ? origin : null,
      controller.signal,
    );
    if (!result.then) {
      cache = { owners, style, matches: result };
      return callback(cache);
    }
    pending = controller;
    panel.setAttribute('aria-busy', 'true');
    report('Searching…');
    return result
      .then((matches) => {
        if (controller.signal.aborted || !panel) return;
        cancel();
        if (!allowed()) return close();
        const now = currentOwners();
        if (style !== styleSignature(now) || !sameOwners(now, owners))
          throw new Error('The document changed during the search. Run the search again.');
        cache = { owners: now, style, matches };
        return callback(cache);
      })
      .catch((error) => {
        if (error.name === 'AbortError' || !panel) return;
        if (pending === controller) cancel();
        clearHit();
        report(error.message);
      });
  }
  function next({ owners, matches }, backward = field('direction').value === 'backward') {
    const previous = cursor;
    const include = (match) =>
      !previous?.skipBoundary ||
      match.id !== previous.id ||
      (backward
        ? match.searchEnd !== previous.searchStart
        : match.searchStart !== previous.searchEnd);
    clearHit();
    if (!matches.length) {
      panel.querySelector('output').textContent = 'No matches found.';
      return;
    }
    const indexById = new Map(owners.map((owner, index) => [owner.id, index]));
    const index = indexById.get(cursor?.id);
    if (backward) {
      hit =
        matches.findLast(
          (match) =>
            include(match) && match.id === cursor?.id && match.searchEnd <= cursor.searchStart,
        ) ||
        matches.findLast((match) => indexById.get(match.id) < index) ||
        matches.at(-1);
    } else {
      hit =
        matches.find(
          (match) =>
            include(match) && match.id === cursor?.id && match.searchStart >= cursor.searchEnd,
        ) ||
        matches.find((match) => indexById.get(match.id) > index) ||
        matches[0];
    }
    cursor = { ...hit, skipBoundary: hit.searchStart === hit.searchEnd };
    reveal(
      owners.find((owner) => owner.id === hit.id),
      hit,
    );
    button('next').focus({ preventScroll: true });
    button('change').disabled = button('change-find').disabled = false;
    panel.querySelector('output').textContent = matches.indexOf(hit) + 1 + ' of ' + matches.length;
  }
  function replace({ owners, matches }, action) {
    const template = field('replacement').value,
      changeFormat = field('change-format').value;
    // Resolve matches again so intervening edits or layer locks cannot change unintended text.
    const eligible =
      action === 'all'
        ? matches
        : matches.filter(
            (match) =>
              hit &&
              hit.id === match.id &&
              hit.start === match.start &&
              hit.end === match.end &&
              hit.text === match.text,
          );
    if (!eligible.length) {
      clearHit();
      panel.querySelector('output').textContent = 'No matches found.';
      return;
    }
    const byOwner = new Map();
    let remaining = 20000000;
    const planned = eligible.map((m) => {
      const edit = plannedReplacement(m, template, changeFormat, remaining);
      remaining -= edit.replacement.length;
      return edit;
    });
    for (const match of planned) {
      if (!byOwner.has(match.id)) byOwner.set(match.id, []);
      byOwner.get(match.id).push(match);
    }
    const changes = owners
      .filter((owner) => byOwner.has(owner.id))
      .map((owner) => ({
        frameId: owner.frames[0].id,
        ...applyTextChanges(owner, byOwner.get(owner.id), changeFormat),
        before: owner.html,
      }))
      .filter((item) => item.html !== item.before);
    if (changes.length) {
      change(changes, action === 'all' ? 'Change All' : 'Change');
      if (byOwner.has(origin.id))
        origin.html = sources().find((owner) => owner.id === origin.id)?.html;
    }
    if (hit && action !== 'all')
      cursor = {
        id: hit.id,
        searchStart: hit.searchStart,
        searchEnd: hit.searchStart + planned[0].replacement.length,
        skipBoundary: hit.searchStart === hit.searchEnd,
      };
    if (origin.id && origin.searchEnd > origin.searchStart) {
      const delta = planned.filter((match) => match.id === origin.id);
      const shift = (offset, right) => {
        let output = offset;
        for (const match of delta) {
          if (
            match.searchEnd < offset ||
            (match.searchEnd === offset && (right || match.searchStart < offset))
          )
            output += match.replacement.length - (match.searchEnd - match.searchStart);
          else if (match.searchStart < offset)
            output += match.searchStart - offset + (right ? match.replacement.length : 0);
        }
        return output;
      };
      const start = shift(origin.searchStart, false);
      origin.searchEnd = shift(origin.searchEnd, true);
      origin.searchStart = start;
    }
    cache = null;
    clearHit();
    if (action === 'change-find') return withMatches((result) => next(result));
    const count = changes.reduce((sum, item) => sum + item.count, 0);
    panel.querySelector('output').textContent =
      count === 1 ? '1 replacement made.' : count + ' replacements made.';
  }
  function run(action) {
    if (!allowed()) return close();
    try {
      cancel();
      if (action === 'done') close(true);
      else if (action === 'next') withMatches((result) => next(result));
      else if (action === 'reverse')
        withMatches((result) => next(result, field('direction').value !== 'backward'));
      else withMatches((result) => replace(result, action));
    } catch (error) {
      clearHit();
      panel.querySelector('output').textContent = error.message;
    }
  }
  function open() {
    if (panel) {
      field('needle').focus();
      field('needle').select();
      return;
    }
    origin = context();
    panel = document.createElement('form');
    panel.className = 'canvas-find-change';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Find/Change');
    panel.innerHTML = `<header>Find/Change</header>
      <div class="find-query"><label>Query <select name="query"></select></label><button type="button" name="save-query">Save…</button><button type="button" name="delete-query">Delete</button></div>
      <div class="find-query" data-query-entry hidden><input name="query-name" type="text" aria-label="Query name" placeholder="Query name" maxlength="100"><button type="button" name="confirm-query">Save query</button></div>
      <div class="find-modes" role="group" aria-label="Search mode"><button type="button" data-find-mode="text">Text</button><button type="button" data-find-mode="grep">GREP</button></div>
      <div class="find-expression"><label>Find what<input name="needle" type="text" autocomplete="off" spellcheck="false"></label><select data-find-characters="needle" aria-label="Special characters for search" title="Special characters for search"></select></div>
      <div class="find-expression"><label>Change to<input name="replacement" type="text" autocomplete="off" spellcheck="false"></label><select data-find-characters="replacement" aria-label="Special characters for replace" title="Special characters for replace"></select></div>
      <label>Search<select name="scope"><option value="document">Document</option><option value="flow">Text Flow</option><option value="selection">Selection</option></select></label>
      <label>Direction<select name="direction"><option value="forward">Forward</option><option value="backward">Backward</option></select></label>
      <div class="find-options"><label><input name="case" type="checkbox">Case Sensitive</label><label><input name="word" type="checkbox">Whole Word</label></div>
      <details data-grep-help hidden><summary>Pattern reference</summary><p>Use <code>^</code> and <code>$</code> for paragraph edges, <code>\\r</code> for a paragraph return and <code>\\n</code> for a forced line break. Insert found text with <code>$0</code> or a group with <code>$1</code>–<code>$99</code>.</p></details>
      <label>Find Format<select name="find-format"></select></label>
      <label>Change Format<select name="change-format"></select></label>
      <div class="find-actions"><button type="submit" data-find-action="next">Find Next</button><button type="button" data-find-action="change">Change</button><button type="button" data-find-action="change-find">Change/Find</button><button type="button" data-find-action="all">Change All</button></div>
      <footer><output aria-live="polite"></output><button type="button" data-find-action="done">Done</button></footer>`;
    host.append(panel);
    field('scope').options[1].disabled = !origin.id;
    field('scope').options[2].disabled = !origin.id || !(origin.searchEnd > origin.searchStart);
    const doc = sources()[0]?.doc;
    for (const name of ['find-format', 'change-format']) {
      field(name).add(
        new Option(name === 'find-format' ? 'Any formatting' : 'Preserve formatting', ''),
      );
      for (const [value, label] of findFormats) field(name).add(new Option(label, value));
      const named = namedFormats(doc, name === 'find-format');
      for (const [kind, label] of [
        ['characterStyle', 'Character Styles'],
        ['paragraphStyle', 'Paragraph Styles'],
      ]) {
        const group = document.createElement('optgroup');
        group.label = label;
        for (const item of named.filter((style) => style.kind === kind))
          group.append(new Option(item.name, item.key));
        if (group.children.length) field(name).append(group);
      }
    }
    resetQuery = installFindQueries(panel, { read: settings, apply: applySettings, report });
    applySettings(
      origin.text
        ? { mode: 'text', needle: origin.text, replacement: lastSettings?.replacement || '' }
        : lastSettings || { mode: 'text', needle: '', replacement: '' },
    );
    panel.addEventListener('input', (event) => {
      if (event.target.hasAttribute('data-find-characters')) return;
      if (['query-name', 'query'].includes(event.target.name)) return;
      cancel();
      if (event.target !== field('direction') && event.target !== field('scope')) resetQuery();
      if (event.target === field('direction')) {
        button('next').textContent =
          field('direction').value === 'backward' ? 'Find Previous' : 'Find Next';
      } else if (event.target !== field('replacement')) invalidate();
    });
    panel.addEventListener('change', (event) => {
      const picker = event.target;
      if (!picker.dataset.findCharacters || !picker.value) return;
      const input = field(picker.dataset.findCharacters);
      input.setRangeText(picker.value, input.selectionStart, input.selectionEnd, 'end');
      picker.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus({ preventScroll: true });
    });
    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      run('next');
    });
    panel.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-find-mode]');
      if (tab && tab.dataset.findMode !== mode) {
        cancel();
        setMode(tab.dataset.findMode);
        field('case').checked = mode === 'grep';
        resetQuery();
        invalidate();
      }
      const action = event.target.closest('[data-find-action]')?.dataset.findAction;
      if (action && action !== 'next') run(action);
    });
    panel.addEventListener('keydown', (event) => {
      // Fields and buttons can be traversed within this modeless panel.
      event.stopPropagation();
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        run('reverse');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        field('needle').select();
        field('needle').focus();
      }
    });
    field('needle').focus();
    field('needle').select();
  }
  return { open, close };
}
