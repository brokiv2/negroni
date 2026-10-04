import XCTest

@testable import NegroniCore

final class RadarTests: XCTestCase {
  private let update: JSON = [
    "kind": "update", "summary": "A colleague needs the budget figures by 15:00.",
    "updateId": "signal-1", "source": "gmail", "title": "Budget figures due today",
    "actor": ["name": "A colleague", "address": "colleague@example.test"],
    "why": "They need the figures before the 15:00 review.", "nextStep": "Send the spreadsheet.",
    "url": "https://mail.example.test/thread/1", "urgency": "today", "action": "reply",
    "occurredAt": "2026-10-04T09:12:00.000Z", "offer": "Draft a reply with the figures?",
    "evidence": "Could you send the budget figures before the review?",
  ]
  private let utc = TimeZone(identifier: "UTC")!
  private let helsinki = TimeZone(identifier: "Europe/Helsinki")!
  private let british = Locale(identifier: "en_GB")
  private func date(_ value: String) -> Date { RadarTime.parse(value)! }

  func testUpdateBlocksDecodeForTheCardAndRefuseOtherLinks() {
    let item = RadarItem(update)!
    XCTAssertEqual(item.id, "signal-1")
    XCTAssertEqual(item.sender, "A colleague")
    XCTAssertTrue(item.hasSenderAddress)
    XCTAssertEqual(item.url?.host, "mail.example.test")
    XCTAssertEqual(item.occurredAt, date("2026-10-04T09:12:00Z"))
    XCTAssertEqual(item.kind, "", "a block's kind is the block kind, not the signal kind")
    XCTAssertEqual(item.primary, RadarPrimary(title: "Draft a reply with the figures", kind: .send))
    for link in ["javascript:alert(1)", "file:///etc/hosts", "mailto:a@example.test", "https://"] {
      XCTAssertNil(RadarItem(update.merging(["url": .string(link)]))?.url, link)
    }
    XCTAssertNil(RadarItem(update.merging(["title": "  "])))
    XCTAssertNil(RadarItem(update.merging(["updateId": .null])))
    let anonymous = RadarItem(update.merging(["actor": ["name": "Billing"]]))!
    XCTAssertEqual(anonymous.sender, "Billing")
    XCTAssertFalse(anonymous.hasSenderAddress)
  }

  func testThePrimaryButtonUsesTheOfferOrFallsBackByAction() {
    XCTAssertEqual(Radar.instruction("  Propose 11:00 instead? "), "Propose 11:00 instead")
    XCTAssertEqual(Radar.instruction("¿Respondo que sí?"), "Respondo que sí")
    XCTAssertEqual(Radar.instruction("Перенести встречу？"), "Перенести встречу")
    XCTAssertEqual(Radar.instruction("?"), "")
    func primary(_ action: String, link: Bool) -> RadarPrimary {
      RadarPrimary(offer: " ? ", action: action, hasURL: link)
    }
    XCTAssertEqual(primary("reply", link: true), RadarPrimary(title: "Draft reply", kind: .send))
    XCTAssertEqual(primary("decide", link: true), RadarPrimary(title: "Handle it", kind: .send))
    XCTAssertEqual(primary("review", link: true), RadarPrimary(title: "Open", kind: .open))
    XCTAssertEqual(primary("", link: true), RadarPrimary(title: "Open", kind: .open))
    XCTAssertEqual(primary("attend", link: false), RadarPrimary(title: "Handle it", kind: .send))
  }

  func testUpdateViewsCarryTheTraceAndKeepCardOnlyFields() {
    let view: JSON = [
      "id": "signal-1", "source": "Gmail", "kind": "email", "title": "Budget figures due today",
      "occurredAt": "2026-10-04T09:12:00.000Z", "excerpt": "", "state": "open",
      "disposition": "interrupt", "importance": 82, "messageId": "message-1",
      "trace": [
        "importance": 82, "scores": ["addressed": 3, "stakes": 2, "seen": 3],
        "thresholds": ["interrupt": 70, "brief": 45], "rules": ["rule-1", ""],
        "gates": ["quiet_hours"], "result": "interrupt", "confidence": .number(0.9),
      ],
    ]
    let full = RadarItem(view)!
    XCTAssertEqual(full.source, "gmail")
    XCTAssertEqual(full.kind, "email")
    XCTAssertEqual(full.trace?.scores, ["addressed": 3, "stakes": 2, "seen": 3])
    XCTAssertEqual(full.trace?.interruptAt, 70)
    XCTAssertEqual(full.trace?.rules, ["rule-1"])
    XCTAssertNil(RadarItem(view.merging(["trace": "corrupt"]))?.trace)
    let merged = RadarItem(update)!.merged(with: full)
    XCTAssertEqual(merged.offer, "Draft a reply with the figures?")
    XCTAssertEqual(merged.evidence, "Could you send the budget figures before the review?")
    XCTAssertEqual(merged.messageID, "message-1")
    XCTAssertEqual(merged.disposition, "interrupt")
    XCTAssertNotNil(merged.trace)
  }

