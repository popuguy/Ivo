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
  }
  private struct Snapshot {
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
    let ligatures: Bool
    let tracking: Double
    let kerning: String?
    let textColor: String?
    let leading: Double?
    let autoLeading: Double?
    let baselineShift: Double?
    let horizontalScale: Double?
    let verticalScale: Double?
    let features: [String: Bool]?
    enum CodingKeys: String, CodingKey {
      case start, end, font, size, ligatures, tracking, kerning, textColor, leading, autoLeading
      case baselineShift, horizontalScale, verticalScale, features
    }
    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      start = try values.decode(Int.self, forKey: .start)
      end = try values.decode(Int.self, forKey: .end)
      font = try values.decode(String.self, forKey: .font)
      size = try values.decode(Double.self, forKey: .size)
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
    let candidates: [Candidate]?
    let breaks: [Int]?
    let includeVectors: Bool?
    let paragraphs: [Paragraph]?
    let placements: [Placement]?
  }
  struct FrozenLine {
    let page: Int
    let start: Int
    let end: Int
    var baseline: Double
    let ascent: Double
    let descent: Double
    let line: CTLine
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
      [1, 2, 3, 4, 5].contains(request.protocol)
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
      request.protocol != 5
        || ["measure-lines-proof", "planned-lines-proof"].contains(request.mode),
      "Composition protocol 5 requires measured or planned lines")
    try require(
      request.placements == nil || (request.protocol >= 3 && request.mode == "planned-lines-proof"),
      "Placements require the planned-lines policy")
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
        frame.verticalAlign == nil || ["top", "center", "bottom"].contains(frame.verticalAlign!),
        "Unsupported vertical alignment")
    }
    try require(!request.spans.isEmpty && request.spans.count <= 30_000, "Invalid source map")
    var logical = 0
    var native = 0
    let string = request.text as NSString
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
          try require(request.protocol == 5, "Word spacing requires composition protocol 5")
          try require(
            finite(spacing.minimum, 0, 1000) && finite(spacing.desired, spacing.minimum, 1000)
              && finite(spacing.maximum, spacing.desired, 1000), "Invalid word-spacing preferences")
          try require(
            value.unicodeScalars.allSatisfy {
              !CharacterSet.whitespacesAndNewlines.contains($0)
                || [0x20, 10, 13, 0x2028, 0x2029].contains($0.value)
            },
            "Explicit word spacing requires qualified ordinary spaces without tabs or fixed spaces")
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
            features: declaredFeatures(ct))
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
    }
    try require(!request.runs.isEmpty && request.runs.count <= 10_000, "Invalid runs")
    var position = 0
    for run in request.runs {
      try require(
        request.protocol >= 4
          || (run.baselineShift == nil && run.horizontalScale == nil && run.verticalScale == nil
            && run.features == nil),
        "Character transforms and OpenType settings require composition protocol 4")
      try require(
        (run.baselineShift == nil || finite(run.baselineShift!, -2000, 2000))
          && (run.horizontalScale == nil || finite(run.horizontalScale!, 10, 1000))
          && (run.verticalScale == nil || finite(run.verticalScale!, 10, 1000)),
        "Invalid character transform")
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
          !placements.isEmpty && placements.count <= 2048 && placements.last?.end == length,
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
  func characterFont(_ run: TextRun, fonts: [String: CGFont]) -> CTFont {
    var transform = CGAffineTransform(
      scaleX: (run.horizontalScale ?? 100) / 100,
      y: (run.verticalScale ?? 100) / 100)
    var font =
      transform.isIdentity
      ? CTFontCreateWithGraphicsFont(fonts[run.font]!, run.size, nil, nil)
      : CTFontCreateWithGraphicsFont(fonts[run.font]!, run.size, &transform, nil)
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
      let descriptor = CTFontDescriptorCreateWithAttributes(
        [kCTFontFeatureSettingsAttribute: settings] as CFDictionary)
      font = CTFontCreateCopyWithAttributes(font, run.size, nil, descriptor)
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
  func attributedSource(_ request: Request, fonts: [String: CGFont]) -> NSMutableAttributedString {
    // Equal-length engine normalization: paragraph identity remains in the source map.
    let attributed = NSMutableAttributedString(
      string: request.text.replacingOccurrences(of: "\u{2029}", with: "\n"))
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
    return attributed
  }
  struct WordSpaceShape {
    let start: Int
    let contentEnd: Int
    let trailingStart: Int
    let spaces: [Int]
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
  func wordSpaceShape(_ source: NSAttributedString, start: Int, contentEnd: Int) throws
    -> WordSpaceShape
  {
    let text = source.string as NSString
    var trailingStart = contentEnd
    while trailingStart > start && text.character(at: trailingStart - 1) == 32 {
      trailingStart -= 1
    }
    let spaces = (start..<trailingStart).filter { text.character(at: $0) == 32 }
    var nominal = 0.0
    for index in spaces {
      let font =
        source.attribute(
          NSAttributedString.Key(kCTFontAttributeName as String), at: index,
          effectiveRange: nil) as! CTFont
      nominal += try fontSpaceAdvance(font)
    }
    return WordSpaceShape(
      start: start, contentEnd: contentEnd, trailingStart: trailingStart,
      spaces: spaces, nominalSpaceWidth: nominal)
  }
  func wordSpaceCapacities(_ shape: WordSpaceShape, naturalWidth: Double, policy: WordSpacing)
    -> [String: Any]
  {
    // The exact native font's transformed U+0020 advances are the affine slope;
    // tracking stays additive and trailing spaces do not contribute visible width.
    func width(_ percent: Double) -> Double {
      max(0, naturalWidth + shape.nominalSpaceWidth * (percent / 100 - 1))
    }
    return [
      "minimumWidth": width(policy.minimum), "desiredWidth": width(policy.desired),
      "maximumWidth": width(policy.maximum), "eligibleGaps": shape.spaces.count,
      "nominalSpaceWidth": shape.nominalSpaceWidth,
    ]
  }
  func wordSpacedLine(
    _ source: NSAttributedString, shape: WordSpaceShape, percent: Double,
    collapseTrailing: Bool, offset: Double
  ) throws -> CTLine {
    if shape.contentEnd == shape.start {
      return CTLineCreateWithAttributedString(NSAttributedString(string: ""))
    }
    let attributed = NSMutableAttributedString(attributedString: source)
    for index in shape.spaces + Array(shape.trailingStart..<shape.contentEnd) {
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
      let adjusted =
        collapseTrailing && index >= shape.trailingStart
        ? -nominal : tracking + nominal * (percent / 100 - 1)
      attributed.addAttribute(key, value: adjusted, range: NSRange(location: index, length: 1))
    }
    return CTTypesetterCreateLineWithOffset(
      CTTypesetterCreateWithAttributedString(attributed),
      CFRange(location: shape.start, length: shape.contentEnd - shape.start), offset)
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
    let sourceSpaces = Set(shape.spaces + Array(shape.trailingStart..<shape.contentEnd))
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
  func measureCandidates(_ request: Request, fonts: [String: CGFont]) throws -> [[String: Any]] {
    let attributed = attributedSource(request, fonts: fonts)
    let typesetter = CTTypesetterCreateWithAttributedString(attributed)
    let string = request.text as NSString
    return try request.candidates!.map { candidate in
      var end = candidate.end
      while end > candidate.start
        && [10, 13, 0x2028, 0x2029].contains(Int(string.character(at: end - 1)))
      { end -= 1 }
      let line =
        end > candidate.start
        ? CTTypesetterCreateLineWithOffset(
          typesetter, CFRange(location: candidate.start, length: end - candidate.start),
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
      var row: [String: Any] = [
        "start": candidate.start, "end": candidate.end, "width": width,
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
        let shape = try wordSpaceShape(attributed, start: candidate.start, contentEnd: end)
        row["wordSpacing"] = wordSpaceCapacities(shape, naturalWidth: width, policy: policy)
      }
      return row
    }
  }
  func compose(_ request: Request, fonts: [String: CGFont]) throws -> (
    [FrozenLine], [[String: Any]], [String], [[String: String]]
  ) {
    let attributed = attributedSource(request, fonts: fonts)
    let typesetter = CTTypesetterCreateWithAttributedString(attributed)
    let textLength = attributed.length
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
    for (page, frame) in request.frames.enumerated() {
      var previousBaseline: Double? = nil
      let frameStart = frozen.count
      while position < textLength {
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
        let end = min(textLength, position + count)
        var contentEnd = end
        let nativeString = attributed.string as NSString
        while contentEnd > position
          && [10, 13, 0x2028].contains(Int(nativeString.character(at: contentEnd - 1)))
        { contentEnd -= 1 }
        var line =
          contentEnd > position
          ? CTTypesetterCreateLineWithOffset(
            typesetter, CFRange(location: position, length: contentEnd - position), indent)
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
        var wordSpacingRow: [String: Any]?
        var collapsedShape: WordSpaceShape?
        var collapsedEdge: Double?
        var originalWordSpaceLine: CTLine?
        var wordSpaceChanges: [WordSpaceChange] = []
        if let policy = paragraph?.wordSpacing {
          let original = line
          try validateWordSpaceDirection(line)
          let shape = try wordSpaceShape(attributed, start: position, contentEnd: contentEnd)
          let nominal = shape.nominalSpaceWidth
          let desired = max(0, visibleWidth + nominal * (policy.desired / 100 - 1))
          let minimum = max(0, visibleWidth + nominal * (policy.minimum / 100 - 1))
          let condensesLast =
            alignment.hasPrefix("justify") && paragraphLastLine
            && alignment != "justify-all" && desired > availableWidth
          let adjustsToArea = justified || condensesLast
          let target = adjustsToArea ? availableWidth : desired
          if condensesLast {
            try require(
              minimum <= availableWidth + 0.000001,
              "Final justified line exceeds its minimum word-space preference")
          }
          if nominal > 0 && adjustsToArea {
            try require(
              visibleWidth - nominal <= availableWidth + 0.000001,
              "Justified line exceeds its zero-word-space physical floor")
          }
          let percentage =
            nominal > 0
            ? policy.desired + (target - desired) / nominal * 100 : policy.desired
          try require(
            percentage.isFinite && percentage >= -0.000001,
            "Invalid solved native word spacing")
          line = try wordSpacedLine(
            attributed, shape: shape, percent: max(0, percentage),
            collapseTrailing: adjustsToArea, offset: indent)
          var fallback = false
          if justified && nominal == 0 && visibleWidth > 0.000001 && visibleWidth < availableWidth,
            let expanded = CTLineCreateJustifiedLine(line, 1, availableWidth)
          {
            // Preserve the already-qualified native single-word letter-spreading
            // fallback. This does not implement authored letter-spacing limits.
            line = expanded
            fallback = true
          }
          width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
          visibleWidth = max(0, width - CTLineGetTrailingWhitespaceWidth(line))
          if nominal > 0 {
            try require(
              abs(visibleWidth - target) < 0.000001,
              "Native word spacing did not realize its measured target")
          }
          if adjustsToArea {
            collapsedEdge = try collapsedSpaceEdge(line, shape: shape)
            if collapsedEdge != nil { collapsedShape = shape }
          }
          if !fallback && (!shape.spaces.isEmpty || shape.trailingStart < shape.contentEnd) {
            originalWordSpaceLine = original
            wordSpaceChanges = try self.wordSpaceChanges(original, final: line, shape: shape)
          }
          wordSpacingRow = [
            "percentage": max(0, percentage), "eligibleGaps": shape.spaces.count,
            "nominalSpaceWidth": nominal, "justified": adjustsToArea,
            "offPreference": percentage < policy.minimum - 0.000001
              || percentage > policy.maximum + 0.000001,
            "fallback": fallback ? "single-word" : NSNull(),
          ]
          if let collapsed = collapsedShape {
            wordSpacingRow!["collapsedTrailingStart"] = collapsed.trailingStart
          }
        } else if justified && visibleWidth > 0 && visibleWidth < availableWidth,
          let expanded = CTLineCreateJustifiedLine(line, 1, availableWidth)
        {
          line = expanded
          width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
          visibleWidth = max(0, width - CTLineGetTrailingWhitespaceWidth(line))
        }
        let flush: CGFloat =
          alignment == "center" || (alignment == "justify-center" && paragraphLastLine)
          ? 0.5
          : alignment == "right" || alignment == "end"
            || (alignment == "justify-right" && paragraphLastLine) ? 1 : 0
        let originX = indent + CTLineGetPenOffsetForFlush(line, flush, availableWidth)
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
            baseline + Double(descent) <= frame.height + 0.000001,
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
        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
          let attrs = CTRunGetAttributes(run) as NSDictionary
          let font = attrs[kCTFontAttributeName] as! CTFont
          let name = CTFontCopyPostScriptName(font) as String
          if !known.contains(name) {
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
          let rows: [[String: Any]] = try (0..<n).map { i in
            let a = indices[i]
            let b = edges.first(where: { $0 > a }) ?? source.location + source.length
            var row: [String: Any] = [
              "glyph": Int(glyphs[i]), "index": a, "end": b,
              "position": [Double(positions[i].x) + originX, Double(positions[i].y)],
              "advance": [Double(advances[i].width), Double(advances[i].height)],
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
        let carets: [[String: Any]] = lineBoundaries.map { index in
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
          return [
            "index": index, "primary": Double(primary) + originX,
            "secondary": Double(secondary) + originX,
            "logicalCandidates": logicalCandidates(index, request.spans),
            "measurement": collapsed
              ? "native-collapsed-space"
              : contentEnd == position
                ? "empty-paragraph-origin"
                : originalWordSpaceLine != nil ? "native-word-space" : "native-line",
            "hitIndex": contentEnd == position
              ? position : CTLineGetStringIndexForPosition(line, CGPoint(x: primary, y: 0)),
          ]
        }
        frozen.append(
          FrozenLine(
            page: page, start: position, end: end, baseline: baseline, ascent: Double(ascent),
            descent: Double(descent), line: line, originX: originX))
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
        let remaining = max(0, frame.height - last.baseline - last.descent)
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
        request.allowFallback || known.contains(name), "Unpackaged fallback font: " + name)
    }
  }
  func vectorIdentity(font: CTFont, glyph: CGGlyph, request: Request) -> String {
    let name = CTFontCopyPostScriptName(font) as String
    let identity: String
    if let resource = request.resources.first(where: { $0.postscript == name }) {
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
        frames: request.frames, lines: retained, responseData: output, requestDigest: digest(input),
        cost: cost)
      snapshotOrder.append(token)
      snapshotBytes += cost
    }
    return output
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
        context.textPosition = CGPoint(
          x: margin + line.originX, y: box.height - margin - line.baseline)
        CTLineDraw(line.line, context)
      }
      context.endPDFPage()
      try require(data.length <= 24_000_000, "Native PDF exceeds bounds")
    }
    context.closePDF()
    try require(data.length <= 24_000_000, "Native PDF exceeds bounds")
    return data as Data
  }
}
