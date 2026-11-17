import { escapeHTML as esc } from '../html/sanitize.js';
import { icon } from './icons.js';
export const actionButton = (action, label, name = '', cls = '') =>
  `<button class="${cls}" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}">${name ? icon(name) : ''}<span>${esc(label)}</span></button>`;
