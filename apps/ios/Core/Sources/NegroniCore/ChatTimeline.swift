import Foundation

public enum ChatTimelineRow: Equatable, Sendable {
  case message(Int)
  case actions, status
}

public enum ChatTimeline {
  public struct Changes: Equatable, Sendable {
    public let removed: [Int]
    public let inserted: [Int]
  }
  /// Stable message identities let a new stream row arrive without replacing existing controls.
  public static func changes(
    old: [ChatTimelineRow], oldMessages: [JSON], new: [ChatTimelineRow], newMessages: [JSON]
  ) -> Changes? {
    func keys(_ rows: [ChatTimelineRow], _ messages: [JSON]) -> [String]? {
      var result: [String] = []
      for row in rows {
        switch row {
        case .message(let index):
          guard messages.indices.contains(index), !messages[index]["id"].string.isEmpty else {
            return nil
          }
          result.append("message:" + messages[index]["id"].string)
        case .actions: result.append("actions")
        case .status: result.append("status")
        }
      }
      return Set(result).count == result.count ? result : nil
    }
    guard let previous = keys(old, oldMessages), let next = keys(new, newMessages) else {
      return nil
    }
    let difference = next.difference(from: previous)
    var removed: [Int] = []
    var inserted: [Int] = []
    for change in difference {
      switch change {
      case .remove(let offset, _, _): removed.append(offset)
      case .insert(let offset, _, _): inserted.append(offset)
      }
    }
    return Changes(removed: removed.sorted(), inserted: inserted.sorted())
  }
  public static func rows(messages: [JSON], runID: String, actions: Bool, status: Bool)
    -> [ChatTimelineRow]
  {
    let insertion =
      messages.firstIndex {
        $0["role"].string != "user" && !runID.isEmpty && $0["runId"].string == runID
      } ?? messages.count
    var result: [ChatTimelineRow] = []
    for index in 0...messages.count {
      if actions && index == insertion { result.append(.actions) }
      if index < messages.count { result.append(.message(index)) }
    }
    if status { result.append(.status) }
    return result
  }
}

extension ThreadLogic {
  public static func onlyResponseStateChanged(old: [JSON], new: [JSON]) -> Bool {
    guard old.count == new.count else { return false }
    var changed = false
    for (a, b) in zip(old, new) {
      guard a["id"] == b["id"], a["blocks"].array.count == b["blocks"].array.count else {
        return false
      }
      var strippedA = a
      var strippedB = b
      var blocksA = a["blocks"].array
      var blocksB = b["blocks"].array
      for index in blocksA.indices {
        if blocksA[index] != blocksB[index] {
          guard let first = ResponseUI(blocksA[index]), let second = ResponseUI(blocksB[index]),
            first.id == second.id, first.spec == second.spec, first.complete == second.complete
          else { return false }
          changed = true
          blocksA[index] = .null
          blocksB[index] = .null
        }
      }
      strippedA["blocks"] = .array(blocksA)
      strippedB["blocks"] = .array(blocksB)
      guard strippedA == strippedB else { return false }
    }
    return changed
  }
}
