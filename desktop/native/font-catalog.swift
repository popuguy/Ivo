import Foundation

@main struct FontCatalog {
    static func main() {
        do {
            let args = CommandLine.arguments
            let encoder = JSONEncoder()
            let data: Data
            if args.count == 2 && args[1] == "list" { data = try encoder.encode(SystemFonts.list()) }
            else if args.count == 3 && args[1] == "read" { data = try encoder.encode(SystemFonts.read(args[2])) }
            else { throw NSError(domain: "Ivo.Fonts", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid font request."]) }
            FileHandle.standardOutput.write(data)
        } catch {
            FileHandle.standardError.write(Data(error.localizedDescription.utf8))
            exit(1)
        }
    }
}
