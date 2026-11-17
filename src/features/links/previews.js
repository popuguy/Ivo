import { cleanHTML, escapeHTML as esc } from '../../shared/html/sanitize.js';
import { icon } from '../../shared/ui/icons.js';

/** Bounded semantic preview. Read canonical textFlows once, never paginate or mutate them. */
export function documentPreview(doc, { limit = 640 } = {}) {
  const seen = new Set(),
    parts = [];
  let length = 0;
  for (const block of doc.blocks || []) {
    if (!['text', 'quote'].includes(block.type)) continue;
    let html = block.html || '';
    if (block.textFlowId) {
      if (seen.has(block.textFlowId)) continue;
      seen.add(block.textFlowId);
      html = doc.textFlows?.find((textFlow) => textFlow.id === block.textFlowId)?.html || '';
    }
    const node = document.createElement('div');
    node.innerHTML = cleanHTML(html.slice(0, 32000))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[2-4]|blockquote)>/gi, '\n');
    const text = node.textContent
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target, label) => label || target)
      .replace(/[\t\r ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) {
      parts.push(text);
      length += text.length;
      if (length > limit) break;
    }
  }
  let excerpt = parts.join('\n\n');
  if (excerpt.length > limit) {
    const chunks =
      typeof Intl.Segmenter === 'function'
        ? [
            ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
              excerpt.slice(0, limit + 32),
            ),
          ].map((value) => value.segment)
        : Array.from(excerpt);
    let value = '';
    for (const chunk of chunks) {
      if (value.length + chunk.length > limit) break;
      value += chunk;
    }
    excerpt = value.trimEnd() + '…';
  }
  const image = (doc.blocks || []).find(
    (block) =>
      block.type === 'image' &&
      /^(?:asset:|data:image\/(?:png|jpeg|webp|gif|avif);base64,|\.\/public\/)/i.test(block.src),
  );
  return {
    id: doc.id,
    title: doc.title || 'Untitled',
    excerpt,
    pages: doc.pages?.length || 1,
    image: image
      ? { src: image.src, alt: image.alt || '', fit: image.fit, crop: image.crop }
      : null,
  };
}

