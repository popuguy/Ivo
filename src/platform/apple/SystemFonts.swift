import Foundation
import CoreText
#if os(macOS)
import AppKit
#endif

/// Read-only local font catalogue. Paths never cross the application bridge.
public enum SystemFonts {
    public struct Face: Codable {
        public let postscript: String
        public let family: String
        public let style: String
        public let fullName: String
        public let weight: Int
        public let italic: Bool
    }
    public struct EmbeddedFace: Codable {
        public let name: String
        public let data: String
        public let variations: [String: Double]
    }
    private static let limit = 30 * 1024 * 1024
    private static func failure(_ message: String) -> NSError {
        NSError(domain: "Ivo.Fonts", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private static func descriptors() -> [CTFontDescriptor] {
        let collection = CTFontCollectionCreateFromAvailableFonts([kCTFontCollectionRemoveDuplicatesOption: true] as CFDictionary)
        var faces = CTFontCollectionCreateMatchingFontDescriptors(collection) as? [CTFontDescriptor] ?? []
        #if os(macOS)
        // These local installations can provide Minion without registering it with Core Text.
        // Registered faces take precedence. No path comes from renderer input.
        let workspace = NSWorkspace.shared
        let directories = [
            workspace.urlForApplication(withBundleIdentifier: "com.adobe.Acrobat.Pro")?
                .appendingPathComponent("Contents/Resources/Resource/Font"),
            workspace.urlForApplication(withBundleIdentifier: "com.adobe.InDesign")?
                .deletingLastPathComponent().appendingPathComponent("Resources/Required/fonts")
        ].compactMap { $0 }
        for directory in directories {
            for name in ["MinionPro-Regular", "MinionPro-It", "MinionPro-Bold", "MinionPro-BoldIt"] {
                let url = directory.appendingPathComponent(name).appendingPathExtension("otf")
                guard FileManager.default.fileExists(atPath: url.path),
                      let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor] else { continue }
                faces += descriptors.filter { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String == name }
            }
        }
        #endif
        return faces
    }
    public static func list() -> [Face] {
        var seen = Set<String>()
        return descriptors().compactMap { descriptor in
            let font = CTFontCreateWithFontDescriptor(descriptor, 12, nil)
            let name = CTFontCopyPostScriptName(font) as String
            guard !name.isEmpty, name.utf8.count <= 512, seen.insert(name).inserted else { return nil }
            return Face(postscript: name, family: CTFontCopyFamilyName(font) as String,
                        style: CTFontCopyName(font, kCTFontStyleNameKey) as String? ?? "Regular",
                        fullName: CTFontCopyFullName(font) as String,
                        weight: weight(font), italic: CTFontGetSymbolicTraits(font).contains(.traitItalic))
        }.sorted { ($0.family, $0.style, $0.postscript) < ($1.family, $1.style, $1.postscript) }
    }
    private static func weight(_ font: CTFont) -> Int {
        if let data = CTFontCopyTable(font, 0x4F532F32, []) as Data?, data.count >= 6 {
            let bytes = [UInt8](data)
            return max(1, min(1000, Int(bytes[4]) * 256 + Int(bytes[5])))
        }
        return CTFontGetSymbolicTraits(font).contains(.traitBold) ? 700 : 400
    }
    public static func read(_ name: String) throws -> EmbeddedFace {
        guard !name.isEmpty, name.utf8.count <= 512,
              let descriptor = descriptors().first(where: { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String == name }) else {
            throw failure("This font is no longer available. Refresh the font list and try again.")
        }
        let font = CTFontCreateWithFontDescriptor(descriptor, 12, nil)
        guard CTFontCopyPostScriptName(font) as String == name else { throw failure("The selected font could not be resolved exactly.") }
        var bytes: Data?
        if let url = CTFontDescriptorCopyAttribute(descriptor, kCTFontURLAttribute) as? URL,
           let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= limit,
           let original = try? Data(contentsOf: url), original.count >= 12 {
            let signature = Array(original.prefix(4))
            // Preserve original single-face files. Collections/resource fonts require a standalone face.
            if signature == [0, 1, 0, 0] || signature == Array("OTTO".utf8) { bytes = original }
        }
        let data = try bytes ?? standalone(font)
        guard data.count <= limit else { throw failure("This font is larger than the 30 MB vault font limit.") }
        var variations: [String: Double] = [:]
        if let values = CTFontCopyVariation(font) as? [NSNumber: NSNumber] {
            for (key, value) in values {
                let tag = key.uint32Value
                let letters = (0..<4).map { UInt8((tag >> UInt32(24 - $0 * 8)) & 255) }
                if let text = String(bytes: letters, encoding: .ascii), text.utf8.allSatisfy({ $0 >= 32 && $0 < 127 }) {
                    variations[text] = value.doubleValue
                }
            }
        }
        return EmbeddedFace(name: name + (data.prefix(4) == Data("OTTO".utf8) ? ".otf" : ".ttf"), data: data.base64EncodedString(), variations: variations)
    }
    /// Preserve face tables while rebuilding collection-relative offsets/checksums.
    private static func standalone(_ font: CTFont) throws -> Data {
        guard let rawTags = CTFontCopyAvailableTables(font, []), CFArrayGetCount(rawTags) > 0, CFArrayGetCount(rawTags) <= 256 else {
            throw failure("The system cannot provide portable font data for this face.")
        }
        // Core Text returns unboxed integer tags, not CFNumber objects.
        let tags = (0..<CFArrayGetCount(rawTags)).map { UInt32(truncatingIfNeeded: UInt(bitPattern: CFArrayGetValueAtIndex(rawTags, $0))) }
        var tables: [(UInt32, Data)] = []
        var total = 0
        for tag in tags.sorted() {
            if tag == 0x44534947 { continue } // DSIG signatures refer to the original container.
            guard let table = CTFontCopyTable(font, tag, []) as Data? else { throw failure("A required font table is unavailable.") }
            total += table.count
            guard total <= limit else { throw failure("This font is larger than the 30 MB vault font limit.") }
            var data = table
            if tag == 0x68656164, data.count >= 12 { data.replaceSubrange(8..<12, with: [0, 0, 0, 0]) }
            tables.append((tag, data))
        }
        let count = tables.count
        let power = 1 << Int(floor(log2(Double(count))))
        var output = Data()
        func append16(_ value: Int) { output.append(contentsOf: [UInt8((value >> 8) & 255), UInt8(value & 255)]) }
        func append32(_ value: UInt32) { output.append(contentsOf: [UInt8((value >> 24) & 255), UInt8((value >> 16) & 255), UInt8((value >> 8) & 255), UInt8(value & 255)]) }
        append32(tables.contains(where: { $0.0 == 0x43464620 || $0.0 == 0x43464632 }) ? 0x4F54544F : 0x00010000)
        append16(count); append16(power * 16); append16(Int(log2(Double(power)))); append16(count * 16 - power * 16)
        var offset = 12 + 16 * count
        var head: Int?
        for (tag, data) in tables {
            append32(tag); append32(checksum(data)); append32(UInt32(offset)); append32(UInt32(data.count))
            if tag == 0x68656164 { head = offset }
            offset += (data.count + 3) & ~3
        }
        for (_, data) in tables {
            output.append(data)
            while output.count % 4 != 0 { output.append(0) }
        }
        guard let head = head, head + 12 <= output.count else { throw failure("This font has no portable header.") }
        let adjustment = 0xB1B0AFBA &- checksum(output)
        output.replaceSubrange((head + 8)..<(head + 12), with: [UInt8((adjustment >> 24) & 255), UInt8((adjustment >> 16) & 255), UInt8((adjustment >> 8) & 255), UInt8(adjustment & 255)])
        return output
    }
    private static func checksum(_ data: Data) -> UInt32 {
        var sum: UInt32 = 0
        let bytes = [UInt8](data)
        for offset in stride(from: 0, to: bytes.count, by: 4) {
            var word: UInt32 = 0
            for index in 0..<4 { word = (word << 8) | UInt32(offset + index < bytes.count ? bytes[offset + index] : 0) }
            sum = sum &+ word
        }
        return sum
    }
}
