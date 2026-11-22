import { ruleSections, installStyleRules } from './paragraph-style-rules.js';
import { markParagraphDialog } from './paragraph-destinations.js';
import { referenceFormatDialog } from './reference-format-dialog.js';
import {
  crossReferenceResolver,
  crossReferenceFormats,
} from '../../../domain/documents/cross-references.js';
import { generatedTextCommands } from './publication-commands.js';
import { indexDialog, indexHTML } from './subject-index.js';
import { contentsDialog, contentsHTML } from './table-of-contents.js';
import {
  generatedTextFlow,
  canPlacePublicationText,
  writePublicationText,
} from '../../../domain/documents/contents.js';
import { readyImageWrapResources } from '../../../rendering/text/image-contours.js';
import { pageFolios } from '../../../domain/documents/page-sections.js';
import { editSection } from './section-options.js';
import { importTextStyles } from '../../../domain/documents/import-text-styles.js';
import { openStyleImport } from './import-text-styles.js';
import { openExceptionDictionary } from './hyphenation-dialog.js';
import { nativeTextColumnWidth } from '../../../rendering/text/native-flow-layout.js';
import {
  openHyphenationForm,
  hyphenationStyleFields,
  readHyphenationStyle,
} from './hyphenation-dialog.js';
import {
  baselineGridSettings,
  BASELINE_GRID_DEFAULTS,
  FRAME_GRID_DEFAULTS,
  frameGridSettings,
} from '../../../domain/text/baseline-grid.js';
import { markTypographyVersion } from '../../../domain/documents/capabilities.js';
import { HYPHENATION_DEFAULTS } from '../../../domain/text/hyphenation.js';
import { PARAGRAPH_STARTS } from '../../../domain/text/paragraph-keep-policy.js';
import { uniformWrapOffset } from '../../../domain/geometry/wrap-contour.js';
import { PANEL_KINDS } from '../../../domain/workspace/panels.js';
import { installPageLayerInteractions } from './page-layer-interactions.js';
import { ARRANGE_COMMANDS, arrangeObjects } from '../../../domain/documents/arrange.js';
import { legacyFontFamilies } from '../../../domain/text/font-references.js';
import {
  normalizeTextWrap,
  setTextWrap,
  setTextWrapDefaults,
  normalizeTextWrapPreferences,
  setIgnoreTextWrap,
  setTextWrapPreferences,
  setLayerIgnoreWrap,
} from '../../../domain/documents/text-wrap.js';
import {
  enablePublishing,
  enableFrameComposition,
  layersFor,
  addLayer,
  removeLayer,
  moveToLayer,
  createParent,
  overrideParent,
  saveTextStyle,
} from '../../../domain/documents/publishing.js';
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../../../domain/text/typography.js';
import { DEFAULT_WORD_SPACING, wordSpacingSettings } from '../../../domain/text/word-spacing.js';
import { prepareFont } from '../assets/font-import.js';
import { dialogMarkup, installDialogDismissal } from '../../../shared/ui/dialog.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { createOpenTypePopover } from './opentype-popover.js';
import { openTabsForm, installStyleTabs, styleTabFields } from './tab-stops-dialog.js';
import { openKeepOptionsForm } from './keep-options-dialog.js';
import {
  createWordSpacingDialog,
  justificationFields,
  readJustificationField,
} from './word-spacing-dialog.js';

