const CHANNEL = 'ivo:text-composition',
  MAX_REQUEST = 32_000_000;
const fields = {
  request: [
    'protocol',
    'mode',
    'id',
    'sourceHTML',
    'sourceDigest',
    'logicalLength',
    'text',
    'spans',
    'runs',
    'paragraphs',
    'placements',
    'resources',
    'frames',
    'allowFallback',
    'candidates',
    'breaks',
    'includeVectors',
  ],
  span: ['kind', 'logicalStart', 'logicalEnd', 'start', 'end'],
  run: [
    'start',
    'end',
    'font',
    'size',
    'ligatures',
    'tracking',
    'kerning',
    'textColor',
    'leading',
    'autoLeading',
    'baselineShift',
    'horizontalScale',
    'verticalScale',
    'features',
  ],
  resource: ['id', 'digest', 'postscript', 'data'],
  frame: ['id', 'width', 'height', 'firstBaseline', 'minimumFirstBaseline', 'verticalAlign'],
  candidate: ['start', 'end', 'offset'],
  paragraph: [
    'start',
    'end',
    'align',
    'paragraphBefore',
    'paragraphAfter',
    'leftIndent',
    'rightIndent',
    'firstLineIndent',
  ],
  placement: ['end', 'frame', 'baseline', 'left', 'width'],
  features: ['dlig', 'smcp', 'onum', 'tnum', 'zero', 'frac', 'ordn', 'salt'],
};
const plain = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function record(value, allowed) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error('Invalid byte-only text composition request.');
}
/** Match the native byte protocol. No URL, font path, output path, or arbitrary object ports. */
export function validateCompositionRequest(request) {
  record(request, fields.request);
  if (
    ![1, 2, 3, 4].includes(request.protocol) ||
    (request.protocol === 1 && request.paragraphs !== undefined) ||
    (request.protocol >= 2 && !Array.isArray(request.paragraphs)) ||
    (request.protocol < 3 && request.placements !== undefined) ||
    (request.mode === 'planned-lines-proof' &&
      (request.protocol < 3 || !Array.isArray(request.placements))) ||
    (request.protocol === 4 &&
      !['greedy-geometry-proof', 'measure-lines-proof', 'planned-lines-proof'].includes(
        request.mode,
      ))
  )
    throw Error('Invalid text composition paragraph protocol.');
  const arrays = [
    ['spans', 30000, 'span'],
    ['runs', 10000, 'run'],
    ['resources', 16, 'resource'],
    ['frames', 128, 'frame'],
    ['paragraphs', 10000, 'paragraph'],
    ['placements', 2048, 'placement'],
    ['candidates', 4096, 'candidate'],
    ['breaks', 2048, null],
  ];
  let budget = 0;
  function atom(value) {
    if (typeof value === 'string') budget += Buffer.byteLength(value);
    else if (typeof value === 'number' && Number.isFinite(value)) budget += 1;
    else if (typeof value === 'boolean' || value === null) budget += value === false ? 5 : 4;
    else throw Error('Invalid byte-only text composition value.');
    if (budget > MAX_REQUEST) throw Error('Text composition request exceeds 32 MB.');
  }
  const arrayFields = new Set(arrays.map(([name]) => name));
  for (const [key, value] of Object.entries(request)) if (!arrayFields.has(key)) atom(value);
  for (const [name, maximum, shape] of arrays) {
    const value = request[name];
    if (value === undefined && ['candidates', 'breaks', 'paragraphs', 'placements'].includes(name))
      continue;
    if (!Array.isArray(value) || value.length > maximum)
      throw Error('Invalid text composition ' + name + '.');
    for (const row of value) {
      if (!shape) atom(row);
      else {
        record(row, fields[shape]);
        if (shape === 'run') {
          for (const [key, minimum, maximum] of [
            ['baselineShift', -2000, 2000],
            ['horizontalScale', 10, 1000],
            ['verticalScale', 10, 1000],
          ])
            if (
              Object.hasOwn(row, key) &&
              (request.protocol !== 4 ||
                !Number.isFinite(row[key]) ||
                row[key] < minimum ||
                row[key] > maximum)
            )
              throw Error('Invalid native character protocol or value.');
          if (Object.hasOwn(row, 'features')) {
            if (request.protocol !== 4)
              throw Error('Native character features require protocol 4.');
            record(row.features, fields.features);
            for (const value of Object.values(row.features))
              if (typeof value !== 'boolean') throw Error('Invalid native character feature.');
          }
        }
        for (const [key, cell] of Object.entries(row)) {
          if (shape === 'run' && key === 'features')
            for (const flag of Object.values(cell)) atom(flag);
          else atom(cell);
        }
      }
    }
  }
  let serialized;
  try {
    serialized = JSON.stringify(request);
  } catch {
    throw Error('Invalid text composition data.');
  }
  if (Buffer.byteLength(serialized) > MAX_REQUEST)
    throw Error('Text composition request exceeds 32 MB.');
  return request;
}

