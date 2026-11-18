import Foundation

/// A serial, bounded JSONL endpoint. Its only inputs are source, font bytes and opaque tokens.
@main struct TextCompositionWorker {
  static func main() {
    let engine = TextCompositionEngine()
    let maxLine = 64_000_000
    var buffer = Data()
    var discarding = false
    func respond(_ bytes: Data) {
      autoreleasepool {
        var id: String = ""
        do {
          guard let request = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            let identity = request["id"] as? String, !identity.isEmpty, identity.utf8.count <= 120
          else { throw error("Invalid worker envelope") }
          id = identity
          let result: Any
          if request["action"] as? String == "pdf" {
            guard Set(request.keys).isSubset(of: ["id", "action", "token", "invisible"]),
              let token = request["token"] as? String, token.count <= 100,
              let invisible = request["invisible"] as? Bool
            else { throw error("Invalid PDF action") }
            let pdf = try engine.pdf(token: token, invisible: invisible)
            result = [
              "data": pdf.base64EncodedString(), "mimeType": "application/pdf", "token": token,
            ]
          } else {
            guard Set(request.keys) == ["id", "payload"],
              let payload = request["payload"] as? String, payload.utf8.count <= 30_000_000
            else { throw error("Invalid composition action") }
            try emitComposition(id: id, result: engine.execute(Data(payload.utf8)))
            return
          }
          try emit(["id": id, "ok": true, "result": result])
        } catch {
          try? emit([
            "id": id, "ok": false, "error": String(error.localizedDescription.prefix(1000)),
          ])
        }
      }
    }
    while true {
      let chunk = FileHandle.standardInput.availableData
      if chunk.isEmpty { break }
      var offset = chunk.startIndex
      while offset < chunk.endIndex {
        let end = chunk[offset...].firstIndex(of: 10) ?? chunk.endIndex
        if !discarding {
          if buffer.count + end - offset > maxLine {
            buffer.removeAll(keepingCapacity: false)
            discarding = true
          } else {
            buffer.append(chunk[offset..<end])
          }
        }
        if end < chunk.endIndex {
          if discarding {
            try? emit(["id": "", "ok": false, "error": "Worker line exceeds bounds"])
          } else if !buffer.isEmpty {
            respond(buffer)
          }
          buffer.removeAll(keepingCapacity: false)
          discarding = false
          offset = end + 1
        } else {
          offset = end
        }
      }
    }
    if !buffer.isEmpty && !discarding { respond(buffer) }
  }
  static func error(_ value: String) -> NSError {
    NSError(
      domain: "Ivo.TextCompositionWorker", code: 1, userInfo: [NSLocalizedDescriptionKey: value])
  }
  static func emitComposition(id: String, result: Data) throws {
    // Engine bytes are already validated JSON. Re-decoding and encoding every glyph
    // here would add a second full composition-result traversal on every edit.
    guard result.count <= 32_000_000 else { throw error("Worker result exceeds bounds") }
    let identity = try JSONSerialization.data(withJSONObject: id, options: [.fragmentsAllowed])
    FileHandle.standardOutput.write(Data("{\"id\":".utf8))
    FileHandle.standardOutput.write(identity)
    FileHandle.standardOutput.write(Data(",\"ok\":true,\"result\":".utf8))
    FileHandle.standardOutput.write(result)
    FileHandle.standardOutput.write(Data("}\n".utf8))
  }
  static func emit(_ value: [String: Any]) throws {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard bytes.count <= 40_000_000 else { throw error("Worker result exceeds bounds") }
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data([10]))
  }
}
