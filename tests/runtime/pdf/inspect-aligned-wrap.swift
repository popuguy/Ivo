import Foundation
import PDFKit

let wrappedJustify = CommandLine.arguments[2] == "justify-wrap"
let justify = wrappedJustify || CommandLine.arguments[2] == "justify"
let bottom = CommandLine.arguments[2] != "center"
guard let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])),
  let page = document.page(at: 0), let pageRef = page.pageRef,
  let selection = document.findString("grading", withOptions: []).first
else { fatalError("Wrapped word is not selectable in the actual PDF") }
let words = page.string?.split(whereSeparator: { $0.isWhitespace }).map(String.init) ?? []
let expected = justify ? ["cut", "hem", "sew", "grading"] : ["grading"]
// PDFKit groups the isolated word beside the obstacle into a separate column.
// The PDF tag tree is verified independently in the authored reading order.
precondition(wrappedJustify ? words.sorted() == expected.sorted() : words == expected,
  "PDFKit did not extract the expected selectable text")
let bounds = selection.bounds(for: page), pageHeight = page.bounds(for: .mediaBox).height
if justify {
  // Fixed first baseline 16, natural leading 20, 12 pt preferential paragraph space.
  for (word, baseline) in [("cut", 36.0), ("hem", 86.6667), ("sew", 149.3333), ("grading", 200.0)] {
    guard let selected = document.findString(word, withOptions: []).first else { fatalError("Missing justified line") }
    let box = selected.bounds(for: page)
    let final = selection.bounds(for: page)
    precondition(abs(box.maxY - final.maxY - (200 - baseline)) < 0.1, "Printed line lost paragraph spacing or leading")
    if wrappedJustify {
      precondition(abs(box.minX - (word == "sew" ? 140 : 20)) < 0.15,
        "Printed word missed the wrap opening at its justified baseline")
    }
  }
}
let baseline: CGFloat = bottom ? 200 : 118
precondition(abs(bounds.minX - (bottom ? 20 : 160)) < 0.15, "Word is on the wrong side of the wrap")
precondition(bounds.minY < pageHeight - baseline + 1 && bounds.maxY > pageHeight - baseline,
  "Selectable word moved away from the composed baseline")
// Inspect just the printer ink below the baseline in page coordinates. A clipped
// SVG can retain a perfectly selectable PDF word while still losing its descenders.
let scale: CGFloat = 4
let crop = CGRect(x: bounds.minX, y: pageHeight - baseline - 5, width: bounds.width, height: 4.5)
let width = Int(ceil(crop.width * scale)), height = Int(ceil(crop.height * scale))
var pixels = [UInt8](repeating: 255, count: width * height)
pixels.withUnsafeMutableBytes { buffer in
  let context = CGContext(data: buffer.baseAddress, width: width, height: height,
    bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
    bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  context.scaleBy(x: scale, y: scale)
  context.translateBy(x: -crop.minX, y: -crop.minY)
  context.drawPDFPage(pageRef)
}
let ink = pixels.filter { $0 < 180 }.count
precondition(ink > 8, "Printed PDF clipped the descenders at the baseline")
print("{\"selectable\":true,\"descenderPixels\":\(ink)}")
