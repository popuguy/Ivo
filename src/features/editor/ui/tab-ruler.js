// The numeric fields and ruler edit the same draft. Only applying the dialog changes the document.
export function installTabRuler(root, width, leftIndent, entries) {
  const ruler = root.querySelector('[data-tab-ruler]');
  const repeat = root.querySelector('[data-repeat-tab]');
  if (!(width > 0)) {
    ruler.parentElement.hidden = true;
    return () => {};
  }
  const markers = new Map();
  let selected = null;
  let drag = null;
  const position = (row) => row.querySelector('input[type=number]').valueAsNumber;
  const at = (x, box) => {
    return Math.max(
      0.01,
      Math.min(width, Math.round(((x - box.left) / box.width) * width * 100) / 100),
    );
  };
  const labelStep = Math.max(12, 12 * Math.ceil(width / 72));
  ruler.style.setProperty('--ruler-step', (100 * labelStep) / width + '%');
  for (let pt = 0; pt < width; pt += labelStep) {
    const label = document.createElement('span');
    label.textContent = pt;
    label.style.left = (100 * pt) / width + '%';
    ruler.append(label);
  }
  function sync(row = selected) {
    selected = entries.list.contains(row) ? row : null;
    for (const [item, marker] of markers) {
      if (!entries.list.contains(item)) {
        markers.delete(item);
        marker.remove();
      }
    }
    for (const item of entries.list.children) {
      let marker = markers.get(item);
      if (!marker) {
        marker = document.createElement('button');
        marker.type = 'button';
        marker.dataset.tabMarker = '';
        ruler.append(marker);
        markers.set(item, marker);
      }
      const pt = position(item);
      marker.hidden = !Number.isFinite(pt) || pt <= 0 || pt > width;
      marker.style.left = (100 * pt) / width + '%';
      const align = item.querySelector('select').value;
      marker.title = align + ' tab at ' + pt + ' pt';
      marker.setAttribute('aria-label', marker.title);
      marker.setAttribute('aria-pressed', String(item === selected));
      item.classList.toggle('tab-stop-selected', item === selected);
    }
    repeat.disabled = !selected || !repeatPositions().length;
  }
  function repeatPositions() {
    if (!selected) return [];
    const used = new Set([...entries.list.children].map(position));
    const start = position(selected);
    const previous = [...used].filter((x) => x < start);
    const interval = start - (previous.length ? Math.max(...previous) : leftIndent);
    if (!(interval >= 0.001)) return [];
    const result = [];
    for (let i = 1; entries.list.childElementCount + result.length < entries.limit; i++) {
      const pt = Math.round((start + i * interval) * 1000) / 1000;
      if (pt > width) break;
      if (!used.has(pt) && result.at(-1) !== pt) result.push(pt);
    }
    return result;
  }
  function markerRow(button) {
    for (const [row, marker] of markers) if (marker === button) return row;
    return null;
  }
  function change(row, pt) {
    const input = row.querySelector('input[type=number]');
    input.value = pt;
    sync(row);
  }
  ruler.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    const existing = markerRow(event.target.closest('button'));
    if (!existing && entries.list.childElementCount >= entries.limit) return;
    const box = ruler.getBoundingClientRect();
    const row =
      existing ||
      entries.add({ position: at(event.clientX, box), alignment: 'left' }).closest('fieldset');
    sync(row);
    drag = {
      row,
      box,
      original: position(row),
      fresh: !existing,
      id: event.pointerId,
      startX: event.clientX,
    };
    markers.get(row).focus({ preventScroll: true });
    if (event.isTrusted) ruler.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  ruler.addEventListener('pointermove', (event) => {
    if (drag?.id === event.pointerId && event.clientX !== drag.startX)
      change(drag.row, at(event.clientX, drag.box));
  });
  function finish(event, cancelled) {
    if (drag?.id !== event.pointerId) return;
    const { row, original, fresh, startX, box } = drag;
    drag = null;
    if (cancelled) {
      if (fresh) entries.remove(row);
      else change(row, original);
    } else if (event.clientY < box.top - 8 || event.clientY > box.bottom + 8) {
      entries.remove(row);
      if (!fresh) entries.changed();
    } else {
      const pt = event.clientX === startX ? original : at(event.clientX, box);
      change(row, pt);
      if (fresh || pt !== original) entries.changed();
    }
    sync();
  }
  ruler.addEventListener('pointerup', (e) => finish(e, false));
  ruler.addEventListener('pointercancel', (e) => finish(e, true));
  ruler.addEventListener('lostpointercapture', (e) => finish(e, true));
  ruler.addEventListener('click', (event) => {
    if (event.detail === 0 && event.target.matches('button')) sync(markerRow(event.target));
  });
  ruler.addEventListener('keydown', (event) => {
    const row = markerRow(event.target);
    if (!row) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      entries.remove(row);
      entries.changed();
      sync();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      change(
        row,
        Math.min(width, Math.max(0.01, position(row) + (event.key === 'ArrowRight' ? 1 : -1))),
      );
      entries.changed();
    } else return;
    event.preventDefault();
  });
  entries.list.addEventListener('focusin', (e) => sync(e.target.closest('fieldset')));
  repeat.addEventListener('click', () => {
    const template = entries.read(selected);
    for (const pt of repeatPositions()) entries.add({ ...template, position: pt });
    entries.changed();
    sync();
  });
  return sync;
}
