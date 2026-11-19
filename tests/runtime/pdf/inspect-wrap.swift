import Foundation
import PDFKit

// Independent publication witness: inspect the printed PDF, not renderer DOM.
let input = CommandLine.arguments[1]
guard let document = PDFDocument(url: URL(fileURLWithPath: input)),
  document.pageCount == 1, let page = document.page(at: 0), let text = page.string
else { fatalError("Wrapped PDF is not a readable one-page document") }
let expression = try NSRegularExpression(pattern: "word[0-9]{3}")
let words = expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).map {
  (text as NSString).substring(with: $0.range)
}.sorted()
precondition(words == (0..<100).map { String(format: "word%03d", $0) },
  "Printed PDF lost, repeated or changed wrapped words")
let height = page.bounds(for: .mediaBox).height
var checked = 0
for index in 0..<page.numberOfCharacters {
  let rect = page.characterBounds(at: index)
  if rect.isEmpty { continue }
  let top = height - rect.maxY, bottom = height - rect.minY
  precondition(bottom <= 92.1 || top >= 247.9 || rect.maxX <= 172.1 || rect.minX >= 327.9,
    "Printed glyph intersects its independently specified object exclusion")
  checked += 1
}
precondition(checked >= 700, "Printed wrapped text is not selectable")
print("{\"wrappedPDFWords\":100,\"selectableCharacters\":\(checked),\"independentExclusion\":true}")
