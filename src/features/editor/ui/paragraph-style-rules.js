import { nestedDelimiters } from '../../../domain/text/paragraph-style-rules.js';

export const ruleSections =
  '<details data-style-rules="nestedStyles"><summary>Nested Styles</summary></details><details data-style-rules="grepStyles"><summary>GREP Style</summary></details>';

export function installStyleRules(dialog, style, doc) {
  const readers = [];
  for (const section of dialog.querySelectorAll('[data-style-rules]')) {
    const key = section.dataset.styleRules,
      pattern = key === 'grepStyles';
    const mode = document.createElement('select');
    mode.setAttribute('aria-label', pattern ? 'GREP style source' : 'Nested style source');
    mode.add(new Option('Inherited', 'inherit'));
    mode.add(new Option('Custom', 'custom'));
    mode.value = style?.[key] === undefined ? 'inherit' : 'custom';
    const list = document.createElement('div'),
      add = document.createElement('button');
    add.type = 'button';
    add.textContent = pattern ? 'New GREP Style' : 'New Nested Style';
    section.append(mode, list, add);
    const row = (rule = {}) => {
      const box = document.createElement('fieldset');
      const field = (name, control) => {
        const label = document.createElement('label');
        label.append(name, control);
        box.append(label);
        control.setAttribute('aria-label', name);
        return control;
      };
      const choose = (name, options, choice) => {
        const select = field(name, document.createElement('select'));
        for (const [value, label] of options) select.add(new Option(label, value));
        if (choice !== undefined) select.value = choice;
        return select;
      };
      const face = choose(
        'Apply Style',
        [
          ...(!pattern ? [['', '[None]']] : []),
          ...(doc.publishing?.characterStyles || []).map((s) => [s.id, s.name]),
        ],
        rule.style ?? undefined,
      );
      face.dataset.ruleStyle = '';
      if (pattern) {
        const input = field('To Text', document.createElement('input'));
        input.maxLength = 160;
        input.value = rule.pattern ?? '\\d+';
        input.dataset.pattern = '';
      } else {
        choose(
          'Apply',
          [
            ['through', 'Through'],
            ['upto', 'Up To'],
          ],
          rule.inclusive === false ? 'upto' : 'through',
        ).dataset.inclusive = '';
        const count = field('Count', document.createElement('input'));
        count.type = 'number';
        count.min = '1';
        count.max = '999';
        count.value = rule.count ?? 1;
        count.dataset.count = '';
        const delimiter = choose(
          'Delimiter',
          Object.entries(nestedDelimiters),
          rule.delimiter ?? 'word',
        );
        delimiter.dataset.delimiter = '';
        const literal = field('Character', document.createElement('input'));
        literal.value = rule.literal ?? ':';
        literal.dataset.literal = '';
        const reflect = () => (literal.closest('label').hidden = delimiter.value !== 'literal');
        delimiter.addEventListener('change', reflect);
        reflect();
      }
      for (const [label, action] of [
        [
          'Move up',
          () => {
            if (box.previousElementSibling) list.insertBefore(box, box.previousElementSibling);
          },
        ],
        [
          'Move down',
          () => {
            if (box.nextElementSibling) list.insertBefore(box.nextElementSibling, box);
          },
        ],
        ['Remove', () => box.remove()],
      ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', action);
        box.append(b);
      }
      list.append(box);
    };
    for (const rule of style?.[key] || []) row(rule);
    add.addEventListener('click', () => {
      if (list.childElementCount < 24) row();
    });
    const reflect = () => {
      list.hidden = mode.value === 'inherit';
      add.hidden = list.hidden;
    };
    mode.addEventListener('change', reflect);
    reflect();
    readers.push(() =>
      mode.value === 'inherit'
        ? {}
        : {
            [key]: [...list.children].map((box) => {
              const get = (key) => box.querySelector('[data-' + key + ']').value;
              const style = get('rule-style') || null;
              if (pattern) return { style, pattern: get('pattern') };
              const delimiter = get('delimiter');
              return {
                style,
                delimiter,
                count: Number(get('count')),
                inclusive: get('inclusive') === 'through',
                ...(delimiter === 'literal' ? { literal: get('literal') } : {}),
              };
            }),
          },
    );
  }
  return () => Object.assign({}, ...readers.map((read) => read()));
}
