import AppKit
import PDFKit

// Exercise the same PDFView action and annotation hit testing as a Mac reader,
// without displaying a window or taking the keyboard away from the user.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 420),
                      styleMask: [.borderless], backing: .buffered, defer: false)
let view = PDFView(frame: window.contentView!.bounds)
window.contentView = view
view.displayMode = .singlePage
view.document = pdf
view.layoutDocumentView()

var followed = [[Int]]()
for i in 0..<pdf.pageCount {
  let page = pdf.page(at: i)!
  for annotation in page.annotations {
    guard let dest = annotation.destination ?? (annotation.action as? PDFActionGoTo)?.destination,
          let target = dest.page, target !== page else { continue }
    view.go(to: page)
    let box = annotation.bounds
    guard let hit = page.annotation(at: CGPoint(x: box.midX, y: box.midY)),
          let action = (hit.action as? PDFActionGoTo) ?? hit.destination.map({ PDFActionGoTo(destination: $0) })
    else { fatalError("Internal link is not actionable at its printed location") }
    view.perform(action)
    guard view.currentPage === target else { fatalError("Reader did not navigate to the intended page") }
    followed.append([i, pdf.index(for: target)])
  }
}
precondition(!followed.isEmpty, "Export contains no cross-page navigation")
let record = try JSONSerialization.data(withJSONObject: followed)
print(String(decoding: record, as: UTF8.self))