let previewInstance = 0;
/** Reading-only popovers live outside transformed pages and never intercept a normal tap/click. */
export function installDocumentPreviews(
  host,
  {
    getDocument,
    source,
    onOpen,
    onError = () => {},
    enabled = () => true,
    delay = 350,
    closeDelay = 180,
  } = {},
) {
  const popupId = 'ivo-document-preview-' + ++previewInstance;
  const controller = new AbortController(),
    listen = (target, name, callback, options = {}) =>
      target.addEventListener(name, callback, { signal: controller.signal, ...options });
  let timer,
    closeTimer,
    owner,
    popup,
    popupController,
    previousDescription,
    previousControls,
    previousExpanded,
    suppressFocus = false,
    touchUntil = 0;
  const linkFor = (target) =>
    target instanceof Element ? target.closest('a[data-doc-id],[data-scene-open]') : null;
  const targetId = (link) => link?.dataset.docId || link?.dataset.sceneOpen;
  function hide({ returnFocus = false } = {}) {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    const anchor = owner;
    popupController?.abort();
    popupController = null;
    popup?.remove();
    popup = null;
    owner = null;
    if (anchor)
      for (const [name, value] of [
        ['aria-describedby', previousDescription],
        ['aria-controls', previousControls],
        ['aria-expanded', previousExpanded],
      ]) {
        if (value === null || value === undefined) anchor.removeAttribute(name);
        else anchor.setAttribute(name, value);
      }
    if (returnFocus && anchor?.isConnected) {
      suppressFocus = true;
      anchor.focus({ preventScroll: true });
      suppressFocus = false;
    }
  }
  function position() {
    if (!popup || !owner?.isConnected) return;
    const rect = owner.getBoundingClientRect(),
      bounds = popup.getBoundingClientRect(),
      gap = 8;
    popup.style.left = Math.max(gap, Math.min(rect.left, innerWidth - bounds.width - gap)) + 'px';
    popup.style.top =
      Math.max(
        gap,
        Math.min(
          rect.bottom + bounds.height + gap <= innerHeight
            ? rect.bottom + gap
            : rect.top - bounds.height - gap,
          innerHeight - bounds.height - gap,
        ),
      ) + 'px';
  }
  function open(link) {
    if (owner !== link || !link.isConnected || !enabled()) {
      hide();
      return;
    }
    const doc = getDocument(targetId(link));
    if (!doc) {
      hide();
      return;
    }
    const value = documentPreview(doc);
    popupController = new AbortController();
    const listenPopup = (target, name, callback) =>
      listen(target, name, callback, { signal: popupController.signal });
    popup = document.createElement('section');
    popup.className = 'document-preview';
    popup.id = popupId;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', value.title + ' preview');
    const image = value.image && source(value.image.src);
    const localImage =
      image && /^(?:data:image\/(?:png|jpeg|webp|gif|avif);base64,|blob:|\.\/public\/)/i.test(image)
        ? image
        : '';
    popup.innerHTML = `<header><button class="document-preview-open" data-preview-open>${esc(value.title)}</button><button class="document-preview-close" aria-label="Close preview">${icon('close')}</button></header><div class="document-preview-meta">${value.pages} ${value.pages === 1 ? 'page' : 'pages'}</div>${localImage ? `<img class="document-preview-image" src="${esc(localImage)}" alt="${esc(value.image.alt)}" decoding="async">` : ''}<p id="${popupId}-excerpt">${esc(value.excerpt || 'No text in this document.')}</p>`;
    document.body.append(popup);
    link.setAttribute('aria-describedby', popupId + '-excerpt');
    link.setAttribute('aria-controls', popup.id);
    link.setAttribute('aria-expanded', 'true');
    position();
    listenPopup(popup, 'pointerenter', () => clearTimeout(closeTimer));
    listenPopup(popup, 'pointerleave', (event) => {
      if (event.relatedTarget instanceof Node && owner?.contains(event.relatedTarget)) return;
      scheduleClose();
    });
    listenPopup(popup, 'focusin', () => clearTimeout(closeTimer));
    listenPopup(popup, 'focusout', (event) => {
      if (
        event.relatedTarget instanceof Node &&
        (popup?.contains(event.relatedTarget) || owner?.contains(event.relatedTarget))
      )
        return;
      scheduleClose();
    });
    listenPopup(popup, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hide({ returnFocus: true });
      }
    });
    const activate = (event) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      event.preventDefault();
      const id = value.id,
        newTab = event.button === 1 || event.metaKey || event.ctrlKey;
      hide();
      Promise.resolve(
        onOpen(id, { newTab, toRight: (event.metaKey || event.ctrlKey) && event.altKey }),
      ).catch(onError);
    };
    listenPopup(popup.querySelector('[data-preview-open]'), 'click', activate);
    listenPopup(popup.querySelector('[data-preview-open]'), 'auxclick', activate);
    listenPopup(popup.querySelector('.document-preview-close'), 'click', () =>
      hide({ returnFocus: true }),
    );
  }
  function scheduleClose() {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => hide(), closeDelay);
  }
  function schedule(link, immediate = false) {
    if (!enabled() || !link || !getDocument(targetId(link))) return;
    clearTimeout(closeTimer);
    if (link === owner) {
      if (immediate && !popup) {
        clearTimeout(timer);
        open(link);
      }
      return;
    }
    hide();
    owner = link;
    previousDescription = link.getAttribute('aria-describedby');
    previousControls = link.getAttribute('aria-controls');
    previousExpanded = link.getAttribute('aria-expanded');
    if (immediate) open(link);
    else timer = setTimeout(() => open(link), delay);
  }
  listen(host, 'pointerover', (event) => {
    const link = linkFor(event.target);
    if (event.pointerType === 'touch' || link?.contains(event.relatedTarget)) return;
    schedule(link);
  });
  listen(host, 'pointerout', (event) => {
    if (!owner?.contains(event.target)) return;
    if (
      event.relatedTarget instanceof Node &&
      (owner.contains(event.relatedTarget) || popup?.contains(event.relatedTarget))
    )
      return;
    scheduleClose();
  });
  listen(host, 'focusin', (event) => {
    if (!suppressFocus && performance.now() > touchUntil) schedule(linkFor(event.target), true);
  });
  listen(host, 'focusout', (event) => {
    if (
      event.relatedTarget instanceof Node &&
      (owner?.contains(event.relatedTarget) || popup?.contains(event.relatedTarget))
    )
      return;
    scheduleClose();
  });
  listen(
    host,
    'keydown',
    (event) => {
      if (event.key === 'Escape' && owner) {
        event.preventDefault();
        event.stopPropagation();
        hide({ returnFocus: popup?.contains(document.activeElement) });
      } else if (event.key === 'ArrowDown' && popup && owner?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        popup.querySelector('[data-preview-open]').focus();
      }
    },
    { capture: true },
  );
  listen(
    document,
    'pointerdown',
    (event) => {
      if (event.pointerType === 'touch') touchUntil = performance.now() + 1000;
      if (popup?.contains(event.target)) return;
      hide();
    },
    { capture: true },
  );
  listen(host, 'click', () => hide(), { capture: true });
  listen(host, 'auxclick', () => hide(), { capture: true });
  listen(host, 'wheel', () => hide(), { capture: true, passive: true });
  listen(
    window,
    'scroll',
    (event) => {
      if (event.target instanceof Node && popup?.contains(event.target)) return;
      hide();
    },
    { capture: true, passive: true },
  );
  listen(window, 'resize', () => hide());
  listen(window, 'blur', () => hide());
  const observer = new MutationObserver(() => {
    if (owner && (!owner.isConnected || !enabled())) hide();
  });
  observer.observe(host, { childList: true, subtree: true });
  return {
    hide,
    destroy() {
      hide();
      observer.disconnect();
      controller.abort();
    },
  };
}
