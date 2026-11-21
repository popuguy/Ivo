import Foundation
import PDFKit
guard let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])), pdf.pageCount == 2
else { fatalError("Baseline grid export must contain two pages") }
let custom = CommandLine.arguments.dropFirst(2).first == "custom"
let expected: [(String, Int, Double, Double)] = custom ? [
  ("cut",0,35,52), ("hem",0,135,69), ("sew",0,135,86), ("press",0,135,103),
  ("join",0,245,65), ("trim",0,245,87), ("fold",0,245,109), ("line",0,245,131),
  ("rip",1,31,93), ("finish",1,31,112), ("dart",1,31,131), ("spin",1,31,150)
] : [
  ("cut",0,35,55), ("hem",0,35,74), ("sew",0,35,93),
  ("press",0,245,74), ("join",0,245,93), ("trim",0,245,112), ("fold",0,245,131),
  ("line",1,31,93), ("rip",1,31,112), ("finish",1,31,131), ("dart",1,31,150), ("spin",1,31,169)
]
var fontAscent: CGFloat?
for (word,index,x,y) in expected {
  let hits=pdf.findString(word, withOptions: [])
  guard hits.count == 1, let page=pdf.page(at: index), hits[0].pages == [page] else {
    fatalError("Grid lost a word or changed its page: \(word)")
  }
  let r=hits[0].bounds(for: page), top=page.bounds(for: .mediaBox).height-r.maxY
  if fontAscent == nil {
    fontAscent=y-top
    precondition(fontAscent! > 6 && fontAscent! < 15,"First word left its baseline band")
  }
  precondition(abs(top+fontAscent!-y)<0.15 && abs(r.minX-x)<0.15, "Printed grid moved \(word) from its baseline or column")
}
// Empty space on page two crosses grid rows. The editor guide must never print.
let page = pdf.page(at: 1)!, probe = CGRect(x:285,y:75,width:50,height:150)
var pixels = [UInt8](repeating: 255, count: 50 * 150)
pixels.withUnsafeMutableBytes { buffer in
  let context=CGContext(data:buffer.baseAddress,width:50,height:150,bitsPerComponent:8,bytesPerRow:50,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
  context.translateBy(x:-probe.minX,y:-probe.minY)
  context.drawPDFPage(page.pageRef!)
}
precondition(pixels.allSatisfy { $0 >= 252 }, "Editor grid lines printed in the PDF")
print("{\"selectableGridWords\":12,\"pages\":2,\"noPrintedGuides\":true}")
