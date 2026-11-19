/** Public, licensed source font bytes used by the composition boundary. */
export const SHIPPED_TEXT_FONT_FILES = Object.freeze({
  'cmu-regular': 'cmu-serif/cmunrm.ttf',
  'cmu-italic': 'cmu-serif/cmunti.ttf',
  'cmu-bold': 'cmu-serif/cmunbx.ttf',
  'cmu-bold-italic': 'cmu-serif/cmunbi.ttf',
});

const romanFeatures = Object.freeze([
    'aalt',
    'c2sc',
    'case',
    'kern',
    'liga',
    'locl',
    'mark',
    'mkmk',
    'onum',
    'salt',
    'smcp',
    'ss01',
  ]),
  italicFeatures = Object.freeze([
    'aalt',
    'case',
    'kern',
    'liga',
    'locl',
    'mark',
    'mkmk',
    'onum',
    'salt',
    'ss01',
  ]);

/** Exact metadata from the committed public bytes, available before any font I/O.
 * The shipped-font-metadata test independently rehashes and reinspects all four
 * faces so changes to a font cannot leave synchronous admission using stale data.
 */
export const SHIPPED_TEXT_FONT_METADATA = Object.freeze({
  'cmu-regular': Object.freeze({
    digest: 'cf2b28d1f36b680bc5851196c0da97d32ed564d8a703a9636f094092934babe6',
    postscript: 'CMUSerif-Roman',
    features: romanFeatures,
  }),
  'cmu-italic': Object.freeze({
    digest: '0473b87393141b7ba311e8a590c568e8a82e29dc417574eb748c0093cce0911d',
    postscript: 'CMUSerif-Italic',
    features: italicFeatures,
  }),
  'cmu-bold': Object.freeze({
    digest: '82d500c7092f44de9de332b8ffdc16a6e7ce5b042832b7aa0203a6cea8f4f263',
    postscript: 'CMUSerif-Bold',
    features: romanFeatures,
  }),
  'cmu-bold-italic': Object.freeze({
    digest: 'fd4e94d71d778bbd334d7203227f20a9bf3c0ca98e3e58c0b2a0662cb4930972',
    postscript: 'CMUSerif-BoldItalic',
    features: italicFeatures,
  }),
});
