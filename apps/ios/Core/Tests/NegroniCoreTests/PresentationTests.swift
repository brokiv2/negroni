import XCTest
@testable import NegroniCore

final class PresentationTests: XCTestCase {
  func testPushTargetsAreValidatedAndPreserveGroupOrPersonalChat() {
    XCTAssertNil(ChatPush([:]))
    XCTAssertNil(ChatPush(["groupId": " ", "botId": ""]))
    XCTAssertEqual(ChatPush(["botId": "main", "messageId": "message"])?.target(mainBotID: "main"),
      ["botId": "main", "threadKind": "personal"])
    XCTAssertEqual(ChatPush(["rakazo.botId": "other"])?.target(mainBotID: "main"),
      ["botId": "other", "threadKind": "team"])
    XCTAssertEqual(ChatPush(["groupId": "room", "botId": "other"])?.target(mainBotID: "main"),
      ["groupId": "room"])
  }
  func testActionsPrecedeTheCurrentReplyAndChoices() {
    let messages: [JSON] = [
      ["id": "old", "role": "bot", "runId": "old"],
      ["id": "user", "role": "user"],
      ["id": "result", "role": "bot", "runId": "current"],
      ["id": "question", "role": "bot", "runId": "current"],
    ]
    XCTAssertEqual(ChatTimeline.rows(messages: messages, runID: "current", actions: true, status: false),
      [.message(0), .message(1), .actions, .message(2), .message(3)])
    XCTAssertEqual(ChatTimeline.rows(messages: [], runID: "current", actions: false, status: true), [.status])
    XCTAssertEqual(ChatTimeline.rows(messages: Array(messages.prefix(2)), runID: "current", actions: true, status: true),
      [.message(0), .message(1), .actions, .status])
  }
  func testQuotesWithBlankLinesHideAllMarkdownMarkers() {
    let blocks = MarkdownDocument.blocks("## Draft\n\n> First **paragraph**\n>\n> Second paragraph\n\nDone")
    XCTAssertEqual(blocks.map(\.kind), ["heading", "quote", "paragraph"])
    XCTAssertEqual(blocks[1].text, "First **paragraph**\n\nSecond paragraph")
    XCTAssertEqual(blocks[1].prefix, "")
  }
  func testDownloadedReportsGetTheirMimeExtensionWithoutPathTraversal() {
    XCTAssertEqual(AttachmentPreview.filename(name: "Report", suggested: "Report", mimeType: "text/markdown"), "Report.md")
    XCTAssertEqual(AttachmentPreview.filename(name: "Report", suggested: "report.pdf", mimeType: "application/pdf"), "report.pdf")
    XCTAssertEqual(AttachmentPreview.filename(name: "../Report.md", suggested: nil, mimeType: "text/plain"), "Report.md")
    XCTAssertEqual(AttachmentPreview.filename(name: "", suggested: nil, mimeType: "text/plain; charset=utf-8"), "Attachment.txt")
    XCTAssertTrue(AttachmentPreview.text(URL(fileURLWithPath: "/tmp/Report.md")))
    XCTAssertFalse(AttachmentPreview.text(URL(fileURLWithPath: "/tmp/Report.pdf")))
  }
}
