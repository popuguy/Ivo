// Optional physical Mac check. Sample only an Ivo fixture palette and this process's
// two-color backing window. Screen recording access must already be available.
import AppKit
import ScreenCaptureKit

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
guard CGPreflightScreenCaptureAccess(), CommandLine.arguments.count == 3,
  let paletteID = UInt32(CommandLine.arguments[1]),
  let fixturePID = Int32(CommandLine.arguments[2])
else { exit(2) }

final class Backdrop: NSView {
  override func draw(_ dirtyRect: NSRect) {
    NSColor(srgbRed: 1, green: 0, blue: 0, alpha: 1).setFill()
    bounds.fill()
    NSColor(srgbRed: 0, green: 1, blue: 0, alpha: 1).setFill()
    NSRect(x: bounds.midX, y: 0, width: bounds.width / 2, height: bounds.height).fill()
  }
}

Task { @MainActor in
  do {
    let before = try await SCShareableContent.excludingDesktopWindows(
      true, onScreenWindowsOnly: true)
    guard
      let palette = before.windows.first(where: {
        $0.windowID == paletteID && $0.owningApplication?.processID == fixturePID
      }), let display = before.displays.first(where: { $0.frame.contains(palette.frame) }),
      let primary = NSScreen.screens.first
    else { exit(3) }
    let box = palette.frame
    let cocoaBox = NSRect(
      x: box.minX, y: primary.frame.maxY - box.maxY, width: box.width, height: box.height)
    let backing = NSPanel(
      contentRect: cocoaBox.insetBy(dx: -24, dy: -24),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    backing.hasShadow = false
    backing.contentView = Backdrop()
    backing.order(.below, relativeTo: Int(paletteID))
    defer { backing.orderOut(nil) }
    backing.display()
    try await Task.sleep(for: .milliseconds(150))
    let content = try await SCShareableContent.excludingDesktopWindows(
      true, onScreenWindowsOnly: true)
    guard
      let backingWindow = content.windows.first(where: {
        $0.windowID == UInt32(backing.windowNumber)
      })
    else { exit(4) }
    let filter = SCContentFilter(display: display, including: [palette, backingWindow])
    let config = SCStreamConfiguration()
    config.includeChildWindows = false
    config.showsCursor = false
    config.sourceRect = CGRect(
      x: box.midX - display.frame.minX - 12, y: box.maxY - display.frame.minY - 12, width: 24,
      height: 14)
    config.width = 48
    config.height = 28
    let image = try await SCScreenshotManager.captureImage(
      contentFilter: filter, configuration: config)
    let pixels = NSBitmapImageRep(cgImage: image)
    // Compare against the actual sampled backing. Displays can have different
    // color profiles, so nominal sRGB primaries are not a pixel oracle.
    func rgb(_ x: Int, _ y: Int) -> [CGFloat] {
      guard let c = pixels.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { return [] }
      return [c.redComponent, c.greenComponent, c.blueComponent]
    }
    let lx = 4
    let rx = pixels.pixelsWide - 5
    let left = rgb(lx, pixels.pixelsHigh - 1)
    let right = rgb(rx, pixels.pixelsHigh - 1)
    guard left.count == 3, right.count == 3, left[0] - left[1] > 0.3, right[1] - right[0] > 0.3
    else {
      print(
        "Two-color backing was not visible outside the palette", left, right, box,
        backingWindow.frame, display.frame)
      exit(5)
    }
    var clear = false
    var gradient = Set<Int>()
    var solid = false
    for y in 0..<(pixels.pixelsHigh - 4) {
      let l = rgb(lx, y)
      let r = rgb(rx, y)
      guard l.count == 3, r.count == 3 else { continue }
      let a = l[0] / left[0]
      let b = r[1] / right[1]
      let followsBacking = (0..<3).allSatisfy {
        abs(l[$0] - a * left[$0]) < 0.025 && abs(r[$0] - b * right[$0]) < 0.025
      }
      if followsBacking && abs(a - b) < 0.04 {
        let transmission = (a + b) / 2
        clear = clear || abs(1 - transmission) < 0.008
        if (0.55..<0.99).contains(transmission) {
          gradient.insert(Int((transmission * 255).rounded()))
        }
      }
      solid = solid || ((0..<3).allSatisfy { abs(l[$0] - r[$0]) < 0.04 } && l[2] > 0.55)
    }
    print("Clear backing: \(clear), shadow levels: \(gradient.count), opaque panel: \(solid)")
    exit(clear && gradient.count >= 2 && solid ? 0 : 5)
  } catch {
    print(error)
    exit(1)
  }
}
RunLoop.main.run()
