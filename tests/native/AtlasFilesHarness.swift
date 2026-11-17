import Foundation

/// Test transport for the exact Foundation implementation used by the Capacitor plugin.
@main enum AtlasFilesHarness {
    static func main() {
        let atlas = AtlasFiles(directory: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
        while let line = readLine() {
            var response: [String: Any]
            do {
                let call = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
                switch call["method"] as? String {
                case "initialize": try atlas.initialize(); response = ["ok":true]
                case "read":
                    if let data = try atlas.read(call["path"] as! String) { response = ["data":data.base64EncodedString()] }
                    else { response = ["data":NSNull()] }
                case "write":
                    try atlas.writeAtomic(call["path"] as! String, data: Data(base64Encoded:call["data"] as! String)!, expectedHash:call["expectedHash"] as? String)
                    response = ["ok":true]
                case "hash": response = ["sha256": AtlasFiles.digest(Data(base64Encoded:call["data"] as! String)!)]
                default: throw NSError(domain:"Harness",code:1)
                }
            } catch { response = ["error":error.localizedDescription] }
            let bytes = try! JSONSerialization.data(withJSONObject:response, options:[.sortedKeys])
            print(String(data:bytes,encoding:.utf8)!); fflush(stdout)
        }
    }
}
