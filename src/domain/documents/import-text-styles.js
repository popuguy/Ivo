import { uid } from './model.js';
import { enablePublishing, resolvedTextStyle } from './publishing.js';
import { markTypographyVersion } from './capabilities.js';

/** Resolve all references before installing either style family. Based On is acyclic.
 * Next Style can legally loop. Existing styled text retains its target IDs. */
export function importTextStyles(target, source, selection, conflicts = 'existing') {
  if (target.id === source.id || !['existing', 'incoming', 'rename'].includes(conflicts))
    throw Error('Choose a different source document and a conflict policy.');
  const selected = new Set(selection),
    seen = new Set(),
    result = {};
  let changed = false;
  for (const kind of ['paragraph', 'character']) {
    const family = kind + 'Styles',
      local = target.publishing?.[family] || [],
      styles = source.publishing?.[family] || [],
      from = new Map(styles.map((s) => [s.id, s])),
      names = new Set(local.map((s) => s.name)),
      mapped = new Map(),
      incoming = [],
      pending = styles.filter((s) => selected.has(s.id));
    for (const style of pending) {
      seen.add(style.id);
      if (mapped.has(style.id)) continue;
      const matches = local.filter((s) => s.name === style.name);
      if (matches.length > 1 && conflicts !== 'rename')
        throw Error(
          'Multiple destination styles are named “' + style.name + '”. Choose Rename incoming.',
        );
      const match = matches[0];
      if (match && conflicts === 'existing') {
        mapped.set(style.id, match.id);
        continue;
      }
      let name = style.name;
      if (names.has(name) && (conflicts === 'rename' || !match)) {
        let i = 1;
        do {
          const suffix = ' (' + i++ + ')';
          name = style.name.slice(0, 120 - suffix.length) + suffix;
        } while (names.has(name));
      }
      const id = match && conflicts === 'incoming' ? match.id : uid('style-');
      if (incoming.some((entry) => entry.id === id))
        throw Error('Conflicting source styles are named “' + name + '”. Choose Rename incoming.');
      names.add(name);
      mapped.set(style.id, id);
      incoming.push({ style, id, name });
      for (const ref of [style.basedOn, style.nextStyle].filter(Boolean)) {
        if (!from.has(ref)) throw Error('Missing source style dependency.');
        if (!mapped.has(ref)) pending.push(from.get(ref));
      }
    }
    const definitions = new Map(local.map((s) => [s.id, s]));
    for (const { style, id, name } of incoming) {
      const next = {
        id,
        name,
        basedOn: mapped.get(style.basedOn) || null,
        attributes: structuredClone(style.attributes),
      };
      if (style.nextStyle && mapped.get(style.nextStyle) !== id)
        next.nextStyle = mapped.get(style.nextStyle);
      definitions.set(id, next);
    }
    if (definitions.size > 256) throw Error('A document supports up to 256 styles of each kind.');
    result[family] = [...definitions.values()];
    for (const style of result[family]) resolvedTextStyle({ publishing: result }, kind, style.id);
    if (incoming.length) changed = true;
  }
  if (!selected.size || [...selected].some((id) => !seen.has(id)))
    throw Error('Choose available styles to import.');
  if (!changed) return false;
  Object.assign(enablePublishing(target), result);
  markTypographyVersion(target);
  return true;
}
