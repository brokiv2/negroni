import Foundation

public enum JSON: Codable, Equatable, Sendable {
  case object([String: JSON])
  case array([JSON])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([JSON].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSON].self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  public subscript(_ key: String) -> JSON {
    get { dictionary[key] ?? .null }
    set {
      var d = dictionary
      d[key] = newValue
      self = .object(d)
    }
  }
  public var dictionary: [String: JSON] {
    if case .object(let v) = self { return v }
    return [:]
  }
  public var array: [JSON] {
    if case .array(let v) = self { return v }
    return []
  }
  public var string: String {
    if case .string(let v) = self { return v }
    return ""
  }
  public var bool: Bool {
    if case .bool(let v) = self { return v }
    return false
  }
  public var int: Int {
    if case .number(let v) = self { return Int(v) }
    return 0
  }
  public var isNull: Bool { self == .null }
  public func merging(_ other: [String: JSON]) -> JSON {
    .object(dictionary.merging(other) { _, new in new })
  }
  public static func decode(_ data: Data) throws -> JSON {
    try JSONDecoder().decode(JSON.self, from: data)
  }
  public func encoded() throws -> Data { try JSONEncoder().encode(self) }
}
extension JSON: ExpressibleByStringLiteral {
  public init(stringLiteral value: String) { self = .string(value) }
}
extension JSON: ExpressibleByBooleanLiteral {
  public init(booleanLiteral value: Bool) { self = .bool(value) }
}
extension JSON: ExpressibleByIntegerLiteral {
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
}
extension JSON: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (String, JSON)...) {
    self = .object(Dictionary(uniqueKeysWithValues: elements))
  }
}
extension JSON: ExpressibleByArrayLiteral {
  public init(arrayLiteral elements: JSON...) { self = .array(elements) }
}

public enum Endpoint {
  public static func normalize(_ value: String) -> URL? {
    guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
      let host = url.host, !host.isEmpty, url.user == nil, url.password == nil, url.query == nil,
      url.fragment == nil, ["", "/"].contains(url.path)
    else { return nil }
    return URL(
      string:
        "\(scheme)://\(url.host!.contains(":") ? "[\(host)]" : host)\(url.port.map { ":\($0)" } ?? "")"
    )
  }
}

public struct SSEDecoder: Sendable {
  private var lineBytes: [UInt8] = []
  private var lines: [String] = []
  private var previousCR = false
  private var frameBytes = 0
  public init() {}
  // AsyncBytes.lines removes empty lines, including SSE's frame delimiters.
  // Parse raw bytes so fragmented UTF-8, CRLF and multiple events stay intact.
  public mutating func consume(byte: UInt8) -> JSON? {
    if byte == 10 && previousCR {
      previousCR = false
      return nil
    }
    previousCR = byte == 13
    if byte == 10 || byte == 13 {
      let line = String(decoding: lineBytes, as: UTF8.self)
      lineBytes.removeAll(keepingCapacity: true)
      return consume(line)
    }
    lineBytes.append(byte)
    if lineBytes.count > 2_000_000 {
      lineBytes.removeAll()
      lines.removeAll()
      frameBytes = 0
    }
    return nil
  }
  public mutating func consume(_ line: String) -> JSON? {
    if line.isEmpty {
      defer {
        lines.removeAll(keepingCapacity: true)
        frameBytes = 0
      }
      let raw = lines.joined(separator: "\n")
      guard raw != "[DONE]", let data = raw.data(using: .utf8), let parsed = try? JSON.decode(data)
      else { return nil }
      return parsed["json"].isNull ? parsed : parsed["json"]
    }
    if line.hasPrefix("data:") {
      var value = String(line.dropFirst(5))
      if value.hasPrefix(" ") { value.removeFirst() }
      lines.append(value)
      frameBytes += value.utf8.count
    }
    if frameBytes > 2_000_000 {
      lines.removeAll()
      frameBytes = 0
    }
    return nil
  }
}

