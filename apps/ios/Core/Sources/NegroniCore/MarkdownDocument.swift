import Foundation

public enum MarkdownDocument {
  public struct Block {
    public var kind: String, text: String, prefix = ""
    public var level = 0
  }
  public static func blocks(_ source: String) -> [Block] {
    var result: [Block] = []
    var paragraph: [String] = []
    var code: [String] = []
    var fence: String?
    var quote: [String] = []
    func flushQuote() {
      if !quote.isEmpty {
        result.append(Block(kind: "quote", text: quote.joined(separator: "\n")))
        quote = []
      }
    }
    func flush() {
      if !paragraph.isEmpty {
        result.append(Block(kind: "paragraph", text: paragraph.joined(separator: "\n")))
        paragraph = []
      }
    }
    for raw in source.components(separatedBy: .newlines) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if let delimiter = fence {
        if line.hasPrefix(delimiter) {
          result.append(Block(kind: "code", text: code.joined(separator: "\n")))
          code = []
          fence = nil
        } else {
          code.append(raw)
        }
        continue
      }
      if line.hasPrefix(">") {
        flush()
        var text = line
        while text.hasPrefix(">") { text = String(text.dropFirst()).trimmingCharacters(in: .whitespaces) }
        quote.append(text)
        continue
      }
      flushQuote()
      if line.hasPrefix("```") || line.hasPrefix("~~~") {
        flush()
        fence = String(line.prefix(3))
        continue
      }
      if line.isEmpty {
        flush()
        continue
      }
      if line.range(of: "^#{1,6}\\s+", options: .regularExpression) != nil {
        flush()
        let level = line.prefix { $0 == "#" }.count
        let text = String(line.dropFirst(level)).trimmingCharacters(in: .whitespaces)
          .replacingOccurrences(of: "\\s+#+$", with: "", options: .regularExpression)
        result.append(Block(kind: "heading", text: text, level: level))
        continue
      }
      if line == "---" || line == "***" || line == "___" {
        flush()
        continue
      }
      if let range = line.range(of: "^(?:[-*+] |[0-9]+[.)] )", options: .regularExpression) {
        flush()
        let marker = String(line[range])
        var text = String(line[range.upperBound...])
        var prefix = marker.first?.isNumber == true ? marker : "• "
        if text.hasPrefix("[ ] ") {
          prefix = "☐ "
          text = String(text.dropFirst(4))
        }
        if text.lowercased().hasPrefix("[x] ") {
          prefix = "☑ "
          text = String(text.dropFirst(4))
        }
        result.append(Block(kind: "list", text: text, prefix: prefix))
        continue
      }
      if line.hasPrefix("|") && line.hasSuffix("|") {
        flush()
        let cells = line.dropFirst().dropLast().split(
          separator: "|", omittingEmptySubsequences: false
        )
        .map { $0.trimmingCharacters(in: .whitespaces) }
        if cells.allSatisfy({ $0.range(of: "^:?-+:?$", options: .regularExpression) != nil }) {
          continue
        }
        result.append(Block(kind: "paragraph", text: cells.joined(separator: "    ")))
        continue
      }
      paragraph.append(raw)
    }
    flush()
    flushQuote()
    if fence != nil { result.append(Block(kind: "code", text: code.joined(separator: "\n"))) }
    return result
  }
}
