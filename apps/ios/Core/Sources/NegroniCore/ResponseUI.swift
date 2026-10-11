import Foundation

extension JSON {
  public var uiNumber: Double? {
    if case .number(let value) = self, value.isFinite { return value }
    return nil
  }
  public var uiInteger: Int? {
    guard let value = uiNumber, value.rounded(.towardZero) == value,
      value > Double(Int.min), value < Double(Int.max)
    else { return nil }
    return Int(value)
  }
  public var uiTruthy: Bool {
    switch self {
    case .null: return false
    case .bool(let value): return value
    case .number(let value): return value != 0 && value.isFinite
    case .string(let value): return !value.isEmpty
    default: return true
    }
  }
}

/// A bounded, validated document shared with the other clients. No generated code is executed.
public struct ResponseUI: Equatable, Sendable {
  public let block: JSON
  public let spec: JSON
  public let id: String
  public let revision: Int
  public let complete: Bool
  public let state: [String: JSON]
  public var summary: String { block["summary"].string }
  private static let catalog: JSON = {
    guard let url = Bundle.module.url(forResource: "ResponseUiCatalog", withExtension: "json"),
      let data = try? Data(contentsOf: url), let json = try? JSON.decode(data)
    else { return .null }
    return json
  }()
  private static let containers = Set(["Stack", "Grid", "Card", "Disclosure", "Tabs"])
  private static let unsafe = Set(["constructor", "prototype", "__proto__"])
  private static func key(_ value: String) -> Bool {
    !unsafe.contains(value)
      && value.range(of: "^[A-Za-z][A-Za-z0-9_-]{0,63}$", options: .regularExpression) != nil
  }
  private static func scalar(_ value: JSON) -> Bool {
    switch value {
    case .string(let value): return value.utf16.count <= 4_000
    case .number(let value): return value.isFinite
    case .null, .bool: return true
    default: return false
    }
  }
  private static func bounded(_ value: JSON, depth: Int = 0) -> Bool {
    guard depth <= 24 else { return false }
    switch value {
    case .object(let fields):
      return fields.count <= 1_000
        && fields.allSatisfy { !unsafe.contains($0.key) && bounded($0.value, depth: depth + 1) }
    case .array(let items):
      return items.count <= 1_000 && items.allSatisfy { bounded($0, depth: depth + 1) }
    case .string(let text): return text.utf16.count <= 128_000
    default: return scalar(value)
    }
  }
  public init?(_ value: JSON) {
    guard Self.bounded(value["spec"]), let bytes = try? value["spec"].encoded(),
      bytes.count <= 128_000,
      value["kind"].string == "response_ui", Self.key(value["id"].string),
      !value["summary"].string.isEmpty, value["summary"].string.utf16.count <= 280
    else { return nil }
    let revision = value.dictionary["revision"] ?? 0
    let complete = value.dictionary["complete"] ?? true
    guard let rev = revision.uiInteger, rev >= 0, case .bool(let done) = complete else {
      return nil
    }
    var spec = value["spec"]
    guard case .object = spec,
      Set(spec.dictionary.keys).isSubset(of: ["root", "elements", "state", "summary"]),
      Self.key(spec["root"].string), !spec["summary"].string.isEmpty,
      spec["summary"].string.utf16.count <= 280, case .object(let rawElements) = spec["elements"],
      !rawElements.isEmpty, rawElements.count <= 160
    else { return nil }
    if spec.dictionary["state"] == nil { spec["state"] = [:] }
    guard case .object(let initial) = spec["state"], initial.count <= 64,
      initial.allSatisfy({ Self.key($0.key) && Self.scalar($0.value) })
    else { return nil }
    var elements: [String: JSON] = [:]
    for (key, raw) in rawElements {
      guard Self.key(key), case .object = raw,
        Set(raw.dictionary.keys).isSubset(of: ["type", "props", "children", "visible"]),
        let schema = Self.catalog["components"].dictionary[raw["type"].string],
        let props = Self.normalize(raw["props"], schema: schema, root: schema)
      else { return nil }
      var element = raw
      element["props"] = props
      if raw.dictionary["children"] == nil { element["children"] = [] }
      guard case .array(let children) = element["children"], children.count <= 64,
        children.allSatisfy({ Self.key($0.string) }),
        children.isEmpty || Self.containers.contains(element["type"].string)
      else { return nil }
      if let visible = raw.dictionary["visible"] {
        let expression = Self.catalog["expression"]
        guard Self.normalize(visible, schema: expression, root: expression) != nil else {
          return nil
        }
      }
      if done && !Self.referencesExist(element, state: initial) { return nil }
      if element["type"].string == "Link" {
        guard let url = URL(string: props["url"].string),
          ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          url.host != nil
        else { return nil }
      }
      if element["type"].string == "Tabs", props["labels"].array.count != children.count {
        return nil
      }
      if element["type"].string == "Table",
        props["rows"].array.contains(where: { $0.array.count != props["columns"].array.count })
      {
        return nil
      }
      if element["type"].string == "Diagram" {
        let nodes = props["nodes"].array.map { $0["id"].string }
        let keys = Set(nodes)
        guard keys.count == nodes.count,
          props["edges"].array.allSatisfy({
            keys.contains($0["from"].string) && keys.contains($0["to"].string)
          })
        else { return nil }
      }
      elements[key] = element
    }
    guard elements[spec["root"].string] != nil else { return nil }
    var visiting = Set<String>()
    var heights: [String: Int] = [:]
    func height(_ id: String, depth: Int) -> Int {
      if depth > 20 || visiting.contains(id) { return 100 }
      if let cached = heights[id] { return cached }
      guard let element = elements[id] else { return done ? 100 : 0 }
      visiting.insert(id)
      let result =
        1 + (element["children"].array.map { height($0.string, depth: depth + 1) }.max() ?? 0)
      visiting.remove(id)
      heights[id] = result
      return result
    }
    guard elements.keys.allSatisfy({ height($0, depth: 0) <= 20 }) else { return nil }
    spec["elements"] = .object(elements)
    guard Self.validateState(spec, initial, partial: !done) else { return nil }
    let current: [String: JSON]
    if let provided = value.dictionary["state"] {
      guard case .object(let fields) = provided, Self.validateState(spec, fields, partial: !done)
      else { return nil }
      current = fields
    } else {
      current = initial
    }
    if done {
      for element in elements.values where element["type"].string == "Button" {
        let action = element["props"]["action"]
        if action["type"].string == "set" {
          var candidate = initial
          candidate[String(action["path"].string.dropFirst())] = action["value"]
          guard Self.validateState(spec, candidate, partial: false) else { return nil }
        }
      }
    }
    self.id = value["id"].string
    self.revision = rev
    self.complete = done
    self.spec = spec
    self.state = current
    self.block = value.merging([
      "spec": spec, "revision": .number(Double(rev)), "complete": .bool(done),
    ])
  }
  public func accepts(_ state: [String: JSON]) -> Bool {
    Self.validateState(spec, state, partial: !complete)
  }
  public func replacingState(_ state: [String: JSON], revision: Int) -> ResponseUI? {
    ResponseUI(block.merging(["state": .object(state), "revision": .number(Double(revision))]))
  }
  private static func referencesExist(_ value: JSON, state: [String: JSON]) -> Bool {
    switch value {
    case .array(let items): return items.allSatisfy { referencesExist($0, state: state) }
    case .object(let fields):
      if let path = fields["$state"], state[String(path.string.dropFirst())] == nil { return false }
      return fields.values.allSatisfy { referencesExist($0, state: state) }
    default: return true
    }
  }
  private static func validateState(_ spec: JSON, _ state: [String: JSON], partial: Bool) -> Bool {
    let initial = spec["state"].dictionary
    guard Set(initial.keys) == Set(state.keys) else { return false }
    func sameType(_ a: JSON, _ b: JSON) -> Bool {
      switch (a, b) {
      case (.null, .null), (.number, .number), (.bool, .bool), (.string, .string): return true
      default: return false
      }
    }
    guard initial.allSatisfy({ sameType($0.value, state[$0.key]!) && scalar(state[$0.key]!) })
    else { return false }
    func read(_ path: JSON) -> JSON? { state[String(path.string.dropFirst())] }
    for element in spec["elements"].dictionary.values {
      let p = element["props"]
      let type = element["type"].string
      let value = read(p["bind"])
      if ["Input", "Slider", "Select"].contains(type), value == nil {
        if partial { continue }
        return false
      }
      if ["Input", "Slider"].contains(type) {
        if type == "Input" && p["input"].string == "text" {
          guard case .string = value else { return false }
        } else {
          guard let number = value?.uiNumber, p["min"].uiNumber.map({ number >= $0 }) ?? true,
            p["max"].uiNumber.map({ number <= $0 }) ?? true
          else { return false }
        }
        if let min = p["min"].uiNumber, let max = p["max"].uiNumber, min > max { return false }
      }
      if type == "Select", !p["options"].array.contains(where: { $0["value"] == value }) {
        return false
      }
      if type == "Checklist",
        !p["items"].array.allSatisfy({
          if case .bool = read($0["bind"]) { return true }
          return false
        })
      {
        return false
      }
      if type == "Disclosure", !p["bind"].isNull, case .bool = value {
      } else if type == "Disclosure" && !p["bind"].isNull {
        return false
      }
      if type == "Tabs", !p["bind"].isNull {
        guard let index = value?.uiInteger, index >= 0, index < p["labels"].array.count else {
          return false
        }
      }
    }
    return true
  }
  /// Supports only the JSON Schema constructs emitted by the shared component catalog.
  private static func normalize(_ value: JSON, schema: JSON, root: JSON, depth: Int = 0) -> JSON? {
    guard depth < 100 else { return nil }
    if !schema["$ref"].isNull {
      guard schema["$ref"].string.hasPrefix("#/") else { return nil }
      let target = schema["$ref"].string.dropFirst(2).split(separator: "/").reduce(root) {
        $0[String($1)]
      }
      return normalize(value, schema: target, root: root, depth: depth + 1)
    }
    for key in ["anyOf", "oneOf"] where !schema[key].isNull {
      return schema[key].array.lazy.compactMap {
        normalize(value, schema: $0, root: root, depth: depth + 1)
      }.first
    }
    if let constant = schema.dictionary["const"], value != constant { return nil }
    if !schema["enum"].isNull && !schema["enum"].array.contains(value) { return nil }
    switch schema["type"].string {
    case "null": return value.isNull ? value : nil
    case "boolean":
      if case .bool = value { return value }
      return nil
    case "number", "integer":
      guard let number = value.uiNumber,
        schema["type"].string != "integer" || value.uiInteger != nil,
        schema["minimum"].uiNumber.map({ number >= $0 }) ?? true,
        schema["maximum"].uiNumber.map({ number <= $0 }) ?? true,
        schema["exclusiveMinimum"].uiNumber.map({ number > $0 }) ?? true
      else { return nil }
      return value
    case "string":
      guard case .string(let text) = value,
        schema["minLength"].uiNumber.map({ Double(text.utf16.count) >= $0 }) ?? true,
        schema["maxLength"].uiNumber.map({ Double(text.utf16.count) <= $0 }) ?? true
      else { return nil }
      if !schema["pattern"].isNull,
        text.range(of: schema["pattern"].string, options: .regularExpression) == nil
      {
        return nil
      }
      return value
    case "array":
      guard case .array(let items) = value,
        schema["minItems"].uiNumber.map({ Double(items.count) >= $0 }) ?? true,
        schema["maxItems"].uiNumber.map({ Double(items.count) <= $0 }) ?? true
      else { return nil }
      var normalized: [JSON] = []
      for item in items {
        guard let next = normalize(item, schema: schema["items"], root: root, depth: depth + 1)
        else { return nil }
        normalized.append(next)
      }
      return .array(normalized)
    case "object":
      guard case .object(var fields) = value else { return nil }
      let properties = schema["properties"].dictionary
      if schema["additionalProperties"] == false
        && !Set(fields.keys).isSubset(of: Set(properties.keys))
      {
        return nil
      }
      for (key, property) in properties {
        if fields[key] == nil, let initial = property.dictionary["default"] {
          fields[key] = initial
        }
        if let raw = fields[key] {
          guard let next = normalize(raw, schema: property, root: root, depth: depth + 1) else {
            return nil
          }
          fields[key] = next
        }
      }
      guard schema["required"].array.allSatisfy({ fields[$0.string] != nil }) else { return nil }
      return .object(fields)
    default: return nil
    }
  }
  public var plainText: String {
    var lines = [summary]
    var visited = Set<String>()
    func text(_ expression: JSON) -> String { Self.format(Self.evaluate(expression, state: state)) }
    func walk(_ id: String) {
      guard visited.insert(id).inserted, let element = spec["elements"].dictionary[id] else {
        return
      }
      if let visible = element.dictionary["visible"], !Self.evaluate(visible, state: state).uiTruthy
      {
        return
      }
      let p = element["props"]
      switch element["type"].string {
      case "Text": lines.append(text(p["text"]))
      case "Metric":
        lines.append(
          "\(p["label"].string): \(text(p["value"]))\(p["unit"].string.isEmpty ? "" : " " + p["unit"].string)"
        )
      case "Input", "Slider", "Select":
        lines.append(
          "\(p["label"].string): \(Self.format(state[String(p["bind"].string.dropFirst())] ?? .null))"
        )
      case "Checklist":
        for item in p["items"].array {
          lines.append(
            "\(state[String(item["bind"].string.dropFirst())]?.bool == true ? "☑" : "☐") \(item["label"].string)"
          )
        }
      case "Link": lines.append("\(p["label"].string): \(p["url"].string)")
      case "Table":
        lines.append(p["columns"].array.map(\.string).joined(separator: " | "))
        for row in p["rows"].array { lines.append(row.array.map(text).joined(separator: " | ")) }
      case "Chart":
        lines.append(p["title"].string)
        for series in p["series"].array {
          lines.append(series["label"].string)
          for point in series["points"].array {
            lines.append("\(Self.format(point["x"])): \(text(point["y"]))")
          }
        }
      case "Diagram":
        let nodes = p["nodes"].array
        let names = Dictionary(
          uniqueKeysWithValues: nodes.map { ($0["id"].string, $0["label"].string) })
        for node in nodes {
          lines.append(
            [node["label"].string, node["detail"].string].filter { !$0.isEmpty }.joined(
              separator: ": "))
        }
        for edge in p["edges"].array {
          lines.append("\(names[edge["from"].string] ?? "") → \(names[edge["to"].string] ?? "")")
        }
      case "Timeline":
        for item in p["items"].array {
          lines.append(
            [item["label"].string, item["detail"].string].filter { !$0.isEmpty }.joined(
              separator: ": "))
        }
      case "Progress":
        lines.append("\(p["label"].string): \(text(p["value"])) / \(Self.format(p["max"]))")
      case "Card", "Disclosure":
        if !p["title"].string.isEmpty { lines.append(p["title"].string) }
        if !p["description"].string.isEmpty { lines.append(p["description"].string) }
      default: break
      }
      for child in element["children"].array { walk(child.string) }
    }
    walk(spec["root"].string)
    return String(lines.joined(separator: "\n").prefix(16_000))
  }
  public static func evaluate(_ expression: JSON, state: [String: JSON], depth: Int = 0) -> JSON {
    guard depth <= 16 else { return .null }
    if scalar(expression) { return expression }
    if !expression["$state"].isNull {
      return state[String(expression["$state"].string.dropFirst())] ?? .null
    }
    let calc = expression["$calc"]
    let op = calc["op"].string
    let values = calc["args"].array.map { evaluate($0, state: state, depth: depth + 1) }
    if op == "equal" { return .bool(values.count == 2 && values[0] == values[1]) }
    if op == "not" { return values.count == 1 ? .bool(!values[0].uiTruthy) : .null }
    if op == "and" { return .bool(values.allSatisfy(\.uiTruthy)) }
    if op == "or" { return .bool(values.contains(where: \.uiTruthy)) }
    let numbers = values.compactMap(\.uiNumber)
    guard !numbers.isEmpty, numbers.count == values.count else { return .null }
    let a = numbers[0]
    let b = numbers.count > 1 ? numbers[1] : 0
    var result: Double?
    switch op {
    case "add": result = numbers.reduce(0, +)
    case "multiply": result = numbers.reduce(1, *)
    case "subtract": if numbers.count == 2 { result = a - b }
    case "divide": if numbers.count == 2 && b != 0 { result = a / b }
    case "power": if numbers.count == 2 && abs(b) <= 100 { result = pow(a, b) }
    case "round": if numbers.count == 1 { result = floor(a + 0.5) }
    case "min": result = numbers.min()
    case "max": result = numbers.max()
    case "clamp": if numbers.count == 3 { result = max(b, min(numbers[2], a)) }
    case "greater": return numbers.count == 2 ? .bool(a > b) : .null
    case "less": return numbers.count == 2 ? .bool(a < b) : .null
    default: break
    }
    return result.flatMap { $0.isFinite ? .number($0) : nil } ?? .null
  }
  public static func format(_ value: JSON, decimals: Int? = nil) -> String {
    switch value {
    case .null: return "—"
    case .string(let text): return text
    case .bool(let flag): return String(flag)
    case .number(let number):
      guard number.isFinite else { return "—" }
      let formatter = NumberFormatter()
      formatter.numberStyle = .decimal
      if let decimals {
        formatter.minimumFractionDigits = max(0, min(6, decimals))
        formatter.maximumFractionDigits = formatter.minimumFractionDigits
      } else {
        formatter.usesSignificantDigits = true
        formatter.maximumSignificantDigits = 12
      }
      return formatter.string(from: NSNumber(value: number)) ?? "—"
    default: return "—"
    }
  }
}
