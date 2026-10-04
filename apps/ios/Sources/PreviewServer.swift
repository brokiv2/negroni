#if DEBUG
  import NegroniCore
  import UIKit

  /// Simulator review without a server. Launch a debug build with `-NegroniPreview YES` to run
  /// the app on fixture data; `-NegroniPreviewScreen` opens one screen (foryou, foryou-brief,
  /// foryou-tabs, foryou-automations, radar, radar-timing, radar-learned, radar-forget,
  /// radar-advanced, skipped, detail, why, why-skipped, brief, settings),
  /// `-NegroniPreviewRadarOff YES` starts with Radar off and `-NegroniPreviewOlder YES` loads
  /// the chat without the older messages (the brief), which the chat then reads. Debug builds
  /// only: it never reads the Keychain or the network.
  enum PreviewMode {
    static let enabled = UserDefaults.standard.bool(forKey: "NegroniPreview")
      || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    static var screen: String { UserDefaults.standard.string(forKey: "NegroniPreviewScreen") ?? "" }
    static var radarOff: Bool { UserDefaults.standard.bool(forKey: "NegroniPreviewRadarOff") }
    static var older: Bool { UserDefaults.standard.bool(forKey: "NegroniPreviewOlder") }
    @MainActor private static var opened = false

    @MainActor static func open(in tabs: MainTabController) {
      guard enabled, !opened else { return }
      opened = true
      let chat = tabs.viewControllers?.first as? UINavigationController
      let feed = tabs.viewControllers?[1] as? UINavigationController
      func later(_ seconds: Double, _ work: @escaping @MainActor () -> Void) {
        Task { @MainActor in
          try? await Task.sleep(for: .seconds(seconds))
          work()
        }
      }
      func sheet(_ item: RadarItem, _ mode: RadarUpdateController.Mode, from: UIViewController?) {
        from?.presentRadar(item, mode: mode)
        later(0.6) {
          (from?.presentedViewController as? UINavigationController)?.sheetPresentationController?
            .animateChanges {
              from?.presentedViewController?.sheetPresentationController?
                .selectedDetentIdentifier = .large
            }
        }
      }
      /// Scrolls a list so the section with this title is at the top.
      func reveal(_ list: ListController?, _ title: String) {
        guard let list, let index = list.sections.firstIndex(where: { $0.title == title }) else {
          return
        }
        list.tableView.scrollToRow(at: IndexPath(row: 0, section: index), at: .top, animated: false)
      }
      let contract = RadarItem(PreviewData.shared.view("u-contract"))!
      switch screen {
      case "push-warm":
        later(1) {
          Task {
            for _ in 0..<3 {
              await Notifications.shared.receive(fields: ["botId": "bot-preview", "messageId": "m-brief", "spaceId": "space-preview"],
                category: "", action: UNNotificationDefaultActionIdentifier)
            }
          }
        }
      case "report":
        chat?.pushViewController(AttachmentController(target: ["botId": "bot-preview"],
          block: ["kind": "file", "artifactId": "report-preview", "name": "Research report"]), animated: false)
      case "foryou", "foryou-brief", "foryou-tabs", "foryou-automations":
        tabs.selectedIndex = 1
        guard screen != "foryou" else { return }
        func segmented(in view: UIView) -> UISegmentedControl? {
          if let control = view as? UISegmentedControl { return control }
          return view.subviews.lazy.compactMap { segmented(in: $0) }.first
        }
        later(1.5) {
          guard let list = feed?.topViewController as? ListController else { return }
          if screen == "foryou-brief" { return reveal(list, "Morning brief") }
          // The Feed / Saved / Automations control, below Needs you and the brief.
          let last = IndexPath(row: 0, section: list.tableView.numberOfSections - 1)
          list.tableView.scrollToRow(at: last, at: .bottom, animated: false)
          guard screen == "foryou-automations" else { return }
          later(0.5) {
            guard let control = segmented(in: list.view) else { return }
            control.selectedSegmentIndex = 2
            control.sendActions(for: .valueChanged)
          }
        }
      case "radar", "radar-timing", "radar-learned", "radar-forget", "radar-advanced":
        tabs.selectedIndex = 1
        let radar = RadarController()
        feed?.pushViewController(radar, animated: false)
        later(1.5) {
          if screen == "radar-timing" { reveal(radar, "Tell me") }
          if screen == "radar-learned" || screen == "radar-forget" {
            reveal(radar, "What I’ve learned")
          }
          if screen == "radar-forget" {
            // Forget one person by address and one by name, as the swipe does.
            for name in ["Alex Rivera", "Dr. Okafor"] {
              radar.sections.flatMap(\.rows).first { $0.title == name }?.deleteAction?()
            }
          }
          guard screen == "radar-advanced" else { return }
          radar.sections.flatMap(\.rows).first { $0.title == "Advanced" }?.action?()
          later(0.5) { reveal(radar, "Context files") }
        }
      case "skipped":
        tabs.selectedIndex = 1
        feed?.pushViewController(RadarSkippedController(), animated: false)
      case "detail":
        tabs.selectedIndex = 1
        later(1.5) { sheet(contract, .detail, from: feed?.topViewController) }
      case "why":
        later(1.5) { sheet(contract, .why, from: chat?.topViewController) }
      case "why-skipped":
        tabs.selectedIndex = 1
        let skipped = RadarItem(PreviewData.shared.view("s-wiki"))!
        later(1.5) { sheet(skipped, .why, from: feed?.topViewController) }
      case "brief":
        later(1.5) {
          (chat?.topViewController as? ChatController)?.focus(messageID: "m-brief")
        }
      case "settings":
        tabs.selectedIndex = 1
        let nav = UINavigationController(rootViewController: FeedSettingsController())
        later(1) { feed?.topViewController?.present(nav, animated: false) }
      default:
        break
      }
    }
  }

  /// Answers every request of the API session from `PreviewData`.
  final class PreviewServer: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
      guard let url = request.url else { return }
      if url.path.hasPrefix("/api/artifacts/") {
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
          headerFields: ["Content-Type": "text/markdown", "Content-Disposition": "attachment; filename=Report"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("# Research report\n\nA **formatted** report inside Negroni.\n\n> First paragraph\n>\n> Second paragraph\n\n- Evidence\n- Next step".utf8))
        client?.urlProtocolDidFinishLoading(self)
        return
      }
      let path = url.path.hasPrefix("/rpc/") ? String(url.path.dropFirst(5)) : url.path
      let headers =
        path == "threads/subscribe"
        ? ["Content-Type": "text/event-stream"] : ["Content-Type": "application/json"]
      let response = HTTPURLResponse(
        url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      // The event stream stays open with nothing new until the chat leaves.
      guard path != "threads/subscribe" else { return }
      let output = PreviewData.shared.answer(path, Self.body(request)["json"])
      client?.urlProtocol(self, didLoad: (try? JSON.object(["json": output]).encoded()) ?? Data())
      client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
    private static func body(_ request: URLRequest) -> JSON {
      if let data = request.httpBody { return (try? JSON.decode(data)) ?? .null }
      guard let stream = request.httpBodyStream else { return .null }
      stream.open()
      defer { stream.close() }
      var data = Data()
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count <= 0 { break }
        data.append(buffer, count: count)
      }
      return (try? JSON.decode(data)) ?? .null
    }
  }

  /// Fictional fixture data (example.test addresses only) and the state preview actions change.
  final class PreviewData: @unchecked Sendable {
    static let shared = PreviewData()
    private let lock = NSLock()
    private let now = Date()
    private var settings: JSON
    private var sources: [JSON]
    private var rules: [JSON]
    private var people: [JSON]
    private var updates: [JSON] = []
    private var sent: [JSON] = []

    private init() {
      settings = [
        "enabled": .bool(!PreviewMode.radarOff), "level": "important",
        "timeZone": .string(TimeZone.current.identifier), "language": "",
        "quietHours": ["enabled": true, "start": "22:00", "end": "08:00"],
        "morningBrief": ["enabled": true, "time": "08:30"],
        "eveningBrief": ["enabled": false, "time": "18:30"], "maxInterruptsPerDay": 6,
        "meetingPrep": true, "contextPaths": ["Notes/priorities.md"], "pausedUntil": .null,
      ]
      sources = [
        Self.source("c-gmail", "gmail", "work@example.test", seen: 31),
        Self.source("c-calendar", "googlecalendar", "work@example.test", seen: 6),
        Self.source("c-granola", "granola_mcp", "", seen: 2),
        Self.source("c-slack", "slack", "team.example.test", state: "error"),
        Self.source("c-drive", "googledrive", "work@example.test", enabled: false, state: "paused"),
        Self.source(
          "c-github", "github", "", enabled: false, supported: false, state: "unsupported"),
      ]
      rules = [
        Self.rule("rule-alex", "always", ["sender": "alex@example.test"], "explicit"),
        Self.rule("rule-shop", "never", ["domain": "shop.example.test"], "learned"),
        Self.rule("rule-wiki", "digest", ["topic": "Team wiki digests"], "learned"),
      ]
      people = [
        [
          "name": "Alex Rivera", "addresses": ["alex@example.test"], "relation": "Manager",
          "weight": 3, "origin": "learned",
        ],
        [
          "name": "Sam Lee", "addresses": ["sam@example.test"], "relation": "Finance partner",
          "weight": 2, "origin": "learned",
        ],
        [
          "name": "Dr. Okafor", "addresses": [], "relation": "Dentist", "weight": 1,
          "origin": "learned",
        ],
      ]
      updates = makeUpdates()
    }

    private static func source(
      _ id: String, _ slug: String, _ account: String, seen: Int = 0, enabled: Bool = true,
      supported: Bool = true, state: String = "ok"
    ) -> JSON {
      [
        "connectionId": .string(id), "source": .string(slug),
        "label": .string(ConnectedApp.name(slug) + " 1"), "account": .string(account),
        "enabled": .bool(enabled), "supported": .bool(supported), "state": .string(state),
        "seenToday": .number(Double(seen)),
      ]
    }
    private static func rule(_ id: String, _ kind: String, _ match: JSON, _ origin: String) -> JSON
    {
      [
        "id": .string(id), "kind": .string(kind), "match": match, "origin": .string(origin),
        "createdAt": "2026-09-28T09:00:00.000Z",
      ]
    }
    private func ago(_ minutes: Double) -> JSON {
      .string(RadarTime.iso(now.addingTimeInterval(-minutes * 60)))
    }
    private func today(_ hour: Int, _ minute: Int) -> JSON {
      .string(
        RadarTime.iso(RadarTime.at(hour: hour, minute: minute, onDayOf: now, timeZone: .current)))
    }
    private func makeUpdates() -> [JSON] {
      let accounts = [
        "gmail": "work@example.test", "googlecalendar": "work@example.test",
        "googledrive": "work@example.test", "granola_mcp": "Granola 1", "todoist": "Todoist 1",
      ]
      func trace(
        _ importance: Int, _ result: String, cost: String, scores: [Int], rules: [String] = [],
        gates: [String] = []
      ) -> JSON {
        let keys = [
          "addressed", "actionRequired", "timePressure", "stakes", "relationship", "novelty",
          "linkage", "seen",
        ]
        return [
          "level": "important", "importance": .number(Double(importance)),
          "confidence": .number(0.9),
          "costOfDelay": .string(cost), "verdict": "scored",
          "whoMustAct": result == "silent" ? "nobody" : "owner", "thresholdOffset": 0,
          "thresholds": ["interrupt": 70, "brief": 45],
          "scores": .object(
            Dictionary(uniqueKeysWithValues: zip(keys, scores.map { JSON.number(Double($0)) }))),
          "rules": .array(rules.map(JSON.string)), "gates": .array(gates.map(JSON.string)),
          "result": .string(result),
        ]
      }
      func update(
        _ id: String, _ source: String, _ title: String, actor: (String, String)?, why: String,
        minutes: Double, disposition: String, action: String, urgency: String, offer: String = "",
        evidence: String = "", url: String = "", reason: String = "", messageID: String = "",
        trace: JSON
      ) -> JSON {
        var value: JSON = [
          "id": .string(id), "source": .string(source), "kind": "email", "title": .string(title),
          "account": .string(accounts[source] ?? ""),
          "occurredAt": ago(minutes), "excerpt": "", "why": .string(why),
          "disposition": .string(disposition), "action": .string(action),
          "urgency": .string(urgency), "state": "open", "trace": trace,
          "importance": trace["importance"],
        ]
        if let actor { value["actor"] = ["name": .string(actor.0), "address": .string(actor.1)] }
        for (key, text) in [
          ("offer", offer), ("evidence", evidence), ("url", url), ("reason", reason),
          ("messageId", messageID),
        ] where !text.isEmpty {
          value[key] = .string(text)
        }
        return value
      }
      func address(of name: String) -> String {
        name.lowercased().replacingOccurrences(of: " ", with: ".") + "@example.test"
      }
      let brief = [
        ("u-invoice", "gmail", "The design studio's invoice is due Monday", "Billing"),
        ("u-survey", "gmail", "The quarterly survey closes Friday", "People team"),
        ("u-comment", "googledrive", "Two new comments on the launch plan", "Sam Lee"),
        ("u-tasks", "todoist", "Two tasks are due today", ""),
        ("u-offsite", "googledrive", "The offsite agenda draft is shared with you", "Jordan Park"),
        ("u-travel", "gmail", "The hotel for the offsite is confirmed", "Travel desk"),
        ("u-metrics", "gmail", "This week's product metrics are in", "Analytics"),
        ("u-panel", "googlecalendar", "The hiring panel moved to Thursday", "Priya Nair"),
      ].enumerated().map { index, entry in
        update(
          entry.0, entry.1, entry.2,
          actor: entry.3.isEmpty ? nil : (entry.3, address(of: entry.3)),
          why: "Worth a look today.", minutes: 300 + Double(index) * 20, disposition: "brief",
          action: "review", urgency: "week",
          offer: entry.0 == "u-invoice" ? "Pay the invoice?" : "",
          trace: trace(50, "brief", cost: "low", scores: [2, 1, 1, 1, 1, 3, 1, 3]))
      }
      return [
        update(
          "u-contract", "gmail", "Contract terms need your answer by noon",
          actor: ("Alex Rivera", "alex@example.test"),
          why: "Legal sends the final version at 12:00 and needs your yes or no first.",
          minutes: 25, disposition: "interrupt", action: "reply", urgency: "now",
          offer: "Draft a reply accepting the new terms?",
          evidence:
            "Could you confirm the revised terms by 12:00 so we can send the final version today?",
          url: "https://mail.example.test/thread/contract", messageID: "m-radar",
          trace: trace(
            84, "interrupt", cost: "high", scores: [3, 3, 3, 2, 3, 3, 2, 3], rules: ["rule-alex"])),
        update(
          "u-review", "googlecalendar", "Sam moved the budget review to 09:00 tomorrow",
          actor: ("Sam Lee", "sam@example.test"),
          why: "It now overlaps your 09:00 call with the design team.", minutes: 40,
          disposition: "interrupt", action: "decide", urgency: "today",
          offer: "Propose 11:00 instead?", url: "https://calendar.example.test/event/budget",
          messageID: "m-radar",
          trace: trace(76, "interrupt", cost: "high", scores: [2, 3, 3, 2, 2, 2, 2, 3])),
        update(
          "u-roadmap", "granola_mcp", "Follow-ups from the roadmap sync", actor: nil,
          why: "You promised the launch checklist by Friday.", minutes: 280, disposition: "brief",
          action: "review", urgency: "week", url: "https://notes.example.test/roadmap-sync",
          trace: trace(58, "brief", cost: "low", scores: [2, 2, 1, 2, 2, 3, 3, 3])),
      ] + brief + [
        update(
          "s-sale", "gmail", "The spring sale ends tonight",
          actor: ("Shop", "news@shop.example.test"), why: "", minutes: 15,
          disposition: "silent", action: "none", urgency: "none",
          reason: "Bulk mail with an unsubscribe link.",
          trace: trace(
            9, "silent", cost: "none", scores: [0, 0, 1, 0, 0, 2, 0, 3], gates: ["bulk"])),
        update(
          "s-code", "gmail", "Your sign-in code", actor: ("Accounts", "no-reply@example.test"),
          why: "", minutes: 55, disposition: "silent", action: "none", urgency: "none",
          reason: "Sign-in codes are never sent.",
          trace: trace(
            5, "silent", cost: "none", scores: [1, 0, 3, 1, 0, 3, 0, 3], gates: ["security_code"])),
        update(
          "s-accepted", "googlecalendar", "You accepted the design critique", actor: nil, why: "",
          minutes: 95, disposition: "silent", action: "none", urgency: "none",
          reason: "Sent by you.",
          trace: trace(
            3, "silent", cost: "none", scores: [0, 0, 0, 0, 0, 1, 1, 0], gates: ["own"])),
        update(
          "s-wiki", "gmail", "Weekly digest from the team wiki",
          actor: ("Team wiki", "digest@wiki.example.test"), why: "", minutes: 130,
          disposition: "silent", action: "none", urgency: "none",
          reason: "A brief-only rule matched and nothing in it needs you.",
          trace: trace(
            22, "silent", cost: "none", scores: [1, 0, 0, 1, 1, 2, 1, 3], rules: ["rule-wiki"],
            gates: ["rule_digest", "below_threshold"])),
      ]
    }

    func view(_ id: String) -> JSON {
      lock.lock()
      defer { lock.unlock() }
      return updates.first { $0["id"].string == id } ?? .null
    }

    private var messages: [JSON] {
      let brief = updates.filter { $0["disposition"].string == "brief" }.map { update in
        [
          "updateId": update["id"], "title": update["title"], "why": update["why"],
          "source": update["source"], "action": update["action"], "actor": update["actor"],
          "offer": update["offer"],
        ] as JSON
      }
      let card = { (id: String, summary: String) -> JSON in
        let update = self.updates.first { $0["id"].string == id }!
        return [
          "kind": "update", "summary": .string(summary), "updateId": .string(id),
          "source": update["source"], "account": update["account"], "title": update["title"],
          "actor": update["actor"],
          "why": update["why"], "offer": update["offer"], "evidence": update["evidence"],
          "url": update["url"], "urgency": update["urgency"], "action": update["action"],
          "occurredAt": update["occurredAt"],
        ]
      }
      return [
        [
          "id": "m-hello", "role": "user", "seq": 1,
          "blocks": [
            ["kind": "text", "text": "Keep an eye on the vendor contract today, please."]
          ],
        ],
        [
          "id": "m-ack", "role": "bot", "seq": 2,
          "blocks": [["kind": "text", "text": "Will do. I’ll tell you as soon as legal replies."]],
        ],
        [
          "id": "m-brief", "role": "bot", "seq": 3,
          "blocks": [
            [
              "kind": "text",
              "text":
                "A light morning: standup at 09:30, then the vendor call at 11:00. The contract still needs your answer before noon, and the afternoon is clear until the design review at 15:00.",
            ],
            [
              "kind": "brief", "summary": "Morning brief", "briefId": "brief-1",
              "period": "morning", "title": "Morning brief", "items": .array(brief),
              "agenda": [
                ["title": "Standup", "start": today(9, 30), "end": today(9, 45)],
                ["title": "Vendor call", "start": today(11, 0), "end": today(11, 30)],
                ["title": "Design review", "start": today(15, 0), "end": today(16, 0)],
              ],
            ],
          ],
        ],
        [
          "id": "m-radar", "role": "bot", "seq": 4,
          "blocks": [
            ["kind": "text", "text": "Two things need you before lunch."],
            card("u-contract", "Alex needs your answer on the contract by noon."),
            card("u-review", "Sam moved the budget review to 09:00 tomorrow."),
          ],
        ],
      ] + sent
    }

    private var status: JSON {
      [
        "settings": settings, "sources": .array(sources),
        "today": ["seen": 42, "interrupted": 2, "briefed": 9, "skipped": 31, "deferred": 0],
        "lastCycleAt": settings["enabled"].bool ? ago(4) : .null,
        "nextCycleAt": .string(RadarTime.iso(now.addingTimeInterval(6 * 60))),
        "lastBriefAt": ago(150), "lastBriefMessageId": "m-brief",
        "summary":
          "Leads product on a small software team. This month: the Q4 launch, the vendor contract and keeping the design review on track.",
        "rules": .array(rules),
        "people": .array(people),
      ]
    }

    func answer(_ procedure: String, _ input: JSON) -> JSON {
      lock.lock()
      defer { lock.unlock() }
      switch procedure {
      case "me":
        return ["spaceId": "space-preview", "name": "Preview", "email": "preview@example.test"]
      case "personal/thread":
        return ["botId": "bot-preview", "threadId": "thread-preview", "unread": false]
      case "bots/get":
        return ["id": "bot-preview", "name": "Negroni", "color": ""]
      case "bots/list":
        return [["id": "bot-preview", "name": "Negroni", "color": ""]]
      case "models/routing":
        return ["enabled": []]
      case "computer/status":
        return ["kind": "desktop", "state": "running"]
      case "voice/status":
        return ["transcribe": false]
      case "aiConsent/status":
        return ["recipients": [], "scope": "space", "version": 1]
      case "threads/get":
        if PreviewMode.screen == "login" {
          return ["threadId": "thread-preview", "cursor": 2, "botId": "bot-preview", "messages": [
            ["id": "login-preview", "role": "bot", "runId": "run-preview", "seq": 1, "blocks": [
              ["kind": "computer", "state": "Needs you", "text": "Please sign in to Threads in the browser on your Mac. Negroni will continue after you sign in."],
            ]],
          ], "run": ["id": "run-preview", "status": "waiting_takeover"], "activeRuns": []]
        }
        if PreviewMode.screen == "choices" || PreviewMode.screen == "markdown" {
          let content: [JSON] = PreviewMode.screen == "choices" ? [
            ["kind": "text", "text": "The report is ready."],
            ["kind": "choice", "id": "choice-preview", "question": "How should we start?", "options": [
              ["id": "small", "label": "Start with a small experiment"],
              ["id": "large", "label": "Try the full plan"],
            ]],
          ] : [["kind": "text", "text": "# Ready for Monday\n\n> A team of three built the agent.\n>\n> The workflow mattered.\n\n**Next step**\n\n- Read the report\n- Choose a plan"]]
          return ["threadId": "thread-preview", "cursor": 4, "botId": "bot-preview", "messages": [
            ["id": "user-preview", "role": "user", "seq": 1, "blocks": [["kind": "text", "text": "Look at the options."]]],
            ["id": "choice-preview", "role": "bot", "runId": "run-preview", "seq": 2, "blocks": .array(content)],
          ], "run": ["id": "run-preview", "status": "waiting_input"], "activeRuns": []]
        }
        // With `-NegroniPreviewOlder YES` the window starts at the Radar message.
        return [
          "threadId": "thread-preview", "kind": "personal",
          "cursor": .number(Double(4 + sent.count)),
          "messages": .array(PreviewMode.older ? messages.filter { $0["seq"].int >= 4 } : messages),
          "olderCursor": PreviewMode.older ? 4 : .null, "botId": "bot-preview", "run": .null,
          "activeRuns": [],
        ]
      case "threads/activity":
        guard PreviewMode.screen == "choices" else { return [] }
        return [
          ["id": "one", "runId": "run-preview", "name": "attach_file", "label": "Attach file", "status": "succeeded"],
          ["id": "two", "runId": "run-preview", "name": "ask_user", "label": "Ask user", "status": "waiting"],
        ]
      case "threads/messages":
        // The page before a message, or the messages around one.
        let before = input["before"].isNull ? Int.max : input["before"].int
        return [
          "threadId": "thread-preview",
          "messages": .array(messages.filter { $0["seq"].int < before }), "olderCursor": .null,
        ]
      case "threads/send":
        let seq = 5 + sent.count
        sent.append([
          "id": .string("m-sent-\(seq)"), "role": "user", "seq": .number(Double(seq)),
          "blocks": [["kind": "text", "text": input["text"]]],
        ])
        return ["messageId": .string("m-sent-\(seq)"), "seq": .number(Double(seq))]
      case "connections/list":
        return .array(
          sources.map { source in
            [
              "id": source["connectionId"], "provider": source["source"], "connectorId": "composio",
              "status": source["state"].string == "error" ? "error" : "connected",
              "displayName": source["label"], "accountLabel": source["account"],
            ]
          })
      case "feed/list":
        guard !input["saved"].bool, !input["hidden"].bool else { return [] }
        return [
          [
            "id": "f-planning", "title": "How small teams run weekly planning",
            "summary":
              "Three habits that keep a weekly plan honest: one owner per goal, a fixed review slot and a short written update.",
            "url": "https://example.test/articles/weekly-planning", "topic": "Team rituals",
          ]
        ]
      case "feed/profile":
        return [
          "researchEnabled": true, "researchChecksPerDay": 3, "learningEnabled": true,
          "interests": [["topic": "Team rituals", "reason": "From your conversations"]],
          "sourceDomains": [], "maxItems": 5,
        ]
      case "feed/research":
        return ["state": "idle", "checksUsed": 1, "checksPerDay": 3]
      case "radar/status", "radar/check", "radar/brief":
        return status
      case "radar/configure":
        for (key, value) in input.dictionary {
          if case .object(let patch) = value, case .object = settings[key] {
            settings[key] = settings[key].merging(patch)
          } else {
            settings[key] = value
          }
        }
        return status
      case "radar/source":
        sources = sources.map {
          $0["connectionId"] == input["connectionId"]
            ? $0.merging(["enabled": input["enabled"]]) : $0
        }
        return status
      case "radar/rule":
        rules.removeAll { $0["id"] == input["removeId"] }
        return .array(rules)
      case "radar/updates":
        let view = input["view"].string
        let items = updates.filter { update in
          let state = update["state"].string
          switch view {
          case "open":
            return state == "open"
              && (update["disposition"].string != "silent"
                || update["feedback"].string == "important")
          case "brief": return update["disposition"].string == "brief"
          case "skipped": return update["disposition"].string == "silent"
          default: return true
          }
        }
        return ["items": .array(items)]
      case "radar/update":
        return updates.first { $0["id"] == input["id"] } ?? .null
      case "radar/person":
        let address = input["address"].string
        let name = input["name"].string
        people.removeAll { person in
          (!address.isEmpty && person["addresses"].array.contains { $0.string == address })
            || (!name.isEmpty && person["name"].string == name)
        }
        return .array(people)
      case "radar/feedback":
        guard let index = updates.firstIndex(where: { $0["id"] == input["id"] }) else {
          return .null
        }
        let kind = input["kind"].string
        let states = [
          "done": "done", "snooze": "snoozed", "not_important": "dismissed",
          "mute_sender": "dismissed", "important": "open", "always_sender": "open",
        ]
        if let state = states[kind] { updates[index]["state"] = .string(state) }
        if kind != "opened" { updates[index]["feedback"] = .string(kind) }
        return updates[index]
      default:
        return [:]
      }
    }
  }
#endif
