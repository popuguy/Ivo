import { fontChoices } from '../../../domain/text/font-catalog.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';
import { effectiveTextStyle } from '../../../domain/documents/publishing.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { reflectTextStyle } from '../../../rendering/text/selection-style.js';
/** Retained, draggable contextual controls. Moving the bar never changes a document or its camera. */
export function createContextualBar(
  editor,
  viewport,
  {
    doc,
    state,
    objects,
    editing,
    textEditing = () => false,
    textState = () => null,
    fonts = () => [],
    systemFonts = () => [],
    allowed,
  },
) {
  const bar = document.createElement('aside');
  bar.className = 'canvas-contextual-bar';
  bar.setAttribute('aria-label', 'Contextual text controls');
  bar.hidden = true;
  editor.append(bar);
  const controller = new AbortController();
  let token = '',
    drag = null,
    viewportWidth = 0,
    viewportHeight = 0,
    width = 600,
    height = 35,
    lastRect = null,
    origin = { x: 0, y: 0 };
  const observe = new ResizeObserver((entries) => {
    const size = entries[0].borderBoxSize[0];
    if (size.inlineSize && size.blockSize) {
      width = size.inlineSize;
      height = size.blockSize;
    }
  });
  observe.observe(bar);
  const geometry = new ResizeObserver(() => {
    const a = viewport.getBoundingClientRect(),
      b = editor.getBoundingClientRect();
    viewportWidth = viewport.clientWidth;
    viewportHeight = viewport.clientHeight;
    origin = { x: a.left - b.left, y: a.top - b.top };
    bar.style.maxWidth = Math.max(80, viewportWidth - 16) + 'px';
    layout();
  });
  geometry.observe(viewport);
  geometry.observe(editor);
  bar.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.target.closest('[data-bar-grip]') || event.button !== 0 || !allowed()) return;
      event.preventDefault();
      const old = state.contextBarOffset || { x: 0, y: 0 };
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, old: { ...old } };
      bar.setPointerCapture(event.pointerId);
    },
    { signal: controller.signal },
  );
  bar.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      state.contextBarOffset = {
        x: drag.old.x + event.clientX - drag.x,
        y: drag.old.y + event.clientY - drag.y,
      };
      layout();
    },
    { signal: controller.signal },
  );
  const end = () => {
    if (drag) {
      try {
        bar.releasePointerCapture(drag.id);
      } catch {}
      drag = null;
    }
  };
  bar.addEventListener('pointerup', end, { signal: controller.signal });
  bar.addEventListener(
    'pointercancel',
    () => {
      if (drag) state.contextBarOffset = drag.old;
      end();
      layout();
    },
    { signal: controller.signal },
  );
  function available(selected = objects()) {
    return editing() && selected.length === 1 && ['text', 'quote'].includes(selected[0].type);
  }
  function layout(rect) {
    if (rect !== undefined) lastRect = rect;
    const selected = objects();
    if (!available(selected) || state.contextBarHidden) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const item = selected[0],
      summary = textState(),
      settings =
        summary?.values || effectiveTextStyle(doc(), textFlowForFrame(doc(), item)?.style || item),
      next = JSON.stringify([
        item.id,
        state.tool,
        textEditing(),
        settings.textStyle,
        settings.fontSize,
        settings.textColor,
        settings.align,
        summary?.mixed,
        fonts().map((a) => a.id),
        systemFonts().length,
      ]);
    if (token !== next && !bar.contains(document.activeElement)) {
      token = next;
      const choices = fontChoices(fonts(), systemFonts(), settings.textStyle);
      delete bar.dataset.reflected;
      bar.innerHTML = `<button data-bar-grip aria-label="Move contextual bar" data-tooltip="Drag contextual bar">${icon('menu')}</button><select data-object-prop="textStyle" aria-label="Contextual font family">${choices.map(([id, name]) => `<option value="${id}" ${settings.textStyle === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select><button data-canvas-command="bold" aria-label="Bold" data-tooltip="Bold">${icon('bold')}</button><button data-canvas-command="italic" aria-label="Italic" data-tooltip="Italic">${icon('italic')}</button><input type="number" step="any" min="1" max="2000" data-object-prop="fontSize" aria-label="Contextual point size" value="${settings.fontSize || 16}"><span>pt</span><input type="color" data-object-prop="textColor" aria-label="Contextual text fill" value="${settings.textColor || '#252525'}"><select data-object-prop="align" aria-label="Contextual paragraph alignment">${[
        ['left', 'Left'],
        ['center', 'Center'],
        ['right', 'Right'],
        ['justify', 'Justify'],
      ]
        .map(
          ([id, name]) =>
            `<option value="${id}" ${settings.align === id ? 'selected' : ''}>${name}</option>`,
        )
        .join(
          '',
        )}</select><button data-canvas-command="type-options" aria-label="Explore more type options" data-tooltip="Explore more type options">${icon('opentype')}</button><button data-canvas-command="highlight-options" aria-label="Text highlight" data-tooltip="Text highlight">${icon('highlighter')}</button><button data-close-contextual aria-label="Hide contextual bar" data-tooltip="Hide contextual bar">${icon('close')}</button>`;
    }
    const reflected = JSON.stringify(summary);
    if (bar.dataset.reflected !== reflected) {
      reflectTextStyle(bar, summary);
      bar.dataset.reflected = reflected;
    }
    const offset = state.contextBarOffset || { x: 0, y: 0 },
      selection = lastRect;
    if (!selection) return;
    const x = Math.max(4, Math.min(viewportWidth - width - 8, selection.x + offset.x));
    const bottom = viewportHeight - height - 8,
      below = selection.y + selection.h + 12,
      above = selection.y - height - 12;
    const target =
      !state.contextBarOffset && below > bottom && above >= 4 ? above : below + offset.y;
    const y = Math.max(4, Math.min(bottom, target));
    bar.style.transform = `translate3d(${origin.x + x}px,${origin.y + y}px,0)`;
  }
  bar.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-close-contextual]')) {
        state.contextBarHidden = true;
        bar.hidden = true;
      }
    },
    { signal: controller.signal },
  );
  return {
    available,
    layout,
    caretClearance: () =>
      bar.hidden || !textEditing() || !bar.getClientRects().length ? 0 : height + 8,
    destroy() {
      end();
      controller.abort();
      observe.disconnect();
      geometry.disconnect();
      bar.remove();
    },
  };
}