public enum ChatNotificationPolicy {
  public static func suppress(
    threadID: String?, spaceID: String?, visibleThreadID: String?, visibleSpaceID: String?,
    foreground: Bool
  ) -> Bool {
    guard foreground, let threadID, !threadID.isEmpty, let spaceID, !spaceID.isEmpty else {
      return false
    }
    return threadID == visibleThreadID && spaceID == visibleSpaceID
  }
}

public enum ThreadLogic {
  public static func working(_ snapshot: JSON) -> Bool {
    let runs = snapshot["activeRuns"].array + (snapshot["run"].isNull ? [] : [snapshot["run"]])
    return runs.contains { ["queued", "leased", "running"].contains($0["status"].string) }
  }
  /// Live tool rows use event sequence numbers, which are not message sequence numbers.
  public static func lastUserSequence(_ messages: [JSON]) -> Int {
    messages.filter { $0["role"].string == "user" }.map { $0["seq"].int }.max() ?? -1
  }
  public static func visibleBlocks(_ message: JSON) -> [JSON] {
    message["blocks"].array.filter { block in
      switch block["kind"].string {
      case "steps", "bot_message_received": return false
      case "text", "channel_message":
        return !block["text"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      case "progress":
        return !block["text"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          && block["pendingToolNames"].array.isEmpty && !block["text"].string.hasPrefix("Using ")
      case "ask", "choice", "file", "image", "app_connect": return true
      case "subagent", "child_bot", "cloud_agent":
        return ["name", "title", "result", "progress", "status"].contains {
          !block[$0].string.isEmpty
        }
      default: return !block["summary"].string.isEmpty
      }
    }
  }
  public static func unconfirmed(_ outgoing: [JSON], in messages: [JSON]) -> [JSON] {
    var used = Set<String>()
    return outgoing.filter { pending in
      let match = messages.first { message in
        guard message["role"].string == "user", !used.contains(message["id"].string) else {
          return false
        }
        if !pending["receiptSeq"].isNull { return pending["receiptSeq"] == message["seq"] }
        guard message["seq"].int > pending["afterSeq"].int else { return false }
        let files: (JSON) -> [String] = { value in
          value["blocks"].array.compactMap {
            $0["artifactId"].isNull ? nil : $0["artifactId"].string
          }.sorted()
        }
        return plainText(message) == plainText(pending) && files(message) == files(pending)
      }
      if let match {
        used.insert(match["id"].string)
        return false
      }
      return true
    }
  }

  public static func plainText(_ message: JSON) -> String {
    message["blocks"].array.compactMap { block in
      switch block["kind"].string {
      case "text", "ask", "progress", "channel_message": return block["text"].string
      case "subagent":
        return [block["name"].string, block["result"].string, block["progress"].string].filter {
          !$0.isEmpty
        }.joined(separator: " · ")
      case "file", "image": return block["name"].string
      default: return nil
      }
    }.joined(separator: "\n\n")
  }
  public static func running(_ snapshot: JSON) -> Bool {
    let runs = snapshot["activeRuns"].array + (snapshot["run"].isNull ? [] : [snapshot["run"]])
    return runs.contains {
      ["queued", "running", "waiting_input", "waiting_takeover"].contains($0["status"].string)
    }
  }
  public static func append(_ draft: String, transcript: String) -> String {
    let spoken = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !spoken.isEmpty else { return draft }
    return draft.isEmpty
      ? spoken : draft.trimmingCharacters(in: .whitespacesAndNewlines) + " " + spoken
  }
  public static func apply(_ event: JSON, to snapshot: JSON) -> JSON {
    var result = snapshot
    if event["type"].string == "thread.cleared" {
      result["messages"] = []
      return result
    }
    let payload = event["payload"]
    if !payload["message"].isNull {
      let message = payload["message"]
      var messages = result["messages"].array
      if let index = messages.firstIndex(where: { $0["id"] == message["id"] }) {
        messages[index] = message
      } else {
        messages.append(message)
      }
      result["messages"] = .array(messages)
    }
    return result
  }
}
