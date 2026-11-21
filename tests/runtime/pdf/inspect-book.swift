import Foundation
import PDFKit

guard let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])),
      let root = pdf.outlineRoot else { fatalError("PDFKit could not open the book outline") }
func children(_ parent: PDFOutline) -> [[String: Any]] {
  (0..<parent.numberOfChildren).compactMap { i in
    guard let item = parent.child(at: i), let page = item.destination?.page else { return nil }
    return ["title": item.label ?? "", "page": pdf.index(for: page), "children": children(item)]
  }
}
let data = try JSONSerialization.data(withJSONObject: [
  "bookmarks": children(root),
  "text": (0..<pdf.pageCount).map { pdf.page(at: $0)?.string ?? "" },
  "labels": (0..<pdf.pageCount).map { pdf.page(at: $0)?.label ?? "" }
])
print(String(decoding: data, as: UTF8.self))
