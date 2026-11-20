import { insertObject } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';

// Original editorial credits, with independently positioned text and the mixed
// character scaling used on a real printed masthead. No external fonts or art.
export function addMagazineCredits(doc, composer) {
  const departments = ['Editorial', 'Studio', 'Photography', 'Production', 'Archives', 'Print'];
  for (let index = 0; index < 71; index++) {
    const frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 30 + Math.floor(index / 24) * 186,
      y: 354 + (index % 24) * 16,
      w: 180,
      h: 15,
      fontSize: 9,
      leading: 10,
      textStyle: 'cmu-serif',
      html:
        '<p><b data-ivo-hscale="88">' +
        departments[index % departments.length] +
        '</b> <span data-ivo-vscale="108">desk ' +
        (index + 1) +
        '</span></p>',
    });
    const flow = startTextFlow(doc, frame.id, { automaticPages: false });
    enableNativeComposition(doc, flow, composer);
  }
}

export function mastheadText() {
  const lead =
    '<p><span data-ivo-hscale="94" data-ivo-vscale="105">A carefully arranged editorial ' +
    'masthead records the people responsible for the photographs and printed pages.</span></p>';
  const credits = [
    'Editorial direction',
    'Fashion editor',
    'Picture editor',
    'Graphics',
    'Print production',
    'Copy editing',
    'Photo research',
    'Contributing editors',
    'Casting',
    'Studio',
    'Production',
    'Archives',
  ];
  return (
    lead +
    credits
      .map(
        (role, i) =>
          '<p><b data-ivo-hscale="84">' +
          role +
          '</b> <span data-ivo-vscale="108">Studio ' +
          (i + 1) +
          '</span> <i data-ivo-hscale="93" data-ivo-vscale="102">Editorial department</i></p>',
      )
      .join('')
  );
}
