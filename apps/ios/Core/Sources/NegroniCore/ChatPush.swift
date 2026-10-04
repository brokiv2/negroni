import Foundation

public struct ChatPush: Equatable, Sendable {
  public let botID: String, groupID: String, messageID: String, spaceID: String, threadKind: String
  public init?(_ fields: [String: String]) {
    botID = (fields["botId"] ?? fields["rakazo.botId"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    groupID = (fields["groupId"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    messageID = fields["messageId"] ?? ""
    spaceID = fields["spaceId"] ?? ""
    threadKind = fields["threadKind"] == "personal" ? "personal" : "team"
    guard !botID.isEmpty || !groupID.isEmpty else { return nil }
  }
  public func target(mainBotID: String) -> JSON {
    if !groupID.isEmpty { return ["groupId": .string(groupID)] }
    return ["botId": .string(botID), "threadKind": .string(botID == mainBotID ? "personal" : threadKind)]
  }
}
