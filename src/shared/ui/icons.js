import { referenceArt } from './reference-art-data.js';

/** Render sourced artwork unchanged; geometry and source identity remain auditable. */
export function icon(name) {
  if (name === 'panel-left' && referenceArt.icons['sidebar-toggle']?.inlineSVG) {
    return referenceArt.icons['sidebar-toggle'].inlineSVG
      .replace(
        '<svg ',
        '<svg data-icon-name="panel-left" data-icon-source="Obsidian" aria-hidden="true" focusable="false" ',
      )
      .replace('class="svg-icon ', 'class="reference-icon svg-icon ');
  }
  const item = referenceArt.icons[name];
  if (!item) throw new Error('Unknown interface icon: ' + name);
  if (name === 'tab-close') {
    // A mask keeps the exact sourced paths while letting the control own its ink color.
    return `<span class="reference-icon" data-icon-name="${name}" data-icon-source="${item.source}" style="--reference-icon-image:url('${item.url}')" aria-hidden="true"></span>`;
  }
  return `<img class="reference-icon" data-icon-name="${name}" data-icon-source="${item.source}" src="${item.url}" alt="" aria-hidden="true" draggable="false">`;
}
export function cursor(name, fallback = 'default') {
  const item = referenceArt.cursors[name];
  return item ? `url("${item.url}") ${item.hotspot[0]} ${item.hotspot[1]}, ${fallback}` : fallback;
}
let preload;
export function preloadReferenceArt() {
  if (!preload && typeof Image !== 'undefined')
    preload = Promise.all(
      [...Object.values(referenceArt.icons), ...Object.values(referenceArt.cursors)].map((item) => {
        const image = new Image();
        image.src = item.url;
        return image.decode();
      }),
    );
  return preload || Promise.resolve();
}
export function installReferenceCursors(element) {
  void preloadReferenceArt().catch(() => {});
  for (const name of Object.keys(referenceArt.cursors))
    element.style.setProperty('--cursor-' + name, cursor(name));
}
