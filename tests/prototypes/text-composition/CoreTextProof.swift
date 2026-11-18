import Foundation
import CoreText
import CoreGraphics
import CryptoKit

// A bounded headless experiment, not Ivo's production composer or a public IPC endpoint.
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
    let data: String
}
struct TextRun: Decodable {
    let start: Int
    let end: Int
    let font: String
    let size: Double
    let ligatures: Bool
    let tracking: Double
}
struct Frame: Decodable {
    let id: String
    let width: Double
    let height: Double
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
}
struct FrozenLine {
    let page: Int
    let start: Int
    let end: Int
    let baseline: Double
    let ascent: Double
    let descent: Double
    let line: CTLine
}
func fail(_ message: String) -> NSError {
    NSError(domain: "Ivo.CompositionProof", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
func finite(_ value: Double, _ minimum: Double, _ maximum: Double) -> Bool {
    value.isFinite && value >= minimum && value <= maximum
}
func require(_ value: Bool, _ message: String) throws { if !value { throw fail(message) } }

func validate(_ request: Request) throws -> [String: CGFont] {
    let length = request.text.utf16.count
    try require(request.protocol == 1 && request.mode == "greedy-geometry-proof", "Unsupported proof protocol or policy")
    try require(!request.id.isEmpty && request.id.utf8.count <= 120, "Invalid source identity")
    try require(length > 0 && length <= 100_000 && request.logicalLength >= 0 && request.logicalLength <= 200_000, "Source exceeds proof bounds")
    try require(request.sourceHTML.utf8.count <= 1_000_000 && digest(Data(request.sourceHTML.utf8)) == request.sourceDigest, "Source digest mismatch")
    try require(!request.frames.isEmpty && request.frames.count <= 16 && Set(request.frames.map { $0.id }).count == request.frames.count, "Invalid frame identities")
    for frame in request.frames {
        try require(!frame.id.isEmpty && frame.id.utf8.count <= 120 && finite(frame.width, 10, 4000) && finite(frame.height, 10, 4000), "Invalid frame geometry")
    }
    try require(!request.spans.isEmpty && request.spans.count <= 30_000, "Invalid source map")
    var logical = 0, native = 0
    let string = request.text as NSString
    for span in request.spans {
        try require(span.logicalStart == logical && span.start == native && span.logicalEnd >= logical && span.end >= native && span.end <= length, "Discontinuous source map")
        let sourceLength = span.logicalEnd - logical, textLength = span.end - native
        switch span.kind {
        case "text": try require(sourceLength == textLength, "Text map length mismatch")
        case "structure", "placeholder": try require(sourceLength == 1 && textLength == 0, "Invalid virtual mark")
        case "soft-break": try require(sourceLength == 1 && textLength == 1 && string.substring(with: NSRange(location: native, length: 1)) == "\u{2028}", "Invalid soft break")
        case "paragraph": try require((sourceLength == 0 || sourceLength == 1) && textLength == 1 && string.substring(with: NSRange(location: native, length: 1)) == "\u{2029}", "Invalid paragraph mark")
        default: throw fail("Unsupported source-map atom")
        }
        logical = span.logicalEnd; native = span.end
    }
    try require(logical == request.logicalLength && native == length, "Source map does not cover both coordinate systems")
    try require(!request.resources.isEmpty && request.resources.count <= 16, "Missing font resources")
    var fonts: [String: CGFont] = [:], totalBytes = 0
    for resource in request.resources {
        try require(!resource.id.isEmpty && resource.id.utf8.count <= 120 && fonts[resource.id] == nil, "Invalid font identity")
        guard let bytes = Data(base64Encoded: resource.data), bytes.count <= 10_000_000, bytes.count >= 12 else { throw fail("Invalid font bytes") }
        totalBytes += bytes.count
        try require(totalBytes <= 20_000_000 && digest(bytes) == resource.digest, "Font resource digest mismatch or budget exceeded")
        guard let provider = CGDataProvider(data: bytes as CFData), let font = CGFont(provider) else { throw fail("Font cannot be decoded") }
        try require(font.postScriptName as String? == resource.postscript, "Font face identity mismatch")
        let ct = CTFontCreateWithGraphicsFont(font, 12, nil, nil)
        if let table = CTFontCopyTable(ct, 0x4F532F32, []) as Data?, table.count >= 10 {
            let flags = Int(table[8]) * 256 + Int(table[9])
            try require(flags & 0x0302 == 0, "Font does not permit this subset-PDF proof")
        }
        fonts[resource.id] = font
    }
    try require(!request.runs.isEmpty && request.runs.count <= 10_000, "Invalid runs")
    var position = 0
    for run in request.runs {
        try require(run.start == position && run.end > run.start && run.end <= length, "Runs do not cover the native source")
        try require(fonts[run.font] != nil && finite(run.size, 1, 2000) && finite(run.tracking, -1000, 10000), "Unavailable font or invalid run metrics")
        for boundary in [run.start, run.end] where boundary > 0 && boundary < length {
            let before = string.character(at: boundary - 1), after = string.character(at: boundary)
            try require(!(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF), "Run splits a surrogate pair")
        }
        position = run.end
    }
    try require(position == length, "Runs lost source text")
    return fonts
}

// A native position can alias multiple virtual source boundaries. Preserve the interval instead of guessing.
func logicalCandidates(_ index: Int, _ spans: [SourceSpan]) -> [Int] {
    var values: [Int] = []
    for span in spans where index >= span.start && index <= span.end {
        if span.kind == "text" { values.append(span.logicalStart + index - span.start) }
        else { values += [span.logicalStart, span.logicalEnd] }
    }
    return [values.min() ?? 0, values.max() ?? 0]
}
func logicalRanges(_ start: Int, _ end: Int, _ spans: [SourceSpan]) -> [[Int]] {
    spans.compactMap { span in
        let a = max(start, span.start), b = min(end, span.end)
        guard b > a else { return nil }
        if span.kind == "text" { return [span.logicalStart + a - span.start, span.logicalStart + b - span.start] }
        return [span.logicalStart, span.logicalEnd]
    }
}

func compose(_ request: Request, fonts: [String: CGFont]) throws -> ([FrozenLine], [[String: Any]], [String]) {
    // Equal-length engine normalization: paragraph identity remains in the source map.
    let attributed = NSMutableAttributedString(string: request.text.replacingOccurrences(of: "\u{2029}", with: "\n"))
    for run in request.runs {
        let font = CTFontCreateWithGraphicsFont(fonts[run.font]!, run.size, nil, nil)
        attributed.addAttributes([
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTLigatureAttributeName as String): run.ligatures ? 1 : 0,
            NSAttributedString.Key(kCTKernAttributeName as String): run.tracking * run.size / 1000,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 37.0 / 255, alpha: 1)
        ], range: NSRange(location: run.start, length: run.end - run.start))
    }
    let typesetter = CTTypesetterCreateWithAttributedString(attributed)
    let textLength = attributed.length
    var boundaries = [0], cursor = request.text.startIndex
    while cursor < request.text.endIndex {
        cursor = request.text.index(after: cursor)
        boundaries.append(cursor.utf16Offset(in: request.text))
    }
    var position = 0, frozen: [FrozenLine] = [], output: [[String: Any]] = [], diagnostics = Set<String>()
    let known = Set(request.resources.map { $0.postscript })
    for (page, frame) in request.frames.enumerated() {
        var top = 0.0
        while position < textLength {
            var count = CTTypesetterSuggestLineBreak(typesetter, position, frame.width)
            if count <= 0 {
                count = (boundaries.first(where: { $0 > position }) ?? textLength) - position
                diagnostics.insert("unbreakable-cluster-overflow")
            }
            let end = min(textLength, position + count)
            var contentEnd = end
            let nativeString = attributed.string as NSString
            while contentEnd > position && [10, 13, 0x2028].contains(Int(nativeString.character(at: contentEnd - 1))) { contentEnd -= 1 }
            let line = contentEnd > position
                ? CTTypesetterCreateLine(typesetter, CFRange(location: position, length: contentEnd - position))
                : CTLineCreateWithAttributedString(NSAttributedString(string: ""))
            var ascent = CGFloat.zero, descent = CGFloat.zero, leading = CGFloat.zero
            let width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
            if contentEnd == position, let blank = request.runs.first(where: { $0.start <= position && $0.end > position }) {
                let font = CTFontCreateWithGraphicsFont(fonts[blank.font]!, blank.size, nil, nil)
                ascent = CTFontGetAscent(font); descent = CTFontGetDescent(font); leading = CTFontGetLeading(font)
            }
            let size = request.runs.filter { $0.start < end && $0.end > position }.map { $0.size }.max() ?? 12
            let advance = max(Double(ascent + descent + leading), size * 1.2)
            if top + Double(ascent + descent) > frame.height { break }
            let baseline = top + Double(ascent)
            var runRows: [[String: Any]] = []
            for run in CTLineGetGlyphRuns(line) as! [CTRun] {
                let attrs = CTRunGetAttributes(run) as NSDictionary
                let font = attrs[kCTFontAttributeName] as! CTFont
                let name = CTFontCopyPostScriptName(font) as String
                if !known.contains(name) {
                    try require(request.allowFallback, "Unpackaged fallback font: " + name)
                    diagnostics.insert("unpackaged-fallback:" + name)
                }
                let n = CTRunGetGlyphCount(run), source = CTRunGetStringRange(run)
                var glyphs = [CGGlyph](repeating: 0, count: n), positions = [CGPoint](repeating: .zero, count: n)
                var advances = [CGSize](repeating: .zero, count: n), indices = [CFIndex](repeating: 0, count: n)
                CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
                CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
                CTRunGetAdvances(run, CFRange(location: 0, length: 0), &advances)
                CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
                let edges = Array(Set(indices + [source.location + source.length])).sorted()
                let rows: [[String: Any]] = (0..<n).map { i in
                    let a = indices[i], b = edges.first(where: { $0 > a }) ?? source.location + source.length
                    return ["glyph": Int(glyphs[i]), "index": a, "end": b,
                            "position": [Double(positions[i].x), Double(positions[i].y)],
                            "advance": [Double(advances[i].width), Double(advances[i].height)],
                            "sourceRanges": logicalRanges(a, b, request.spans)]
                }
                runRows.append(["font": name, "size": Double(CTFontGetSize(font)), "rtl": CTRunGetStatus(run).contains(.rightToLeft), "start": source.location, "end": source.location + source.length, "glyphs": rows])
            }
            let carets: [[String: Any]] = boundaries.filter { $0 >= position && $0 <= end }.map { index in
                var secondary = CGFloat.zero
                let primary = contentEnd == position ? CGFloat.zero : CTLineGetOffsetForStringIndex(line, min(index, contentEnd), &secondary)
                return ["index": index, "primary": Double(primary), "secondary": Double(secondary),
                        "logicalCandidates": logicalCandidates(index, request.spans),
                        "measurement": contentEnd == position ? "empty-paragraph-origin" : "native-line",
                        "hitIndex": contentEnd == position ? position : CTLineGetStringIndexForPosition(line, CGPoint(x: primary, y: 0))]
            }
            frozen.append(FrozenLine(page: page, start: position, end: end, baseline: baseline, ascent: Double(ascent), descent: Double(descent), line: line))
            output.append(["frame": frame.id, "page": page, "start": position, "end": end, "contentEnd": contentEnd,
                           "baseline": baseline, "ascent": Double(ascent), "descent": Double(descent),
                           "leading": Double(leading), "width": width, "advance": advance,
                           "sourceRanges": logicalRanges(position, end, request.spans), "runs": runRows, "carets": carets])
            position = end; top += advance
        }
    }
    if position < textLength { diagnostics.insert("overset") }
    return (frozen, output, diagnostics.sorted())
}

