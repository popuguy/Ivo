import CoreGraphics
import Foundation
import PDFKit

// Select the same word at three weights, then measure the real ink in each selected area.
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let page = document.page(at: 0)!
let scale: CGFloat = 4
let selections = document.findString("Rhythm", withOptions: [])
let rows = selections.map { selection -> [String: Double] in
  let bounds = selection.bounds(for: page)
  let crop = bounds.insetBy(dx: -2, dy: -2)
  let width = Int(ceil(crop.width * scale)), height = Int(ceil(crop.height * scale))
  var pixels = [UInt8](repeating: 255, count: width * height)
  pixels.withUnsafeMutableBytes { buffer in
    let context = CGContext(data: buffer.baseAddress, width: width, height: height,
      bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
      bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: -crop.minX, y: -crop.minY)
    context.drawPDFPage(page.pageRef!)
  }
  let ink = pixels.reduce(0.0) { $0 + Double(255 - $1) / 255 }
  return ["advance": Double(bounds.width), "ink": ink]
}
print(String(data: try JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!)
