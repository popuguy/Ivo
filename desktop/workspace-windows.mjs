/** One writer lease for a shared native vault. A failed handoff never grants another writer. */
export function createWindowLease({ release, snapshot, grant, passive = () => {} }) {
  const members = new Set();
  let writer = null,
    queue = Promise.resolve();
  const notifyPassive = (record) => {
    try {
      passive(record);
    } catch {}
  };
  const available = (record) =>
    members.has(record) && record.ready === true && !record.closingIntent;
  async function transfer(target) {
    if (!available(target)) return false;
    if (writer === target) return true;
    const previous = writer;
    if (previous && members.has(previous) && !previous.closingIntent) {
      try {
        if ((await release(previous)) !== true)
          throw new Error('The other window could not finish saving.');
      } catch (error) {
        if (members.has(previous)) {
          await grant(previous, null).catch(() => {});
          throw error;
        }
      }
    }
    writer = null;
    try {
      const state = await snapshot();
      if (!available(target)) throw new Error('The destination window closed before it was ready.');
      await grant(target, state);
      if (!available(target)) throw new Error('The destination window closed during activation.');
      writer = target;
      if (previous && members.has(previous)) notifyPassive(previous);
      return true;
    } catch (error) {
      writer = null;
      notifyPassive(target);
      if (previous && available(previous)) {
        try {
          await grant(previous, await snapshot());
          writer = previous;
        } catch {
          writer = null;
        }
      }
      throw error;
    }
  }
  return Object.freeze({
    add(record, { initial = false } = {}) {
      members.add(record);
      if (initial && !writer) writer = record;
    },
    ready(record) {
      if (!members.has(record)) throw new Error('This workspace window has closed.');
      record.ready = true;
    },
    request(record) {
      const pending = queue.then(() => transfer(record));
      queue = pending.catch(() => {});
      return pending;
    },
    remove(record) {
      members.delete(record);
      if (writer === record) writer = null;
    },
    canWrite: (record) => members.has(record) && writer === record && !record.closingIntent,
    owner: () => writer,
    settled: () => queue,
  });
}

/** Native placement is bounded to the chosen display, including negative-coordinate monitors. */
export function workspaceWindowBounds(input = {}, area = { x: 0, y: 0, width: 1440, height: 900 }) {
  const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback),
    clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const width = Math.round(clamp(finite(input.width, 1200), Math.min(600, area.width), area.width)),
    height = Math.round(clamp(finite(input.height, 850), Math.min(450, area.height), area.height));
  return {
    x: Math.round(
      clamp(
        finite(input.x, area.x + (area.width - width) / 2),
        area.x,
        area.x + area.width - width,
      ),
    ),
    y: Math.round(
      clamp(
        finite(input.y, area.y + (area.height - height) / 2),
        area.y,
        area.y + area.height - height,
      ),
    ),
    width,
    height,
  };
}

/** Renderer menu descriptions contain labels and opaque IDs, never callbacks, roles or paths. */
export function navigationMenuItems(input) {
  let remaining = 50;
  const ids = new Set();
  function normalize(items, depth) {
    if (!Array.isArray(items) || depth > 2) throw new Error('Invalid navigation menu.');
    return items.map((item) => {
      if (--remaining < 0 || !item || typeof item !== 'object')
        throw new Error('Navigation menu is too large.');
      if (item.type === 'separator') return { type: 'separator' };
      if (
        typeof item.label !== 'string' ||
        !item.label ||
        item.label.length > 160 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
        /[\x00-\x1f]/.test(item.label)
      )
        throw new Error('Invalid navigation menu label.');
      const value = {
        label: item.label,
        enabled: item.enabled !== false && item.disabled !== true,
      };
      if (item.submenu) {
        value.submenu = normalize(item.submenu, depth + 1);
        return value;
      }
      if (
        typeof item.id !== 'string' ||
        !/^[A-Za-z0-9_:/.-]{1,180}$/.test(item.id) ||
        ids.has(item.id)
      )
        throw new Error('Invalid navigation menu action.');
      ids.add(item.id);
      value.id = item.id;
      if (typeof item.checked === 'boolean') {
        value.type = 'checkbox';
        value.checked = item.checked;
      }
      return value;
    });
  }
  const result = normalize(input, 0);
  if (!result.length) throw new Error('Empty navigation menu.');
  return result;
}