func writePDF(_ request: Request, _ lines: [FrozenLine], _ path: String) throws {
    var initial = CGRect(x: 0, y: 0, width: request.frames[0].width + 40, height: request.frames[0].height + 40)
    guard let context = CGContext(URL(fileURLWithPath: path) as CFURL, mediaBox: &initial, nil) else { throw fail("PDF cannot be opened") }
    for (page, frame) in request.frames.enumerated() {
        var box = CGRect(x: 0, y: 0, width: frame.width + 40, height: frame.height + 40)
        let boxData = Data(bytes: &box, count: MemoryLayout<CGRect>.size)
        context.beginPDFPage([kCGPDFContextMediaBox: boxData] as CFDictionary)
        context.textMatrix = .identity
        for line in lines where line.page == page {
            context.textPosition = CGPoint(x: 20, y: box.height - 20 - line.baseline)
            CTLineDraw(line.line, context)
        }
        context.endPDFPage()
    }
    context.closePDF()
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    try require(input.count <= 30_000_000 && CommandLine.arguments.count == 2, "Invalid proof invocation")
    let request = try JSONDecoder().decode(Request.self, from: input)
    let fonts = try validate(request)
    let (lines, rows, diagnostics) = try compose(request, fonts: fonts)
    try writePDF(request, lines, CommandLine.arguments[1])
    let result: [String: Any] = [
        "protocol": 1, "mode": request.mode, "requestDigest": digest(input), "sourceDigest": request.sourceDigest,
        "os": ProcessInfo.processInfo.operatingSystemVersionString, "backend": "CoreText-system",
        "resources": request.resources.map { ["id": $0.id, "digest": $0.digest, "postscript": $0.postscript] },
        "layout": ["lines": rows, "coveredLength": lines.last?.end ?? 0, "textLength": request.text.utf16.count],
        "diagnostics": diagnostics
    ]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
