// Minimal probe: everything Electron cannot tell us about notch geometry.
// Build: swiftc -O notchinfo.swift -o notchinfo
// Output: one JSON line per display on stdout.
import AppKit
import Foundation

var out: [[String: Any]] = []

for s in NSScreen.screens {
    var d: [String: Any] = [:]
    d["frame"] = ["x": s.frame.origin.x, "y": s.frame.origin.y,
                  "w": s.frame.width, "h": s.frame.height]
    d["backingScaleFactor"] = s.backingScaleFactor
    d["localizedName"] = s.localizedName

    // safeAreaInsets.top > 0  =>  this display has a notch (macOS 12+)
    let i = s.safeAreaInsets
    d["safeAreaInsets"] = ["top": i.top, "left": i.left, "bottom": i.bottom, "right": i.right]
    d["hasNotch"] = i.top > 0

    // The two menu-bar segments flanking the notch. The gap between them IS the notch.
    if let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
        d["auxTopLeft"] = ["x": l.origin.x, "w": l.width, "h": l.height]
        d["auxTopRight"] = ["x": r.origin.x, "w": r.width, "h": r.height]
        // notch width = distance between the right edge of the left area
        // and the left edge of the right area, in points
        d["notchWidth"] = r.origin.x - (l.origin.x + l.width)
        d["notchHeight"] = l.height
    } else {
        d["auxTopLeft"] = NSNull()
        d["auxTopRight"] = NSNull()
        d["notchWidth"] = NSNull()
    }

    // menu bar height, for comparison with Electron's bounds-minus-workArea
    d["menuBarHeight"] = NSStatusBar.system.thickness
    out.append(d)
}

let data = try! JSONSerialization.data(withJSONObject: ["screens": out], options: [])
print(String(data: data, encoding: .utf8)!)