  func testBriefsShowSevenRowsThenMoreAndASortedAgenda() {
    let items: [JSON] = (1...9).map {
      ["updateId": .string("u\($0)"), "title": .string("Item \($0)"), "source": "gmail"]
    }
    let brief = RadarBrief([
      "kind": "brief", "summary": "Two things need you today.", "briefId": "brief-1",
      "period": "morning", "title": "Morning brief", "items": .array(items + [["title": "No id"]]),
      "agenda": [
        ["title": "Review", "start": "2026-10-04T12:00:00.000Z", "end": "2026-10-04T13:00:00Z"],
        ["title": "Standup", "start": "2026-10-04T07:30:00Z", "allDay": false],
        ["title": "", "start": "2026-10-04T08:00:00Z"], ["title": "No start"],
      ],
    ])!
    XCTAssertEqual(brief.items.count, 9)
    XCTAssertEqual(brief.visibleItems(expanded: false).map(\.id), (1...7).map { "u\($0)" })
    XCTAssertEqual(brief.hiddenCount, 2)
    XCTAssertEqual(brief.visibleItems(expanded: true).count, 9)
    XCTAssertEqual(brief.agenda.map(\.title), ["Standup", "Review"])
    XCTAssertEqual(brief.agenda[1].end, date("2026-10-04T13:00:00Z"))
    let short = RadarBrief(["briefId": "b", "items": .array(Array(items.prefix(7)))])!
    XCTAssertEqual(short.hiddenCount, 0)
    XCTAssertEqual(short.visibleItems(expanded: false).count, 7)
    XCTAssertNil(RadarBrief(["title": "Morning brief"]))
  }

  func testTheTraceReadsAsPlainSentences() {
    let rules = [
      RadarRule([
        "id": "rule-1", "kind": "always", "origin": "explicit",
        "match": ["sender": "colleague@example.test"], "createdAt": "2026-10-01T00:00:00Z",
      ])!
    ]
    var item = RadarItem(
      update.merging([
        "trace": [
          "level": "important", "importance": .number(81.6), "confidence": .number(0.92),
          "costOfDelay": "high",
          "whoMustAct": "owner", "thresholdOffset": -3, "rules": ["rule-1", "rule-gone"],
          "thresholds": ["interrupt": 67, "brief": 45], "result": "interrupt",
          "scores": [
            "addressed": 3, "actionRequired": 3, "timePressure": 2, "stakes": 1,
            "relationship": 3, "novelty": 3, "linkage": 0, "seen": 3,
          ],
        ]
      ]))!
    XCTAssertEqual(
      RadarExplanation.sentences(for: item, rules: rules),
      [
        "I told you right away.",
        "You asked me to always tell you about colleague@example.test.",
        "One of your rules matched.",
        "It scored 82 out of 100.",
        "At Important, anything from 67 interrupts you and anything from 45 goes to the brief.",
        "Your feedback lowered the bar to interrupt by 3.",
        "It needs you to act, or something is missed.",
        "It asks you directly for something.",
        "The sender matters to you.",
        "Waiting for the brief would cost you.",
      ])
    item.reason = "bulk mail with an unsubscribe link"
    item.trace = RadarTrace([
      "result": "silent", "importance": 18, "confidence": .number(0.6), "costOfDelay": "none",
      "whoMustAct": "nobody", "verdict": "unclear",
      "scores": ["addressed": 0, "actionRequired": 0, "stakes": 1, "seen": 0],
      "gates": ["quiet_hours", "daily_cap_reached", "story-limit", "new_gate_name"],
    ])
    XCTAssertEqual(
      RadarExplanation.sentences(for: item),
      [
        "I stayed quiet.",
        "Bulk mail with an unsubscribe link.",
        "It scored 18 out of 100.",
        "Nothing needs doing.",
        "The stakes are minor.",
        "You already handled it.",
        "Nothing is lost by waiting.",
        "Nobody needs to act on it.",
        "I could not tell clearly what it is about.",
        "I was 60% sure.",
        "It came in during quiet hours, so it waited until they ended.",
        "You had reached today's limit, so it went to the brief.",
        "You had already heard about this today.",
        "New gate name.",
      ])
    item.trace = nil
    item.disposition = "brief"
    XCTAssertEqual(
      RadarExplanation.sentences(for: item),
      ["I kept it for your brief.", "Bulk mail with an unsubscribe link."])
    XCTAssertEqual(RadarExplanation.gateSentence("owner_replied"), "You had already replied.")
    XCTAssertEqual(
      RadarExplanation.gateSentence("paused"), "Radar was paused, so it went to the brief.")
  }

