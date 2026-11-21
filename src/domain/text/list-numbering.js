// HTML ordered lists restart at their first item or an explicit item value.
// The displayed label is derived text and never a character in the source.
export function listOrdinal(value) {
  if (typeof value !== 'string' || !/^-?\d{1,9}$/.test(value.trim())) return null;
  return Number(value);
}

export const LIST_COMMANDS = Object.freeze({
  'apply-bullets': 'Apply Bullets',
  'apply-numbering': 'Apply Numbers',
  'remove-list': 'Remove Bullets and Numbering',
  'increase-list-level': 'Increase List Level',
  'decrease-list-level': 'Decrease List Level',
  'restart-numbering': 'Restart Numbering',
  'continue-numbering': 'Continue Numbering',
  'convert-list-to-text': 'Convert Bullets and Numbering to Text',
});
