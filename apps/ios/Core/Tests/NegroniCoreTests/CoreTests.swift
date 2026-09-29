import XCTest

@testable import NegroniCore

final class CoreTests: XCTestCase {
  func testOptimisticMessagesReconcileWithoutHidingEarlierIdenticalText() {
    let pending: JSON = [
      "id": "local", "role": "user", "afterSeq": 4, "blocks": [["kind": "text", "text": "Hello"]],
    ]
    let old: JSON = ["id": "old", "role": "user", "seq": 4, "blocks": pending["blocks"]]
    let fresh = old.merging(["id": "new", "seq": 5])
    XCTAssertEqual(ThreadLogic.unconfirmed([pending], in: [old]), [pending])
    XCTAssertTrue(ThreadLogic.unconfirmed([pending], in: [old, fresh]).isEmpty)
    XCTAssertEqual(
      ThreadLogic.unconfirmed([pending, pending.merging(["id": "second"])], in: [fresh]).count, 1)
    let acknowledged = pending.merging(["receiptSeq": 6])
    XCTAssertEqual(ThreadLogic.unconfirmed([acknowledged], in: [fresh]).count, 1)
    XCTAssertTrue(ThreadLogic.unconfirmed([acknowledged], in: [fresh.merging(["seq": 6])]).isEmpty)
  }
  func testWorkingIndicatorStopsForCompletionAndWaitingForUser() {
    XCTAssertTrue(ThreadLogic.working(["run": ["status": "queued"]]))
    XCTAssertTrue(ThreadLogic.working(["activeRuns": [["status": "leased"]]]))
    XCTAssertFalse(ThreadLogic.working(["run": ["status": "waiting_input"]]))
    XCTAssertFalse(ThreadLogic.working(["run": .null]))
  }
  func testMarkdownBlocksHideSyntaxButPreserveLiteralCode() {
    let blocks = MarkdownDocument.blocks(
      "### Useful for Negroni\n\n- **Fast** replies\n1. Read [source](https://example.test)\n\n> Quote\n\n```swift\n# literal\n```\n"
    )
    XCTAssertEqual(blocks.map { $0.kind }, ["heading", "list", "list", "quote", "code"])
    XCTAssertEqual(blocks[0].text, "Useful for Negroni")
    XCTAssertEqual(blocks[0].level, 3)
    XCTAssertEqual(blocks[1].prefix, "• ")
    XCTAssertEqual(blocks[4].text, "# literal")
  }

  func testNotificationsStaySilentOnlyForTheVisibleConversation() {
    func suppress(
      _ thread: String?, _ space: String?, visible: String? = "chat-1",
      foreground: Bool = true
    ) -> Bool {
      ChatNotificationPolicy.suppress(
        threadID: thread, spaceID: space, visibleThreadID: visible,
        visibleSpaceID: "space-1", foreground: foreground)
    }
    XCTAssertTrue(suppress("chat-1", "space-1"))
    XCTAssertFalse(suppress("chat-2", "space-1"))
    XCTAssertFalse(suppress("chat-1", "space-2"))
    XCTAssertFalse(suppress("chat-1", "space-1", visible: nil))
    XCTAssertFalse(suppress("chat-1", "space-1", foreground: false))
    XCTAssertFalse(suppress(nil, "space-1"))
    XCTAssertFalse(suppress("chat-1", nil))
    XCTAssertFalse(suppress("", "space-1", visible: ""))
  }
  func testRPCValuesRoundTrip() throws {
    let value: JSON = [
      "json": ["text": "Привет", "enabled": true, "cursor": -1, "items": ["one", .null]]
    ]
    XCTAssertEqual(try JSON.decode(value.encoded()), value)
  }
  func testEndpointRejectsCredentialAndPathInjection() {
    for value in [
      "file:///tmp/key", "https://user:secret@example.test", "https://example.test/rpc",
      "https://example.test?key=secret", "javascript:alert(1)",
    ] { XCTAssertNil(Endpoint.normalize(value)) }
    XCTAssertEqual(
      Endpoint.normalize("http://127.0.0.1:3110/")?.absoluteString, "http://127.0.0.1:3110")
  }
  func testStreamFramesAndKeepAlives() {
    var decoder = SSEDecoder()
    XCTAssertNil(decoder.consume(": keepalive"))
    XCTAssertNil(decoder.consume(""))
    XCTAssertNil(decoder.consume("data: {\"json\":{\"type\":\"message.updated\",\"seq\":12}}"))
    XCTAssertEqual(decoder.consume("")?["seq"].int, 12)
    XCTAssertNil(decoder.consume("data: [DONE]"))
    XCTAssertNil(decoder.consume(""))
  }
  func testRawSSEPreservesDelimitersAndFragmentedUnicode() {
    var decoder = SSEDecoder()
    let wire =
      ": keepalive\r\n\r\nevent: message\r\ndata: {\"json\":{\"seq\":1,\"text\":\"Привет 👋\"}}\r\n\r\ndata: {\"json\":{\"seq\":2}}\n\ndata: [DONE]\n\n"
    let events = wire.utf8.compactMap { decoder.consume(byte: $0) }
    XCTAssertEqual(events.count, 2)
    XCTAssertEqual(events[0]["text"].string, "Привет 👋")
    XCTAssertEqual(events[1]["seq"].int, 2)
  }
  func testTranscriptPreservesDraftAndEmptySpeech() {
    XCTAssertEqual(
      ThreadLogic.append("Existing draft", transcript: " next thought "),
      "Existing draft next thought")
    XCTAssertEqual(ThreadLogic.append(" draft ", transcript: "  "), " draft ")
  }
  func testMessageEventsAreIdempotent() {
    let snapshot: JSON = [
      "messages": [["id": "m1", "blocks": [["kind": "text", "text": "first"]]]]
    ]
    let event: JSON = [
      "type": "message.updated",
      "payload": ["message": ["id": "m1", "blocks": [["kind": "text", "text": "updated"]]]],
    ]
    let next = ThreadLogic.apply(event, to: snapshot)
    XCTAssertEqual(next["messages"].array.count, 1)
    XCTAssertEqual(ThreadLogic.plainText(next["messages"].array[0]), "updated")
    XCTAssertEqual(ThreadLogic.apply(event, to: next), next)
  }
}
