import XCTest

@testable import NegroniCore

final class ResponseUITests: XCTestCase {
  private func fixture() throws -> JSON {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: "ResponseUiFixture", withExtension: "json"))
    return try JSON.decode(Data(contentsOf: url))
  }
  func testSharedVocabularyCalculatesAndValidatesSavedValues() throws {
    let raw = try fixture()
    let document = try XCTUnwrap(ResponseUI(raw))
    XCTAssertEqual(
      Set(document.spec["elements"].dictionary.values.map { $0["type"].string }).count, 18)
    XCTAssertEqual(
      ResponseUI.evaluate(
        document.spec["elements"]["result"]["props"]["value"], state: document.state
      ).uiNumber!, 44, accuracy: 0.00001)
    var saved = document.state
    saved["bill"] = 180
    let reopened = try XCTUnwrap(document.replacingState(saved, revision: 1))
    XCTAssertEqual(ResponseUI(reopened.block)?.state["bill"], 180)
    XCTAssertTrue(reopened.plainText.contains("Bill: 180"))
    XCTAssertTrue(reopened.plainText.contains("Per person: 66"))
    XCTAssertFalse(reopened.plainText.contains("$calc"))
    XCTAssertEqual(
      ResponseUI.evaluate(
        document.spec["elements"]["result"]["props"]["value"], state: reopened.state
      ).uiNumber!, 66, accuracy: 0.00001)
    saved["bill"] = -1
    XCTAssertFalse(document.accepts(saved))
    saved["bill"] = 10001
    XCTAssertFalse(document.accepts(saved))
    saved["bill"] = "180"
    XCTAssertFalse(document.accepts(saved))
    saved = document.state
    saved["other"] = 1
    XCTAssertFalse(document.accepts(saved))
    saved = document.state
    saved["tab"] = 2
    XCTAssertFalse(document.accepts(saved))
    saved = document.state
    saved["currency"] = "invalid"
    XCTAssertFalse(document.accepts(saved))
  }
  func testMalformedOrUnsafeComponentsDegradeAndPartialControlsStayIncomplete() throws {
    let raw = try fixture()
    var value = raw
    value["spec"]["elements"]["root"]["children"] = ["absent"]
    XCTAssertNil(ResponseUI(value))
    value["complete"] = false
    XCTAssertEqual(ResponseUI(value)?.complete, false)
    value = raw
    value["spec"]["elements"]["root"]["children"] = ["root"]
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["elements"]["link"]["props"]["url"] = "javascript:alert(1)"
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["elements"]["intro"]["props"]["html"] = "<script />"
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["elements"]["intro"]["type"] = "HostCommand"
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["elements"]["followup"]["props"]["action"] = [
      "type": "execute", "prompt": "do it",
    ]
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["elements"]["intro"]["visible"] = ["$state": "/missing"]
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["revision"] = .number(1e100)
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["state"]["prototype"] = "unsafe"
    XCTAssertNil(ResponseUI(value))
    value = raw
    value["spec"]["elements"]["diagram"]["props"]["edges"] = [["from": "review", "to": "absent"]]
    XCTAssertNil(ResponseUI(value))
  }
  func testGeneratedDefaultsAndBoundedExpressionsMatchTheOtherClients() throws {
    var raw = try fixture()
    raw["spec"]["elements"]["intro"]["props"] = ["text": "hello"]
    let parsed = try XCTUnwrap(ResponseUI(raw))
    XCTAssertEqual(parsed.spec["elements"]["intro"]["props"]["style"], "body")
    func calc(_ op: String, _ args: [JSON]) -> JSON {
      ["$calc": ["op": .string(op), "args": .array(args)]]
    }
    XCTAssertEqual(ResponseUI.evaluate(calc("round", [.number(-1.5)]), state: [:]), -1)
    XCTAssertEqual(ResponseUI.evaluate(calc("divide", [1, 0]), state: [:]), .null)
    XCTAssertEqual(ResponseUI.evaluate(calc("power", [2, 101]), state: [:]), .null)
    XCTAssertEqual(
      ResponseUI.evaluate(calc("multiply", [.number(1e308), .number(1e308)]), state: [:]), .null)
    XCTAssertEqual(ResponseUI.evaluate(calc("add", ["1", 1]), state: [:]), .null)
    XCTAssertEqual(ResponseUI.evaluate(calc("not", [""]), state: [:]), true)
    XCTAssertEqual(ResponseUI.evaluate(calc("equal", [false, 0]), state: [:]), false)
    XCTAssertEqual(ResponseUI.evaluate(calc("clamp", [20, 1, 10]), state: [:]), 10)
    XCTAssertNil(JSON.number(.infinity).uiInteger)
    XCTAssertNil(JSON.number(1e100).uiInteger)
    XCTAssertFalse(ResponseUI.format(.number(99.00000000001)).contains("0000000"))
  }
  @MainActor func testEditsDuringFlightAreSerializedAndRemoteConflictsPreserveTheDraft()
    async throws
  {
    let document = try XCTUnwrap(ResponseUI(fixture()))
    var attempts: [(Int, [String: JSON])] = []
    var continuation: CheckedContinuation<ResponseUI, Error>?
    let session = ResponseUIState(document) { revision, values in
      attempts.append((revision, values))
      if attempts.count == 1 {
        return try await withCheckedThrowingContinuation { continuation = $0 }
      }
      return document.replacingState(values, revision: revision + 1)!
    }
    var first = document.state
    first["bill"] = 180
    var second = document.state
    second["bill"] = 240
    XCTAssertTrue(session.change(first))
    let saving = Task { await session.flush() }
    while continuation == nil { await Task.yield() }
    XCTAssertTrue(session.change(second))
    session.receive(document.replacingState(first, revision: 1)!)  // event before RPC acknowledgement
    continuation!.resume(returning: document.replacingState(first, revision: 1)!)
    await saving.value
    XCTAssertEqual(attempts.map { $0.0 }, [0, 1])
    XCTAssertEqual(session.document.revision, 2)
    XCTAssertEqual(session.state["bill"], 240)
    XCTAssertFalse(session.dirty)
    XCTAssertTrue(session.change(first))
    session.receive(document.replacingState(second, revision: 3)!)
    XCTAssertEqual(session.error, "conflict")
    XCTAssertEqual(session.state["bill"], 180)
    await session.flush()
    XCTAssertEqual(attempts.count, 2)
    session.reload(document.replacingState(second, revision: 3)!)
    XCTAssertNil(session.error)
    XCTAssertEqual(session.state["bill"], 240)
  }
  @MainActor func testLostAcknowledgementRetriesTheSameWriteBeforeNewerEdits() async throws {
    let document = try XCTUnwrap(ResponseUI(fixture()))
    var attempts: [(Int, [String: JSON])] = []
    let session = ResponseUIState(document) { revision, values in
      attempts.append((revision, values))
      if attempts.count == 1 { throw URLError(.networkConnectionLost) }
      return document.replacingState(values, revision: revision + 1)!
    }
    var first = document.state
    first["bill"] = 180
    var second = document.state
    second["bill"] = 240
    XCTAssertTrue(session.change(first))
    await session.flush()
    XCTAssertEqual(session.error, "save")
    XCTAssertTrue(session.change(second))
    await session.retry()
    XCTAssertEqual(attempts.map { $0.0 }, [0, 0, 1])
    XCTAssertEqual(attempts[0].1, attempts[1].1)
    XCTAssertEqual(session.state["bill"], 240)
    XCTAssertNil(session.error)
    XCTAssertFalse(session.dirty)
  }
  func testStateEventsKeepMessageChronologyAndDoNotCreateNewMessages() throws {
    let message: JSON = [
      "id": "reply", "seq": 2, "role": "bot", "runId": "ended", "createdAt": "earlier",
      "blocks": [try fixture()],
    ]
    let snapshot: JSON = ["messages": [message], "run": ["id": "active", "status": "running"]]
    var block = try fixture()
    block["revision"] = 1
    let event: JSON = [
      "type": "thread.message.updated", "seq": 99,
      "payload": ["messageId": "reply", "blocks": [block]],
    ]
    let updated = ThreadLogic.apply(event, to: snapshot)
    XCTAssertEqual(updated["messages"].array.count, 1)
    XCTAssertEqual(updated["messages"].array[0]["seq"], 2)
    XCTAssertEqual(updated["messages"].array[0]["createdAt"], "earlier")
    XCTAssertEqual(updated["messages"].array[0]["runId"], "ended")
    XCTAssertEqual(updated["run"], snapshot["run"])
    XCTAssertTrue(
      ThreadLogic.onlyResponseStateChanged(old: [message], new: updated["messages"].array))
    XCTAssertFalse(ThreadLogic.onlyResponseStateChanged(old: [message], new: [message]))
    var reordered = updated["messages"].array[0]
    reordered["seq"] = 99
    XCTAssertFalse(ThreadLogic.onlyResponseStateChanged(old: [message], new: [reordered]))
    var newProse = updated["messages"].array[0]
    newProse["blocks"] = .array(
      newProse["blocks"].array + [["kind": "text", "text": "New answer"]])
    XCTAssertFalse(ThreadLogic.onlyResponseStateChanged(old: [message], new: [newProse]))
    XCTAssertTrue(ThreadLogic.plainText(updated["messages"].array[0]).hasPrefix("Dinner budget\n"))
    var unknown = event
    unknown["payload"]["messageId"] = "absent"
    XCTAssertEqual(ThreadLogic.apply(unknown, to: snapshot), snapshot)
  }
  func testNewStreamAndActivityRowsPreserveExistingMessageIdentities() {
    let old: [JSON] = [["id": "response"], ["id": "question"]]
    let new = old + [["id": "progress:next"]]
    XCTAssertEqual(
      ChatTimeline.changes(
        old: [.message(0), .message(1)], oldMessages: old,
        new: [.message(0), .message(1), .actions, .message(2), .status], newMessages: new)?.removed,
      [])
    XCTAssertEqual(
      ChatTimeline.changes(
        old: [.message(0), .message(1)], oldMessages: old,
        new: [.message(0), .message(1), .actions, .message(2), .status], newMessages: new)?
        .inserted, [2, 3, 4])
    XCTAssertEqual(
      ChatTimeline.changes(
        old: [.message(0), .actions, .status], oldMessages: old,
        new: [.message(0)], newMessages: old)?.removed, [1, 2])
    XCTAssertNil(
      ChatTimeline.changes(
        old: [.message(0), .message(0)], oldMessages: old,
        new: [], newMessages: []))
  }
}
