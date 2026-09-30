import Foundation

public enum ConnectionIntent {
  /// The original question remains the reply target even after other messages or
  /// pagination. Replaying this receipt never starts a second continuation run.
  public static func continuation(message: JSON, block: JSON, target: JSON) -> JSON? {
    guard !block["requestId"].string.isEmpty else { return nil }
    var input = target.merging([
      "text": .string(
        "Connected " + block["name"].string + ". Continue the request that needed this connection."),
      "clientNonce": .string("connected:" + message["id"].string + ":" + block["provider"].string),
      "replyToMessageId": block["sourceMessageId"].string.isEmpty
        ? message["id"] : block["sourceMessageId"],
    ])
    if !target["groupId"].string.isEmpty, !message["botId"].string.isEmpty {
      input["mentions"] = .array([message["botId"]])
    }
    return input
  }
}
