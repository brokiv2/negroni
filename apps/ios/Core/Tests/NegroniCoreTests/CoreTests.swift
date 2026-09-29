import XCTest

@testable import NegroniCore

final class CoreTests: XCTestCase {
  func testNotificationsStaySilentOnlyForTheVisibleConversation() {
    func suppress(_ thread: String?, _ space: String?, visible: String? = "chat-1",
                  foreground: Bool = true) -> Bool {
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
