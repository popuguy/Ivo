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
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "bounds"
var checked = 0, above = 0, below = 0, insideBox = 0
for index in 0..<page.numberOfCharacters {
  let rect = page.characterBounds(at: index)
  if rect.isEmpty { continue }
  let top = height - rect.maxY, bottom = height - rect.minY
  if bottom < 100 { above += 1 }
  if top > 240 { below += 1 }
  switch mode {
  case "jump":
    precondition(bottom <= 110 || top >= 230, "Jump Object left printed text beside the object")
  case "contour":
    if rect.minX > 180 && rect.maxX < 320 && top > 100 && bottom < 240 {
      // The upper-left triangle occupies x+y < 420 in page coordinates.
      precondition(rect.midX + (top + bottom)/2 >= 419, "Glyph printed inside the triangle")
      insideBox += 1
    }
  default:
    precondition(bottom <= 92.1 || top >= 247.9 || rect.maxX <= 172.1 || rect.minX >= 327.9,
      "Printed glyph intersects its independently specified object exclusion")
  }
  checked += 1
}
if mode == "contour" { precondition(insideBox > 0, "PDF used the triangle's entire box") }
if mode == "jump" { precondition(above > 0 && below > 0, "PDF did not resume below the object") }
precondition(checked >= 700, "Printed wrapped text is not selectable")
print("{\"wrappedPDFWords\":100,\"selectableCharacters\":\(checked),\"independentExclusion\":true}")
