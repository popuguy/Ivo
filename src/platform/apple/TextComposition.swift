import CoreGraphics
import CoreText
import CryptoKit
import Foundation

/// Exact-font native geometry; callers own scheduling and source editing. No filesystem APIs.
public final class TextCompositionEngine {
  private struct CachedFont {
    let font: CGFont
    let postscript: String
    let bytes: Int
    let flags: Int
    let features: Set<String>
    let axes: [UInt32: ClosedRange<Double>]
  }
  private struct Snapshot {
    let text: NSString
    let frames: [Frame]
    let lines: [FrozenLine]
    let responseData: Data
    let requestDigest: String
    let cost: Int
  }
  private let lock = NSLock()
  private var fontCache: [String: CachedFont] = [:], fontOrder: [String] = [],
    fontBindings: [String: String] = [:]
  private var fontBytes = 0
  private var snapshots: [String: Snapshot] = [:], snapshotOrder: [String] = [], snapshotBytes = 0
  // Core Text gives named and interpolated instances a new PostScript name.
  // Bind only names constructed from the exact packaged face for this request.
  private var variableInstances: [String: (resourceID: String, coordinates: String)] = [:]
  private var vectorCache: [String: String] = [:], vectorOrder: [String] = [], vectorBytes = 0
  private let unsupportedWordSpaceScript = try! NSRegularExpression(
    pattern: "[^\\p{Latin}\\p{Greek}\\p{Cyrillic}\\p{Common}\\p{Inherited}]")
  public init() {}
  // Bounded exact-font shaping and line geometry. Paragraph policy belongs to the caller.
  struct SourceSpan: Decodable {
    let kind: String
    let logicalStart: Int
    let logicalEnd: Int
    let start: Int
    let end: Int
  }
  struct FontResource: Decodable {
    let id: String
    let digest: String
    let postscript: String
    let data: String?
  }
  struct TextRun: Decodable {
    let start: Int
    let end: Int
    let font: String
    let size: Double
    let language: String?
    let ligatures: Bool
    let tracking: Double
    let kerning: String?
    let textColor: String?
    let leading: Double?
    let autoLeading: Double?
    let baselineShift: Double?
    let horizontalScale: Double?
    let verticalScale: Double?
    let variations: [String: Double]?
    let features: [String: Bool]?
    enum CodingKeys: String, CodingKey {
      case start, end, font, size, language, ligatures, tracking, kerning, textColor, leading, autoLeading
      case baselineShift, horizontalScale, verticalScale, features, variations
    }
    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      start = try values.decode(Int.self, forKey: .start)
      end = try values.decode(Int.self, forKey: .end)
      font = try values.decode(String.self, forKey: .font)
      size = try values.decode(Double.self, forKey: .size)
      language = try values.decodeIfPresent(String.self, forKey: .language)
      ligatures = try values.decode(Bool.self, forKey: .ligatures)
      tracking = try values.decode(Double.self, forKey: .tracking)
      kerning = try values.decodeIfPresent(String.self, forKey: .kerning)
      textColor = try values.decodeIfPresent(String.self, forKey: .textColor)
      leading = try values.decodeIfPresent(Double.self, forKey: .leading)
      autoLeading = try values.decodeIfPresent(Double.self, forKey: .autoLeading)
      // Absent defaults are allowed; explicitly malformed/null character values
      // must not disappear into an optional and silently change saved intent.
      baselineShift =
        values.contains(.baselineShift)
        ? try values.decode(Double.self, forKey: .baselineShift) : nil
      horizontalScale =
        values.contains(.horizontalScale)
        ? try values.decode(Double.self, forKey: .horizontalScale) : nil
      verticalScale =
        values.contains(.verticalScale)
        ? try values.decode(Double.self, forKey: .verticalScale) : nil
      variations = values.contains(.variations)
        ? try values.decode([String: Double].self, forKey: .variations) : nil
      features =
        values.contains(.features)
        ? try values.decode([String: Bool].self, forKey: .features) : nil
    }
  }
  struct Frame: Decodable {
    let id: String
    let width: Double
    let height: Double
    let firstBaseline: String?
    let minimumFirstBaseline: Double?
    let verticalAlign: String?
  }
  struct Candidate: Decodable {
    let start: Int
    let end: Int
    let offset: Double?
  }
  struct WordSpacing: Decodable {
    let minimum: Double
    let desired: Double
    let maximum: Double
    let letterMinimum, letterDesired, letterMaximum: Double?
    let glyphMinimum, glyphDesired, glyphMaximum: Double?
  }
  struct Paragraph: Decodable {
    let start: Int
    let end: Int
    let align: String
    let paragraphBefore: Double
    let paragraphAfter: Double
    let leftIndent: Double
    let rightIndent: Double
    let firstLineIndent: Double
    let wordSpacing: WordSpacing?
    enum CodingKeys: String, CodingKey {
      case start, end, align, paragraphBefore, paragraphAfter, leftIndent, rightIndent,
        firstLineIndent
      case wordSpacing
    }
    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      start = try values.decode(Int.self, forKey: .start)
      end = try values.decode(Int.self, forKey: .end)
      align = try values.decode(String.self, forKey: .align)
      paragraphBefore = try values.decode(Double.self, forKey: .paragraphBefore)
      paragraphAfter = try values.decode(Double.self, forKey: .paragraphAfter)
      leftIndent = try values.decode(Double.self, forKey: .leftIndent)
      rightIndent = try values.decode(Double.self, forKey: .rightIndent)
      firstLineIndent = try values.decode(Double.self, forKey: .firstLineIndent)
      wordSpacing =
        values.contains(.wordSpacing)
        ? try values.decode(WordSpacing.self, forKey: .wordSpacing) : nil
    }
  }
  struct Placement: Decodable {
    let end: Int
    let frame: Int
    let baseline: Double
    let left: Double
    let width: Double
    let wordPercent, letterPercent, glyphPercent: Double?
  }
  struct RetainedLine: Decodable {
    let start: Int
    let end: Int
    let availableWidth: Double
    let originX: Double
    let width: Double
  }
  struct Request: Decodable {
    let `protocol`: Int
    let mode: String
    let id: String
    let sourceHTML: String
    let sourceDigest: String
    let logicalLength: Int
    let text: String
    let spans: [SourceSpan]
    let runs: [TextRun]
    let resources: [FontResource]
    let frames: [Frame]
    let allowFallback: Bool
    let hyphenationPoints: [Int]?
    let candidates: [Candidate]?
    let breaks: [Int]?
    let includeVectors: Bool?
    let paragraphs: [Paragraph]?
    let placements: [Placement]?
    let oversetStart: Int?
    let retainedLines: [RetainedLine]?
  }
  struct FrozenLine {
    let page: Int
    let start: Int
    let end: Int
    var baseline: Double
    let ascent: Double
    let descent: Double
    let line: CTLine
    let hyphen: BreakHyphen?
    let letterOffsets: LetterOffsets
    let scaleX: Double
    let bodyWidth: Double
    let originX: Double
  }
  func fail(_ message: String) -> NSError {
    NSError(domain: "Ivo.TextComposition", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  func digest(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  func finite(_ value: Double, _ minimum: Double, _ maximum: Double) -> Bool {
    value.isFinite && value >= minimum && value <= maximum
  }
  func require(_ value: Bool, _ message: String) throws { if !value { throw fail(message) } }

  func validate(_ request: Request) throws -> [String: CGFont] {
    let length = request.text.utf16.count
    try require(
      [1, 2, 3, 4, 5, 6].contains(request.protocol)
        && [
          "greedy-geometry-proof", "measure-lines-proof", "explicit-lines-proof",
          "planned-lines-proof",
        ].contains(
          request.mode),
      "Unsupported composition protocol or policy")
    try require(
      request.protocol >= 2 || request.paragraphs == nil,
      "Paragraph layout requires composition protocol 2")
    try require(
      request.mode != "planned-lines-proof" || request.protocol >= 3,
      "Planned lines require composition protocol 3 or 4")
    try require(
      request.protocol != 3
        || ["measure-lines-proof", "planned-lines-proof"].contains(request.mode),
      "Composition protocol 3 requires measured or planned lines")
    try require(
      request.protocol != 4
        || ["greedy-geometry-proof", "measure-lines-proof", "planned-lines-proof"].contains(
          request.mode),
      "Composition protocol 4 requires greedy, measured or planned lines")
    try require(
      request.protocol < 5
        || ["measure-lines-proof", "planned-lines-proof"].contains(request.mode),
      "Composition protocol 5 requires measured or planned lines")
    try require(
      request.oversetStart == nil || (request.mode == "planned-lines-proof" && (0..<length).contains(request.oversetStart!)),
      "Invalid overset boundary")
    try require(
      request.placements == nil || (request.protocol >= 3 && request.mode == "planned-lines-proof"),
      "Placements require the planned-lines policy")
    if let retained = request.retainedLines {
      try require(
        request.protocol >= 2 && !request.allowFallback
          && ["planned-lines-proof", "greedy-geometry-proof"].contains(request.mode)
          && retained.count <= 4096 && Set(retained.map { $0.start }).count == retained.count
          && retained.allSatisfy {
            $0.start >= 0 && $0.end > $0.start && $0.end <= length && $0.availableWidth > 0
              && $0.availableWidth.isFinite && $0.originX.isFinite && $0.width.isFinite
          }, "Invalid retained geometry ranges")
    }
    try require(!request.id.isEmpty && request.id.utf8.count <= 120, "Invalid source identity")
    try require(
      length > 0 && length <= 100_000 && request.logicalLength >= 0
        && request.logicalLength <= 200_000, "Composition source exceeds bounds")
    try require(
      request.sourceHTML.utf8.count <= 1_000_000
        && digest(Data(request.sourceHTML.utf8)) == request.sourceDigest, "Source digest mismatch")
    try require(
      !request.frames.isEmpty && request.frames.count <= 128
        && Set(request.frames.map { $0.id }).count == request.frames.count,
      "Invalid frame identities")
    for frame in request.frames {
      try require(
        !frame.id.isEmpty && frame.id.utf8.count <= 120 && finite(frame.width, 1, 14400)
          && finite(frame.height, 1, 14400), "Invalid frame geometry")
      try require(
        frame.firstBaseline == nil
          || ["ascent", "cap-height", "x-height", "leading", "fixed"].contains(frame.firstBaseline!),
        "Unsupported first baseline policy")
      try require(
        frame.minimumFirstBaseline == nil || finite(frame.minimumFirstBaseline!, 0, 14400),
        "Invalid minimum first baseline")
      try require(
        ["top", "center", "bottom"].contains(frame.verticalAlign ?? "top")
          || (frame.verticalAlign == "justify"
            && ["planned-lines-proof", "measure-lines-proof"].contains(request.mode)),
        "Unsupported vertical alignment")
    }
    try require(!request.spans.isEmpty && request.spans.count <= 30_000, "Invalid source map")
    var logical = 0
    var native = 0
    let string = request.text as NSString
    if let points = request.hyphenationPoints {
      try require(request.protocol >= 3 && ["planned-lines-proof", "measure-lines-proof"].contains(request.mode)
        && points.count <= 1024, "Invalid automatic hyphenation request")
      var previous = 0
      let boundaries = Set(graphemeBoundaries(request.text))
      func letter(_ unit: unichar, allowMark: Bool) -> Bool {
        guard let scalar = UnicodeScalar(unit) else { return false }
        return CharacterSet.letters.contains(scalar) || (allowMark && CharacterSet.nonBaseCharacters.contains(scalar))
      }
      for at in points {
        try require(at > previous && at < length && boundaries.contains(at) && letter(string.character(at: at - 1), allowMark: true)
          && letter(string.character(at: at), allowMark: false), "Invalid automatic hyphenation boundary")
        previous = at
      }
    }
    if request.protocol >= 2 {
      guard let paragraphs = request.paragraphs else { throw fail("Missing paragraph layout") }
      try require(!paragraphs.isEmpty && paragraphs.count <= 10_000, "Invalid paragraph layout")
      var paragraphStart = 0
      for paragraph in paragraphs {
        try require(
          paragraph.start == paragraphStart && paragraph.end > paragraph.start
            && paragraph.end <= length, "Discontinuous paragraph layout")
        try require(
          [
            "left", "center", "right", "justify", "justify-center", "justify-right", "justify-all",
            "start", "end",
          ].contains(paragraph.align), "Unsupported paragraph alignment")
        try require(
          finite(paragraph.paragraphBefore, 0, 2000) && finite(paragraph.paragraphAfter, 0, 2000)
            && finite(paragraph.leftIndent, -2000, 2000)
            && finite(paragraph.rightIndent, -2000, 2000)
            && finite(paragraph.firstLineIndent, -2000, 2000), "Invalid paragraph geometry")
        let value = string.substring(
          with: NSRange(location: paragraph.start, length: paragraph.end - paragraph.start))
        if let spacing = paragraph.wordSpacing {
          try require(request.protocol >= 5, "Word spacing requires composition protocol 5")
          if [
            spacing.letterMinimum, spacing.letterDesired, spacing.letterMaximum,
            spacing.glyphMinimum, spacing.glyphDesired, spacing.glyphMaximum,
          ].contains(where: { $0 != nil }) {
            guard request.protocol == 6,
              let lmin = spacing.letterMinimum, let ldes = spacing.letterDesired,
              let lmax = spacing.letterMaximum,
              let gmin = spacing.glyphMinimum, let gdes = spacing.glyphDesired,
              let gmax = spacing.glyphMaximum,
              finite(lmin, -100, 500), finite(ldes, lmin, 500), finite(lmax, ldes, 500),
              finite(gmin, 50, 200), finite(gdes, gmin, 200), finite(gmax, gdes, 200)
            else { throw fail("Invalid nine-field justification settings") }
          }
          try require(
            finite(spacing.minimum, 0, 1000) && finite(spacing.desired, spacing.minimum, 1000)
              && finite(spacing.maximum, spacing.desired, 1000), "Invalid word-spacing preferences")
          try require(
            value.unicodeScalars.allSatisfy {
              !CharacterSet.whitespacesAndNewlines.contains($0)
                || [0x20, 0xA0, 0x202F, 0x200B, 10, 13, 0x2028, 0x2029].contains($0.value)
            },
            "Explicit word spacing requires supported spaces and break characters")
          try require(
            !value.unicodeScalars.contains {
              (0x202A...0x202E).contains($0.value) || (0x2066...0x2069).contains($0.value)
                || [0x200E, 0x200F, 0x061C].contains($0.value)
            }, "Explicit word spacing requires qualified left-to-right text")
          try require(
            unsupportedWordSpaceScript.firstMatch(
              in: value,
              range: NSRange(value.startIndex..., in: value)) == nil,
            "Explicit word spacing requires qualified Latin, Greek or Cyrillic source")
        }
        try require(
          !value.contains("\t") || ["left", "start"].contains(paragraph.align),
          "Aligned native tab paragraphs require a qualified tab policy")
        try require(
          !value.dropLast().contains("\u{2029}")
            && (paragraph.end == length || value.last == "\u{2029}"),
          "Paragraph layout crosses or omits a source paragraph boundary")
        try require(
          paragraph.leftIndent >= 0 && paragraph.rightIndent >= 0
            && paragraph.leftIndent + paragraph.firstLineIndent >= 0,
          "Paragraph indents leave no valid line area")
        for frame in request.frames
        where request.protocol == 2
          || (request.protocol == 4 && request.mode == "greedy-geometry-proof")
        {
          let width = frame.width - paragraph.leftIndent - paragraph.rightIndent
          try require(
            paragraph.leftIndent >= 0 && paragraph.rightIndent >= 0
              && paragraph.leftIndent + paragraph.firstLineIndent >= 0
              && finite(width, 1, 18400) && finite(width - paragraph.firstLineIndent, 1, 20400),
            "Paragraph indents leave no valid line area")
        }
        paragraphStart = paragraph.end
      }
      try require(paragraphStart == length, "Paragraph layout does not cover source")
    }
    for span in request.spans {
      try require(
        span.logicalStart == logical && span.start == native && span.logicalEnd >= logical
          && span.end >= native && span.end <= length, "Discontinuous source map")
      let sourceLength = span.logicalEnd - logical
      let textLength = span.end - native
      switch span.kind {
      case "text": try require(sourceLength == textLength, "Text map length mismatch")
      case "whitespace":
        try require(sourceLength >= 1 && textLength == 0, "Invalid virtual whitespace")
      case "structure", "placeholder":
        try require(sourceLength == 1 && textLength == 0, "Invalid virtual mark")
      case "soft-break":
        try require(
          sourceLength == 1 && textLength == 1
            && string.substring(with: NSRange(location: native, length: 1)) == "\u{2028}",
          "Invalid soft break")
      case "paragraph":
        try require(
          (sourceLength == 0 || sourceLength == 1) && textLength == 1
            && string.substring(with: NSRange(location: native, length: 1)) == "\u{2029}",
          "Invalid paragraph mark")
      default: throw fail("Unsupported source-map atom")
      }
      logical = span.logicalEnd
      native = span.end
    }
    try require(
      logical == request.logicalLength && native == length,
      "Source map does not cover both coordinate systems")
    try require(
      !request.resources.isEmpty && request.resources.count <= 16, "Missing font resources")
    var fonts: [String: CGFont] = [:]
    var fontFeatures: [String: Set<String>] = [:]
    var fontAxes: [String: [UInt32: ClosedRange<Double>]] = [:]
    var totalBytes = 0
    for resource in request.resources {
      try require(
        !resource.id.isEmpty && resource.id.utf8.count <= 120 && fonts[resource.id] == nil,
        "Invalid font identity")
      try require(
        resource.digest.count == 64
          && resource.digest.allSatisfy { $0.isHexDigit && !$0.isUppercase }, "Invalid font digest")
      let identity = resource.digest + ":" + resource.postscript
      if let bound = fontBindings[resource.id] {
        try require(bound == identity, "Font identity was rebound to different bytes")
      }
      var cached = fontCache[resource.digest]
      if let encoded = resource.data {
        guard let bytes = Data(base64Encoded: encoded), bytes.count <= 10_000_000, bytes.count >= 12
        else { throw fail("Invalid font bytes") }
        try require(
          digest(bytes) == resource.digest, "Font resource digest mismatch or budget exceeded")
        if cached == nil {
          guard let provider = CGDataProvider(data: bytes as CFData), let font = CGFont(provider)
          else { throw fail("Font cannot be decoded") }
          try require(
            font.postScriptName as String? == resource.postscript, "Font face identity mismatch")
          let ct = CTFontCreateWithGraphicsFont(font, 12, nil, nil)
          var flags = 0
          if let table = CTFontCopyTable(ct, 0x4F53_2F32, []) as Data?, table.count >= 10 {
            flags = Int(table[8]) * 256 + Int(table[9])
          }
          cached = CachedFont(
            font: font, postscript: resource.postscript, bytes: bytes.count, flags: flags,
            features: declaredFeatures(ct), axes: variationBounds(ct))
          while fontOrder.count >= 64 || fontBytes + bytes.count > 64_000_000 {
            guard let oldest = fontOrder.first else { break }
            fontOrder.removeFirst()
            fontBytes -= fontCache.removeValue(forKey: oldest)?.bytes ?? 0
          }
          fontCache[resource.digest] = cached
          fontOrder.append(resource.digest)
          fontBytes += bytes.count
        }
      }
      guard let face = cached else {
        throw fail("Font resource is not registered: " + resource.digest)
      }
      try require(face.postscript == resource.postscript, "Font face identity mismatch")
      if request.mode != "measure-lines-proof" {
        try require(face.flags & 0x0302 == 0, "Font does not permit this PDF embedding policy")
      }
      totalBytes += face.bytes
      try require(totalBytes <= 20_000_000, "Font resource digest mismatch or budget exceeded")
      if fontBindings[resource.id] == nil {
        try require(fontBindings.count < 256, "Font identity budget exceeded")
        fontBindings[resource.id] = identity
      }
      fonts[resource.id] = face.font
      fontFeatures[resource.id] = face.features
      fontAxes[resource.id] = face.axes
    }
    try require(!request.runs.isEmpty && request.runs.count <= 10_000, "Invalid runs")
    var position = 0
    for run in request.runs {
      try require(
        request.protocol >= 4
          || (run.baselineShift == nil && run.horizontalScale == nil && run.verticalScale == nil
            && run.features == nil && run.variations == nil),
        "Character transforms and OpenType settings require composition protocol 4")
      try require(
        (run.baselineShift == nil || finite(run.baselineShift!, -2000, 2000))
          && (run.horizontalScale == nil || finite(run.horizontalScale!, 10, 1000))
          && (run.verticalScale == nil || finite(run.verticalScale!, 10, 1000)),
        "Invalid character transform")
      if let language = run.language {
        try require(language.utf8.count < 64 && language.range(of: "^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$", options: .regularExpression) != nil, "Invalid native text language")
      }
      if let coordinates = run.variations {
        try require(coordinates.count <= 16, "Too many font axes")
        for (tag, value) in coordinates {
          let bytes = Array(tag.utf8)
          try require(bytes.count == 4 && bytes.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0)
          } && value.isFinite && fontAxes[run.font]?[axisIdentifier(tag)]?.contains(value) == true,
            "Unsupported font axis or coordinate: " + tag)
        }
      }
      if let features = run.features {
        let supported: Set<String> = [
          "dlig", "smcp", "onum", "tnum", "zero", "frac", "ordn", "salt",
        ]
        try require(
          features.count <= 8 && Set(features.keys).isSubset(of: supported),
          "Unsupported OpenType feature setting")
        for tag in features.keys.sorted() where features[tag] == true {
          try require(
            fontFeatures[run.font]?.contains(tag) == true,
            "Font does not support OpenType feature: " + tag)
        }
      }
      try require(
        run.start == position && run.end > run.start && run.end <= length,
        "Runs do not cover the native source")
      try require(
        fonts[run.font] != nil && finite(run.size, 1, 2000) && finite(run.tracking, -1000, 10000),
        "Unavailable font or invalid run metrics")
      if request.paragraphs?.contains(where: {
        $0.wordSpacing != nil && $0.start < run.end && $0.end > run.start
      }) == true {
        try require(
          run.tracking >= 0, "Explicit word spacing requires qualified nonnegative tracking")
      }
      try require(
        run.kerning == nil || run.kerning == "metrics" || run.kerning == "none",
        "Unsupported kerning policy")
      try require(run.leading == nil || finite(run.leading!, 0, 10000), "Invalid leading")
      try require(
        run.autoLeading == nil || finite(run.autoLeading!, 50, 1000), "Invalid auto-leading")
      if let color = run.textColor {
        try require(
          color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
          "Invalid text color")
      }
      for boundary in [run.start, run.end] where boundary > 0 && boundary < length {
        let before = string.character(at: boundary - 1)
        let after = string.character(at: boundary)
        try require(
          !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF),
          "Run splits a surrogate pair")
      }
      position = run.end
    }
    try require(position == length, "Runs lost source text")
    if request.mode != "greedy-geometry-proof" {
      try require(length <= 10_000, "Paragraph source budget exceeded")
      let boundaries = Set(graphemeBoundaries(request.text))
      if request.mode == "measure-lines-proof" {
        guard let candidates = request.candidates else { throw fail("Missing line alternatives") }
        try require(
          !candidates.isEmpty && candidates.count <= 4096, "Line-alternative budget exceeded")
        for candidate in candidates {
          try require(
            candidate.offset == nil
              || (request.protocol == 2 && finite(candidate.offset!, -4000, 4000))
              || (request.protocol >= 3 && finite(candidate.offset!, 0, 14400)),
            "Invalid line-alternative origin")
          try require(
            candidate.start >= 0 && candidate.end > candidate.start && candidate.end <= length
              && boundaries.contains(candidate.start) && boundaries.contains(candidate.end),
            "Invalid line alternative or grapheme boundary")
          let value = string.substring(
            with: NSRange(location: candidate.start, length: candidate.end - candidate.start))
          try require(
            !value.dropLast().contains(where: { $0 == "\n" || $0 == "\u{2028}" || $0 == "\u{2029}" }
            ), "Line alternative crosses a forced break")
        }
      } else if request.mode == "explicit-lines-proof" {
        guard let breaks = request.breaks else { throw fail("Missing explicit line decisions") }
        try require(
          !breaks.isEmpty && breaks.count <= 2048 && breaks.last == length,
          "Explicit lines do not cover source")
        var previous = 0
        for end in breaks {
          try require(
            end > previous && end <= length && boundaries.contains(end),
            "Invalid explicit line order or grapheme boundary")
          let value = string.substring(with: NSRange(location: previous, length: end - previous))
          try require(
            !value.dropLast().contains(where: { $0 == "\n" || $0 == "\u{2028}" || $0 == "\u{2029}" }
            ), "Explicit line crosses a forced break")
          previous = end
        }
      } else {
        guard let placements = request.placements else { throw fail("Missing planned lines") }
        try require(
          placements.count <= 2048 && (placements.last?.end ?? 0) == (request.oversetStart ?? length),
          "Planned lines do not cover source")
        var previousEnd = 0
        var previous: Placement? = nil
        var paragraphIndex = 0
        for placement in placements {
          try require(
            placement.end > previousEnd && placement.end <= length
              && boundaries.contains(placement.end), "Invalid planned source boundary")
          try require(
            placement.frame >= 0 && placement.frame < 128
              && finite(placement.baseline, 0, 14400)
              && finite(placement.left, 0, 14400) && finite(placement.width, 1, 14400),
            "Invalid planned line geometry")
          let value = string.substring(
            with: NSRange(location: previousEnd, length: placement.end - previousEnd))
          try require(
            !value.dropLast().contains(where: { $0 == "\n" || $0 == "\u{2028}" || $0 == "\u{2029}" }
            ),
            "Planned line crosses a forced break")
          while paragraphIndex + 1 < request.paragraphs!.count
            && previousEnd >= request.paragraphs![paragraphIndex].end
          { paragraphIndex += 1 }
          let paragraph = request.paragraphs![paragraphIndex]
          try require(placement.end <= paragraph.end, "Planned line crosses a paragraph")
          if placement.frame < request.frames.count {
            let frame = request.frames[placement.frame]
            let indent =
              paragraph.leftIndent
              + (previousEnd == paragraph.start ? paragraph.firstLineIndent : 0)
            try require(
              placement.left + 0.000001 >= indent
                && placement.left + placement.width <= frame.width - paragraph.rightIndent
                  + 0.000001
                && placement.baseline <= frame.height,
              "Planned line lies outside its frame or paragraph area")
          }
          if let prior = previous {
            try require(placement.frame >= prior.frame, "Planned frame order goes backwards")
            if placement.frame == prior.frame {
              try require(
                placement.baseline + 0.000001 >= prior.baseline,
                "Planned baseline order goes backwards")
              if abs(placement.baseline - prior.baseline) <= 0.000001 {
                try require(
                  placement.left + 0.000001 >= prior.left + prior.width,
                  "Planned row segments overlap or go backwards")
                let last = string.character(at: previousEnd - 1)
                try require(
                  ![10, 13, 0x2028, 0x2029].contains(Int(last)),
                  "Planned forced break continues on the same row")
              }
            }
          }
          previousEnd = placement.end
          previous = placement
        }
      }
    }
    return fonts
  }

  // A native position can alias multiple virtual source boundaries. Preserve the interval instead of guessing.
  func logicalCandidates(_ index: Int, _ spans: [SourceSpan]) -> [Int] {
    var values: [Int] = []
    for span in overlapping(spans, from: index, through: index) {
      if span.kind == "text" {
        values.append(span.logicalStart + index - span.start)
      } else {
        values += [span.logicalStart, span.logicalEnd]
      }
    }
    return [values.min() ?? 0, values.max() ?? 0]
  }
  func logicalRanges(_ start: Int, _ end: Int, _ spans: [SourceSpan]) -> [[Int]] {
    overlapping(spans, from: start, through: end).compactMap { span in
      let a = max(start, span.start)
      let b = min(end, span.end)
      guard b > a else { return nil }
      if span.kind == "text" {
        return [span.logicalStart + a - span.start, span.logicalStart + b - span.start]
      }
      return [span.logicalStart, span.logicalEnd]
    }
  }

  func declaredFeatures(_ font: CTFont) -> Set<String> {
    var tags = Set<String>()
    for feature in CTFontCopyFeatures(font) as? [[String: Any]] ?? [] {
      for selector in feature[kCTFontFeatureTypeSelectorsKey as String] as? [[String: Any]] ?? [] {
        if let tag = selector[kCTFontOpenTypeFeatureTag as String] as? String { tags.insert(tag) }
      }
    }
    return tags
  }
  func axisIdentifier(_ tag: String) -> UInt32 {
    tag.utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
  }
  func variationBounds(_ font: CTFont) -> [UInt32: ClosedRange<Double>] {
    var bounds = [UInt32: ClosedRange<Double>]()
    for axis in CTFontCopyVariationAxes(font) as? [[String: Any]] ?? [] {
      if let id = axis[kCTFontVariationAxisIdentifierKey as String] as? NSNumber,
        let min = axis[kCTFontVariationAxisMinimumValueKey as String] as? Double,
        let max = axis[kCTFontVariationAxisMaximumValueKey as String] as? Double,
        min.isFinite && max.isFinite && min <= max {
        bounds[id.uint32Value] = min...max
      }
    }
    return bounds
  }
  func characterFont(_ run: TextRun, fonts: [String: CGFont]) -> CTFont {
    var transform = CGAffineTransform(
      scaleX: (run.horizontalScale ?? 100) / 100,
      y: (run.verticalScale ?? 100) / 100)
    var font =
      transform.isIdentity
      ? CTFontCreateWithGraphicsFont(fonts[run.font]!, run.size, nil, nil)
      : CTFontCreateWithGraphicsFont(fonts[run.font]!, run.size, &transform, nil)
    var attributes = [String: Any]()
    if let axes = run.variations, !axes.isEmpty {
      attributes[kCTFontVariationAttribute as String] = Dictionary(uniqueKeysWithValues:
        axes.map { (NSNumber(value: axisIdentifier($0.key)), NSNumber(value: $0.value)) })
    }
    if var features = run.features, !features.isEmpty {
      // InDesign's proportional oldstyle choice combines figure style and width.
      // Some faces have oldstyle glyphs but no proportional alternate.
      if features["onum"] == true && features["tnum"] != true
        && declaredFeatures(font).contains("pnum")
      {
        features["pnum"] = true
      }
      let settings = features.keys.sorted().map { tag in
        [
          kCTFontOpenTypeFeatureTag as String: tag,
          kCTFontOpenTypeFeatureValue as String: features[tag]! ? 1 : 0,
        ] as [String: Any]
      }
      attributes[kCTFontFeatureSettingsAttribute as String] = settings
    }
    if !attributes.isEmpty {
      let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
      font = CTFontCreateCopyWithAttributes(font, run.size, nil, descriptor)
    }
    if run.variations != nil, let coordinates = CTFontCopyVariation(font) as? [NSNumber: NSNumber],
      !coordinates.isEmpty {
      let key = coordinates.keys.sorted { $0.uint32Value < $1.uint32Value }.map {
        String($0.uint32Value) + "=" + String(coordinates[$0]!.doubleValue.bitPattern)
      }.joined(separator: ",")
      variableInstances[CTFontCopyPostScriptName(font) as String] = (run.font, key)
    }
    return font
  }
  func untransformedFont(_ font: CTFont) -> CTFont {
    var identity = CGAffineTransform.identity
    return CTFontCreateCopyWithAttributes(font, 0, &identity, nil)
  }
  struct CharacterMetrics {
    let ascent: CGFloat
    let descent: CGFloat
    let leading: CGFloat
    let capHeight: CGFloat
    let xHeight: CGFloat
    let inkAscent: CGFloat
    let inkDescent: CGFloat
  }
  func characterMetrics(_ line: CTLine, sourceRuns: [TextRun], fonts: [String: CGFont])
    -> CharacterMetrics
  {
    let nativeRuns = CTLineGetGlyphRuns(line) as! [CTRun]
    let nativeFonts = nativeRuns.map {
      (CTRunGetAttributes($0) as NSDictionary)[kCTFontAttributeName] as! CTFont
    }
    let actualFonts =
      nativeFonts.isEmpty
      ? sourceRuns.map { characterFont($0, fonts: fonts) } : nativeFonts
    let struts = actualFonts.map { untransformedFont($0) }
    var inkAscent = CGFloat.zero
    var inkDescent = CGFloat.zero
    if nativeFonts.isEmpty {
      inkAscent =
        zip(sourceRuns, actualFonts).map { pair in
          CTFontGetAscent(pair.1) + (pair.0.baselineShift ?? 0)
        }.max() ?? 0
      inkDescent =
        zip(sourceRuns, actualFonts).map { pair in
          CTFontGetDescent(pair.1) - (pair.0.baselineShift ?? 0)
        }.max() ?? 0
    } else {
      let boxes = nativeRuns.map { run -> (CGFloat, CGFloat) in
        let attrs = CTRunGetAttributes(run) as NSDictionary
        let font = attrs[kCTFontAttributeName] as! CTFont
        let shift = (attrs[kCTBaselineOffsetAttributeName] as? NSNumber)?.doubleValue ?? 0
        return (CTFontGetAscent(font) + shift, CTFontGetDescent(font) - shift)
      }
      inkAscent = boxes.map { $0.0 }.max() ?? 0
      inkDescent = boxes.map { $0.1 }.max() ?? 0
    }
    return CharacterMetrics(
      ascent: struts.map { CTFontGetAscent($0) }.max() ?? 0,
      descent: struts.map { CTFontGetDescent($0) }.max() ?? 0,
      leading: struts.map { CTFontGetLeading($0) }.max() ?? 0,
      capHeight: struts.map { CTFontGetCapHeight($0) }.max() ?? 0,
      xHeight: struts.map { CTFontGetXHeight($0) }.max() ?? 0,
      inkAscent: inkAscent, inkDescent: inkDescent)
  }
  func attributedSource(_ request: Request, fonts: [String: CGFont]) throws
    -> NSMutableAttributedString
  {
    // Equal-length engine normalization: paragraph identity remains in the source map.
    var shapingText = request.text.replacingOccurrences(of: "\u{2029}", with: "\n")
    // An owned break plan retains NBSP in the canonical source. Shape its
    // advance with the actual face's ordinary space, even if it lacks U+00A0.
    if request.mode == "planned-lines-proof" || request.mode == "measure-lines-proof" {
      shapingText = shapingText.replacingOccurrences(of: "\u{00A0}", with: " ")
        .replacingOccurrences(of: "\u{202F}", with: " ")
    }
    let attributed = NSMutableAttributedString(string: shapingText)
    // Repeating half-inch stops. Custom/decimal/right-indent tabs remain a
    // separate paragraph capability; U+0009 stays source text, never spaces.
    var interval: CGFloat = 36
    var stops: CFArray = [] as CFArray
    let paragraph = withUnsafePointer(to: &interval) { intervalPointer in
      withUnsafePointer(to: &stops) { stopsPointer in
        var settings = [
          CTParagraphStyleSetting(
            spec: .defaultTabInterval, valueSize: MemoryLayout<CGFloat>.size,
            value: intervalPointer),
          CTParagraphStyleSetting(
            spec: .tabStops, valueSize: MemoryLayout<CFArray>.size,
            value: stopsPointer),
        ]
        return CTParagraphStyleCreate(&settings, settings.count)
      }
    }
    attributed.addAttribute(
      NSAttributedString.Key(kCTParagraphStyleAttributeName as String),
      value: paragraph, range: NSRange(location: 0, length: attributed.length))
    for run in request.runs {
      let font = characterFont(run, fonts: fonts)
      attributed.addAttributes(
        [
          NSAttributedString.Key(kCTFontAttributeName as String): font,
          NSAttributedString.Key(kCTLigatureAttributeName as String): run.ligatures ? 1 : 0,
          NSAttributedString.Key(kCTTrackingAttributeName as String): run.tracking * run.size
            / 1000 * ((run.horizontalScale ?? 100) / 100),
          NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(
            run.textColor ?? "#252525"),
        ], range: NSRange(location: run.start, length: run.end - run.start))
      if let language = run.language {
        attributed.addAttribute(NSAttributedString.Key(kCTLanguageAttributeName as String), value: language,
          range: NSRange(location: run.start, length: run.end - run.start))
      }
      if let shift = run.baselineShift, shift != 0 {
        attributed.addAttribute(
          NSAttributedString.Key(kCTBaselineOffsetAttributeName as String), value: shift,
          range: NSRange(location: run.start, length: run.end - run.start))
      }
      if run.kerning == "none" {
        attributed.addAttribute(
          NSAttributedString.Key(kCTKernAttributeName as String), value: 0,
          range: NSRange(location: run.start, length: run.end - run.start))
      }
    }
    // The fixed space follows Desired Word Spacing, then keeps that advance
    // while the other gaps take up the remainder of a justified line.
    if request.text.contains("\u{202F}")
      && (request.mode == "planned-lines-proof" || request.mode == "measure-lines-proof")
    {
      let source = request.text as NSString
      let key = NSAttributedString.Key(kCTTrackingAttributeName as String)
      for paragraph in request.paragraphs ?? [] {
        guard let desired = paragraph.wordSpacing?.desired, desired != 100 else { continue }
        for index in paragraph.start..<paragraph.end where source.character(at: index) == 0x202F {
          let font =
            attributed.attribute(
              NSAttributedString.Key(kCTFontAttributeName as String),
              at: index, effectiveRange: nil) as! CTFont
          let tracking =
            (attributed.attribute(key, at: index, effectiveRange: nil) as? NSNumber)?.doubleValue
            ?? 0
          let advance = try fontSpaceAdvance(font)
          attributed.addAttribute(
            key, value: tracking + advance * (desired / 100 - 1),
            range: NSRange(location: index, length: 1))
        }
      }
    }
    return attributed
  }
  struct WordSpaceShape {
    let start: Int
    let contentEnd: Int
    let trailingStart: Int
    let adjustable: [Int]
    let gapCount: Int
    let hangingStart: Int
    let nominalSpaceWidth: Double
  }
  func fontSpaceAdvance(_ font: CTFont) throws -> Double {
    var character: UniChar = 32
    var glyph: CGGlyph = 0
    var advance = CGSize.zero
    try require(
      CTFontGetGlyphsForCharacters(font, &character, &glyph, 1),
      "Font has no qualified ordinary space")
    CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &advance, 1)
    try require(advance.width.isFinite && advance.width > 0, "Invalid native space advance")
    return Double(advance.width)
  }
  func wordSpaceShape(_ source: NSAttributedString, text: NSString, start: Int, contentEnd: Int)
    throws
    -> WordSpaceShape
  {
    var trailingStart = contentEnd
    while trailingStart > start && [0x20, 0x202F].contains(text.character(at: trailingStart - 1)) {
      trailingStart -= 1
    }
    func flexible(_ index: Int) -> Bool {
      let point = text.character(at: index)
      return point == 0x20 || point == 0xA0
    }
    var hangingStart = trailingStart
    while hangingStart > start
      && (flexible(hangingStart - 1) || text.character(at: hangingStart - 1) == 0x202F)
    { hangingStart -= 1 }
    let gaps = (start..<hangingStart).filter(flexible)
    var nominal = 0.0
    for index in gaps {
      let font =
        source.attribute(
          NSAttributedString.Key(kCTFontAttributeName as String), at: index,
          effectiveRange: nil) as! CTFont
      nominal += try fontSpaceAdvance(font)
    }
    return WordSpaceShape(
      start: start, contentEnd: contentEnd, trailingStart: trailingStart,
      adjustable: gaps + Array(hangingStart..<contentEnd), gapCount: gaps.count,
      hangingStart: hangingStart, nominalSpaceWidth: nominal)
  }
  // One painted cluster has no internal position at which to distribute space.
  // In particular a trailing source space must not count as a second cluster.
  func canSpreadGlyphs(_ line: CTLine, shape: WordSpaceShape) -> Bool {
    guard shape.gapCount == 0, shape.hangingStart - shape.start > 1 else { return false }
    var first: CFIndex?
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
      let count = CTRunGetGlyphCount(run)
      var indices = [CFIndex](repeating: 0, count: count)
      var advances = [CGSize](repeating: .zero, count: count)
      CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
      CTRunGetAdvances(run, CFRange(location: 0, length: 0), &advances)
      for i in 0..<count where indices[i] < shape.hangingStart && advances[i].width > 0 {
        if let first = first, first != indices[i] { return true }
        first = indices[i]
      }
    }
    return false
  }
  struct FittedJustification {
    let word, letter, glyph: Double
    let condensed, letterOutsidePreference: Bool
  }
  func fittedJustification(_ placement: Placement?, policy: WordSpacing?) throws
    -> FittedJustification?
  {
    guard let policy, let gmin = policy.glyphMinimum, let gmax = policy.glyphMaximum,
      let gdes = policy.glyphDesired, let ldes = policy.letterDesired,
      let lmin = policy.letterMinimum,
      let lmax = policy.letterMaximum
    else {
      if placement?.wordPercent != nil || placement?.letterPercent != nil
        || placement?.glyphPercent != nil
      {
        throw fail("Unexpected advanced justification placement")
      }
      return nil
    }
    guard let w = placement?.wordPercent, let l = placement?.letterPercent,
      let g = placement?.glyphPercent,
      finite(w, 0, 1e9), finite(l, -100, 1e9), finite(g, gmin, gmax)
    else {
      throw fail("Missing or invalid justification placement")
    }
    return FittedJustification(
      word: w, letter: l, glyph: g,
      condensed: w < policy.desired || l < ldes || g < gdes,
      letterOutsidePreference: l < lmin - 0.000001 || l > lmax + 0.000001)
  }

  // Boundaries are stored after each eligible shaped cluster. This preserves
  // ligatures, combining marks, authored tracking and the original font runs.
  struct LetterOffsets {
    var ends: [Int] = []
    var prefix: [Double] = [0]
    var total: Double { prefix.last ?? 0 }
    func through(_ source: Int) -> Double {
      var low = 0, high = ends.count
      while low < high {
        let mid = (low + high) / 2
        if ends[mid] <= source { low = mid + 1 } else { high = mid }
      }
      return prefix[low]
    }
  }
  func letterOffsets(
    _ line: CTLine, shape: WordSpaceShape, text: NSString,
    generatedHyphen: Bool, percent: Double
  ) throws -> LetterOffsets {
    var result = LetterOffsets()
    if percent == 0 { return result }
    var clusters: [Int: Double] = [:]
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
      let count = CTRunGetGlyphCount(run)
      let font = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
      var indices = [CFIndex](repeating: 0, count: count)
      var widths = [CGSize](repeating: .zero, count: count)
      CTRunGetStringIndices(run, CFRange(), &indices)
      CTRunGetAdvances(run, CFRange(), &widths)
      let space = try fontSpaceAdvance(font)
      for i in 0..<count where indices[i] < shape.hangingStart && widths[i].width > 0 {
        let cluster = text.rangeOfComposedCharacterSequence(at: indices[i]).location
        if clusters[cluster] == nil { clusters[cluster] = space }
      }
    }
    let starts = clusters.keys.sorted()
    for i in starts.indices {
      if i + 1 == starts.count && !generatedHyphen { break }
      result.ends.append(i + 1 < starts.count ? starts[i + 1] : shape.hangingStart)
      result.prefix.append(result.total + clusters[starts[i]]! * percent / 100)
    }
    return result
  }

  func wordSpaceCapacities(
    _ shape: WordSpaceShape, line: CTLine, naturalWidth: Double, policy: WordSpacing,
    letterBasis: Double
  ) -> [String: Any] {
    // The exact native font's transformed U+0020 advances are the affine slope;
    // tracking stays additive and trailing spaces do not contribute visible width.
    func width(_ percent: Double) -> Double {
      max(0, naturalWidth + shape.nominalSpaceWidth * (percent / 100 - 1))
    }
    if let lmin = policy.letterMinimum, let ldes = policy.letterDesired,
      let lmax = policy.letterMaximum,
      let gmin = policy.glyphMinimum, let gdes = policy.glyphDesired, let gmax = policy.glyphMaximum
    {
      func adjusted(_ w: Double, _ l: Double, _ g: Double) -> Double {
        max(
          0,
          (naturalWidth + shape.nominalSpaceWidth * (w / 100 - 1) + letterBasis * l / 100) * g / 100
        )
      }
      return [
        "minimumWidth": adjusted(policy.minimum, lmin, gmin),
        "desiredWidth": adjusted(policy.desired, ldes, gdes),
        "maximumWidth": adjusted(policy.maximum, lmax, gmax), "eligibleGaps": shape.gapCount,
        "nominalSpaceWidth": shape.nominalSpaceWidth, "letterBasis": letterBasis,
        "physicalMinimum": adjusted(0, lmin, gmin),
      ]
    }
    return [
      "minimumWidth": width(policy.minimum), "desiredWidth": width(policy.desired),
      "maximumWidth": width(policy.maximum), "eligibleGaps": shape.gapCount,
      "nominalSpaceWidth": shape.nominalSpaceWidth,
      "canSpreadGlyphs": canSpreadGlyphs(line, shape: shape),
    ]
  }
  func wordSpacedLine(
    _ source: NSAttributedString, text: NSString, shape: WordSpaceShape, percent: Double,
    collapseTrailing: Bool, offset: Double
  ) throws -> CTLine {
    if shape.contentEnd == shape.start {
      return CTLineCreateWithAttributedString(NSAttributedString(string: ""))
    }
    let attributed = NSMutableAttributedString(attributedString: source)
    for index in shape.adjustable {
      let font =
        source.attribute(
          NSAttributedString.Key(kCTFontAttributeName as String), at: index,
          effectiveRange: nil) as! CTFont
      let key = NSAttributedString.Key(kCTTrackingAttributeName as String)
      let tracking =
        (source.attribute(key, at: index, effectiveRange: nil) as? NSNumber)?.doubleValue ?? 0
      let nominal = try fontSpaceAdvance(font)
      // CoreText tracking is already in transformed point units. Adding a kern
      // while tracking exists is ignored; changing only this source-space
      // tracking preserves nonspace shaping, ligatures and source clusters.
      let point = text.character(at: index)
      let adjusted: Double
      if collapseTrailing && index >= shape.hangingStart && point != 0xA0 {
        adjusted = -nominal
      } else if point == 0x202F {
        adjusted = tracking
      } else {
        adjusted = tracking + nominal * (percent / 100 - 1)
      }
      attributed.addAttribute(key, value: adjusted, range: NSRange(location: index, length: 1))
    }
    return CTTypesetterCreateLineWithOffset(
      CTTypesetterCreateWithAttributedString(attributed),
      CFRange(location: shape.start, length: shape.contentEnd - shape.start), offset)
  }
  // With only fixed gaps, distribute the remaining space between shaped
  // clusters. Core Text otherwise expands the space glyph as a word gap.
  func justifyFixedPair(
    _ source: NSAttributedString, text: NSString, shape: WordSpaceShape,
    line: CTLine, width: Double, target: Double, offset: Double
  ) -> CTLine? {
    let range = NSRange(location: shape.start, length: shape.contentEnd - shape.start)
    guard shape.adjustable.isEmpty, range.length > 1,
      text.range(of: "\u{202F}", options: [], range: range).location != NSNotFound
    else { return nil }
    var clusters = Set<Int>()
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
      var indices = [CFIndex](repeating: 0, count: CTRunGetGlyphCount(run))
      CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
      clusters.formUnion(indices)
    }
    guard let last = clusters.max(), clusters.count > 1, last > shape.start else { return nil }
    let delta = (target - width) / Double(clusters.count - 1)
    let adjusted = NSMutableAttributedString(attributedString: source)
    let adjustmentRange = NSRange(location: shape.start, length: last - shape.start)
    let key = NSAttributedString.Key(kCTTrackingAttributeName as String)
    source.enumerateAttribute(key, in: adjustmentRange) { value, part, _ in
      let tracking = (value as? NSNumber)?.doubleValue ?? 0
      adjusted.addAttribute(key, value: tracking + delta, range: part)
    }
    let result = CTTypesetterCreateLineWithOffset(
      CTTypesetterCreateWithAttributedString(adjusted),
      CFRange(location: range.location, length: range.length), offset)
    let actual = CTLineGetTypographicBounds(result, nil, nil, nil)
    return abs(actual - target) < 0.000001 ? result : nil
  }
  func collapsedSpaceEdge(_ line: CTLine, shape: WordSpaceShape) throws -> Double? {
    guard shape.trailingStart < shape.contentEnd else { return nil }
    var edge: Double?
    var covered = Set<Int>()
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
      let count = CTRunGetGlyphCount(run)
      var indices = [CFIndex](repeating: 0, count: count)
      var positions = [CGPoint](repeating: .zero, count: count)
      var advances = [CGSize](repeating: .zero, count: count)
      CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
      CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
      CTRunGetAdvances(run, CFRange(location: 0, length: 0), &advances)
      let matrix = CTRunGetTextMatrix(run)
      for index in 0..<count
      where indices[index] >= shape.trailingStart && indices[index] < shape.contentEnd {
        let x = Double(positions[index].applying(matrix).x)
        try require(
          abs(advances[index].width) < 0.000001
            && (edge == nil || abs(x - edge!) < 0.000001), "Native trailing spaces did not collapse"
        )
        edge = x
        covered.insert(indices[index])
      }
    }
    try require(
      covered.count == shape.contentEnd - shape.trailingStart && edge != nil,
      "Native trailing-space source coverage changed")
    return edge
  }
  struct WordSpaceChange {
    let index: Int
    let delta: Double
  }
  func wordSpaceChanges(_ original: CTLine, final: CTLine, shape: WordSpaceShape) throws
    -> [WordSpaceChange]
  {
    let sourceSpaces = Set(shape.adjustable)
    func advances(_ line: CTLine) throws -> [Int: Double] {
      var result: [Int: Double] = [:]
      for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var indices = [CFIndex](repeating: 0, count: count)
        var widths = [CGSize](repeating: .zero, count: count)
        CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
        CTRunGetAdvances(run, CFRange(location: 0, length: 0), &widths)
        for index in 0..<count where sourceSpaces.contains(indices[index]) {
          try require(
            result[indices[index]] == nil && widths[index].width.isFinite,
            "Native word-space source cluster is not qualified")
          result[indices[index]] = Double(widths[index].width)
        }
      }
      try require(
        result.count == sourceSpaces.count,
        "Native word-space source coverage changed")
      return result
    }
    let before = try advances(original)
    let after = try advances(final)
    return sourceSpaces.sorted().map { WordSpaceChange(index: $0, delta: after[$0]! - before[$0]!) }
  }
  func validateWordSpaceDirection(_ line: CTLine) throws {
    try require(
      !(CTLineGetGlyphRuns(line) as! [CTRun]).contains {
        CTRunGetStatus($0).contains(.rightToLeft)
      }, "Explicit word spacing requires qualified left-to-right shaping")
  }
  // Core Text normally suppresses the soft hyphen. A glyph override on the authored
  // character supplies ink while preserving its UTF-16 identity for carets and PDF.
  func discretionaryBreak(_ text: NSString, at end: Int) -> Bool {
    guard end >= 2, end < text.length, text.character(at: end - 1) == 0xAD else { return false }
    func boundary(_ unit: unichar) -> Bool {
      if [0x2D, 0x200B, 0x2010, 0x2011, 0x2013, 0x2014, 0xFEFF].contains(unit) { return true }
      return UnicodeScalar(unit).map { CharacterSet.whitespacesAndNewlines.contains($0) } ?? false
    }
    let following = text.character(at: end)
    guard following != 0xAD && !boundary(following) else { return false }
    // Only the final soft marker in a run can print. A literal dash already
    // supplies the ink, so a following soft marker stays silent.
    var before = end - 2
    while before >= 0 && text.character(at: before) == 0xAD { before -= 1 }
    return before >= 0 && !boundary(text.character(at: before))
  }

  func showDiscretionaryHyphen(_ text: NSMutableAttributedString, at end: Int) throws {
    let range = NSRange(location: end - 1, length: 1)
    let font =
      text.attribute(
        NSAttributedString.Key(kCTFontAttributeName as String),
        at: range.location, effectiveRange: nil) as! CTFont
    var character: UniChar = 0x2D
    var glyph: CGGlyph = 0
    guard CTFontGetGlyphsForCharacters(font, &character, &glyph, 1),
      let info = CTGlyphInfoCreateWithGlyph(glyph, font, "\u{00AD}" as CFString)
    else { throw fail("The selected face has no discretionary hyphen glyph") }
    text.addAttribute(
      NSAttributedString.Key(kCTGlyphInfoAttributeName as String), value: info, range: range)
  }

  // Generated ink has no source character. Shape one dash with the preceding
  // run's attributes and keep the searchable PDF text and insertion stops intact.
  struct BreakHyphen {
    let font: CTFont
    let glyph: CGGlyph
    let offset: CGPoint
    let advance: CGFloat
    let color: CGColor
  }
  func breakHyphen(_ source: NSAttributedString, at end: Int) throws -> BreakHyphen {
    let attributes = source.attributes(at: end - 1, effectiveRange: nil)
    let face = attributes[NSAttributedString.Key(kCTFontAttributeName as String)] as! CTFont
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "-", attributes: attributes))
    let runs = CTLineGetGlyphRuns(line) as! [CTRun]
    guard runs.count == 1, let run = runs.first, CTRunGetGlyphCount(run) == 1
    else { throw fail("Cannot shape a generated hyphen in the selected face") }
    let font = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
    try require(CTFontCopyPostScriptName(font) == CTFontCopyPostScriptName(face),
      "The selected face has no generated hyphen")
    var glyph = CGGlyph()
    var offset = CGPoint.zero
    let one = CFRange(location: 0, length: 1)
    CTRunGetGlyphs(run, one, &glyph)
    CTRunGetPositions(run, one, &offset)
    let advance = CTLineGetTypographicBounds(line, nil, nil, nil)
    try require(glyph != 0 && advance > 0 && advance.isFinite, "Invalid generated hyphen metrics")
    return BreakHyphen(font: font, glyph: glyph, offset: offset.applying(CTRunGetTextMatrix(run)),
      advance: advance, color: attributes[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] as! CGColor)
  }

  func measureCandidates(_ request: Request, fonts: [String: CGFont]) throws -> [[String: Any]] {
    let attributed = try attributedSource(request, fonts: fonts)
    let typesetter = CTTypesetterCreateWithAttributedString(attributed)
    let string = request.text as NSString
    let candidates = request.candidates!
    let automaticEnds = Set(request.hyphenationPoints ?? [])
    var hyphenWidths: [Int: CGFloat] = [:]
    // Multiple candidate starts can share the same conditional ending. Keep only
    // one alternate typesetter alive and return measurements in caller order.
    let order =
      request.text.contains("\u{00AD}")
      ? candidates.indices.sorted { candidates[$0].end < candidates[$1].end }
      : Array(candidates.indices)
    var alternate: (end: Int, typesetter: CTTypesetter)?
    var rows = Array(repeating: [String: Any](), count: candidates.count)
    for index in order {
      let candidate = candidates[index]
      var lineTypesetter = typesetter
      if candidate.end - candidate.start >= 2 && discretionaryBreak(string, at: candidate.end) {
        if alternate?.end != candidate.end {
          let copy = NSMutableAttributedString(attributedString: attributed)
          try showDiscretionaryHyphen(copy, at: candidate.end)
          alternate = (candidate.end, CTTypesetterCreateWithAttributedString(copy))
        }
        lineTypesetter = alternate!.typesetter
      }
      var end = candidate.end
      while end > candidate.start
        && [10, 13, 0x2028, 0x2029].contains(Int(string.character(at: end - 1)))
      { end -= 1 }
      let line =
        end > candidate.start
        ? CTTypesetterCreateLineWithOffset(
          lineTypesetter, CFRange(location: candidate.start, length: end - candidate.start),
          candidate.offset ?? 0)
        : CTLineCreateWithAttributedString(NSAttributedString(string: ""))
      try validateFallback(line, request: request)
      var ascent = CGFloat.zero
      var descent = CGFloat.zero
      var leading = CGFloat.zero
      let width = max(
        0,
        CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
          - CTLineGetTrailingWhitespaceWidth(line))
      if automaticEnds.contains(candidate.end) && hyphenWidths[candidate.end] == nil {
        hyphenWidths[candidate.end] = try breakHyphen(attributed, at: candidate.end).advance
      }
      let sourceRuns = request.runs.filter { $0.start < candidate.end && $0.end > candidate.start }
      let nativeFonts = (CTLineGetGlyphRuns(line) as! [CTRun]).map {
        (CTRunGetAttributes($0) as NSDictionary)[kCTFontAttributeName] as! CTFont
      }
      let actualFonts =
        nativeFonts.isEmpty
        ? sourceRuns.map { CTFontCreateWithGraphicsFont(fonts[$0.font]!, $0.size, nil, nil) }
        : nativeFonts
      if end == candidate.start {
        ascent = actualFonts.map { CTFontGetAscent($0) }.max() ?? 0
        descent = actualFonts.map { CTFontGetDescent($0) }.max() ?? 0
        leading = actualFonts.map { CTFontGetLeading($0) }.max() ?? 0
      }
      let character =
        request.protocol >= 4
        ? characterMetrics(line, sourceRuns: sourceRuns, fonts: fonts) : nil
      if let character = character {
        ascent = character.ascent
        descent = character.descent
        leading = character.leading
      }
      let advance =
        sourceRuns.map {
          ($0.leading ?? 0) > 0 ? $0.leading! : $0.size * ($0.autoLeading ?? 120) / 100
        }.max() ?? 14.4
      let measuredWidth = width + (hyphenWidths[candidate.end] ?? 0)
      var row: [String: Any] = [
        "start": candidate.start, "end": candidate.end, "width": measuredWidth,
        "ascent": Double(ascent), "descent": Double(descent), "leading": Double(leading),
        "advance": advance,
        "capHeight": character.map { Double($0.capHeight) }
          ?? (actualFonts.map { Double(CTFontGetCapHeight($0)) }.max() ?? 0),
        "xHeight": character.map { Double($0.xHeight) }
          ?? (actualFonts.map { Double(CTFontGetXHeight($0)) }.max() ?? 0),
      ]
      if let character = character {
        row["inkAscent"] = Double(character.inkAscent)
        row["inkDescent"] = Double(character.inkDescent)
      }
      if let policy = request.paragraphs?.first(where: {
        $0.start <= candidate.start && $0.end > candidate.start
      })?.wordSpacing {
        try validateWordSpaceDirection(line)
        let shape = try wordSpaceShape(
          attributed, text: string, start: candidate.start, contentEnd: end)
        row["wordSpacing"] = wordSpaceCapacities(
          shape, line: line, naturalWidth: measuredWidth, policy: policy,
          letterBasis: policy.letterDesired == nil ? 0 : try letterOffsets(line, shape: shape, text: string, generatedHyphen: automaticEnds.contains(candidate.end), percent: 100).total)
      }
      rows[index] = row
    }
    return rows
  }
  // Centered text hugs the interruption at the outer fragments of an occupied
  // row. A lone fragment and any interior fragments center in their own space.
  func horizontalFlush(
    _ alignment: String, last: Bool, placements: [Placement]?, index: Int,
    paragraph: Paragraph?
  ) -> CGFloat {
    guard alignment == "center" || (alignment == "justify-center" && last) else {
      let right = alignment == "right" || alignment == "end" || (alignment == "justify-right" && last)
      return right ? 1 : 0
    }
    guard let placements = placements, let paragraph = paragraph else { return 0.5 }
    let own = placements[index]
    func sameRow(_ neighbor: Placement) -> Bool {
      neighbor.frame == own.frame && abs(neighbor.baseline - own.baseline) <= 0.000001
    }
    let before = index > 0 && placements[index - 1].end > paragraph.start
      && sameRow(placements[index - 1])
    let after = index + 1 < placements.count && own.end < paragraph.end
      && sameRow(placements[index + 1])
    if before == after { return 0.5 }
    return after ? 1 : 0
  }

  func compose(_ request: Request, fonts: [String: CGFont]) throws -> (
    [FrozenLine], [[String: Any]], [String], [[String: String]]
  ) {
    let canonicalString = request.text as NSString
    let base = try attributedSource(request, fonts: fonts)
    let automaticEnds = Set(request.hyphenationPoints ?? [])
    let usesGreedyBreaks = request.placements == nil && request.breaks == nil
    if request.text.contains("\u{00AD}"),
      let ends = request.placements?.map(\.end) ?? request.breaks
    {
      var start = 0
      for end in ends {
        if end - start >= 2 && discretionaryBreak(canonicalString, at: end) {
          try showDiscretionaryHyphen(base, at: end)
        }
        start = end
      }
    }
    let typesetter = CTTypesetterCreateWithAttributedString(base)
    let textLength = base.length
    let nativeString = base.string as NSString
    let boundaries = graphemeBoundaries(request.text)
    var vectors: [String: String] = [:]
    var glyphBudget = 0
    var caretBudget = 0
    var position = 0
    var frozen: [FrozenLine] = []
    var output: [[String: Any]] = []
    var diagnostics = Set<String>()
    let known = Set(request.resources.map { $0.postscript })
    var paragraphIndex = 0
    let retained = Dictionary(uniqueKeysWithValues: (request.retainedLines ?? []).map { ($0.start, $0) })
    for (page, frame) in request.frames.enumerated() {
      var previousBaseline: Double? = nil
      let frameStart = frozen.count
      while position < (request.oversetStart ?? textLength) {
        try require(output.count < 4096, "Composed line budget exceeded")
        let placement =
          request.mode == "planned-lines-proof" ? request.placements![output.count] : nil
        if let placement = placement {
          if placement.frame > page { break }
          try require(placement.frame == page, "Planned frame does not match its source cursor")
        }
        while let paragraphs = request.paragraphs,
          paragraphIndex + 1 < paragraphs.count && position >= paragraphs[paragraphIndex].end
        { paragraphIndex += 1 }
        let paragraph = request.paragraphs?[paragraphIndex]
        let paragraphFirstLine = paragraph?.start == position
        let paragraphIndent =
          (paragraph?.leftIndent ?? 0)
          + (paragraphFirstLine ? paragraph?.firstLineIndent ?? 0 : 0)
        let indent = placement?.left ?? paragraphIndent
        let availableWidth =
          placement?.width
          ?? (frame.width - paragraphIndent - (paragraph?.rightIndent ?? 0))
        var count =
          placement != nil
          ? placement!.end - position
          : request.mode == "explicit-lines-proof"
            ? request.breaks!.first(where: { $0 > position })! - position
            : CTTypesetterSuggestLineBreakWithOffset(typesetter, position, availableWidth, indent)
        if count <= 0 {
          count = (boundaries.first(where: { $0 > position }) ?? textLength) - position
          diagnostics.insert("unbreakable-cluster-overflow")
        }
        var end = min(textLength, position + count)
        var attributed = base
        var lineTypesetter = typesetter
        // Long single-line flows use Core Text's streaming fitter. Its first
        // suggestion measures a silent marker. Refit with the chosen glyph's
        // actual advance before accepting that break in a tight column.
        while usesGreedyBreaks && end - position >= 2
          && discretionaryBreak(canonicalString, at: end)
        {
          let copy = NSMutableAttributedString(attributedString: base)
          try showDiscretionaryHyphen(copy, at: end)
          let alternate = CTTypesetterCreateWithAttributedString(copy)
          let revised = CTTypesetterSuggestLineBreakWithOffset(
            alternate, position, availableWidth, indent)
          if revised >= end - position {
            attributed = copy
            lineTypesetter = alternate
            break
          }
          end =
            revised > 0
            ? position + revised : (boundaries.first(where: { $0 > position }) ?? textLength)
        }
        var contentEnd = end
        while contentEnd > position
          && [10, 13, 0x2028].contains(Int(nativeString.character(at: contentEnd - 1)))
        { contentEnd -= 1 }
        var line =
          contentEnd > position
          ? CTTypesetterCreateLineWithOffset(
            lineTypesetter, CFRange(location: position, length: contentEnd - position), indent)
          : CTLineCreateWithAttributedString(NSAttributedString(string: ""))
        var ascent = CGFloat.zero
        var descent = CGFloat.zero
        var leading = CGFloat.zero
        var width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
        var visibleWidth = max(0, width - CTLineGetTrailingWhitespaceWidth(line))
        let paragraphLastLine = paragraph.map { end >= $0.end } ?? false
        let alignment = paragraph?.align ?? "left"
        let justified =
          alignment.hasPrefix("justify")
          && (!paragraphLastLine || alignment == "justify-all")
        let hyphen = automaticEnds.contains(end) ? try breakHyphen(base, at: end) : nil
        let fitted = try fittedJustification(placement, policy: paragraph?.wordSpacing)
        let scaleX = (fitted?.glyph ?? 100) / 100
        var letters = LetterOffsets()
        let bodyArea = availableWidth / scaleX - (hyphen?.advance ?? 0)
        var wordSpacingRow: [String: Any]?
        var collapsedShape: WordSpaceShape?
        var collapsedEdge: Double?
        var originalWordSpaceLine: CTLine?
        var wordSpaceChanges: [WordSpaceChange] = []
        if let policy = paragraph?.wordSpacing {
          let original = line
          try validateWordSpaceDirection(line)
          let shape = try wordSpaceShape(
            attributed, text: canonicalString, start: position, contentEnd: contentEnd)
          let nominal = shape.nominalSpaceWidth
          let desired = max(0, visibleWidth + nominal * (policy.desired / 100 - 1))
          let minimum = max(0, visibleWidth + nominal * (policy.minimum / 100 - 1))
          if let fitted {
            letters = try letterOffsets(
              original, shape: shape, text: canonicalString,
              generatedHyphen: hyphen != nil, percent: fitted.letter)
          }
          let condensesLast =
            alignment.hasPrefix("justify") && paragraphLastLine && alignment != "justify-all"
            && (fitted?.condensed ?? (desired > bodyArea))
          let adjustsToArea = justified || condensesLast
          let target = adjustsToArea ? bodyArea : desired
          if fitted == nil && condensesLast {
            try require(
              minimum <= bodyArea + 0.000001,
              "Final justified line exceeds its minimum word-space preference")
          }
          if fitted == nil && nominal > 0 && adjustsToArea {
            try require(
              visibleWidth - nominal <= bodyArea + 0.000001,
              "Justified line exceeds its zero-word-space physical floor")
          }
          let percentage =
            fitted?.word
            ?? (nominal > 0 ? policy.desired + (target - desired) / nominal * 100 : policy.desired)
          try require(
            percentage.isFinite && percentage >= -0.000001,
            "Invalid solved native word spacing")
          line = try wordSpacedLine(
            attributed, text: canonicalString, shape: shape, percent: max(0, percentage),
            collapseTrailing: adjustsToArea, offset: indent)
          var fallback = false
          if fitted == nil && justified && nominal == 0 && visibleWidth > 0.000001
            && visibleWidth < bodyArea,
            canSpreadGlyphs(original, shape: shape),
            let expanded = justifyFixedPair(
              attributed, text: canonicalString, shape: shape, line: line,
              width: visibleWidth, target: bodyArea, offset: indent)
              ?? CTLineCreateJustifiedLine(line, 1, bodyArea)
          {
            // Preserve the already-qualified native single-word letter-spreading
            // fallback. This does not implement authored letter-spacing limits.
            line = expanded
            fallback = true
          }
          width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
          visibleWidth = max(0, width - CTLineGetTrailingWhitespaceWidth(line))
          if fitted == nil && nominal > 0 {
            try require(
              abs(visibleWidth - target) < 0.000001,
              "Native word spacing did not realize its measured target")
          }
          if adjustsToArea {
            collapsedEdge = try collapsedSpaceEdge(line, shape: shape)
            if collapsedEdge != nil { collapsedShape = shape }
          }
          if !fallback && !shape.adjustable.isEmpty {
            originalWordSpaceLine = original
            wordSpaceChanges = try self.wordSpaceChanges(original, final: line, shape: shape)
          }
          wordSpacingRow = [
            "percentage": max(0, percentage), "eligibleGaps": shape.gapCount,
            "nominalSpaceWidth": nominal, "justified": adjustsToArea,
            "offPreference": percentage < policy.minimum - 0.000001
              || percentage > policy.maximum + 0.000001,
            "fallback": fallback ? "single-word" : NSNull(),
          ]
          if let fitted {
            wordSpacingRow?["letterPercentage"] = fitted.letter
            wordSpacingRow?["glyphPercentage"] = fitted.glyph
            if fitted.letterOutsidePreference { wordSpacingRow?["offPreference"] = true }
          }
          if let collapsed = collapsedShape {
            wordSpacingRow!["collapsedTrailingStart"] = collapsed.trailingStart
          }
        } else if justified && visibleWidth > 0 && visibleWidth < bodyArea,
          let expanded = CTLineCreateJustifiedLine(line, 1, bodyArea)
        {
          line = expanded
          width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
          visibleWidth = max(0, width - CTLineGetTrailingWhitespaceWidth(line))
        }
        let flush = horizontalFlush(
          alignment, last: paragraphLastLine, placements: request.placements, index: output.count,
          paragraph: paragraph)
        let originX =
          indent
          + (paragraph?.wordSpacing?.glyphDesired == nil
            ? CTLineGetPenOffsetForFlush(line, flush, bodyArea)
            : Double(flush)
              * (availableWidth - (visibleWidth + letters.total + (hyphen?.advance ?? 0)) * scaleX))
        width = (width + letters.total) * scaleX
        visibleWidth = (visibleWidth + letters.total) * scaleX
        let bodyWidth = visibleWidth
        if let hyphen = hyphen {
          width += hyphen.advance * scaleX
          visibleWidth += hyphen.advance * scaleX
        }
        if contentEnd == position,
          let blank = request.runs.first(where: { $0.start <= position && $0.end > position })
        {
          let font = CTFontCreateWithGraphicsFont(fonts[blank.font]!, blank.size, nil, nil)
          ascent = CTFontGetAscent(font)
          descent = CTFontGetDescent(font)
          leading = CTFontGetLeading(font)
        }
        let sourceRuns = request.runs.filter { $0.start < end && $0.end > position }
        let character =
          request.protocol >= 4
          ? characterMetrics(line, sourceRuns: sourceRuns, fonts: fonts) : nil
        if let character = character {
          // Manual character transforms affect ink, not InDesign's baseline strut.
          ascent = character.ascent
          descent = character.descent
          leading = character.leading
        }
        let advance =
          sourceRuns.map {
            ($0.leading ?? 0) > 0 ? $0.leading! : $0.size * ($0.autoLeading ?? 120) / 100
          }.max() ?? 14.4
        let baseline: Double
        if let placement = placement {
          baseline = placement.baseline
        } else if let previous = previousBaseline {
          let previousAfter =
            paragraphFirstLine && paragraphIndex > 0
            ? request.paragraphs![paragraphIndex - 1].paragraphAfter : 0
          baseline =
            previous + advance + previousAfter
            + (paragraphFirstLine ? paragraph?.paragraphBefore ?? 0 : 0)
        } else {
          let metric: Double
          switch frame.firstBaseline ?? "ascent" {
          case "fixed": metric = 0
          case "leading": metric = advance
          case "cap-height", "x-height":
            let nativeRuns = CTLineGetGlyphRuns(line) as! [CTRun]
            let nativeFonts = nativeRuns.map {
              (CTRunGetAttributes($0) as NSDictionary)[kCTFontAttributeName] as! CTFont
            }
            let actualFonts =
              nativeFonts.isEmpty
              ? sourceRuns.map { CTFontCreateWithGraphicsFont(fonts[$0.font]!, $0.size, nil, nil) }
              : nativeFonts
            metric =
              actualFonts.map {
                let font = request.protocol >= 4 ? untransformedFont($0) : $0
                return Double(
                  frame.firstBaseline == "cap-height"
                    ? CTFontGetCapHeight(font) : CTFontGetXHeight(font))
              }.max() ?? Double(ascent)
          default: metric = Double(ascent)
          }
          baseline = max(frame.minimumFirstBaseline ?? 0, metric)
        }
        if placement != nil {
          try require(
            baseline + ((frame.verticalAlign ?? "top") == "top" ? Double(descent) : 0)
              <= frame.height + 0.000001,
            "Planned line exceeds frame height")
        } else if baseline + Double(descent) > frame.height {
          break
        }
        // A full column hands this same decision to the next authored frame,
        // which can be wider. Validate width only after it can occupy this row.
        if request.mode == "explicit-lines-proof" || placement != nil {
          try require(
            visibleWidth <= availableWidth + 0.000001,
            "Explicit line exceeds its indented line area")
        }
        var runRows: [[String: Any]] = []
        let reuseDetails = request.protocol != 6 && (retained[position].map {
          $0.end == end && $0.availableWidth == availableWidth && $0.originX == originX
            && $0.width == width
        } ?? false)
        let nativeRuns = CTLineGetGlyphRuns(line) as! [CTRun]
        if reuseDetails {
          // Freeze the actual new CTLine for PDF. The editor already owns the
          // detail arrays for this paragraph, font identity and horizontal area.
          try validateFallback(line, request: request)
          glyphBudget += nativeRuns.reduce(0) { $0 + CTRunGetGlyphCount($1) }
          try require(glyphBudget <= 100_000, "Glyph budget exceeded")
        }
        for run in reuseDetails ? [] : nativeRuns {
          let attrs = CTRunGetAttributes(run) as NSDictionary
          let font = attrs[kCTFontAttributeName] as! CTFont
          let name = CTFontCopyPostScriptName(font) as String
          if !known.contains(name) && variableInstances[name] == nil {
            try require(request.allowFallback, "Unpackaged fallback font: " + name)
            diagnostics.insert("unpackaged-fallback:" + name)
          }
          let n = CTRunGetGlyphCount(run)
          let source = CTRunGetStringRange(run)
          glyphBudget += n
          try require(glyphBudget <= 100_000, "Glyph budget exceeded")
          var glyphs = [CGGlyph](repeating: 0, count: n)
          var positions = [CGPoint](repeating: .zero, count: n)
          var advances = [CGSize](repeating: .zero, count: n)
          var indices = [CFIndex](repeating: 0, count: n)
          CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
          CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
          CTRunGetAdvances(run, CFRange(location: 0, length: 0), &advances)
          CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
          if request.protocol >= 4 {
            // Positions are in run-matrix coordinates. Advances and line caret
            // offsets already include that matrix and must not be scaled twice.
            let matrix = CTRunGetTextMatrix(run)
            positions = positions.map { $0.applying(matrix) }
          }
          let edges = Array(Set(indices + [source.location + source.length])).sorted()
          var rows: [[String: Any]] = try (0..<n).map { i in
            let a = indices[i]
            let b = edges.first(where: { $0 > a }) ?? source.location + source.length
            var row: [String: Any] = [
              "glyph": Int(glyphs[i]), "index": a, "end": b,
              "position": [
                (Double(positions[i].x) + letters.through(a)) * scaleX + originX,
                Double(positions[i].y),
              ],
              "advance": [
                (Double(advances[i].width)
                  + (i + 1 == n || indices[i + 1] != a
                    ? letters.through(b) - letters.through(a) : 0))
                  * scaleX, Double(advances[i].height),
              ],
              "sourceRanges": logicalRanges(a, b, request.spans),
            ]
            if request.includeVectors == true {
              let key = vectorIdentity(font: font, glyph: glyphs[i], request: request)
              if let path = try vectorPath(font: font, glyph: glyphs[i], id: key) {
                row["vector"] = key
                vectors[key] = path
              } else if advances[i].width != 0 && glyphs[i] != 0 {
                let value = (request.text as NSString).substring(
                  with: NSRange(location: a, length: max(0, b - a)))
                if !value.unicodeScalars.allSatisfy({
                  CharacterSet.whitespacesAndNewlines.contains($0)
                    || $0.properties.isDefaultIgnorableCodePoint
                }) {
                  row["vectorUnavailable"] = true
                  diagnostics.insert("glyph-outline-unavailable:" + name)
                }
              }
            }
            return row
          }
          if let hyphen = hyphen, source.location + source.length == end {
            let x = originX + bodyWidth + hyphen.offset.x * scaleX
            var ink: [String: Any] = [
              "glyph": Int(hyphen.glyph), "index": end, "end": end, "generated": true,
              "position": [x, hyphen.offset.y], "advance": [hyphen.advance * scaleX, 0], "sourceRanges": [],
            ]
            if request.includeVectors == true {
              let id = vectorIdentity(font: hyphen.font, glyph: hyphen.glyph, request: request)
              guard let path = try vectorPath(font: hyphen.font, glyph: hyphen.glyph, id: id)
              else { throw fail("Generated hyphen outline unavailable") }
              vectors[id] = path
              ink["vector"] = id
            }
            rows.append(ink)
            glyphBudget += 1
            try require(glyphBudget <= 100_000, "Glyph budget exceeded")
          }
          var row: [String: Any] = [
            "font": name, "size": Double(CTFontGetSize(font)),
            "rtl": CTRunGetStatus(run).contains(.rightToLeft), "start": source.location,
            "end": source.location + source.length, "glyphs": rows,
            "underlinePosition": Double(CTFontGetUnderlinePosition(font)),
            "underlineThickness": Double(CTFontGetUnderlineThickness(font)),
            "xHeight": Double(CTFontGetXHeight(font)),
            "capHeight": Double(CTFontGetCapHeight(font)),
          ]
          if let input = sourceRuns.first(where: {
            $0.start <= source.location && $0.end > source.location
          }) {
            row["textColor"] = input.textColor ?? "#252525"
            row["leading"] = input.leading ?? 0
            row["autoLeading"] = input.autoLeading ?? 120
            if request.protocol >= 4 {
              let strut = untransformedFont(font)
              let shift = (attrs[kCTBaselineOffsetAttributeName] as? NSNumber)?.doubleValue ?? 0
              row["ascent"] = Double(CTFontGetAscent(strut))
              row["descent"] = Double(CTFontGetDescent(strut))
              row["xHeight"] = Double(CTFontGetXHeight(strut))
              row["capHeight"] = Double(CTFontGetCapHeight(strut))
              row["inkAscent"] = Double(CTFontGetAscent(font)) + shift
              row["inkDescent"] = Double(CTFontGetDescent(font)) - shift
              row["baselineShift"] = shift
              row["horizontalScale"] = input.horizontalScale ?? 100
              row["verticalScale"] = input.verticalScale ?? 100
            }
          }
          runRows.append(row)
        }
        let lineBoundaries = boundaries.filter { $0 >= position && $0 <= end }
        caretBudget += lineBoundaries.count
        try require(caretBudget <= 110_000, "Caret budget exceeded")
        var spaceCursor = 0
        var spaceDelta = 0.0
        let carets: [[String: Any]] = reuseDetails ? [] : lineBoundaries.map { index in
          var secondary = CGFloat.zero
          let boundary = min(index, contentEnd)
          while spaceCursor < wordSpaceChanges.count
            && wordSpaceChanges[spaceCursor].index < boundary
          {
            spaceDelta += wordSpaceChanges[spaceCursor].delta
            spaceCursor += 1
          }
          var primary =
            contentEnd == position
            ? CGFloat.zero
            : CTLineGetOffsetForStringIndex(originalWordSpaceLine ?? line, boundary, &secondary)
          if originalWordSpaceLine != nil {
            // Tracking added only to a source space changes CoreText's insertion
            // query by half its advance. Preserve the original native ligature /
            // authored-tracking caret, then translate it by actual retained
            // glyph-advance changes before this source boundary. One monotonic
            // sweep covers all carets; no per-caret scan or invented target edge.
            primary += CGFloat(spaceDelta)
            secondary += CGFloat(spaceDelta)
          }
          let collapsed = collapsedShape.map { index >= $0.trailingStart } ?? false
          if collapsed, let edge = collapsedEdge {
            // CTLine's insertion query extrapolates half tracking past collapsed
            // trailing spaces. The retained glyph runs instead measure every
            // such source boundary at their actual zero-advance drawn edge.
            primary = CGFloat(edge)
            secondary = primary
          }
            let nativeHit =
              contentEnd == position
              ? position : CTLineGetStringIndexForPosition(line, CGPoint(x: primary, y: 0))
            primary = (primary + letters.through(boundary)) * scaleX
            secondary = (secondary + letters.through(boundary)) * scaleX
            if hyphen != nil && index == end {
              primary = visibleWidth
              secondary = primary
            }
            return [
            "index": index, "primary": Double(primary) + originX,
            "secondary": Double(secondary) + originX,
            "logicalCandidates": logicalCandidates(index, request.spans),
            "measurement": collapsed
              ? "native-collapsed-space"
              : contentEnd == position
                ? "empty-paragraph-origin"
                : originalWordSpaceLine != nil ? "native-word-space" : "native-line",
            "hitIndex": hyphen != nil && index == end ? end : nativeHit,
          ]
        }
        frozen.append(
          FrozenLine(
            page: page, start: position, end: end, baseline: baseline, ascent: Double(ascent),
            descent: Double(descent), line: line, hyphen: hyphen, letterOffsets: letters,
            scaleX: scaleX, bodyWidth: bodyWidth, originX: originX))
        var row: [String: Any] = [
          "frame": frame.id, "page": page, "start": position, "end": end, "contentEnd": contentEnd,
          "baseline": baseline, "ascent": Double(ascent), "descent": Double(descent),
          "leading": Double(leading), "width": width, "visibleWidth": visibleWidth,
          "advance": advance,
          "sourceRanges": logicalRanges(position, end, request.spans), "runs": runRows,
          "carets": carets,
        ]
        if request.protocol >= 2 {
          row["originX"] = originX
          row["availableWidth"] = availableWidth
          row["paragraphStart"] = paragraph!.start
          row["paragraphEnd"] = paragraph!.end
        }
        if reuseDetails { row["retainedGeometry"] = true }
        if placement != nil { row["placementIndex"] = output.count }
        if let character = character {
          row["inkAscent"] = Double(character.inkAscent)
          row["inkDescent"] = Double(character.inkDescent)
        }
        if let spacing = wordSpacingRow { row["wordSpacing"] = spacing }
        output.append(row)
        position = end
        previousBaseline = baseline
      }
      if let last = frozen.last, frozen.count > frameStart && request.mode != "planned-lines-proof"
      {
        let remaining = max(0, frame.height - last.baseline)
        let offset =
          frame.verticalAlign == "bottom"
          ? remaining : frame.verticalAlign == "center" ? remaining / 2 : 0
        if offset > 0 {
          for index in frameStart..<frozen.count {
            frozen[index].baseline += offset
            output[index]["baseline"] = frozen[index].baseline
          }
        }
      }
    }
    if position < textLength { diagnostics.insert("overset") }
    return (
      frozen, output, diagnostics.sorted(),
      vectors.keys.sorted().map { ["id": $0, "pathD": vectors[$0]!] }
    )
  }

  func graphemeBoundaries(_ text: String) -> [Int] {
    var result = [0]
    var cursor = text.startIndex
    while cursor < text.endIndex {
      cursor = text.index(after: cursor)
      result.append(cursor.utf16Offset(in: text))
    }
    return result
  }
  func overlapping(_ spans: [SourceSpan], from start: Int, through end: Int) -> ArraySlice<
    SourceSpan
  > {
    var low = 0
    var high = spans.count
    while low < high {
      let mid = (low + high) / 2
      if spans[mid].end < start { low = mid + 1 } else { high = mid }
    }
    let first = low
    while low < spans.count && spans[low].start <= end { low += 1 }
    return spans[first..<low]
  }
  func color(_ value: String) -> CGColor {
    let number = Int(value.dropFirst(), radix: 16) ?? 0x252525
    return CGColor(
      red: Double((number >> 16) & 255) / 255, green: Double((number >> 8) & 255) / 255,
      blue: Double(number & 255) / 255, alpha: 1)
  }
  func validateFallback(_ line: CTLine, request: Request) throws {
    let known = Set(request.resources.map { $0.postscript })
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
      let font = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
      let name = CTFontCopyPostScriptName(font) as String
      try require(
        request.allowFallback || known.contains(name) || variableInstances[name] != nil, "Unpackaged fallback font: " + name)
    }
  }
  func vectorIdentity(font: CTFont, glyph: CGGlyph, request: Request) -> String {
    let name = CTFontCopyPostScriptName(font) as String
    let identity: String
    if let instance = variableInstances[name],
      let resource = request.resources.first(where: { $0.id == instance.resourceID }) {
      identity = resource.digest + ":axes:" + instance.coordinates
    } else if let resource = request.resources.first(where: { $0.postscript == name }) {
      identity = resource.digest
    } else {
      // System fallbacks are explicit diagnostics, never misidentified as packaged faces.
      var bytes = Data(name.utf8)
      for tag: CTFontTableTag in [0x6865_6164, 0x676C_7966, 0x4346_4620, 0x636D_6170] {
        if let table = CTFontCopyTable(font, tag, []) as Data? { bytes.append(table) }
      }
      identity = "system-" + digest(bytes)
    }
    let matrix = CTFontGetMatrix(font)
    let transform =
      request.protocol >= 4 && !matrix.isIdentity
      ? ":matrix:"
        + [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
        .map { String(Double($0).bitPattern) }.joined(separator: ":") : ""
    return "g-"
      + digest(
        Data(
          (identity + ":" + name + ":" + String(Double(CTFontGetSize(font)).bitPattern) + ":"
            + String(glyph) + transform).utf8))
  }
  func vectorPath(font: CTFont, glyph: CGGlyph, id: String) throws -> String? {
    if let value = vectorCache[id] { return value }
    guard let path = CTFontCreatePathForGlyph(font, glyph, nil), !path.isEmpty else { return nil }
    var parts: [String] = []
    var valid = true
    func point(_ p: CGPoint) -> String {
      if !p.x.isFinite || !p.y.isFinite || abs(p.x) > 1_000_000 || abs(p.y) > 1_000_000 {
        valid = false
      }
      return String(Double(p.x)) + " " + String(Double(p.y))
    }
    path.applyWithBlock { raw in
      let item = raw.pointee
      switch item.type {
      case .moveToPoint: parts.append("M" + point(item.points[0]))
      case .addLineToPoint: parts.append("L" + point(item.points[0]))
      case .addQuadCurveToPoint:
        parts.append("Q" + point(item.points[0]) + " " + point(item.points[1]))
      case .addCurveToPoint:
        parts.append(
          "C" + point(item.points[0]) + " " + point(item.points[1]) + " " + point(item.points[2]))
      case .closeSubpath: parts.append("Z")
      @unknown default: valid = false
      }
    }
    let value = parts.joined(separator: " ")
    try require(valid && value.utf8.count <= 1_000_000, "Glyph outline exceeds bounds")
    while vectorOrder.count >= 2048 || vectorBytes + value.utf8.count > 8_000_000 {
      guard let first = vectorOrder.first else { break }
      vectorOrder.removeFirst()
      vectorBytes -= vectorCache.removeValue(forKey: first)?.utf8.count ?? 0
    }
    vectorCache[id] = value
    vectorOrder.append(id)
    vectorBytes += value.utf8.count
    return value
  }

  /// The input/output JSON protocol is shared by desktop and future Apple clients.
  public func execute(_ input: Data) throws -> Data {
    lock.lock()
    defer { lock.unlock() }
    try require(input.count <= 30_000_000, "Composition request exceeds bounds")
    let request = try JSONDecoder().decode(Request.self, from: input)
    variableInstances.removeAll(keepingCapacity: true)
    let fonts = try validate(request)
    var canonical = try JSONSerialization.jsonObject(with: input) as! [String: Any]
    canonical["resources"] = request.resources.map {
      ["id": $0.id, "digest": $0.digest, "postscript": $0.postscript]
    }
    let token =
      "ct1-" + digest(try JSONSerialization.data(withJSONObject: canonical, options: [.sortedKeys]))
    if let snapshot = snapshots[token] {
      let inputDigest = digest(input)
      if inputDigest == snapshot.requestDigest { return snapshot.responseData }
      // Only the envelope digest changes when registered font bytes are elided. Keep
      // immutable geometry serialized instead of rebuilding thousands of JSON rows.
      var output = snapshot.responseData
      let marker = Data("\"requestDigest\":\"".utf8)
      guard let range = output.range(of: marker), range.upperBound + 64 <= output.endIndex else {
        throw fail("Invalid retained result")
      }
      output.replaceSubrange(
        range.upperBound..<(range.upperBound + 64), with: Data(inputDigest.utf8))
      return output
    }
    var result: [String: Any] = [
      "protocol": request.protocol, "mode": request.mode, "requestDigest": digest(input),
      "sourceDigest": request.sourceDigest,
      "os": ProcessInfo.processInfo.operatingSystemVersionString, "backend": "CoreText-system",
      "resources": request.resources.map {
        ["id": $0.id, "digest": $0.digest, "postscript": $0.postscript]
      },
    ]
    var retained: [FrozenLine] = []
    if request.mode == "measure-lines-proof" {
      result["measurements"] = try measureCandidates(request, fonts: fonts)
    } else {
      let (lines, rows, diagnostics, vectors) = try compose(request, fonts: fonts)
      retained = lines
      result["token"] = token
      result["layout"] = [
        "lines": rows, "coveredLength": lines.last?.end ?? 0,
        "textLength": request.text.utf16.count,
      ]
      result["diagnostics"] = diagnostics
      if request.includeVectors == true { result["vectors"] = vectors }
    }
    result["spans"] = canonical["spans"]
    let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    try require(output.count <= 32_000_000, "Composition result exceeds bounds")
    if request.mode != "measure-lines-proof" {
      let cost =
        output.count * 2 + request.text.utf8.count * 8
        + request.resources.reduce(0) { $0 + (fontCache[$1.digest]?.bytes ?? 0) }
      while snapshotOrder.count >= 16 || snapshotBytes + cost > 64_000_000 {
        guard let first = snapshotOrder.first else { break }
        snapshotOrder.removeFirst()
        snapshotBytes -= snapshots.removeValue(forKey: first)?.cost ?? 0
      }
      try require(cost <= 64_000_000, "Composition snapshot exceeds bounds")
      snapshots[token] = Snapshot(
        text: request.text as NSString, frames: request.frames, lines: retained, responseData: output, requestDigest: digest(input),
        cost: cost)
      snapshotOrder.append(token)
      snapshotBytes += cost
    }
    return output
  }

  private func drawLetterSpacedRun(
    _ run: CTRun, text: NSString, offsets: LetterOffsets, context: CGContext
  ) {
    let count = CTRunGetGlyphCount(run)
    let attrs = CTRunGetAttributes(run) as NSDictionary
    let font = attrs[kCTFontAttributeName] as! CTFont
    var indices = [CFIndex](repeating: 0, count: count)
    var glyphs = [CGGlyph](repeating: 0, count: count)
    var positions = [CGPoint](repeating: .zero, count: count)
    CTRunGetStringIndices(run, CFRange(), &indices)
    CTRunGetGlyphs(run, CFRange(), &glyphs)
    CTRunGetPositions(run, CFRange(), &positions)
    let matrix = CTRunGetTextMatrix(run)
    for i in 0..<count {
      positions[i] = positions[i].applying(matrix)
      positions[i].x += offsets.through(indices[i])
    }
    if let fill = attrs[kCTForegroundColorAttributeName] {
      context.setFillColor(fill as! CGColor)
    }
    let range = CTRunGetStringRange(run)
    var batch = 0
    func draw(_ start: Int, _ end: Int) {
      guard start < end else { return }
      glyphs.withUnsafeBufferPointer { ids in
        positions.withUnsafeBufferPointer { points in
          CTFontDrawGlyphs(
            font, ids.baseAddress! + start, points.baseAddress! + start, end - start, context)
        }
      }
    }
    for i in 0..<count {
      let start = indices[i]
      let end = i + 1 < count ? indices[i + 1] : range.location + range.length
      guard end > start else { continue }
      var character = text.character(at: start), nominal = CGGlyph()
      let direct =
        end - start == 1 && CTFontGetGlyphsForCharacters(font, &character, &nominal, 1)
        && nominal == glyphs[i]
      if !direct {
        draw(batch, i)
        let source = text.substring(with: NSRange(location: start, length: end - start))
        // Core Graphics can encode "ffi" as a single compatibility
        // scalar. Drawing a matching one-glyph source line lets Core
        // Text supply the original ActualText for the publication map.
        let cluster = CTLineCreateWithAttributedString(
          NSAttributedString(
            string: source,
            attributes: CTRunGetAttributes(run) as! [NSAttributedString.Key: Any]))
        if let part = (CTLineGetGlyphRuns(cluster) as! [CTRun]).first,
          CTLineGetGlyphCount(cluster) == 1
        {
          var id = CGGlyph(), point = CGPoint.zero
          CTRunGetGlyphs(part, CFRange(location: 0, length: 1), &id)
          CTRunGetPositions(part, CFRange(location: 0, length: 1), &point)
          if id == glyphs[i] {
            point = point.applying(CTRunGetTextMatrix(part))
            context.textPosition = CGPoint(x: positions[i].x - point.x, y: positions[i].y - point.y)
            CTLineDraw(cluster, context)
            context.textPosition = .zero
          } else {
            draw(i, i + 1)
          }
        } else {
          draw(i, i + 1)
        }
        batch = i + 1
      }
    }
    draw(batch, count)
  }

  /// Export the very same immutable lines used for displayed geometry. No paths or margins.
  public func pdf(token: String, invisible: Bool = false) throws -> Data {
    try pdf(token: token, invisible: invisible, margin: 0)
  }
  // The standalone historical proof keeps its 20pt inspection gutter, outside the worker API.
  func pdf(token: String, invisible: Bool, margin: Double) throws -> Data {
    lock.lock()
    defer { lock.unlock() }
    guard let snapshot = snapshots[token] else {
      throw fail("Composition token expired; compose the source again")
    }
    let data = NSMutableData()
    guard let consumer = CGDataConsumer(data: data as CFMutableData) else {
      throw fail("PDF cannot be opened")
    }
    var initial = CGRect(
      x: 0, y: 0, width: snapshot.frames[0].width + margin * 2,
      height: snapshot.frames[0].height + margin * 2)
    guard let context = CGContext(consumer: consumer, mediaBox: &initial, nil) else {
      throw fail("PDF cannot be opened")
    }
    for (page, frame) in snapshot.frames.enumerated() {
      var box = CGRect(
        x: 0, y: 0, width: frame.width + margin * 2, height: frame.height + margin * 2)
      let boxData = Data(bytes: &box, count: MemoryLayout<CGRect>.size)
      context.beginPDFPage([kCGPDFContextMediaBox: boxData] as CFDictionary)
      context.textMatrix = .identity
      context.setTextDrawingMode(invisible ? .invisible : .fill)
      for line in snapshot.lines where line.page == page {
        context.saveGState()
        context.translateBy(x: margin + line.originX, y: box.height - margin - line.baseline)
        context.scaleBy(x: line.scaleX, y: 1)
        context.textPosition = .zero
        if line.letterOffsets.ends.isEmpty {
          CTLineDraw(line.line, context)
        } else {
          for run in CTLineGetGlyphRuns(line.line) as! [CTRun] {
            drawLetterSpacedRun(
              run, text: snapshot.text, offsets: line.letterOffsets, context: context)
          }
        }
        context.restoreGState()
        if !invisible, let hyphen = line.hyphen,
          let path = CTFontCreatePathForGlyph(hyphen.font, hyphen.glyph, nil)
        {
          context.saveGState()
          context.translateBy(
            x: margin + line.originX + line.bodyWidth + hyphen.offset.x * line.scaleX,
            y: box.height - margin - line.baseline + hyphen.offset.y)
          context.scaleBy(x: line.scaleX, y: 1)
          context.setFillColor(hyphen.color)
          context.addPath(path)
          context.fillPath()
          context.restoreGState()
        }
      }
      context.endPDFPage()
      try require(data.length <= 24_000_000, "Native PDF exceeds bounds")
    }
    context.closePDF()
    try require(data.length <= 24_000_000, "Native PDF exceeds bounds")
    return data as Data
  }
}
