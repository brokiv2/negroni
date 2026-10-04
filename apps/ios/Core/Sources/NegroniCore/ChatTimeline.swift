import Foundation

public enum ChatTimelineRow: Equatable, Sendable {
  case message(Int), actions, status
}

public enum ChatTimeline {
  public static func rows(messages: [JSON], runID: String, actions: Bool, status: Bool) -> [ChatTimelineRow] {
    let insertion = messages.firstIndex {
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
