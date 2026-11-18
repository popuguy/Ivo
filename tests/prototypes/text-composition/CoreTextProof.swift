import Foundation

@main struct CoreTextProof {
  static func main() {
    do {
      guard CommandLine.arguments.count == 2 else {
        throw NSError(
          domain: "Ivo.CompositionProof", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Invalid proof invocation"])
      }
      let engine = TextCompositionEngine()
      let output = try engine.execute(FileHandle.standardInput.readDataToEndOfFile())
      let result = try JSONSerialization.jsonObject(with: output) as! [String: Any]
      if let token = result["token"] as? String {
        try engine.pdf(token: token, invisible: false, margin: 20).write(
          to: URL(fileURLWithPath: CommandLine.arguments[1]))
      }
      FileHandle.standardOutput.write(output)
    } catch {
      FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
      exit(1)
    }
  }
}
