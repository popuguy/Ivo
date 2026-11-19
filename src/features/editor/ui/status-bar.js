import { icon } from '../../../shared/ui/icons.js';

export function statusBarMarkup(control) {
  return `<footer class="canvas-status"><nav class="canvas-page-navigation" aria-label="Page navigation">${control('previous-page', 'Previous page', 'chevron-right', 'class="previous-page"')}<select data-active-page aria-label="Page"></select>${control('next-page', 'Next page', 'chevron-right')}</nav><div class="canvas-zoom">${control('zoom-out', 'Zoom out', 'minus')}<button data-canvas-command="zoom-100" class="zoom-value" aria-label="Actual size">100.00%</button>${control('zoom-in', 'Zoom in', 'plus')}<button data-canvas-command="fit-page" aria-label="Fit page" title="Fit page">${icon('fit-page')}</button><button data-canvas-command="fit-all" aria-label="Fit all pages" title="Fit all pages">${icon('fit-all')}</button></div></footer>`;
}