  func testRulesAndPeopleReadForTheRadarScreen() {
    let learned = RadarRule([
      "id": "r", "kind": "digest", "origin": "learned", "match": ["source": "googledrive"],
    ])!
    XCTAssertEqual(learned.subject, "Google Drive")
    XCTAssertEqual(learned.title, "Brief only")
    XCTAssertEqual(learned.sentence, "I learned to keep Google Drive for the brief.")
    let never = RadarRule(["id": "n", "kind": "never", "match": ["domain": "example.test"]])!
    XCTAssertEqual(never.sentence, "You asked me never to tell you about example.test.")
    XCTAssertNil(RadarRule(["id": "x", "kind": "sometimes", "match": ["topic": "a"]]))
    let person = RadarPerson([
      "name": "A colleague", "relation": "Manager", "addresses": ["colleague@example.test"],
    ])!
    XCTAssertEqual(person.detail, "Manager · colleague@example.test")
    XCTAssertEqual(ConnectedApp.name("granola_mcp"), "Granola")
    XCTAssertEqual(ConnectedApp.name("todoist"), "Todoist")
  }

  func testLaterChoicesFollowTheRadarTimeZone() {
    // 10:00 in Helsinki (UTC+3 in October).
    var choices = RadarTime.later(now: date("2026-10-05T07:00:00Z"), timeZone: helsinki)
    XCTAssertEqual(choices.map(\.option), [.hour, .evening, .morning])
    XCTAssertEqual(
      choices.map(\.date),
      [
        date("2026-10-05T08:00:00Z"), date("2026-10-05T16:00:00Z"), date("2026-10-06T05:30:00Z"),
      ])
    // 18:30: this evening is less than an hour away.
    choices = RadarTime.later(now: date("2026-10-05T15:30:00Z"), timeZone: helsinki)
    XCTAssertEqual(choices.map(\.option), [.hour, .morning])
    // 02:00: the coming morning is still today.
    choices = RadarTime.later(now: date("2026-10-04T23:00:00Z"), timeZone: helsinki)
    XCTAssertEqual(choices.last?.date, date("2026-10-05T05:30:00Z"))
    // The clocks go back overnight: 08:30 the next morning is UTC+2.
    choices = RadarTime.later(now: date("2026-10-24T07:00:00Z"), timeZone: helsinki)
    XCTAssertEqual(choices.last?.date, date("2026-10-25T06:30:00Z"))
    XCTAssertEqual(
      RadarTime.Later.allCases.map(\.title), ["1 hour", "This evening", "Tomorrow morning"])
  }

  func testPauseChoices() {
    let now = date("2026-10-05T12:00:00Z")
    XCTAssertEqual(
      RadarTime.pausedUntil(.hour, now: now, timeZone: utc), "2026-10-05T13:00:00.000Z")
    XCTAssertEqual(
      RadarTime.pausedUntil(.tomorrow, now: now, timeZone: helsinki), "2026-10-06T05:00:00.000Z")
    XCTAssertEqual(
      RadarTime.pausedUntil(.resumed, now: now, timeZone: utc), Radar.pausedUntilResumed)
  }