/** Register one service, with PDF tokens confined to the verified requesting window/job. */
export function installTextCompositionBridge({ ipcMain, authorize, createService }) {
  let service,
    closed = false;
  const tokens = new WeakMap();
  async function backend() {
    if (closed) throw Error('Native text composition is closed.');
    if (!service)
      service = Promise.resolve()
        .then(createService)
        .then((value) => {
          if (
            !value ||
            typeof value.compose !== 'function' ||
            typeof value.pdf !== 'function' ||
            typeof value.close !== 'function'
          )
            throw Error('Native text composition is unavailable.');
          if (closed) {
            value.close();
            throw Error('Native text composition is closed.');
          }
          return value;
        })
        .catch((error) => {
          service = undefined;
          throw error;
        });
    return service;
  }
  async function pdfFor(event, value, options = {}, owner = authorize(event)) {
    if (!owner || (typeof owner !== 'object' && typeof owner !== 'function'))
      throw Error('Invalid text composition owner.');
    if (
      typeof value !== 'string' ||
      !/^ct1-[a-f0-9]{64}$/.test(value) ||
      !tokens.get(owner)?.has(value)
    )
      throw Error('Compose this text in this window before exporting it.');
    options ??= {};
    record(options, ['invisible']);
    if (options.invisible !== undefined && typeof options.invisible !== 'boolean')
      throw Error('Invalid text PDF visibility.');
    const result = await (await backend()).pdf(value, { invisible: options.invisible ?? true });
    if (authorize(event) !== owner) throw Error('Text composition window changed.');
    return result;
  }
  ipcMain.handle(CHANNEL, async (event, action, value, options) => {
    const owner = authorize(event);
    if (!owner || (typeof owner !== 'object' && typeof owner !== 'function'))
      throw Error('Invalid text composition owner.');
    if (action === 'compose') {
      validateCompositionRequest(value);
      const result = await (await backend()).compose(value);
      // Recheck authorization after asynchronous native work, before returning private data.
      if (authorize(event) !== owner) throw Error('Text composition window changed.');
      if (result.token) {
        let owned = tokens.get(owner);
        if (!owned) tokens.set(owner, (owned = new Set()));
        owned.delete(result.token);
        owned.add(result.token);
        while (owned.size > 256) owned.delete(owned.values().next().value);
      }
      return result;
    }
    if (action === 'pdf') return pdfFor(event, value, options, owner);
    throw Error('Unknown text composition action.');
  });
  return {
    readPDF(sender, token) {
      return pdfFor({ sender, senderFrame: sender.mainFrame }, token, { invisible: true });
    },
    close() {
      if (closed) return;
      closed = true;
      ipcMain.removeHandler(CHANNEL);
      service?.then((value) => value.close()).catch(() => {});
    },
  };
}
