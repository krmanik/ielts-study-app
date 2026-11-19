// Apple Vision OCR. Writes, next to each image, a JSON file {"w":,"h":,"lines":[{"t":text,"x":,"y":,"w":,"h":,"c":conf,"alt":[...]}]}
// with coordinates normalised 0..1, origin top-left.
//
//   vocr in.png [in2.png ...]         -> in.vjson   (language correction on: best for running prose)
//   vocr --raw in.png [in2.png ...]   -> in.vraw    (language correction off: best for names, numbers, codes)
//
// "alt" holds the other top candidates; proof.py uses them to settle disagreements between engines.
import Foundation
import Vision
import AppKit

var args = Array(CommandLine.arguments.dropFirst())
let raw = args.first == "--raw"
if raw { args.removeFirst() }

for path in args {
    let out = (path as NSString).deletingPathExtension + (raw ? ".vraw" : ".vjson")
    if FileManager.default.fileExists(atPath: out) { continue }
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = !raw
    req.recognitionLanguages = ["en-GB", "en-US"]
    let h = VNImageRequestHandler(cgImage: cg, options: [:])
    try? h.perform([req])
    var rows: [[String: Any]] = []
    for o in req.results ?? [] {
        let cands = o.topCandidates(4)
        guard let c = cands.first else { continue }
        let b = o.boundingBox
        var row: [String: Any] = ["t": c.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "c": c.confidence]
        let alt = cands.dropFirst().map { $0.string }.filter { $0 != c.string }
        if !alt.isEmpty { row["alt"] = alt }
        rows.append(row)
    }
    let data = try! JSONSerialization.data(withJSONObject: ["w": cg.width, "h": cg.height, "lines": rows])
    try! data.write(to: URL(fileURLWithPath: out))
}
