import { createRequire } from 'node:module';
import * as lib from 'pdf-lib';

// These two parser classes are internal to the pinned pdf-lib 1.17.1 dependency.
const require = createRequire(import.meta.url);
const PDFObjectParser = require('pdf-lib/cjs/core/parser/PDFObjectParser.js').default;
const ByteStream = require('pdf-lib/cjs/core/parser/ByteStream.js').default;
const {
  PDFDocument,
  PDFRawStream,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFName,
  PDFNumber,
  decodePDFRawStream,
} = lib;
const name = (value) => PDFName.of(value),
  stringObject = (value) => value instanceof PDFString || value instanceof PDFHexString;
function normalizedHex(value) {
  const raw = value.asString().replace(/[\0\t\n\f\r ]/g, '');
  if (!/^[\da-f]*$/i.test(raw)) throw Error('Malformed PDF hex string');
  return PDFHexString.of(raw);
}
function stringBytes(value) {
  return (value instanceof PDFHexString ? normalizedHex(value) : value).asBytes();
}
function decodedText(value) {
  return (value instanceof PDFHexString ? normalizedHex(value) : value).decodeText();
}
const limits = {
  bytes: 24_000_000,
  decodedBytes: 32_000_000,
  operations: 100_000,
  uses: 100_000,
  formDepth: 20,
  mappings: 65536,
};
const permitted = new Set(
  'q Q cm w J j M d ri i gs m l c v y h re S s f F f* B B* b b* n W W* CS cs SC SCN sc scn G g RG rg K k sh BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 Do MP DP BMC BDC EMC BX EX'.split(
    ' ',
  ),
);
function validUTF16(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function utf16Hex(text) {
  let value = '';
  for (let i = 0; i < text.length; i++) value += text.charCodeAt(i).toString(16).padStart(4, '0');
  return value;
}
function hexUTF16(hex) {
  if (!hex.length || hex.length % 4) throw Error('Unsupported CMap UTF16 length');
  const text = String.fromCharCode(...hex.match(/.{4}/g).map((value) => parseInt(value, 16)));
  if (!validUTF16(text)) throw Error('Malformed CMap UTF16');
  return text;
}
// Parse PDF objects with the pinned parser; bare content/CMap operators remain strings.
function tokens(bytes, context) {
  const input = ByteStream.of(bytes),
    parser = new PDFObjectParser(input, context),
    out = [];
  while (!input.done()) {
    parser.skipWhitespaceAndComments();
    if (input.done()) break;
    const c = input.peek();
    if ('/<[(+-.0123456789'.includes(String.fromCharCode(c))) out.push(parser.parseObject());
    else {
      let word = '';
      while (!input.done() && !'\0\t\n\f\r []()<>/%'.includes(String.fromCharCode(input.peek())))
        word += String.fromCharCode(input.next());
      if (!word) throw Error('Unexpected content token');
      out.push(word);
    }
    if (out.length > limits.operations * 10) throw Error('Content token budget');
  }
  return out;
}
// Accept only the complete native ToUnicode grammar, never execute PostScript or infer maps from comments.
function parseCMap(stream, context) {
  const decoded = decodePDFRawStream(stream).decode();
  if (decoded.length > 1_000_000) throw Error('ToUnicode byte budget');
  const parsed = tokens(decoded, context);
  let position = 0;
  const take = () => {
    if (position >= parsed.length) throw Error('Incomplete ToUnicode');
    return parsed[position++];
  };
  const word = (value) => {
    if (take() !== value) throw Error('Unsupported ToUnicode grammar: ' + value);
  };
  const named = (value) => {
    const object = take();
    if (!(object instanceof PDFName) || object.decodeText() !== value)
      throw Error('Unsupported ToUnicode name: ' + value);
  };
  const integer = () => {
    const object = take();
    if (
      !(object instanceof PDFNumber) ||
      !Number.isSafeInteger(object.asNumber()) ||
      object.asNumber() < 0
    )
      throw Error('Unsupported ToUnicode count');
    return object.asNumber();
  };
  const hex = () => {
    const object = take();
    if (!(object instanceof PDFHexString)) throw Error('Expected ToUnicode hex string');
    return Buffer.from(stringBytes(object)).toString('hex');
  };
  named('CIDInit');
  named('ProcSet');
  word('findresource');
  word('begin');
  if (integer() !== 12) throw Error('Unsupported ToUnicode dictionary');
  word('dict');
  word('begin');
  word('begincmap');
  named('CIDSystemInfo');
  const system = take();
  if (
    !(system instanceof PDFDict) ||
    system.keys().length !== 3 ||
    !stringObject(system.get(name('Registry'))) ||
    !stringObject(system.get(name('Ordering'))) ||
    !(system.get(name('Supplement')) instanceof PDFNumber)
  )
    throw Error('Unsupported CIDSystemInfo');
  word('def');
  named('CMapName');
  if (!(take() instanceof PDFName)) throw Error('Unsupported CMapName');
  word('def');
  named('CMapType');
  if (integer() !== 2) throw Error('Unsupported CMapType');
  word('def');
  if (integer() !== 1) throw Error('Variable codespace unsupported');
  word('begincodespacerange');
  const low = hex(),
    high = hex(),
    width = low.length / 2;
  word('endcodespacerange');
  if (![1, 2].includes(width) || low !== '00'.repeat(width) || high !== 'ff'.repeat(width))
    throw Error('Restricted codespace unsupported');
  const mappings = new Map();
  function code(hexadecimal) {
    if (hexadecimal.length !== width * 2) throw Error('Bad CMap code width');
    return parseInt(hexadecimal, 16);
  }
  function put(number, unicode) {
    if (
      number < 0 ||
      number >= 2 ** (width * 8) ||
      mappings.has(number) ||
      mappings.size >= limits.mappings
    )
      throw Error('Bad CMap code range');
    mappings.set(number, hexUTF16(unicode));
  }
  while (parsed[position] !== 'endcmap') {
    const count = integer();
    if (count > limits.mappings) throw Error('CMap count budget');
    const operation = take();
    if (!['beginbfchar', 'beginbfrange'].includes(operation))
      throw Error('Unsupported CMap mapping operation');
    for (let entry = 0; entry < count; entry++) {
      const start = code(hex());
      if (operation === 'beginbfchar') put(start, hex());
      else {
        const end = code(hex()),
          destination = take();
        if (end < start || end - start > limits.mappings) throw Error('Bad bfrange extent');
        if (destination instanceof PDFHexString) {
          const initial = Buffer.from(stringBytes(destination)).toString('hex');
          if (!initial.length) throw Error('Empty CMap destination');
          const base = BigInt('0x' + initial);
          for (let number = start; number <= end; number++) {
            const target = (base + BigInt(number - start))
              .toString(16)
              .padStart(initial.length, '0');
            if (target.length !== initial.length) throw Error('CMap increment overflow');
            put(number, target);
          }
        } else if (destination instanceof PDFArray) {
          if (destination.size() !== end - start + 1) throw Error('Bad bfrange array');
          for (let number = start; number <= end; number++) {
            const target = destination.get(number - start);
            if (!(target instanceof PDFHexString)) throw Error('Bad bfrange target');
            put(number, Buffer.from(stringBytes(target)).toString('hex'));
          }
        } else throw Error('Bad bfrange destination');
      }
    }
    word(operation === 'beginbfchar' ? 'endbfchar' : 'endbfrange');
  }
  word('endcmap');
  word('CMapName');
  word('currentdict');
  named('CMap');
  word('defineresource');
  word('pop');
  word('end');
  word('end');
  if (position !== parsed.length) throw Error('Trailing unsupported ToUnicode grammar');
  if (!mappings.size) throw Error('Missing CMap mappings');
  return { width, mappings, source: Buffer.from(decoded).toString('latin1') };
}

function cmapText(width, mappings) {
  const entries = [...mappings].sort((a, b) => a[0] - b[0]);
  let text =
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Ivo-Canonical-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<' +
    '00'.repeat(width) +
    '><' +
    'FF'.repeat(width) +
    '>\nendcodespacerange\n';
  for (let i = 0; i < entries.length; i += 100) {
    const group = entries.slice(i, i + 100);
    text +=
      group.length +
      ' beginbfchar\n' +
      group
        .map(
          ([code, unicode]) =>
            '<' + code.toString(16).padStart(width * 2, '0') + '><' + utf16Hex(unicode) + '>',
        )
        .join('\n') +
      '\nendbfchar\n';
  }
  return text + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
}
async function repairKnownNativePDF(input) {
  const original = input;
  if (original.length > limits.bytes) throw Error('PDF input budget');
  const doc = await PDFDocument.load(original, { updateMetadata: false }),
    ctx = doc.context,
    fonts = new Map(),
    audit = [],
    fontRefs = new Map(),
    scanned = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects())
    if (obj instanceof PDFDict && String(obj.get(name('Type'))) === '/Font')
      fontRefs.set(obj, String(ref));
  let operations = 0,
    uses = 0,
    decodedBytes = 0;
  const lookup = (value) => ctx.lookup(value),
    dict = (value) => {
      const d = lookup(value);
      if (!(d instanceof PDFDict)) throw Error('Missing resource dictionary');
      return d;
    };
  const get = (d, key) => d?.get(name(key));
  // Resource aliases may share a font object or a ToUnicode stream. Track each font object independently.
  function font(value) {
    const object = dict(value),
      id = fontRefs.get(object);
    if (!id) throw Error('Direct font dictionaries unsupported');
    if (fonts.has(id)) return fonts.get(id);
    const subtype = String(get(object, 'Subtype'));
    let width;
    if (['/TrueType', '/Type1'].includes(subtype)) width = 1;
    else if (subtype === '/Type0' && String(get(object, 'Encoding')) === '/Identity-H') width = 2;
    else throw Error('Unsupported text font encoding');
    let cmap = null,
      cmapError = null;
    const toUnicode = get(object, 'ToUnicode');
    if (toUnicode)
      try {
        const stream = lookup(toUnicode);
        if (!(stream instanceof PDFRawStream)) throw Error('Missing ToUnicode stream');
        cmap = parseCMap(stream, ctx);
        if (cmap.width !== width) throw Error('CMap width conflicts with font');
      } catch (error) {
        cmapError = error.message;
      }
    const result = { id, object, width, cmap, cmapError, uses: new Map() };
    fonts.set(id, result);
    return result;
  }
  function resolve(resources, category, key) {
    return get(dict(get(resources, category)), key.decodeText());
  }
  // Scan every reachable use before proposing changes, including repeated/shared Form resources.
  function scanStreams(raws, resources, initialFont = null, stack = []) {
    if (stack.length > limits.formDepth) throw Error('Form depth budget');
    if (get(resources, 'Pattern')) throw Error('Pattern traversal unsupported');
    const decoded = raws.map((raw) => {
      if (!(raw instanceof PDFRawStream)) throw Error('Missing content stream');
      const value = decodePDFRawStream(raw).decode();
      decodedBytes += value.length;
      if (decodedBytes > limits.decodedBytes) throw Error('Decoded content budget');
      return Buffer.from(value);
    });
    const parsed = tokens(
        Buffer.concat(decoded.flatMap((bytes) => [bytes, Buffer.from('\n')])),
        ctx,
      ),
      args = [],
      states = [],
      marks = [];
    let state = { font: initialFont },
      inText = false;
    const record = (bytes) => {
      if (!inText || !state.font) throw Error('Text shown outside known text state');
      if (bytes.length % state.font.width) throw Error('Incomplete encoded character');
      for (let index = 0; index < bytes.length; index += state.font.width) {
        if (++uses > limits.uses) throw Error('Text use budget');
        let code = 0;
        for (let j = 0; j < state.font.width; j++) code = code * 256 + bytes[index + j];
        const use = { claims: [], ambiguous: false };
        if (!state.font.uses.has(code)) state.font.uses.set(code, []);
        state.font.uses.get(code).push(use);
        for (const mark of marks) mark.uses.push(use);
      }
    };
    for (const token of parsed) {
      if (typeof token !== 'string') {
        args.push(token);
        continue;
      }
      if (++operations > limits.operations) throw Error('Content operation budget');
      if (!permitted.has(token)) throw Error('Unsupported content operator ' + token);
      if (token === 'q') {
        states.push({ ...state });
      } else if (token === 'Q') {
        if (!states.length) throw Error('Unbalanced graphics state');
        state = states.pop();
      } else if (token === 'BT') {
        if (inText) throw Error('Nested BT');
        inText = true;
      } else if (token === 'ET') {
        if (!inText) throw Error('Unexpected ET');
        inText = false;
      } else if (token === 'Tf') {
        if (args.length !== 2 || !(args[0] instanceof PDFName) || !(args[1] instanceof PDFNumber))
          throw Error('Malformed Tf');
        state.font = font(resolve(resources, 'Font', args[0]));
      } else if (token === 'Tj' || token === "'" || token === '"') {
        const expected = token === '"' ? 3 : 1;
        if (args.length !== expected || !stringObject(args[expected - 1]))
          throw Error('Malformed text show');
        record(stringBytes(args[expected - 1]));
      } else if (token === 'TJ') {
        if (args.length !== 1 || !(args[0] instanceof PDFArray)) throw Error('Malformed TJ');
        for (const item of args[0].asArray())
          if (stringObject(item)) record(stringBytes(item));
          else if (!(item instanceof PDFNumber)) throw Error('Malformed TJ member');
      } else if (token === 'BDC' || token === 'BMC') {
        if (args.length !== (token === 'BDC' ? 2 : 1) || !(args[0] instanceof PDFName))
          throw Error('Malformed marked content');
        let actual = null;
        if (token === 'BDC') {
          const properties =
            args[1] instanceof PDFName
              ? lookup(resolve(resources, 'Properties', args[1]))
              : args[1];
          if (!(properties instanceof PDFDict)) throw Error('Unknown marked properties');
          const value = lookup(get(properties, 'ActualText'));
          if (value) {
            if (!stringObject(value)) throw Error('Nonstring ActualText');
            actual = decodedText(value);
            if (!actual.length || actual.length > 256 || !validUTF16(actual))
              throw Error('Unsupported ActualText');
          }
        }
        marks.push({ actual, uses: [] });
      } else if (token === 'EMC') {
        if (args.length || !marks.length) throw Error('Unbalanced marked content');
        const mark = marks.pop();
        if (mark.actual !== null) {
          if (mark.uses.length === 1) mark.uses[0].claims.push(mark.actual);
          else for (const use of mark.uses) use.ambiguous = true;
        }
      } else if (token === 'Do') {
        if (args.length !== 1 || !(args[0] instanceof PDFName)) throw Error('Malformed Do');
        const ref = resolve(resources, 'XObject', args[0]),
          object = lookup(ref);
        if (!(object instanceof PDFRawStream)) throw Error('Unknown XObject');
        const subtype = String(get(object.dict, 'Subtype'));
        if (subtype === '/Form') {
          if (inText || marks.some((mark) => mark.actual !== null))
            throw Error('Form nested in ActualText/text unsupported');
          const key = String(ref);
          if (stack.includes(key)) throw Error('Cyclic Form');
          const ownResources = get(object.dict, 'Resources');
          scanStreams([object], ownResources ? dict(ownResources) : resources, state.font, [
            ...stack,
            key,
          ]);
        } else if (subtype !== '/Image') throw Error('Unknown XObject subtype');
      } else if (token === 'gs') {
        if (args.length !== 1 || !(args[0] instanceof PDFName)) throw Error('Malformed gs');
        const gs = dict(resolve(resources, 'ExtGState', args[0]));
        if (get(gs, 'Font')) throw Error('ExtGState font unsupported');
        if (get(gs, 'SMask') && String(get(gs, 'SMask')) !== '/None')
          throw Error('Soft mask traversal unsupported');
      }
      args.length = 0;
    }
    if (args.length || states.length || marks.length || inText)
      throw Error('Incomplete content state');
    scanned.push({ streams: raws.length, depth: stack.length });
  }
  try {
    // Annotation appearances, patterns, soft masks and Type3 charprocs are outside the native proof.
    // Reject them rather than overlooking a hidden reuse of an affected font code.
    for (const page of doc.getPages()) {
      if (page.node.Annots()?.size()) throw Error('Annotation appearance traversal unsupported');
      const resources = dict(page.node.Resources());
      if (get(resources, 'Pattern')) throw Error('Pattern traversal unsupported');
      const contents = lookup(page.node.get(name('Contents'))),
        streams =
          contents instanceof PDFArray
            ? contents.asArray().map(lookup)
            : contents
              ? [contents]
              : [];
      scanStreams(streams, resources);
    }
  } catch (error) {
    return {
      bytes: original,
      changed: false,
      supported: false,
      error: error.message,
      audit: [],
      scanned,
    };
  }
  // ActualText is authoritative only when one span describes one encoded code and every use agrees.
  const changes = [];
  for (const f of fonts.values()) {
    if (!f.cmap) {
      if (f.cmapError)
        audit.push({
          font: f.id,
          status: 'unsupported-cmap',
          reason: f.cmapError,
        });
      continue;
    }
    const updates = [];
    for (const [code, observations] of f.uses) {
      const claimed = observations.flatMap((use) => use.claims),
        candidate = new Set(claimed),
        unannotated = observations.some((use) => !use.claims.length),
        ambiguous = observations.some((use) => use.ambiguous || new Set(use.claims).size > 1);
      if (!candidate.size) {
        if (ambiguous)
          audit.push({
            font: f.id,
            code,
            status: 'blocked',
            reason: 'multicode-ActualText',
            uses: observations.length,
          });
        continue;
      }
      const existing = f.cmap.mappings.get(code),
        desired = candidate.size === 1 ? [...candidate][0] : null;
      if (candidate.size > 1 || ambiguous || unannotated) {
        audit.push({
          font: f.id,
          code,
          status: 'blocked',
          reason:
            candidate.size > 1 || ambiguous
              ? 'conflicting-or-multicode-ActualText'
              : 'unannotated-use',
          existing,
          candidates: [...candidate],
          uses: observations.length,
          unannotated,
        });
        continue;
      }
      if (existing === undefined) {
        audit.push({
          font: f.id,
          code,
          status: 'blocked',
          reason: 'missing-existing-map',
        });
        continue;
      }
      if (existing !== desired) {
        updates.push({ code, existing, desired, uses: observations.length });
      }
    }
    if (updates.length) changes.push({ f, updates });
  }
  // No ambiguous repair is emitted. Caller can distinguish untouched correct PDFs from blocked candidates.
  if (audit.some((row) => row.status === 'blocked' || row.status === 'unsupported-cmap'))
    return {
      bytes: original,
      changed: false,
      supported: false,
      error: 'Ambiguous or unsupported font mapping',
      audit,
      scanned,
    };
  if (!changes.length) return { bytes: original, changed: false, supported: true, audit, scanned };
  // This is the transaction boundary: no mutations occurred during parsing or admission.
  for (const { f, updates } of changes) {
    const mappings = new Map(f.cmap.mappings);
    for (const update of updates) mappings.set(update.code, update.desired);
    const stream = ctx.flateStream(cmapText(f.width, mappings));
    f.object.set(name('ToUnicode'), ctx.register(stream));
    audit.push({ font: f.id, status: 'patched', width: f.width, updates });
  }
  return {
    bytes: Buffer.from(
      await doc.save({
        useObjectStreams: false,
        addDefaultPage: false,
        updateFieldAppearances: false,
      }),
    ),
    changed: true,
    supported: true,
    audit,
    scanned,
  };
}

/**
 * Improve text extraction only for a freshly generated native text-worker PDF.
 * Do not apply this to imported PDFs. This parser admits a narrow known profile;
 * its budgets are acceptance checks, not a hostile-input inflation/stack limit.
 * All failure paths retain the original PDF bytes. No paint stream is rewritten.
 */
export async function improveNativePDFEncoding(bytes) {
  let original = bytes;
  try {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('Native PDF encoding requires a byte array.');
    }
    original = Buffer.from(bytes);
    const result = await repairKnownNativePDF(original);
    const { error, ...output } = result;
    return error ? { ...output, reason: error } : output;
  } catch (error) {
    return {
      bytes: original,
      changed: false,
      supported: false,
      reason:
        error instanceof Error ? error.message : 'Native PDF encoding could not be inspected.',
      audit: [],
      scanned: [],
    };
  }
}