  func testTheStatusLine() {
    let now = date("2026-10-05T09:00:00Z")
    func line(_ settings: JSON, _ extra: [String: JSON] = [:]) -> String {
      RadarStatusLine.text(
        JSON.object(["settings": settings]).merging(extra), now: now, timeZone: utc,
        locale: british)
    }
    XCTAssertEqual(line(["enabled": false]), "Off")
    XCTAssertEqual(
      line(["enabled": true, "pausedUntil": .string(Radar.pausedUntilResumed)]), "Paused")
    XCTAssertEqual(
      line(["enabled": true, "pausedUntil": "2026-10-05T15:00:00.000Z"]), "Paused until 15:00")
    XCTAssertEqual(
      line(["enabled": true, "pausedUntil": "2026-10-06T08:00:00.000Z"]), "Paused until Tue 08:00")
    let watching = ["nextCycleAt": JSON.string("2026-10-05T09:40:00.000Z")]
    XCTAssertEqual(
      line(["enabled": true, "pausedUntil": "2026-10-05T08:00:00.000Z"], watching),
      "Watching · next check 09:40", "an expired pause reads as running")
    XCTAssertEqual(line(["enabled": true, "pausedUntil": .null]), "Watching")
    let revoked: JSON = [["enabled": true, "state": "revoked"]]
    XCTAssertEqual(
      line(["enabled": true], watching.merging(["sources": revoked]) { $1 }), "Needs reconnect")
    let off: JSON = [["enabled": false, "state": "revoked"]]
    XCTAssertEqual(
      line(["enabled": true], watching.merging(["sources": off]) { $1 }),
      "Watching · next check 09:40")
  }

  func testTimesAndClockSettings() {
    let now = date("2026-10-05T12:00:00Z")
    XCTAssertEqual(
      RadarTime.when(date("2026-10-05T09:12:00Z"), now: now, timeZone: utc, locale: british),
      "09:12")
    XCTAssertEqual(
      RadarTime.when(date("2026-10-03T18:40:00Z"), now: now, timeZone: utc, locale: british),
      "Sat 18:40")
    XCTAssertEqual(
      RadarTime.when(date("2026-08-20T18:40:00Z"), now: now, timeZone: utc, locale: british),
      "20 Aug")
    XCTAssertEqual(RadarTime.clockDate("22:05").map(RadarTime.clockString), "22:05")
    XCTAssertEqual(
      RadarTime.clockString(Date(timeIntervalSince1970: 86_400 * 3 + 8 * 3600 + 30 * 60)), "08:30")
    for invalid in ["24:00", "8", "aa:bb", "12:60"] {
      XCTAssertNil(RadarTime.clockDate(invalid), invalid)
    }
    XCTAssertEqual(RadarTime.iso(date("2026-10-05T09:12:00+03:00")), "2026-10-05T06:12:00.000Z")
    XCTAssertNil(RadarTime.parse("tomorrow"))
  }

  func testPushesRouteToTheirActions() {
    let fields = [
      "kind": "radar", "updateId": "signal-1", "messageId": "message-1", "threadId": "thread-1",
      "spaceId": "space-1", "botId": "bot-1", "threadKind": "personal",
    ]
    let push = RadarPush(fields, category: "RADAR_REPLY")!
    XCTAssertEqual(push.updateID, "signal-1")
    XCTAssertEqual(push.target, ["botId": "bot-1", "threadKind": "personal"])
    XCTAssertEqual(push.fallbackInstruction, "Draft reply")
    XCTAssertFalse(push.isDraft)
    XCTAssertEqual(RadarPush(fields, category: "RADAR_DECIDE")?.fallbackInstruction, "Handle it")
    XCTAssertNil(RadarPush(fields, category: "RADAR_GENERIC")?.fallbackInstruction)
    XCTAssertNil(RadarPush(fields.merging(["kind": "completion"]) { $1 }, category: "RADAR_REPLY"))
    XCTAssertEqual(RadarPush.response(action: "radar.primary", text: nil), .primary)
    XCTAssertEqual(RadarPush.response(action: "radar.later", text: nil), .later)
    XCTAssertEqual(RadarPush.response(action: "radar.not_important", text: nil), .notImportant)
    XCTAssertEqual(
      RadarPush.response(action: "radar.tell", text: " Ask for Friday "), .tell("Ask for Friday"))
    XCTAssertEqual(RadarPush.response(action: "radar.brief", text: nil), .open)
    XCTAssertEqual(
      RadarPush.response(action: "com.apple.UNNotificationDefaultActionIdentifier", text: nil),
      .open)
    let draft = RadarPush(
      push.draftFields("Ask for Friday", title: "Budget review moved"), category: "")!
    XCTAssertTrue(draft.isDraft)
    XCTAssertEqual(draft.draft, "Ask for Friday")
    XCTAssertEqual(draft.title, "Budget review moved")
    XCTAssertEqual(draft.updateID, "signal-1")
    XCTAssertEqual(draft.target, push.target)
    XCTAssertNil(RadarPush(push.draftFields("  ", title: ""), category: ""))
    XCTAssertEqual(
      Set(RadarPush.Category.allCases.map(\.rawValue)),
      ["RADAR_REPLY", "RADAR_DECIDE", "RADAR_GENERIC", "RADAR_BRIEF"])
  }
}
