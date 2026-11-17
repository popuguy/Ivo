import Foundation
import CryptoKit

/// Byte IO for the shared JavaScript vault engine. No caller-supplied absolute paths.
/// Kept independent of UIKit/Capacitor so the actual iOS file code is testable on macOS.
final class AtlasFiles {
    let directory: URL
    private let files = FileManager.default
    private let lock = NSLock()

    init(directory: URL) { self.directory = directory.standardizedFileURL }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "Ivo.Atlas", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private func checkLink(_ url: URL) throws {
        if files.fileExists(atPath: url.path) {
            let attributes = try files.attributesOfItem(atPath: url.path)
            if attributes[.type] as? FileAttributeType == .typeSymbolicLink {
                throw failure("Atlas paths must not be symbolic links.")
            }
        } else if (try? files.destinationOfSymbolicLink(atPath: url.path)) != nil {
            throw failure("Atlas paths must not be symbolic links.")
        }
    }
    private func location(_ relative: String, createParent: Bool = false) throws -> URL {
        let pattern = "^(atlas\\.json|documents/[A-Za-z0-9_-]+-[a-f0-9]{64}\\.json|assets/[a-f0-9]{64}\\.bin)$"
        guard relative.rangeOfCharacter(from: .controlCharacters) == nil,
              relative.range(of: pattern, options: .regularExpression) != nil else {
            throw failure("Invalid atlas object path.")
        }
        let target = directory.appendingPathComponent(relative)
        try checkLink(directory)
        try checkLink(target.deletingLastPathComponent())
        try checkLink(target)
        if createParent {
            try files.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        }
        return target
    }
    func initialize() throws {
        lock.lock(); defer { lock.unlock() }
        try checkLink(directory)
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        let manifest = try location("atlas.json")
        if !files.fileExists(atPath: manifest.path), !(try files.contentsOfDirectory(atPath: directory.path)).isEmpty {
            throw failure("This folder is not an Ivo atlas. Choose an empty folder.")
        }
        for folder in ["documents", "assets"] { try checkLink(directory.appendingPathComponent(folder)) }
    }
    func read(_ relative: String) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        let target = try location(relative)
        guard files.fileExists(atPath: target.path) else { return nil }
        return try Data(contentsOf: target)
    }
    func writeAtomic(_ relative: String, data: Data, expectedHash: String?) throws {
        lock.lock(); defer { lock.unlock() }
        let target = try location(relative, createParent: true)
        if relative == "atlas.json" {
            let previous = files.fileExists(atPath: target.path) ? try Data(contentsOf: target) : nil
            let digest = previous.map { Self.digest($0) }
            guard digest == expectedHash else {
                throw failure("The atlas changed outside this window. Your edits are still here; export a backup before reopening it.")
            }
        }
        try data.write(to: target, options: .atomic)
    }
}
