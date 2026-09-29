import XCTest

@testable import NegroniCore

final class CoreTests: XCTestCase {
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