/** Publishing controls use the same transaction/history owner as canvas edits. */
export function installPublishingControls(
  editor,
  {
    doc,
    state,
    objects,
    mutate,
    applyTextProperty,
    applyStyleSequence,
    render,
    select,
    allowed,
    dialogAllowed,
    preserveRange,
    notify,
    onAsset,
    onEditParent,
    readContents,
    focusContents,
    showPanel,
    clearOverrides,
    fonts = () => [],
    assets = () => [],
    parentMode = false,
    textState,
    resolveFont,
    refreshSystemFonts,
    prepareDocumentFonts,
    canPrepareFonts,
    nativeComposition,
    placedParagraphs,
    prepareReferencePlacements,
    documents,
    ensureFontVariant,
    fontSelection,
    applyTextSettings,
  },
) {
  const controller = new AbortController(),
    listen = (target, type, fn, options = {}) =>
      target.addEventListener(
        type,
        (event) => {
          if (
            target === editor &&
            event.target instanceof Element &&
            event.target.closest('.scene-editor') !== editor
          )
            return;
          fn(event);
        },
        { signal: controller.signal, ...options },
      );
  let popover = null,
    wordSpacingDialog = null,
    paragraphDialog = null,
    fontWork = Promise.resolve(),
    wrapWork = null,
    wrapRevision = 0,
    fontPending = 0,
    preparedLegacy = '';
  const disclosureKey = 'ivo:property-disclosures:1';
  try {
    const saved = JSON.parse(localStorage.getItem(disclosureKey));
    if (saved && typeof saved === 'object') state.propertyDisclosures = saved;
  } catch {}
  function saveDisclosure(key, value) {
    (state.propertyDisclosures ||= {})[key] = value;
    try {
      localStorage.setItem(disclosureKey, JSON.stringify(state.propertyDisclosures));
    } catch {}
  }
  const uniformOffsets = (value) => ({ top: value, right: value, bottom: value, left: value });
  function editWrap(label, patchFor, control) {
    const selected = objects();
    if (!selected.length && (parentMode || !control.closest('.wrap-panel'))) return;
    const targets = selected.length ? selected : [null];
    const changes = targets
      .map((object) => {
        const current = normalizeTextWrap(
          object ? object.textWrap : doc().extensions?.ivoTextWrapDefaults,
        );
        return { object, patch: patchFor(current, object) };
      })
      .filter(({ patch }) => patch);
    if (!changes.length) return;
    mutate(() => {
      for (const { object, patch } of changes) {
        if (object) setTextWrap(doc(), [object.id], patch);
        else setTextWrapDefaults(doc(), patch);
      }
    }, label);
  }
  function prepareLegacyFonts() {
    const signature = JSON.stringify([...legacyFontFamilies(doc())].sort());
    if (!prepareDocumentFonts || !canPrepareFonts() || signature === preparedLegacy) return;
    preparedLegacy = signature;
    const snapshot = structuredClone(doc());
    fontPending++;
    fontWork = fontWork
      .then(() => prepareDocumentFonts(snapshot))
      .catch((error) => {
        preparedLegacy = '';
        notify?.(error.message);
      })
      .finally(() => fontPending--);
  }
  function fontTransaction(prepare) {
    if (!allowed()) return Promise.resolve(false);
    const target = fontSelection();
    fontPending++;
    fontWork = fontWork
      .then(async () => {
        const settings = await prepare();
        if (!allowed() || fontSelection() !== target) return false;
        applyTextSettings(settings, 'Font');
        render();
        return true;
      })
      .catch((error) => {
        notify?.(error.message);
        if (allowed() && fontSelection() === target) render();
        return false;
      })
      .finally(() => fontPending--);
    return fontWork;
  }
  function closePopover() {
    popover?.destroy();
    popover = null;
  }
  function closeWordSpacingDialog() {
    wordSpacingDialog?.destroy();
    wordSpacingDialog = null;
  }
  function nativeTextFlow() {
    if (!nativeComposition) return null;
    const item = objects()[0];
    return doc().textFlows?.find((flow) => flow.id === item?.textFlowId && flow.composition);
  }
  function openParagraphOptions(name) {
    preserveRange();
    const flow = nativeTextFlow(),
      summary = textState();
    if (!flow || !summary || paragraphDialog?.open) return;
    const source = flow.html,
      target = fontSelection();
    closePopover();
    closeWordSpacingDialog();
    const isKeep = name === 'keep-options';
    const title = name === 'tabs' ? 'Tabs' : isKeep ? 'Keep Options' : 'Hyphenation';
    const openForm = isKeep ? openKeepOptionsForm : openHyphenationForm;
    const apply = (patch) => {
      const current = nativeTextFlow();
      if (
        !dialogAllowed?.() ||
        current?.id !== flow.id ||
        current?.html !== source ||
        target !== fontSelection()
      )
        throw Error(`The text selection changed. Reopen ${title} for the current text.`);
      if (Object.keys(patch).length) applyTextSettings(patch, title);
      render();
    };
    const dialog =
      name === 'tabs'
        ? openTabsForm(form, summary, apply, nativeTextColumnWidth(objects()[0]))
        : openForm(form, summary, apply);
    paragraphDialog = dialog;
    dialog.addEventListener(
      'close',
      () => {
        if (paragraphDialog === dialog) paragraphDialog = null;
      },
      { once: true },
    );
  }
  function openWordSpacing() {
    preserveRange();
    const summary = textState(),
      flow = nativeTextFlow();
    if (!summary || !flow) {
      notify?.('Choose a text flow with native composition before editing word spacing.');
      return;
    }
    const owner = {
      document: doc().id,
      flow: flow.id,
      selection: objects()
        .map((item) => item.id)
        .join('|'),
      source: flow.html,
    };
    closePopover();
    closeWordSpacingDialog();
    wordSpacingDialog = createWordSpacingDialog({
      summary,
      apply: (value) => {
        const current = nativeTextFlow();
        if (
          controller.signal.aborted ||
          !dialogAllowed?.() ||
          owner.document !== doc().id ||
          owner.flow !== current?.id ||
          owner.source !== current.html ||
          owner.selection !==
            objects()
              .map((item) => item.id)
              .join('|')
        )
          throw Error('The text selection changed. Reopen Justification for the current text.');
        const result = applyTextProperty('wordSpacing', value);
        if (result !== false) render();
        return result;
      },
      onClose: () => (wordSpacingDialog = null),
    });
  }
  function run(action) {
    if (!allowed()) return;
    try {
      action();
    } catch (error) {
      notify?.(error.message);
    }
  }
  function currentLayer() {
    return layersFor(doc()).find((l) => l.id === state.activeLayer) || layersFor(doc())[0];
  }
  function form(title, fields, onSubmit) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal publishing-style-dialog';
    dialog.innerHTML = dialogMarkup(
      `<h2>${esc(title)}</h2>${fields}<p role="alert"></p><button type="submit">OK</button>`,
    );
    const dismissal = installDialogDismissal(dialog);
    document.body.append(dialog);
    dialog.addEventListener(
      'close',
      () => {
        dismissal.destroy();
        dialog.remove();
      },
      { once: true },
    );
    let submitting = false;
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        if (submitting) return;
        submitting = true;
        const result = onSubmit(new FormData(event.currentTarget));
        if (result instanceof Promise) {
          dialog.setAttribute('aria-busy', 'true');
          await result;
        }
        if (dialog.open) dialog.close();
      } catch (error) {
        dialog.querySelector('[role=alert]').textContent = error.message;
      } finally {
        submitting = false;
        dialog.removeAttribute('aria-busy');
      }
    });
    dialog.showModal();
    dialog.querySelector('input')?.focus();
    return dialog;
  }
  function styleForm(kind, edit = false) {
    const item = objects()[0],
      flow = doc().textFlows?.find((f) => f.id === item?.textFlowId),
      settings = flow?.style || item || {};
    const definitions = doc().publishing?.[kind + 'Styles'] || [],
      existing = edit ? definitions.find((s) => s.id === settings[kind + 'Style']) : null;
    if (edit && !existing) {
      notify?.('Choose a named style to edit.');
      return;
    }
    const fields = Object.keys({
      ...CHARACTER_FIELDS,
      ...(kind === 'paragraph' ? PARAGRAPH_FIELDS : {}),
    }).filter((k) => !['characterStyle', 'paragraphStyle'].includes(k));
    const attributes =
      existing?.attributes ||
      Object.fromEntries(
        fields
          .filter(
            (key) =>
              settings[key] !== undefined &&
              !(
                Object.hasOwn(HYPHENATION_DEFAULTS, key) &&
                HYPHENATION_DEFAULTS[key] === settings[key]
              ) &&
              !(key === 'paragraphStart' && settings[key] === 'anywhere') &&
              !(key === 'keepNextLines' && settings[key] === 1) &&
              !(
                ['keepWithPrevious', 'keepBoundaryLines', 'noBreak'].includes(key) &&
                settings[key] === false
              ),
          )
          .map((key) => [key, settings[key]]),
      );
    const spacing = wordSpacingSettings(attributes.wordSpacing ?? 'normal') || DEFAULT_WORD_SPACING,
      spacingMode =
        attributes.wordSpacing === undefined
          ? 'inherit'
          : attributes.wordSpacing === 'normal'
            ? 'normal'
            : 'custom';
    const keepFields =
      kind === 'paragraph' && nativeTextFlow()
        ? [
            ['keepWithPrevious', 'Keep with previous', [false, true]],
            ['keepWithNext', 'Keep with next', [false, true]],
            ['keepNextLines', 'Following lines', [1, 2, 3, 4, 5]],
            ['keepTogether', 'All Lines in Paragraph', [false, true]],
            ['keepBoundaryLines', 'At Start/End of Paragraph', [false, true]],
            ...[
              ['orphans', 'At Start'],
              ['widows', 'At End'],
            ].map(([key, label]) => [key, label, Array.from({ length: 20 }, (_, i) => i + 1)]),
            ['paragraphStart', 'Start Paragraph', Object.keys(PARAGRAPH_STARTS)],
          ]
        : [];
    const styleOptions = nativeTextFlow()
      ? [...keepFields, ['noBreak', 'No Break', [false, true]]]
      : [];
    const nativeParagraphOptions = kind === 'paragraph' && nativeTextFlow();
    let readStyleTabs, readRules;
    const nextStyleField =
      kind === 'paragraph'
        ? `<label>Next Style<select name="nextStyle"><option value="">[Same Style]</option>${definitions
            .filter((s) => s.id !== existing?.id)
            .map(
              (s) =>
                `<option value="${esc(s.id)}" ${existing?.nextStyle === s.id ? 'selected' : ''}>${esc(s.name)}</option>`,
            )
            .join('')}</select></label>`
        : '';
    const keepControls = styleOptions
      .map(
        ([key, label, values]) =>
          `<label>${label}<select name="${key}"><option value="">Inherited</option>${values.map((value) => `<option value="${value}" ${attributes[key] === value ? 'selected' : ''}>${value === true ? 'On' : value === false ? 'Off' : (PARAGRAPH_STARTS[value] ?? value)}</option>`).join('')}</select></label>`,
      )
      .join('');
    const dialog = form(
      (edit ? 'Edit ' : 'New ') + kind + ' style',
      `<label>Name<input name="name" value="${esc(existing?.name || '')}" required maxlength="120"></label><label>Based on<select name="basedOn"><option value="">[None]</option>${definitions
        .filter((s) => s.id !== existing?.id)
        .map(
          (s) =>
            `<option value="${s.id}" ${existing?.basedOn === s.id ? 'selected' : ''}>${esc(s.name)}</option>`,
        )
        .join(
          '',
        )}</select></label>${nextStyleField}${kind === 'paragraph' ? ruleSections : ''}<label>Point size<input type="number" min="1" max="2000" step="any" name="fontSize" value="${attributes.fontSize || ''}" placeholder="Inherited"></label><label>Leading (0 = Auto)<input type="number" min="0" max="4000" step="any" name="leading" value="${attributes.leading ?? ''}" placeholder="Inherited"></label>${keepControls}${nativeParagraphOptions ? hyphenationStyleFields(attributes) + styleTabFields : ''}<label>Tracking<input type="number" min="-1000" max="10000" step="any" name="tracking" value="${attributes.tracking ?? ''}" placeholder="Inherited"></label>${
        nativeParagraphOptions
          ? `<label>Justification<select name="wordSpacingMode" data-style-word-spacing-mode>${[
              ['inherit', 'Inherited'],
              ['normal', 'Normal'],
              ['custom', 'Custom'],
            ]
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${spacingMode === value ? 'selected' : ''}>${label}</option>`,
              )
              .join('')}</select></label>${justificationFields(spacing, false, true)}`
          : ''
      }`,
      (data) => {
        const next = { ...attributes };
        if (nativeParagraphOptions) readHyphenationStyle(data, next);
        for (const key of ['fontSize', 'leading', 'tracking'])
          if (data.get(key) === '') delete next[key];
          else next[key] = Number(data.get(key));
        for (const [key, , values] of styleOptions) {
          const selected = data.get(key);
          if (!selected) delete next[key];
          else {
            const value = values.find((value) => String(value) === selected);
            if (value === undefined) throw Error('Invalid text style option.');
            next[key] = value;
          }
        }
        if (nativeParagraphOptions) {
          const tabStops = readStyleTabs();
          if (tabStops === undefined) delete next.tabStops;
          else next.tabStops = tabStops;
          const mode = data.get('wordSpacingMode');
          if (mode === 'inherit') delete next.wordSpacing;
          else
            next.wordSpacing =
              mode === 'normal'
                ? 'normal'
                : readJustificationField(
                    (key) => data.get('wordSpacing-' + key),
                    spacing.glyphDesired !== undefined,
                  );
          if (next.wordSpacing !== attributes.wordSpacing && !nativeTextFlow())
            throw Error('Choose a text flow with native composition before editing word spacing.');
        }
        mutate(
          () =>
            saveTextStyle(doc(), kind, {
              ...(existing ? { id: existing.id } : {}),
              name: data.get('name'),
              basedOn: data.get('basedOn') || null,
              nextStyle: data.get('nextStyle') || null,
              ...readRules(),
              attributes: next,
            }),
          edit ? 'Edit text style' : 'New text style',
        );
      },
    );
    readRules = installStyleRules(dialog, existing, doc());
    if (nativeParagraphOptions)
      readStyleTabs = installStyleTabs(
        dialog,
        attributes.tabStops,
        item && nativeTextColumnWidth(item),
        Number(attributes.leftIndent) || 0,
      );
    const mode = dialog.querySelector('[data-style-word-spacing-mode]');
    if (mode) {
      const reflect = () => {
        for (const field of dialog.querySelectorAll('[data-style-word-spacing-field]'))
          field.disabled = mode.value !== 'custom';
      };
      mode.addEventListener('change', reflect);
      reflect();
    }
  }
  function openType(anchor) {
    closePopover();
    if (!textState()) return;
    const trigger =
      (anchor?.getClientRects().length ? anchor : null) ||
      editor.querySelector('.canvas-type-options') ||
      editor.querySelector('.canvas-contextual-bar [data-canvas-command="type-options"]');
    if (!trigger) return;
    popover = createOpenTypePopover(editor, {
      anchor: trigger,
      textState,
      fonts,
      preserveRange,
      previewText: () => {
        const selected = window.getSelection();
        if (selected?.rangeCount && editor.contains(selected.anchorNode) && selected.toString())
          return selected.toString();
        const item = objects()[0],
          flow = doc().textFlows?.find((f) => f.id === item?.textFlowId),
          root = document.createElement('div');
        root.innerHTML = flow?.html ?? item?.html ?? '';
        return root.textContent;
      },
      apply: (field, value) => run(() => applyTextProperty(field, value)),
      onClose: closePopover,
    });
  }
  listen(editor, 'pointerdown', (event) => {
    if (
      event.target.closest(
        '[data-highlight-color],[data-type-feature],[data-canvas-command="word-spacing"],[data-canvas-command="keep-options"],[data-canvas-command="hyphenation-options"],[data-property-step],[data-paragraph-align],[data-font-style],[data-property-disclosure],[data-property-presets]',
      )
    ) {
      preserveRange();
      if (event.target.closest('button')) event.preventDefault();
    }
  });
  listen(window, 'pointerdown', (event) => {
    if (
      popover &&
      !popover.element.contains(event.target) &&
      event.target.closest('[data-canvas-command="type-options"]')?.closest('.scene-editor') !==
        editor
    )
      closePopover();
  });
  listen(
    editor,
    'keydown',
    (event) => {
      if (event.key === 'Escape' && popover) {
        event.preventDefault();
        event.stopPropagation();
        closePopover();
      }
    },
    { capture: true },
  );
  listen(editor, 'click', (event) => {
    const summary = event.target.closest('summary[data-property-disclosure]');
    if (summary) {
      saveDisclosure(summary.dataset.propertyDisclosure, !summary.parentElement.open);
      return;
    }
    const t = event.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-wrap-more')) {
      saveDisclosure('wrap', !state.propertyDisclosures?.wrap);
      render();
      editor.querySelector('[data-wrap-more]')?.focus({ preventScroll: true });
      return;
    }
    if (t.hasAttribute('data-property-constrain')) {
      state.constrainProportions = !state.constrainProportions;
      render();
      return;
    }
    if (t.dataset.styleKind) {
      state.styleKind = t.dataset.styleKind;
      render();
      return;
    }
    if (t.hasAttribute('data-transform-reference')) {
      state.transformReference = Number(t.dataset.transformReference);
      render();
      return;
    }
    if (t.hasAttribute('data-layer-select')) {
      state.activeLayer = t.dataset.layerSelect;
      render();
      return;
    }
    if (t.hasAttribute('data-layer-object')) {
      select(t.dataset.layerObject);
      return;
    }
    if (!allowed()) return;
    run(() => {
      if (t.hasAttribute('data-property-step')) {
        const input = t.closest('.property-number').querySelector('input');
        const old = input.value;
        // Auto leading is represented by zero; step from the composed leading shown to the user.
        if (input.dataset.objectProp === 'leading' && input.value === '0') {
          const settings = textState()?.values;
          if (settings?.fontSize)
            input.value = String((settings.fontSize * (settings.autoLeading || 120)) / 100);
        }
        if (input.step === 'any') {
          const next = Number(input.value) + Number(t.dataset.propertyStep);
          input.value = String(
            Math.max(
              input.min ? Number(input.min) : -Infinity,
              Math.min(input.max ? Number(input.max) : Infinity, next),
            ),
          );
        } else if (t.dataset.propertyStep === '1') input.stepUp();
        else input.stepDown();
        if (input.value !== old) input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (t.dataset.paragraphAlign) {
        applyTextProperty('align', t.dataset.paragraphAlign);
        return;
      }
      if (t.dataset.objectNone) {
        mutate(() => {
          objects()[0][t.dataset.objectNone] = 'none';
        }, 'Object paint');
        return;
      }
      if (t.hasAttribute('data-wrap-link')) {
        state.wrapOffsetsLinked = t.getAttribute('aria-pressed') !== 'true';
        if (state.wrapOffsetsLinked)
          editWrap(
            'Link text wrap offsets',
            (current) =>
              Object.values(current.offsets).every((value) => value === current.offsets.top)
                ? null
                : { offsets: uniformOffsets(current.offsets.top) },
            t,
          );
        render();
        return;
      }
      if (t.dataset.textWrapMode) {
        const mode = t.dataset.textWrapMode;
        editWrap(
          'Text wrap mode',
          (current, object) => {
            if (current.mode === mode) return null;
            return {
              mode,
              ...(uniformWrapOffset(object, mode) && {
                offsets: uniformOffsets(current.offsets.top),
              }),
            };
          },
          t,
        );
        return;
      }
      if (t.dataset.highlightColor) {
        applyTextProperty('highlight', t.dataset.highlightColor);
        return;
      }
      if (t.dataset.frameNone) {
        mutate(() => {
          enablePublishing(doc());
          (objects()[0].frameOptions ||= {})[t.dataset.frameNone] = 'none';
        }, 'Frame paint');
        return;
      }
      if (t.dataset.layerToggle) {
        mutate(
          () => {
            const old = currentLayer(),
              p = enablePublishing(doc()),
              layer =
                p.layers.find((l) => l.id === t.dataset.layerId) ||
                p.layers.find((l) => l.name === old.name);
            layer[t.dataset.layerToggle] = !layer[t.dataset.layerToggle];
            state.activeLayer = layer.id;
          },
          'Layer ' + t.dataset.layerToggle,
          t.dataset.layerToggle === 'locked' ? t : null,
        );
        return;
      }
      if (t.dataset.objectToggle) {
        mutate(
          () => {
            enablePublishing(doc());
            const item = doc().blocks.find((b) => b.id === t.dataset.objectId);
            item[t.dataset.objectToggle] = !item[t.dataset.objectToggle];
          },
          'Object ' + t.dataset.objectToggle,
          t.dataset.objectToggle === 'locked' ? t : null,
        );
        return;
      }
      if (t.dataset.layerMove) {
        mutate(
          () =>
            moveToLayer(
              doc(),
              objects().map((b) => b.id),
              t.dataset.layerMove,
            ),
          'Move to layer',
        );
        return;
      }
    });
  });
  listen(editor, 'change', (event) =>
    run(() => {
      const t = event.target;
      if (t.hasAttribute('data-property-presets')) {
        const input = t.closest('.property-number').querySelector('input');
        input.value = t.value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (t.hasAttribute('data-font-style')) {
        const option = t.selectedOptions[0];
        if (!option) return;
        const bold = option.dataset.bold === 'true',
          italic = option.dataset.italic === 'true';
        const ids = textState()?.fonts || [];
        void fontTransaction(async () => {
          if (option.hasAttribute('data-font-face')) {
            const settings = resolveFont
              ? await resolveFont(option.value)
              : { textStyle: option.value };
            return { ...settings, bold, italic };
          }
          for (const id of ids.filter((font) => font.startsWith('font-')))
            await ensureFontVariant?.(id, bold, italic);
          return { bold, italic };
        });
        return;
      }
      if (t.hasAttribute('data-wrap-inside')) {
        editWrap('Include Inside Edges', () => ({ contour: { insideEdges: t.checked } }), t);
        return;
      }
      if (t.hasAttribute('data-wrap-contour')) {
        const source = t.value,
          revision = ++wrapRevision;
        if (source === 'alpha' || source === 'edges') {
          const selected = objects(),
            snapshot = selected.map((b) => ({
              ...b,
              textWrap: { mode: 'contour', contour: { source } },
            }));
          wrapWork = readyImageWrapResources({ blocks: snapshot }, assets())
            .then(() => {
              const current = objects();
              if (
                revision === wrapRevision &&
                !controller.signal.aborted &&
                allowed() &&
                current.length === selected.length &&
                current.every((b, i) => b.id === selected[i].id && b.src === snapshot[i].src)
              )
                editWrap('Contour type', () => ({ contour: { source } }), t);
            })
            .catch((error) => {
              if (revision === wrapRevision) {
                notify?.(error.message);
                render();
              }
            })
            .finally(() => {
              if (revision === wrapRevision) wrapWork = null;
            });
        } else {
          wrapWork = null;
          editWrap('Contour type', () => ({ contour: { source } }), t);
        }
        return;
      }
      if (t.dataset.textWrap) {
        const key = t.dataset.textWrap,
          value = t.type === 'checkbox' ? t.checked : t.value;
        editWrap(
          'Text wrap options',
          (current) => {
            if (current[key] === value) return null;
            // Stored offsets describe geometry. Invert keeps the displayed distances and flips their direction.
            if (key === 'invert')
              return {
                invert: value,
                offsets: Object.fromEntries(
                  Object.entries(current.offsets).map(([side, distance]) => [side, -distance || 0]),
                ),
              };
            return { [key]: value };
          },
          t,
        );
        return;
      }
      if (t.dataset.textWrapOffset) {
        if (!t.value.trim()) throw new Error('Enter a text wrap offset.');
        const value = Number(t.value),
          key = t.dataset.textWrapOffset;
        editWrap(
          'Text wrap offset',
          (current, object) => {
            const link = t.closest('.wrap-controls')?.querySelector('[data-wrap-link]');
            const uniform =
              link?.getAttribute('aria-pressed') === 'true' ||
              uniformWrapOffset(object, current.mode);
            const distance = current.invert ? -value : value;
            return { offsets: uniform ? uniformOffsets(distance) : { [key]: distance } };
          },
          t,
        );
        return;
      }
      if (t.hasAttribute('data-ignore-text-wrap')) {
        const ids = objects()
          .filter((object) => ['text', 'quote'].includes(object.type))
          .map((object) => object.id);
        mutate(() => setIgnoreTextWrap(doc(), ids, t.checked), 'Ignore text wrap');
        return;
      }
      if (t.dataset.textWrapPref) {
        const key = t.dataset.textWrapPref,
          value = t.type === 'checkbox' ? t.checked : t.value;
        mutate(() => setTextWrapPreferences(doc(), { [key]: value }), 'Text wrap preferences');
        return;
      }
      if (t.dataset.baselineGridSetting) {
        if (!nativeComposition) throw Error('Set document baseline grids in the native app.');
        const settings = baselineGridSettings({
          ...(doc().publishing?.baselineGrid || BASELINE_GRID_DEFAULTS),
          [t.dataset.baselineGridSetting]:
            t.dataset.baselineGridSetting === 'relativeTo' ? t.value : t.valueAsNumber,
        });
        mutate(() => {
          enablePublishing(doc()).baselineGrid = settings;
          markTypographyVersion(doc());
        }, 'Document baseline grid');
        return;
      }
      if (t.dataset.frameGrid && objects().length === 1) {
        if (!nativeTextFlow())
          throw Error('Choose a native text composer to use a custom baseline grid.');
        const frame = objects()[0],
          key = t.dataset.frameGrid;
        const prior = frame.frameOptions?.baselineGrid || FRAME_GRID_DEFAULTS;
        const grid =
          key === 'enabled'
            ? t.checked
              ? prior
              : null
            : frameGridSettings({
                ...prior,
                [key]: key === 'relativeTo' ? t.value : t.valueAsNumber,
              });
        mutate(() => {
          enablePublishing(doc());
          frame.frameOptions ||= {};
          if (grid) frame.frameOptions.baselineGrid = { ...grid };
          else delete frame.frameOptions.baselineGrid;
          markTypographyVersion(doc());
        }, 'Custom baseline grid');
        return;
      }
      if (t.dataset.frameProp && objects().length === 1) {
        const key = t.dataset.frameProp,
          value = t.type === 'number' ? Number(t.value) : t.value;
        if (t.type === 'number' && (!Number.isFinite(value) || value < 0 || value > 2000))
          throw new Error('Choose a valid frame value.');
        if (
          ((key === 'verticalAlign' && value === 'justify') || key === 'paragraphSpacingLimit') &&
          !nativeTextFlow()
        )
          throw new Error('Choose a native text composer to use vertical Justify.');
        if (key === 'strokeWidth' && value > 100)
          throw new Error('Use a stroke weight between 0 and 100 pt.');
        if (key === 'columns' && (!Number.isInteger(value) || value < 1 || value > 40))
          throw new Error('Use 1–40 whole columns.');
        const candidate = { ...(objects()[0].frameOptions || {}), [key]: value },
          frame = objects()[0];
        if (
          (candidate.insetLeft || 0) +
            (candidate.insetRight || 0) +
            ((candidate.columns || 1) - 1) * (candidate.gutter ?? 12) >=
            frame.w - 1 ||
          (candidate.insetTop || 0) + (candidate.insetBottom || 0) >= frame.h - 1
        )
          throw new Error('Insets and gutters must leave room for text.');
        mutate(() => {
          if (key === 'firstBaseline' || key === 'minimumFirstBaseline') {
            enableFrameComposition(doc());
            if (key === 'firstBaseline' && value === 'legacy') {
              delete candidate.firstBaseline;
              delete candidate.minimumFirstBaseline;
            } else candidate.firstBaseline ||= 'ascent';
          } else enablePublishing(doc());
          objects()[0].frameOptions = candidate;
          if (
            candidate.verticalAlign === 'justify' ||
            candidate.paragraphSpacingLimit !== undefined
          )
            markTypographyVersion(doc());
        }, 'Text frame options');
      }
    }),
  );
  listen(editor.querySelector('.canvas-font-input'), 'change', (event) => {
    if (!allowed()) return;
    const files = [...event.target.files],
      target = objects()
        .map((o) => o.id)
        .join('|');
    event.target.value = '';
    fontPending++;
    fontWork = fontWork
      .then(async () => {
        for (const file of files) {
          const asset = await prepareFont(file);
          if (!allowed()) return;
          await onAsset(asset);
          if (!allowed()) return;
          if (
            objects()
              .map((o) => o.id)
              .join('|') === target
          )
            applyTextProperty('textStyle', asset.id);
        }
        render();
      })
      .catch((error) => notify?.(error.message))
      .finally(() => fontPending--);
  });
  installPageLayerInteractions(editor, {
    listen,
    doc,
    state,
    objects,
    render,
    mutate,
    run,
    allowed,
    parentMode,
    onEditParent,
  });
  return {
    openForm: form,
    prepareLegacyFonts,
    chooseFont(value) {
      return fontTransaction(() => resolveFont(value));
    },
    variant(field, value) {
      const summary = textState(),
        ids = summary?.fonts.filter((id) => /^font-/.test(id)) || [];
      if (!ensureFontVariant || !ids.length || !['bold', 'italic'].includes(field)) return false;
      void fontTransaction(async () => {
        for (const id of ids)
          await ensureFontVariant(
            id,
            field === 'bold' ? value : summary.values.bold === true,
            field === 'italic' ? value : summary.values.italic === true,
          );
        const settings = { [field]: value };
        if (
          field === 'bold' &&
          ids.some((id) =>
            fonts()
              .find((asset) => asset.id === id)
              ?.font.axes.some((axis) => axis.tag === 'wght'),
          )
        ) {
          settings.fontVariations =
            (summary.values.fontVariations || '')
              .split(',')
              .filter((pair) => pair && pair !== 'normal' && !pair.startsWith('wght:'))
              .join(',') || 'normal';
        }
        return settings;
      });
      return true;
    },
    flush: () => Promise.all([fontWork, wrapWork]),
    get pending() {
      return fontPending > 0 || !!wrapWork;
    },
    refreshTextState() {
      popover?.refresh();
    },
    choosePageLink(reference = false) {
      const owner = doc(),
        others = documents().filter((d) => d.id !== owner.id && d.pages?.length);
      return new Promise((resolve) => {
        let paragraphs = new Map(),
          generation = 0,
          measuredChapter = null;
        const dialog = form(
          reference ? 'New Cross-Reference' : 'Insert Page Link',
          (others.length
            ? '<label>Document<select name="chapter">' +
              [owner, ...others]
                .map((d) => '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>')
                .join('') +
              '</select></label>'
            : '') +
            (reference
              ? '<label>Link to<select name="targetKind"><option value="page">Page</option><option value="paragraph">Paragraph</option></select></label>'
              : '') +
            '<label><span data-target-label>Page</span><select name="destination"></select></label>' +
            (reference
              ? '<label>Cross-Reference Format<select name="format">' +
                [
                  ...Object.entries(crossReferenceFormats),
                  ...(owner.referenceFormats || []).map((f) => [f.id, f.name]),
                ]
                  .map(([key, name]) => '<option value="' + key + '">' + esc(name) + '</option>')
                  .join('') +
                '</select></label><label>Preview<output name="preview"></output></label>'
              : ''),
          (data) => {
            const id = data.get('chapter') || owner.id;
            const chapter = [owner, ...documents()].find((d) => d.id === id);
            const key = data.get('targetKind') === 'paragraph' ? data.get('destination') : '';
            const dest = key && paragraphs.get(key);
            if (
              data.get('targetKind') === 'paragraph' &&
              (!dest?.pageId || !chapter || JSON.stringify(chapter) !== measuredChapter)
            )
              throw Error('Choose a current printed paragraph destination.');
            if (reference && !fields.preview.value)
              throw Error('Choose a format available for this destination.');
            resolve({
              documentId: id,
              pageId: dest?.pageId || data.get('destination'),
              ...(key && { paragraph: dest }),
              ...(reference && { format: data.get('format') }),
            });
          },
        );
        dialog.setAttribute('aria-label', reference ? 'New Cross-Reference' : 'Insert Page Link');
        const fields = dialog.querySelector('form').elements;
        function showPreview() {
          if (!reference) return;
          const id = fields.chapter?.value || owner.id;
          const dest =
            fields.targetKind.value === 'paragraph'
              ? paragraphs.get(fields.destination.value)
              : null;
          fields.preview.value =
            crossReferenceResolver([owner, ...others], owner)(
              id,
              dest?.pageId || fields.destination.value,
              fields.format.value,
              dest,
            ) ?? '';
        }
        async function showPages(chapter) {
          const current = ++generation;
          const kind = fields.targetKind?.value || 'page';
          dialog.querySelector('[data-target-label]').textContent =
            kind === 'paragraph' ? 'Paragraph' : 'Page';
          const folios = pageFolios(chapter.pages);
          fields.destination.disabled = false;
          if (kind === 'paragraph') {
            fields.destination.replaceChildren(new Option('Locating destinations…', ''));
            fields.destination.disabled = true;
            fields.preview.value = '';
            const snapshot = JSON.stringify(chapter);
            try {
              const list = await placedParagraphs(chapter);
              if (!dialog.open || generation !== current) return;
              if (JSON.stringify(chapter) !== snapshot)
                throw Error('The destination document changed. Select it again.');
              measuredChapter = snapshot;
              paragraphs = list;
              const pages = new Map(chapter.pages.map((p, i) => [p.id, folios[i]]));
              const printed = [...list.values()].filter((p) => p?.pageId && p.title);
              fields.destination.replaceChildren(
                ...(printed.length
                  ? printed.map(
                      (p) => new Option(pages.get(p.pageId) + ' · ' + p.title.slice(0, 160), p.key),
                    )
                  : [new Option('No marked paragraphs on these pages', '')]),
              );
              fields.destination.disabled = !printed.length;
            } catch (e) {
              if (current === generation)
                dialog.querySelector('[role=alert]').textContent = e.message;
            }
          } else {
            fields.destination.replaceChildren(
              ...chapter.pages.map((p, i) => new Option(folios[i] + ' · ' + p.name, p.id)),
            );
            if (chapter.id === owner.id) fields.destination.value = state.activePage;
          }
          showPreview();
        }
        fields.targetKind?.addEventListener('change', () =>
          showPages([owner, ...others].find((d) => d.id === (fields.chapter?.value || owner.id))),
        );
        fields.destination.addEventListener('change', showPreview);
        fields.format?.addEventListener('change', showPreview);
        showPages(owner);
        if (fields.chapter)
          fields.chapter.onchange = () =>
            showPages([owner, ...others].find((d) => d.id === fields.chapter.value));
        dialog.addEventListener('close', () => resolve(null), { once: true });
      });
    },
    command(name, { anchor } = {}) {
      if (name === 'toggle-wrap-options') {
        saveDisclosure('wrapPanel', state.propertyDisclosures?.wrapPanel === false);
        render();
        return true;
      }
      if (name === 'wrap-preferences' && allowed()) {
        const prefs = normalizeTextWrapPreferences(doc().textWrapPreferences);
        form(
          'Composition',
          '<label><input type="checkbox" name="onlyBelow" ' +
            (prefs.onlyBelow ? 'checked' : '') +
            '> Text Wrap Only Affects Text Beneath</label>',
          (data) => {
            const onlyBelow = data.has('onlyBelow');
            if (onlyBelow !== prefs.onlyBelow)
              mutate(() => setTextWrapPreferences(doc(), { onlyBelow }), 'Composition preferences');
          },
        );
        return true;
      }
      if (name === 'apply-next-styles') {
        const definitions = doc().publishing?.paragraphStyles || [];
        const options = definitions
          .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
          .join('');
        form(
          'Apply Style Sequence',
          '<label>First paragraph style<select name="start">' + options + '</select></label>',
          (data) => {
            applyStyleSequence(data.get('start'));
          },
        );
        return true;
      }
      if (name.startsWith('show-panel-')) {
        const kind = name.slice(11);
        if (PANEL_KINDS.includes(kind)) {
          state.panel = kind;
          showPanel(kind);
          render();
        }
        return true;
      }
      if (name === 'highlight-options') {
        state.panel = 'properties';
        showPanel('properties');
        render();
        editor.querySelector('.highlight-swatches')?.scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (name === 'show-pages') {
        state.panel = 'pages';
        showPanel('pages');
        render();
        return true;
      }
      if (!allowed()) return false;
      if (Object.hasOwn(generatedTextCommands, name)) {
        if (parentMode) return true;
        const owner = doc(),
          picked = objects().length === 1 ? objects()[0] : null;
        const { kind, update, title } = generatedTextCommands[name];
        const saved = generatedTextFlow(owner, picked)?.[kind];
        let dialog;
        const valid = () =>
          (!dialog || dialog.open) &&
          dialogAllowed() &&
          doc() === owner &&
          (!picked || (owner.blocks.includes(picked) && objects().includes(picked)));
        const apply = (settings, placement) => {
          if (!valid()) throw Error('The selected document or frame changed.');
          const target = saved || placement === 'selection' ? picked : null;
          const generate = kind === 'index' ? indexHTML : contentsHTML;
          const write = (pages) => {
            if (!valid()) throw Error('The selected document or frame changed.');
            const html = generate(owner, pages, settings, {
              allowEmpty: !!saved,
            });
            let written;
            mutate(() => {
              written = writePublicationText(owner, target, html, settings, {
                kind,
                update: !!saved,
              });
              state.activePage = written.pageId;
              state.selection = [written.id];
            }, title);
            focusContents(written.id);
          };
          const pages = readContents(settings, kind, valid);
          return pages instanceof Promise ? pages.then(write) : write(pages);
        };
        if (!update) {
          const open = kind === 'index' ? indexDialog : contentsDialog;
          dialog = open(
            form,
            owner,
            { saved, emptyFrame: canPlacePublicationText(owner, picked) },
            apply,
          );
        } else if (saved) return apply(saved) || true;
        else
          notify?.(
            kind === 'index'
              ? 'Select the index you want to update.'
              : 'Select the table of contents you want to update.',
          );
        return true;
      }
      if (name === 'mark-paragraph-destination' && !parentMode) {
        const owner = doc(),
          block = objects()[0];
        try {
          markParagraphDialog(form, owner, block, {
            mutate,
            valid: () => doc() === owner && objects()[0] === block && dialogAllowed(),
          });
        } catch (error) {
          notify?.(error.message);
        }
        return true;
      }
      if (name === 'define-cross-reference-formats' && !parentMode) {
        const owner = doc();
        referenceFormatDialog(form, owner, state.activePage, {
          documents,
          mutate,
          prepareReferencePlacements,
          valid: () => doc() === owner && dialogAllowed(),
        });
        return true;
      }
      if (name === 'section-options') {
        const owner = doc(),
          page = owner.pages.find((p) => p.id === state.activePage);
        if (!page || state.panelParent) return false;
        editSection(form, page, (section) => {
          if (!dialogAllowed?.() || doc() !== owner || !owner.pages.includes(page))
            throw Error('The selected page changed.');
          mutate(() => {
            if (section) page.section = section;
            else delete page.section;
            markTypographyVersion(owner);
          }, 'Numbering & Section Options');
        });
        return true;
      }
      if (name === 'load-text-styles') {
        const owner = doc(),
          sources = documents().filter(
            (other) =>
              other.id !== owner.id &&
              other.publishing &&
              (other.publishing.paragraphStyles.length || other.publishing.characterStyles.length),
          );
        preserveRange();
        openStyleImport(form, sources, (source, selected, policy) => {
          if (!dialogAllowed?.() || doc() !== owner || !documents().includes(source))
            throw Error('The source or destination changed. Reopen Load Text Styles.');
          mutate(() => importTextStyles(owner, source, selected, policy), 'Load Text Styles');
        });
        return true;
      }
      if (name === 'document-dictionary') {
        if (!nativeComposition || paragraphDialog?.open) return true;
        preserveRange();
        const owner = doc(),
          original = owner.hyphenationExceptions;
        const dialog = openExceptionDictionary(
          form,
          original,
          textState()?.values.language,
          (words) => {
            if (!dialogAllowed?.() || doc() !== owner || doc().hyphenationExceptions !== original)
              throw Error('The document changed. Reopen its dictionary.');
            mutate(() => {
              if (Object.keys(words).length) owner.hyphenationExceptions = words;
              else delete owner.hyphenationExceptions;
              markTypographyVersion(owner);
            }, 'Document dictionary');
          },
        );
        paragraphDialog = dialog;
        dialog.addEventListener(
          'close',
          () => {
            if (paragraphDialog === dialog) paragraphDialog = null;
          },
          { once: true },
        );
        return true;
      }
      if (name === 'type-options') {
        openType(anchor);
        return true;
      }
      if (['tabs', 'keep-options', 'hyphenation-options'].includes(name)) {
        openParagraphOptions(name);
        return true;
      }
      if (name === 'word-spacing') {
        openWordSpacing();
        return true;
      }
      if (name === 'refresh-fonts') {
        if (refreshSystemFonts) void refreshSystemFonts().catch((error) => notify?.(error.message));
        return true;
      }
      if (name === 'import-font') {
        editor.querySelector('.canvas-font-input').click();
        return true;
      }
      if (name === 'new-layer') {
        mutate(() => {
          state.activeLayer = addLayer(doc()).id;
          state.panel = 'layers';
        }, 'New layer');
        return true;
      }
      if (name === 'delete-layer') {
        mutate(() => removeLayer(doc(), currentLayer().id), 'Remove layer');
        return true;
      }
      if (name === 'layer-options') {
        const old = currentLayer();
        form(
          'Layer Options',
          `<label>Name<input name="name" value="${esc(old.name)}" maxlength="120"></label><label>Color<input name="color" type="color" value="${old.color}"></label><label class="publishing-check"><input name="ignoreWrap" type="checkbox" ${old.ignoreWrap ? 'checked' : ''}>Suppress Text Wrap When Layer Is Hidden</label>`,
          (data) =>
            mutate(() => {
              const p = enablePublishing(doc()),
                layer = p.layers.find((l) => l.id === old.id) || p.layers[0];
              layer.name = String(data.get('name')).trim() || 'Layer';
              layer.color = data.get('color');
              if ((data.get('ignoreWrap') === 'on') !== !!old.ignoreWrap)
                setLayerIgnoreWrap(doc(), layer.id, data.get('ignoreWrap') === 'on');
              state.activeLayer = layer.id;
            }, 'Layer options'),
        );
        return true;
      }
      if (/^(new|edit)-(paragraph|character)-style$/.test(name)) {
        const [action, kind] = name.split('-');
        styleForm(kind, action === 'edit');
        return true;
      }
      if (name === 'new-parent') {
        form(
          'New Parent',
          `<label>Name<input name="name" value="Parent" maxlength="120"></label>`,
          (data) =>
            mutate(() => createParent(doc(), state.activePage, data.get('name')), 'Create parent'),
        );
        return true;
      }
      if (name === 'override-parent') {
        const page = doc().pages.find((candidate) => candidate.id === state.activePage);
        if (!page?.parentPageId) return true;
        mutate(() => select(overrideParent(doc(), state.activePage)), 'Override parent items');
        return true;
      }
      if (name === 'restore-parent') {
        const page = doc().pages.find((candidate) => candidate.id === state.activePage);
        if (!page?.parentOverrides?.length) return true;
        mutate(() => {
          delete doc().pages.find((p) => p.id === state.activePage).parentOverrides;
          doc().blocks = doc().blocks.filter(
            (b) => !(b.pageId === state.activePage && b.parentOriginId),
          );
        }, 'Restore parent items');
        return true;
      }
      if (name === 'clear-overrides') {
        clearOverrides();
        return true;
      }
      if (Object.hasOwn(ARRANGE_COMMANDS, name)) {
        mutate(
          () =>
            arrangeObjects(
              doc(),
              objects().map((item) => item.id),
              name,
            ),
          ARRANGE_COMMANDS[name].label,
        );
        return true;
      }
      if (name.startsWith('align-')) {
        const align = name.slice(6),
          items = objects();
        if (!items.length) return true;
        mutate(() => {
          const rects = items.map((item) => ({ item, x: item.x, y: item.y, w: item.w, h: item.h })),
            page = doc().pages.find((p) => p.id === items[0].pageId),
            bounds =
              items.length === 1
                ? { x: 0, y: 0, w: page.width, h: page.height }
                : {
                    x: Math.min(...rects.map((r) => r.x)),
                    y: Math.min(...rects.map((r) => r.y)),
                    w: 0,
                    h: 0,
                  };
          if (items.length > 1) {
            bounds.w = Math.max(...rects.map((r) => r.x + r.w)) - bounds.x;
            bounds.h = Math.max(...rects.map((r) => r.y + r.h)) - bounds.y;
          }
          for (const r of rects) {
            if (align === 'left') r.item.x = bounds.x;
            if (align === 'center') r.item.x = bounds.x + (bounds.w - r.w) / 2;
            if (align === 'right') r.item.x = bounds.x + bounds.w - r.w;
            if (align === 'top') r.item.y = bounds.y;
            if (align === 'middle') r.item.y = bounds.y + (bounds.h - r.h) / 2;
            if (align === 'bottom') r.item.y = bounds.y + bounds.h - r.h;
          }
        }, 'Align objects');
        return true;
      }
      return false;
    },
    destroy() {
      closePopover();
      closeWordSpacingDialog();
      paragraphDialog?.close();
      controller.abort();
    },
  };
}
