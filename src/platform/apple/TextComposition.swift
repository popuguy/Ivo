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
  }
  struct FrozenLine {
    let page: Int
    let start: Int
    let end: Int
    var baseline: Double
    let ascent: Double
    let descent: Double
    let line: CTLine
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
      request.protocol == 1
        && ["greedy-geometry-proof", "measure-lines-proof", "explicit-lines-proof"].contains(
          request.mode),
      "Unsupported composition protocol or policy")
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
            font: font, postscript: resource.postscript, bytes: bytes.count, flags: flags)
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
    }
    try require(!request.runs.isEmpty && request.runs.count <= 10_000, "Invalid runs")
    var position = 0
    for run in request.runs {
      try require(
        run.start == position && run.end > run.start && run.end <= length,
        "Runs do not cover the native source")
      try require(
        fonts[run.font] != nil && finite(run.size, 1, 2000) && finite(run.tracking, -1000, 10000),
        "Unavailable font or invalid run metrics")
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
            candidate.start >= 0 && candidate.end > candidate.start && candidate.end <= length
              && boundaries.contains(candidate.start) && boundaries.contains(candidate.end),
            "Invalid line alternative or grapheme boundary")
          let value = string.substring(
            with: NSRange(location: candidate.start, length: candidate.end - candidate.start))
          try require(
            !value.dropLast().contains(where: { $0 == "\n" || $0 == "\u{2028}" || $0 == "\u{2029}" }
            ), "Line alternative crosses a forced break")
        }
      } else {
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
          CTParagraphStyleSetting(spec: .defaultTabInterval, valueSize: MemoryLayout<CGFloat>.size,
            value: intervalPointer),
          CTParagraphStyleSetting(spec: .tabStops, valueSize: MemoryLayout<CFArray>.size,
            value: stopsPointer),
        ]
        return CTParagraphStyleCreate(&settings, settings.count)
      }
    }
    attributed.addAttribute(NSAttributedString.Key(kCTParagraphStyleAttributeName as String),
      value: paragraph, range: NSRange(location: 0, length: attributed.length))
    for run in request.runs {
      let font = CTFontCreateWithGraphicsFont(fonts[run.font]!, run.size, nil, nil)
      attributed.addAttributes(
        [
          NSAttributedString.Key(kCTFontAttributeName as String): font,
          NSAttributedString.Key(kCTLigatureAttributeName as String): run.ligatures ? 1 : 0,
          NSAttributedString.Key(kCTTrackingAttributeName as String): run.tracking * run.size
            / 1000,
          NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(
            run.textColor ?? "#252525"),
        ], range: NSRange(location: run.start, length: run.end - run.start))
      if run.kerning == "none" {
        attributed.addAttribute(
          NSAttributedString.Key(kCTKernAttributeName as String), value: 0,
          range: NSRange(location: run.start, length: run.end - run.start))
      }
    }
    return attributed
  }
  func measureCandidates(_ request: Request, fonts: [String: CGFont]) throws -> [[String: Any]] {
    let typesetter = CTTypesetterCreateWithAttributedString(attributedSource(request, fonts: fonts))
    let string = request.text as NSString
    return try request.candidates!.map { candidate in
      var end = candidate.end
      while end > candidate.start
        && [10, 13, 0x2028, 0x2029].contains(Int(string.character(at: end - 1)))
      { end -= 1 }
      let line =
        end > candidate.start
        ? CTTypesetterCreateLine(
          typesetter, CFRange(location: candidate.start, length: end - candidate.start))
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
      let advance =
        sourceRuns.map {
          ($0.leading ?? 0) > 0 ? $0.leading! : $0.size * ($0.autoLeading ?? 120) / 100
        }.max() ?? 14.4
      return [
        "start": candidate.start, "end": candidate.end, "width": width,
        "ascent": Double(ascent), "descent": Double(descent), "leading": Double(leading),
        "advance": advance,
        "capHeight": actualFonts.map { Double(CTFontGetCapHeight($0)) }.max() ?? 0,
        "xHeight": actualFonts.map { Double(CTFontGetXHeight($0)) }.max() ?? 0,
      ]
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
    for (page, frame) in request.frames.enumerated() {
      var previousBaseline: Double? = nil
      let frameStart = frozen.count
      while position < textLength {
        try require(output.count < 4096, "Composed line budget exceeded")
        var count =
          request.mode == "explicit-lines-proof"
          ? request.breaks!.first(where: { $0 > position })! - position
          : CTTypesetterSuggestLineBreak(typesetter, position, frame.width)
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
        let line =
          contentEnd > position
          ? CTTypesetterCreateLine(
            typesetter, CFRange(location: position, length: contentEnd - position))
          : CTLineCreateWithAttributedString(NSAttributedString(string: ""))
        var ascent = CGFloat.zero
        var descent = CGFloat.zero
        var leading = CGFloat.zero
        let width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
        let visibleWidth = max(0, width - CTLineGetTrailingWhitespaceWidth(line))
        if contentEnd == position,
          let blank = request.runs.first(where: { $0.start <= position && $0.end > position })
        {
          let font = CTFontCreateWithGraphicsFont(fonts[blank.font]!, blank.size, nil, nil)
          ascent = CTFontGetAscent(font)
          descent = CTFontGetDescent(font)
          leading = CTFontGetLeading(font)
        }
        let sourceRuns = request.runs.filter { $0.start < end && $0.end > position }
        let advance =
          sourceRuns.map {
            ($0.leading ?? 0) > 0 ? $0.leading! : $0.size * ($0.autoLeading ?? 120) / 100
          }.max() ?? 14.4
        let baseline: Double
        if let previous = previousBaseline {
          baseline = previous + advance
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
                Double(
                  frame.firstBaseline == "cap-height"
                    ? CTFontGetCapHeight($0) : CTFontGetXHeight($0))
              }.max() ?? Double(ascent)
          default: metric = Double(ascent)
          }
          baseline = max(frame.minimumFirstBaseline ?? 0, metric)
        }
        if baseline + Double(descent) > frame.height { break }
        if request.mode == "explicit-lines-proof" {
          try require(visibleWidth <= frame.width + 0.000001, "Explicit line exceeds frame width")
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
          let edges = Array(Set(indices + [source.location + source.length])).sorted()
          let rows: [[String: Any]] = try (0..<n).map { i in
            let a = indices[i]
            let b = edges.first(where: { $0 > a }) ?? source.location + source.length
            var row: [String: Any] = [
              "glyph": Int(glyphs[i]), "index": a, "end": b,
              "position": [Double(positions[i].x), Double(positions[i].y)],
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
          }
          runRows.append(row)
        }
        let lineBoundaries = boundaries.filter { $0 >= position && $0 <= end }
        caretBudget += lineBoundaries.count
        try require(caretBudget <= 110_000, "Caret budget exceeded")
        let carets: [[String: Any]] = lineBoundaries.map { index in
          var secondary = CGFloat.zero
          let primary =
            contentEnd == position
            ? CGFloat.zero : CTLineGetOffsetForStringIndex(line, min(index, contentEnd), &secondary)
          return [
            "index": index, "primary": Double(primary), "secondary": Double(secondary),
            "logicalCandidates": logicalCandidates(index, request.spans),
            "measurement": contentEnd == position ? "empty-paragraph-origin" : "native-line",
            "hitIndex": contentEnd == position
              ? position : CTLineGetStringIndexForPosition(line, CGPoint(x: primary, y: 0)),
          ]
        }
        frozen.append(
          FrozenLine(
            page: page, start: position, end: end, baseline: baseline, ascent: Double(ascent),
            descent: Double(descent), line: line))
        output.append([
          "frame": frame.id, "page": page, "start": position, "end": end, "contentEnd": contentEnd,
          "baseline": baseline, "ascent": Double(ascent), "descent": Double(descent),
          "leading": Double(leading), "width": width, "visibleWidth": visibleWidth,
          "advance": advance,
          "sourceRanges": logicalRanges(position, end, request.spans), "runs": runRows,
          "carets": carets,
        ])
        position = end
        previousBaseline = baseline
      }
      if let last = frozen.last, frozen.count > frameStart {
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
    return "g-"
      + digest(
        Data(
          (identity + ":" + name + ":" + String(Double(CTFontGetSize(font)).bitPattern) + ":"
            + String(glyph)).utf8))
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
      "protocol": 1, "mode": request.mode, "requestDigest": digest(input),
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
        context.textPosition = CGPoint(x: margin, y: box.height - margin - line.baseline)
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
