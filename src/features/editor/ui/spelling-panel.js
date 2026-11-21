import { applyTextChanges, proofingWords } from '../text/find-change.js';

const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The dictionary runs only during an explicit review. The editor owns all mutations and undo. */
export function createSpellingPanel(
  { host, context, sources, reveal, change, allowed, finished },
  dictionary,
) {
  let panel,
    origin,
    snapshot,
    hits,
    hit,
    position = 0,
    generation = 0;
  const ignored = new Set();
  const fields = () => panel.elements;
  const report = (text) => {
    panel.querySelector('output').textContent = text;
  };
  function close(returnFocus = false) {
    if (!panel) return;
    generation++;
    panel.remove();
    panel = snapshot = hits = hit = null;
    ignored.clear();
    finished(returnFocus);
  }
  function owners() {
    return sources().filter((owner) => fields().scope.value === 'document' || owner.id === origin);
  }
  function stillCurrent() {
    const now = owners();
    return (
      now.length === snapshot.length &&
      now.every((owner, i) => {
        const old = snapshot[i];
        return (
          owner.id === old.id &&
          owner.html === old.html &&
          owner.frames.map((f) => f.id).join('|') === old.frames.map((f) => f.id).join('|') &&
          JSON.stringify(owner.regions) === JSON.stringify(old.regions)
        );
      })
    );
  }
  function showNext() {
    while (position < hits.length && ignored.has(hits[position].text)) position++;
    hit = hits[position++];
    const term = hit?.text || '';
    fields().term.value = term;
    const guesses = hit ? dictionary.suggestions(term) : [];
    fields().choices.replaceChildren(...guesses.map((word) => new Option(word, word)));
    fields().replacement.value = guesses[0] || term;
    for (const node of panel.querySelectorAll('[data-review]')) node.disabled = !hit;
    if (!hit) return report('Spelling check complete.');
    reveal(
      snapshot.find((o) => o.id === hit.id),
      hit,
    );
    fields().skip.focus({ preventScroll: true });
    report('Word not in dictionary.');
  }
  async function scan(after) {
    const token = ++generation;
    hit = null;
    hits = [];
    position = 0;
    for (const node of panel.querySelectorAll('[data-review]')) node.disabled = true;
    fields().term.value = fields().replacement.value = '';
    fields().choices.replaceChildren();
    if (!dictionary?.available()) return report('System spelling dictionary unavailable.');
    report('Checking spelling…');
    const checked = new Map();
    snapshot = owners();
    const startOwner = after ? snapshot.findIndex((o) => o.id === after.id) : 0;
    for (let i = Math.max(startOwner, 0); i < snapshot.length; i++) {
      const owner = snapshot[i],
        words = proofingWords(owner);
      for (;;) {
        const batch = [];
        let step;
        while (batch.length < 64 && !(step = words.next()).done) batch.push(step.value);
        const unknown = [...new Set(batch.map((m) => m.text).filter((w) => !checked.has(w)))];
        if (unknown.length) {
          const errors = new Set(dictionary.misspelled(unknown));
          for (const word of unknown) checked.set(word, errors.has(word));
        }
        for (const match of batch)
          if (
            checked.get(match.text) &&
            !ignored.has(match.text) &&
            (!after || after.id !== owner.id || match.start >= after.start)
          )
            hits.push(match);
        if (step?.done) break;
        await yieldFrame();
        if (generation !== token) return;
      }
      await yieldFrame();
      if (generation !== token) return;
    }
    if (!allowed()) return close();
    if (!stillCurrent()) return report('Document changed. Choose Check Again.');
    showNext();
  }
  async function action(name) {
    if (name === 'done') return close(true);
    if (!allowed()) return close();
    if (name === 'again') return scan();
    if (!hit) return;
    if (!stillCurrent()) return scan();
    if (name === 'skip' || name === 'ignore') {
      if (name === 'ignore') ignored.add(hit.text);
      return showNext();
    }
    if (name !== 'correct' && name !== 'all') return;
    const replacement = fields().replacement.value;
    if (!replacement.trim()) return report('Enter a replacement.');
    if (replacement === hit.text)
      return report('Choose a different replacement or skip this word.');
    const edits = [];
    for (const owner of snapshot) {
      if (name === 'correct' && owner.id !== hit.id) continue;
      const matches =
        name === 'correct' ? [hit] : [...proofingWords(owner)].filter((m) => m.text === hit.text);
      if (matches.length)
        edits.push({
          frameId: owner.frames[0].id,
          ...applyTextChanges(
            owner,
            matches.map((m) => ({ ...m, replacement })),
          ),
        });
    }
    const next = { id: hit.id, start: hit.start + replacement.length };
    change(edits, name === 'all' ? 'Correct All Spellings' : 'Correct Spelling');
    return scan(name === 'all' ? null : next);
  }
  const run = (name) =>
    action(name).catch((error) => {
      if (panel) report(error.message);
    });
  function open() {
    if (!allowed()) return;
    if (panel) return panel.elements.again.focus();
    origin = context().id;
    panel = document.createElement('form');
    panel.className = 'canvas-find-change canvas-spelling';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Check Spelling');
    panel.innerHTML = `<header>Check Spelling</header>
      <label>Search<select name="scope"><option value="document">Document</option><option value="flow">Current text</option></select></label>
      <label>Not in dictionary<input type="text" name="term" readonly></label>
      <label>Change To<input type="text" name="replacement" maxlength="256" data-review></label>
      <label>Suggestions<select name="choices" size="4" data-review></select></label>
      <div class="find-actions"><button type="button" name="skip" data-review>Skip</button><button type="button" name="ignore" data-review>Ignore All</button><button type="submit" name="correct" data-review>Change</button><button type="button" name="all" data-review>Change All</button></div>
      <footer><output aria-live="polite"></output><button type="button" name="again">Check Again</button><button type="button" name="done">Done</button></footer>`;
    host.append(panel);
    fields().scope.options[1].disabled = !origin;
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      run('correct');
    });
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button[type=button]');
      if (b) run(b.name);
    });
    panel.addEventListener('change', (e) => {
      if (e.target.name === 'scope') run('again');
      if (e.target.name === 'choices') fields().replacement.value = e.target.value;
    });
    panel.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    });
    fields().again.focus();
    run('again');
  }
  return { open, close };
}
