import { findTextMatches, changeTextMatches, decodeFindField } from '../text/find-change.js';

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
    lastQuery = '',
    lastReplacement = '';
  const field = (name) => panel.elements.namedItem(name);
  const button = (name) => panel.querySelector('[data-find-action="' + name + '"]');
  function close(returnFocus = false) {
    if (!panel) return;
    lastQuery = field('needle').value;
    lastReplacement = field('replacement').value;
    panel.remove();
    panel = null;
    cache = null;
    finished(returnFocus);
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
    button('next').disabled = button('all').disabled = !field('needle').value;
  }
  function search() {
    const scope = field('scope').value;
    const owners = sources().filter((item) => scope === 'document' || item.id === origin.id);
    if (scope === 'selection' && owners[0]?.html !== origin.html) {
      throw new Error('The selected text changed. Reopen Find/Change to search a new selection.');
    }
    const unchanged =
      cache &&
      owners.length === cache.owners.length &&
      owners.every((owner, i) => {
        const prior = cache.owners[i];
        return (
          owner.id === prior.id &&
          owner.html === prior.html &&
          ((!owner.regions && !prior.regions) ||
            (owner.regions &&
              prior.regions &&
              owner.regions.length === prior.regions.length &&
              owner.regions.every(
                (range, j) =>
                  range.start === prior.regions[j].start && range.end === prior.regions[j].end,
              )))
        );
      });
    if (unchanged) return cache;
    const matches = findTextMatches(
      owners,
      {
        needle: field('needle').value,
        caseSensitive: field('case').checked,
        wholeWord: field('word').checked,
      },
      scope === 'selection' ? origin : null,
    );
    cache = { owners, matches };
    return cache;
  }
  function next(backward = field('direction').value === 'backward') {
    const { owners, matches } = search();
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
          (match) => match.id === cursor?.id && match.searchEnd <= cursor.searchStart,
        ) ||
        matches.findLast((match) => indexById.get(match.id) < index) ||
        matches.at(-1);
    } else {
      hit =
        matches.find((match) => match.id === cursor?.id && match.searchStart >= cursor.searchEnd) ||
        matches.find((match) => indexById.get(match.id) > index) ||
        matches[0];
    }
    cursor = hit;
    reveal(
      owners.find((owner) => owner.id === hit.id),
      hit,
    );
    button('next').focus({ preventScroll: true });
    button('change').disabled = button('change-find').disabled = false;
    panel.querySelector('output').textContent = matches.indexOf(hit) + 1 + ' of ' + matches.length;
  }
  function replace(action) {
    const { owners, matches } = search(),
      replacement = decodeFindField(field('replacement').value);
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
    for (const match of eligible) {
      if (match.text === replacement) continue;
      if (!byOwner.has(match.id)) byOwner.set(match.id, []);
      byOwner.get(match.id).push(match);
    }
    const changes = owners
      .filter((owner) => byOwner.has(owner.id))
      .map((owner) => ({
        frameId: owner.frames[0].id,
        html: changeTextMatches(owner.html, byOwner.get(owner.id), replacement),
      }));
    if (changes.length) {
      change(changes, action === 'all' ? 'Change All' : 'Change');
      if (byOwner.has(origin.id))
        origin.html = sources().find((owner) => owner.id === origin.id)?.html;
    }
    if (hit && action !== 'all')
      cursor = {
        id: hit.id,
        searchStart: hit.searchStart,
        searchEnd: hit.searchStart + replacement.length,
      };
    if (origin.id && origin.searchEnd > origin.searchStart) {
      const delta = eligible.filter((match) => match.id === origin.id);
      const shift = (offset, right) => {
        let output = offset;
        for (const match of delta) {
          if (match.searchEnd <= offset)
            output += replacement.length - (match.searchEnd - match.searchStart);
          else if (match.searchStart < offset)
            output += match.searchStart - offset + (right ? replacement.length : 0);
        }
        return output;
      };
      const start = shift(origin.searchStart, false);
      origin.searchEnd = shift(origin.searchEnd, true);
      origin.searchStart = start;
    }
    cache = null;
    clearHit();
    if (action === 'change-find') return next();
    const count = [...byOwner.values()].reduce((sum, values) => sum + values.length, 0);
    panel.querySelector('output').textContent =
      count === 1 ? '1 replacement made.' : count + ' replacements made.';
  }
  function run(action) {
    if (!allowed()) return close();
    try {
      if (action === 'done') close(true);
      else if (action === 'next') next();
      else if (action === 'reverse') next(field('direction').value !== 'backward');
      else replace(action);
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
      <label>Find what<input name="needle" type="text" autocomplete="off" spellcheck="false"></label>
      <label>Change to<input name="replacement" type="text" autocomplete="off" spellcheck="false"></label>
      <label>Search<select name="scope"><option value="document">Document</option><option value="flow">Text Flow</option><option value="selection">Selection</option></select></label>
      <label>Direction<select name="direction"><option value="forward">Forward</option><option value="backward">Backward</option></select></label>
      <div class="find-options"><label><input name="case" type="checkbox">Case Sensitive</label><label><input name="word" type="checkbox">Whole Word</label></div>
      <div class="find-actions"><button type="submit" data-find-action="next">Find Next</button><button type="button" data-find-action="change">Change</button><button type="button" data-find-action="change-find">Change/Find</button><button type="button" data-find-action="all">Change All</button></div>
      <footer><output aria-live="polite"></output><button type="button" data-find-action="done">Done</button></footer>`;
    host.append(panel);
    field('scope').options[1].disabled = !origin.id;
    field('scope').options[2].disabled = !origin.id || !(origin.searchEnd > origin.searchStart);
    field('needle').value = origin.text || lastQuery;
    field('replacement').value = lastReplacement;
    invalidate();
    panel.addEventListener('input', (event) => {
      if (event.target === field('direction')) {
        button('next').textContent =
          field('direction').value === 'backward' ? 'Find Previous' : 'Find Next';
      } else if (event.target !== field('replacement')) invalidate();
    });
    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      run('next');
    });
    panel.addEventListener('click', (event) => {
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
