import Foundation

/// Radar (docs/proactive-layer.md): decoding, wording and time logic behind the native cards,
/// For you, the Radar screen and notification actions. Shapes follow
/// `packages/contracts/src/radar.ts` and the `update` and `brief` message blocks.
public enum Radar {
  /// `pausedUntil` for "until resumed" (`RADAR_PAUSED_UNTIL_RESUMED`).
  public static let pausedUntilResumed = "9999-12-31T23:59:59.000Z"
  /// Brief rows shown before "N more".
  public static let briefVisibleItems = 7
  /// Levels in the order the app offers them.
  public static let levels: [(id: String, title: String)] = [
    ("urgent", "Only urgent"), ("important", "Important"), ("more", "More"),
  ]
  public static func levelTitle(_ id: String) -> String? { levels.first { $0.id == id }?.title }
  /// Only web links leave the app; any other scheme is ignored.
  public static func webURL(_ value: String) -> URL? {
    guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
      url.host?.isEmpty == false
    else { return nil }
    return url
  }
  /// Offers are phrased as questions ("Draft a reply?"); the button and the message it sends
  /// use the instruction ("Draft a reply").
  public static func instruction(_ offer: String) -> String {
    var text = offer.trimmingCharacters(in: .whitespacesAndNewlines)
    while let last = text.last, last == "?" || last == "？" {
      text.removeLast()
    }
    if text.first == "¿" { text.removeFirst() }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

/// Display names for connector toolkit slugs.
public enum ConnectedApp {
  public static func name(_ slug: String) -> String {
    let names = [
      "gmail": "Gmail", "googlecalendar": "Google Calendar", "googledrive": "Google Drive",
      "granola_mcp": "Granola", "youtube": "YouTube", "linkedin": "LinkedIn",
    ]
    return names[slug.lowercased()] ?? slug.replacingOccurrences(of: "_", with: " ").capitalized
  }
}

/// One Radar update: an `update` block, a brief row or a `radar/updates` view.
public struct RadarItem: Equatable, Sendable {
  public var id: String
  public var source: String
  /// Which account of that source: the provider-verified address or the connection's name.
  /// Update blocks and views carry it; brief rows do not.
  public var account: String
  /// Signal kind (`email`, `invite`, …); empty for blocks and brief rows.
  public var kind: String
  public var title: String
  public var actorName: String
  public var actorAddress: String
  public var why: String
  public var offer: String
  public var evidence: String
  public var excerpt: String
  public var url: URL?
  public var urgency: String
  public var action: String
  public var occurredAt: Date?
  /// Why it was skipped or deferred, in the backend's words.
  public var reason: String
  public var state: String
  public var disposition: String
  public var feedback: String
  public var snoozedUntil: Date?
  public var messageID: String
  public var trace: RadarTrace?

  /// Nil without an id and a title.
  public init?(_ json: JSON) {
    let blockID = json["updateId"].string
    id = blockID.isEmpty ? json["id"].string : blockID
    title = json["title"].string.trimmed
    guard !id.isEmpty, !title.isEmpty else { return nil }
    source = json["source"].string.trimmed.lowercased()
    account = json["account"].string.trimmed
    kind = blockID.isEmpty ? json["kind"].string : ""
    actorName = json["actor"]["name"].string.trimmed
    actorAddress = json["actor"]["address"].string.trimmed
    why = json["why"].string.trimmed
    offer = json["offer"].string.trimmed
    evidence = json["evidence"].string.trimmed
    excerpt = json["excerpt"].string.trimmed
    url = Radar.webURL(json["url"].string)
    urgency = json["urgency"].string
    action = json["action"].string
    occurredAt = RadarTime.parse(json["occurredAt"].string)
    reason = json["reason"].string.trimmed
    state = json["state"].string
    disposition = json["disposition"].string
    feedback = json["feedback"].string
    snoozedUntil = RadarTime.parse(json["snoozedUntil"].string)
    messageID = json["messageId"].string
    trace = RadarTrace(json["trace"])
  }
  /// Who it is from, as the card shows it.
  public var sender: String { actorName.isEmpty ? actorAddress : actorName }
  /// Sender rules key on the address, so "Never about this" and "Always tell me" need one.
  public var hasSenderAddress: Bool { !actorAddress.isEmpty }
  public var primary: RadarPrimary {
    RadarPrimary(offer: offer, action: action, hasURL: url != nil)
  }
  /// The line beside a card's source mark: the account and the sender, then the time. With
  /// neither it names the app, and `showSource` puts the app first even when they are known.
  public func metaLine(
    showSource: Bool = false, now: Date = Date(), timeZone: TimeZone = .current,
    locale: Locale = .current
  ) -> String {
    let app = source.isEmpty ? "" : ConnectedApp.name(source)
    let who = [account, sender].filter { !$0.isEmpty }
    let when =
      occurredAt.map { RadarTime.when($0, now: now, timeZone: timeZone, locale: locale) } ?? ""
    return ((showSource || who.isEmpty ? [app] : []) + who + [when]).filter { !$0.isEmpty }
      .joined(separator: " · ")
  }
  /// The full view from `radar/update`, keeping what only the card or brief row carried.
  public func merged(with full: RadarItem) -> RadarItem {
    var result = full
    if result.account.isEmpty { result.account = account }
    if result.why.isEmpty { result.why = why }
    if result.offer.isEmpty { result.offer = offer }
    if result.evidence.isEmpty { result.evidence = evidence }
    if result.actorName.isEmpty { result.actorName = actorName }
    if result.actorAddress.isEmpty { result.actorAddress = actorAddress }
    if result.url == nil { result.url = url }
    if result.action.isEmpty { result.action = action }
    if result.urgency.isEmpty { result.urgency = urgency }
    if result.occurredAt == nil { result.occurredAt = occurredAt }
    if result.messageID.isEmpty { result.messageID = messageID }
    return result
  }
}

/// The card's primary button: the offer, or a fallback by action.
public struct RadarPrimary: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    /// Send `title` to the personal conversation with the update attached.
    case send
    /// Open the update's link.
    case open
  }
  public var title: String
  public var kind: Kind
  public init(title: String, kind: Kind) {
    self.title = title
    self.kind = kind
  }
  /// Draft reply for replies, Handle it for decisions, Open for anything else with a link.
  public init(offer: String, action: String, hasURL: Bool) {
    let text = Radar.instruction(offer)
    if !text.isEmpty {
      self.init(title: text, kind: .send)
    } else if action == "reply" {
      self.init(title: "Draft reply", kind: .send)
    } else if action == "decide" || !hasURL {
      self.init(title: "Handle it", kind: .send)
    } else {
      self.init(title: "Open", kind: .open)
    }
  }
}

/// A `brief` message block. The narrative is the message's text block.
public struct RadarBrief: Equatable, Sendable {
  public struct Event: Equatable, Sendable {
    public var title: String
    public var start: Date
    public var end: Date?
    public var allDay: Bool
    public var location: String
  }
  public var id: String
  public var period: String
  public var title: String
  public var items: [RadarItem]
  public var agenda: [Event]
  public init?(_ json: JSON) {
    id = json["briefId"].string
    guard !id.isEmpty else { return nil }
    period = json["period"].string
    title = json["title"].string.trimmed
    items = json["items"].array.compactMap(RadarItem.init)
    agenda = json["agenda"].array.compactMap { entry -> Event? in
      let title = entry["title"].string.trimmed
      guard !title.isEmpty, let start = RadarTime.parse(entry["start"].string) else { return nil }
      return Event(
        title: title, start: start, end: RadarTime.parse(entry["end"].string),
        allDay: entry["allDay"].bool, location: entry["location"].string.trimmed)
    }.sorted { $0.start < $1.start }
  }
  /// Rows before "N more", or all of them once expanded.
  public func visibleItems(expanded: Bool) -> [RadarItem] {
    expanded ? items : Array(items.prefix(Radar.briefVisibleItems))
  }
  /// How many rows "N more" holds back.
  public var hiddenCount: Int { max(0, items.count - Radar.briefVisibleItems) }
}

public struct RadarRule: Equatable, Sendable {
  public var id: String
  /// `always`, `digest` or `never`.
  public var kind: String
  public var origin: String
  public var sender: String
  public var domain: String
  public var topic: String
  public var source: String
  public init?(_ json: JSON) {
    id = json["id"].string
    kind = json["kind"].string
    guard !id.isEmpty, ["always", "digest", "never"].contains(kind) else { return nil }
    origin = json["origin"].string
    sender = json["match"]["sender"].string.trimmed
    domain = json["match"]["domain"].string.trimmed
    topic = json["match"]["topic"].string.trimmed
    source = json["match"]["source"].string.trimmed
  }
  public var learned: Bool { origin == "learned" }
  /// What the rule is about: a sender, a domain, a topic or an app.
  public var subject: String {
    [sender, domain, topic, source.isEmpty ? "" : ConnectedApp.name(source)].first {
      !$0.isEmpty
    } ?? ""
  }
  public var title: String {
    switch kind {
    case "always": return "Always tell me"
    case "digest": return "Brief only"
    default: return "Never"
    }
  }
  /// The rule as one sentence of "How I decided".
  public var sentence: String {
    switch kind {
    case "always":
      return learned
        ? "I learned to always tell you about \(subject)."
        : "You asked me to always tell you about \(subject)."
    case "digest":
      return learned
        ? "I learned to keep \(subject) for the brief."
        : "You asked me to keep \(subject) for the brief."
    default:
      return learned
        ? "I learned to stay quiet about \(subject)."
        : "You asked me never to tell you about \(subject)."
    }
  }
}

public struct RadarPerson: Equatable, Sendable {
  public var name: String
  public var relation: String
  public var addresses: [String]
  public init?(_ json: JSON) {
    name = json["name"].string.trimmed
    guard !name.isEmpty else { return nil }
    relation = json["relation"].string.trimmed
    addresses = json["addresses"].array.map(\.string).filter { !$0.isEmpty }
  }
  public var detail: String {
    ([relation] + addresses).filter { !$0.isEmpty }.joined(separator: " · ")
  }
  /// What `radar/person` takes to forget this person: an address when there is one, else the name.
  public var forgetInput: JSON {
    addresses.first.map { ["address": .string($0)] } ?? ["name": .string(name)]
  }
}

/// What triage and the policy saw and applied (`RadarTraceSchema`).
public struct RadarTrace: Equatable, Sendable {
  public var level: String
  public var importance: Double?
  public var confidence: Double?
  public var scores: [String: Int]
  public var costOfDelay: String
  public var verdict: String
  public var whoMustAct: String
  public var thresholdOffset: Double?
  public var interruptAt: Double?
  public var briefAt: Double?
  public var rules: [String]
  public var gates: [String]
  public var result: String
  public init?(_ json: JSON) {
    guard case .object = json else { return nil }
    level = json["level"].string
    importance = json["importance"].doubleValue
    confidence = json["confidence"].doubleValue
    scores = json["scores"].dictionary.compactMapValues { $0.doubleValue.map { Int($0) } }
    costOfDelay = json["costOfDelay"].string
    verdict = json["verdict"].string
    whoMustAct = json["whoMustAct"].string
    thresholdOffset = json["thresholdOffset"].doubleValue
    interruptAt = json["thresholds"]["interrupt"].doubleValue
    briefAt = json["thresholds"]["brief"].doubleValue
    rules = json["rules"].array.map(\.string).filter { !$0.isEmpty }
    gates = json["gates"].array.map(\.string).filter { !$0.isEmpty }
    result = json["result"].string
  }
}

/// A reason that shaped a decision, as the policy and the screening write it to `trace.gates`
/// (`RadarGate` in `packages/contracts/src/radar.ts`). Every one reads as a plain sentence.
public enum RadarGate: String, CaseIterable, Sendable {
  // Explicit rules.
  case ruleNever = "rule_never", ruleDigest = "rule_digest", ruleAlways = "rule_always"
  // Judgement.
  case unclear, notOwner = "not_owner", belowThreshold = "below_threshold"
  case lowConfidence = "low_confidence", alreadySeen = "already_seen"
  case secondOpinion = "second_opinion"
  // Delivery gates.
  case critical, paused, quietHours = "quiet_hours", inMeeting = "in_meeting"
  case dailyCap = "daily_cap", storyLimit = "story_limit", spacing
  case foldedIntoBrief = "folded_into_brief"
  // A fresh look at the source right before sending.
  case handledInSource = "handled_in_source", seenInSource = "seen_in_source"
  // Screened before any model call.
  case own, securityCode = "security_code", bulk, declined
  case calendarWindow = "calendar_window", backoff, duplicate, stale, unevaluated
  case meetingPrep = "meeting_prep"

  /// Gates that name a matched rule, which the explanation already reads as its own sentence.
  public var isRule: Bool { [.ruleNever, .ruleDigest, .ruleAlways].contains(self) }

  public var sentence: String {
    switch self {
    case .ruleNever: return "Your rule says never to tell you about this."
    case .ruleDigest: return "Your rule keeps this for the brief."
    case .ruleAlways: return "Your rule says to always tell you about this."
    case .unclear: return "It wasn't clear enough to interrupt you."
    case .notOwner: return "It wasn't clearly yours to act on."
    case .belowThreshold: return "It didn't score high enough to bring up."
    case .lowConfidence: return "I wasn't sure enough to interrupt you."
    case .alreadySeen: return "You had already seen it."
    case .secondOpinion: return "A second look disagreed, so it went to the brief."
    case .critical: return "Urgent enough to skip quiet hours and meetings."
    case .paused: return "Radar was paused."
    case .quietHours: return "It came in during quiet hours."
    case .inMeeting: return "You were in a meeting."
    case .dailyCap: return "Today's interrupt limit was reached."
    case .storyLimit: return "You already heard about this today."
    case .spacing: return "You had heard from me less than 30 minutes before."
    case .foldedIntoBrief: return "It waited for quiet hours to end, then joined your brief."
    case .handledInSource: return "It was already handled or gone when I checked the source."
    case .seenInSource: return "You had already opened it when I checked the source."
    case .own: return "It was your own message."
    case .securityCode: return "It looked like a sign-in or security code."
    case .bulk: return "It looked like bulk or automated mail."
    case .declined: return "You declined this event."
    case .calendarWindow: return "The event isn't in the next two days."
    case .backoff: return "You said something like this wasn't important."
    case .duplicate: return "It matched an earlier update."
    case .stale: return "It was too old to judge."
    case .unevaluated: return "It couldn't be evaluated."
    case .meetingPrep: return "It came from preparing you for a meeting."
    }
  }
}

/// "How I decided": plain sentences built from the stored trace, the backend's reason and the
/// owner's rules, never from a fresh model answer.
public enum RadarExplanation {
  /// Rubric dimensions by their weight in the importance formula.
  static let weights: [(key: String, weight: Double)] = [
    ("actionRequired", 0.20), ("stakes", 0.18), ("addressed", 0.14), ("linkage", 0.14),
    ("relationship", 0.12), ("novelty", 0.12), ("timePressure", 0.10),
  ]
  /// One sentence per rubric anchor (scores 0–3).
  static let rubric: [String: [String]] = [
    "addressed": [
      "It was a broadcast or an automated message.", "You were in a group or copied.",
      "It was sent to you directly.", "It asks you directly for something.",
    ],
    "actionRequired": [
      "Nothing needs doing.", "Acting on it is optional.", "It expects you to act.",
      "It needs you to act, or something is missed.",
    ],
    "timePressure": [
      "There is no deadline this week.", "It is due within a week.", "It is due within two days.",
      "It is due before your next brief.",
    ],
    "stakes": [
      "Little is at stake.", "The stakes are minor.",
      "Money, a commitment, a deliverable or a key relationship is involved.",
      "Security, health, legal matters, travel or a large sum is involved.",
    ],
    "relationship": [
      "The sender is unknown or automated.", "You know the sender.",
      "You often work with the sender.", "The sender matters to you.",
    ],
    "novelty": [
      "You already knew this.", "Only a small detail changed.",
      "It changes something you already knew.", "It is new.",
    ],
    "linkage": [
      "It is not tied to your current work.", "It touches something you are interested in.",
      "It is tied to work in progress.", "It blocks or unblocks something you committed to.",
    ],
    "seen": [
      "You already handled it.", "You already opened it.", "You may not have seen it.",
      "You have not seen it yet.",
    ],
  ]

  public static func sentences(for item: RadarItem, rules: [RadarRule] = []) -> [String] {
    var lines: [String] = []
    func add(_ text: String) {
      let line = sentence(text)
      if !line.isEmpty, !lines.contains(line) { lines.append(line) }
    }
    let trace = item.trace
    let result = (trace?.result).flatMap { $0.isEmpty ? nil : $0 } ?? item.disposition
    switch result {
    case "interrupt": add("I told you right away.")
    case "brief": add("I kept it for your brief.")
    case "silent": add("I stayed quiet.")
    default: break
    }
    add(item.reason)
    guard let trace else { return lines }
    for id in trace.rules {
      add(rules.first { $0.id == id }?.sentence ?? "One of your rules matched.")
    }
    if let importance = trace.importance {
      add("It scored \(Int(importance.rounded())) out of 100.")
    }
    if let interrupt = trace.interruptAt, let brief = trace.briefAt {
      let bar =
        "anything from \(Int(interrupt.rounded())) interrupts you and anything from "
        + "\(Int(brief.rounded())) goes to the brief."
      add(Radar.levelTitle(trace.level).map { "At \($0), \(bar)" } ?? bar)
    }
    if let offset = trace.thresholdOffset, Int(offset.rounded()) != 0 {
      let amount = abs(Int(offset.rounded()))
      add(
        offset > 0
          ? "Your feedback raised the bar to interrupt by \(amount)."
          : "Your feedback lowered the bar to interrupt by \(amount).")
    }
    let surfaced = result == "interrupt" || result == "brief"
    let ranked = weights.enumerated().compactMap {
      index, entry -> (key: String, score: Int, weight: Double, index: Int)? in
      guard let score = trace.scores[entry.key], (0...3).contains(score) else { return nil }
      return (entry.key, score, entry.weight, index)
    }
    let factors =
      surfaced
      ? Array(
        ranked.filter { $0.score >= 2 }.sorted {
          ($0.weight * Double($0.score), -$0.index) > ($1.weight * Double($1.score), -$1.index)
        }.prefix(3))
      : Array(ranked.filter { $0.score <= 1 }.prefix(2))
    for factor in factors { add(rubric[factor.key]![factor.score]) }
    if let seen = trace.scores["seen"], seen == 0 || (seen == 1 && !surfaced) {
      add(rubric["seen"]![seen])
    }
    switch trace.costOfDelay {
    case "critical": add("Waiting would cause harm before your next brief.")
    case "high": add("Waiting for the brief would cost you.")
    case "low": add("Waiting costs little.")
    case "none": add("Nothing is lost by waiting.")
    default: break
    }
    switch trace.whoMustAct {
    case "someone_else": add("Someone else needs to act on it.")
    case "nobody": add("Nobody needs to act on it.")
    case "unclear": add("It is unclear who needs to act.")
    default: break
    }
    if trace.verdict == "unclear" { add("I could not tell clearly what it is about.") }
    if let confidence = trace.confidence, confidence < 0.85 {
      add("I was \(Int((confidence * 100).rounded()))% sure.")
    }
    for gate in trace.gates {
      // A matched rule already reads as its own sentence above.
      if !trace.rules.isEmpty, RadarGate(rawValue: gate)?.isRule == true { continue }
      add(gateSentence(gate))
    }
    return lines
  }

  /// The sentence for a gate name, or nothing for a name this build does not know: traces are
  /// read tolerantly, so a newer server's gate says nothing rather than showing as written.
  public static func gateSentence(_ gate: String) -> String {
    RadarGate(rawValue: gate)?.sentence ?? ""
  }

  /// Capitalised and ending in punctuation.
  static func sentence(_ text: String) -> String {
    let trimmed = text.trimmed
    guard let first = trimmed.first else { return "" }
    let body = first.uppercased() + trimmed.dropFirst()
    return ".!?…".contains(body.last!) ? body : body + "."
  }
}

/// Times as Radar uses them: ISO instants on the wire, wall-clock choices in the Radar time zone.
public enum RadarTime {
  public static func parse(_ value: String) -> Date? {
    let trimmed = value.trimmed
    guard !trimmed.isEmpty else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: trimmed) ?? ISO8601DateFormatter().date(from: trimmed)
  }
  public static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  public enum Later: String, CaseIterable, Sendable {
    case hour, evening, morning
    public var title: String {
      switch self {
      case .hour: return "1 hour"
      case .evening: return "This evening"
      case .morning: return "Tomorrow morning"
      }
    }
  }
  public struct Choice<Option: Equatable & Sendable>: Equatable, Sendable {
    public var option: Option
    public var date: Date
  }
  /// Later: in an hour, this evening at 19:00 while that is more than an hour away, and the
  /// coming morning at 08:30, all in the Radar time zone.
  public static func later(now: Date, timeZone: TimeZone) -> [Choice<Later>] {
    var choices = [Choice(option: Later.hour, date: now.addingTimeInterval(3600))]
    let evening = at(hour: 19, minute: 0, onDayOf: now, timeZone: timeZone)
    if evening.timeIntervalSince(now) > 3600 {
      choices.append(Choice(option: .evening, date: evening))
    }
    let morning = nextMorning(hour: 8, minute: 30, after: now, timeZone: timeZone)
    choices.append(Choice(option: .morning, date: morning))
    return choices
  }

  public enum Pause: String, CaseIterable, Sendable {
    case hour, tomorrow, resumed
    public var title: String {
      switch self {
      case .hour: return "1 hour"
      case .tomorrow: return "Until tomorrow"
      case .resumed: return "Until resumed"
      }
    }
  }
  /// `pausedUntil` for a pause: an hour, tomorrow at 08:00 in the Radar zone, or until resumed.
  public static func pausedUntil(_ pause: Pause, now: Date, timeZone: TimeZone) -> String {
    switch pause {
    case .hour: return iso(now.addingTimeInterval(3600))
    case .tomorrow: return iso(nextMorning(hour: 8, minute: 0, after: now, timeZone: timeZone))
    case .resumed: return Radar.pausedUntilResumed
    }
  }

  static func calendar(_ timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    return calendar
  }
  /// The wall-clock time `hour:minute` on the calendar day of `date` in the zone.
  public static func at(hour: Int, minute: Int, onDayOf date: Date, timeZone: TimeZone) -> Date {
    let calendar = calendar(timeZone)
    var parts = calendar.dateComponents([.year, .month, .day], from: date)
    parts.hour = hour
    parts.minute = minute
    return calendar.date(from: parts) ?? date
  }
  /// The coming morning at `hour:minute`: later today while it is still night (before 05:00),
  /// otherwise tomorrow.
  public static func nextMorning(hour: Int, minute: Int, after now: Date, timeZone: TimeZone)
    -> Date
  {
    let calendar = calendar(timeZone)
    let today = at(hour: hour, minute: minute, onDayOf: now, timeZone: timeZone)
    if calendar.component(.hour, from: now) < 5, today > now { return today }
    let tomorrow =
      calendar.date(byAdding: .day, value: 1, to: now) ?? now.addingTimeInterval(86_400)
    return at(hour: hour, minute: minute, onDayOf: tomorrow, timeZone: timeZone)
  }

  /// A moment as the app shows it: the time today, weekday and time within a week, otherwise
  /// the date.
  public static func when(
    _ date: Date, now: Date, timeZone: TimeZone = .current, locale: Locale = .current
  ) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = timeZone
    if calendar(timeZone).isDate(date, inSameDayAs: now) {
      formatter.setLocalizedDateFormatFromTemplate("jmm")
    } else if abs(date.timeIntervalSince(now)) < 6 * 86_400 {
      formatter.setLocalizedDateFormatFromTemplate("EEEjmm")
    } else {
      formatter.setLocalizedDateFormatFromTemplate("dMMM")
    }
    return formatter.string(from: date)
  }

  /// "HH:mm" settings as a date on a fixed UTC day, so time pickers in UTC show the wall clock.
  public static func clockDate(_ value: String) -> Date? {
    let parts = value.split(separator: ":").map { Int($0) }
    guard parts.count == 2, let hour = parts[0], let minute = parts[1], (0..<24).contains(hour),
      (0..<60).contains(minute)
    else { return nil }
    return Date(timeIntervalSince1970: TimeInterval(hour * 3600 + minute * 60))
  }
  public static func clockString(_ date: Date) -> String {
    let seconds = Int(date.timeIntervalSince1970.rounded(.down))
    let minutes = ((seconds % 86_400) + 86_400) % 86_400 / 60
    return String(format: "%02d:%02d", minutes / 60, minutes % 60)
  }
}

/// The Radar screen's one-line status.
public enum RadarStatusLine {
  public static func text(
    _ status: JSON, now: Date, timeZone: TimeZone = .current, locale: Locale = .current
  ) -> String {
    let settings = status["settings"]
    guard settings["enabled"].bool else { return "Off" }
    let paused = settings["pausedUntil"].string
    if let until = RadarTime.parse(paused), until > now {
      // "Until resumed" is stored as the far future.
      if paused == Radar.pausedUntilResumed || until.timeIntervalSince(now) > 365 * 86_400 {
        return "Paused"
      }
      return "Paused until " + RadarTime.when(until, now: now, timeZone: timeZone, locale: locale)
    }
    if status["sources"].array.contains(where: {
      $0["enabled"].bool && $0["state"].string == "revoked"
    }) {
      return "Needs reconnect"
    }
    if let next = RadarTime.parse(status["nextCycleAt"].string), next > now {
      return "Watching · next check "
        + RadarTime.when(next, now: now, timeZone: timeZone, locale: locale)
    }
    return "Watching"
  }
}

/// A Radar push (`kind: "radar"`), or a "Tell Negroni…" reply that could not be sent
/// (`kind: "radar_draft"`), read from the notification's string fields.
public struct RadarPush: Equatable, Sendable {
  public enum Action: String, CaseIterable, Sendable {
    case primary = "radar.primary"
    case later = "radar.later"
    case notImportant = "radar.not_important"
    case tell = "radar.tell"
    case brief = "radar.brief"
  }
  public enum Category: String, CaseIterable, Sendable {
    case reply = "RADAR_REPLY"
    case decide = "RADAR_DECIDE"
    case generic = "RADAR_GENERIC"
    case brief = "RADAR_BRIEF"
  }
  public enum Response: Equatable, Sendable {
    case open, primary, later, notImportant
    case tell(String)
  }
  public var updateID: String
  public var messageID: String
  public var threadID: String
  public var spaceID: String
  public var botID: String
  public var category: String
  /// What the owner typed, for a reply that could not be sent.
  public var draft: String
  /// The original notification's title, kept with a reply that could not be sent.
  public var title: String
  public var isDraft: Bool { !draft.isEmpty }

  public init?(_ fields: [String: String], category: String) {
    guard ["radar", "radar_draft"].contains(fields["kind"] ?? "") else { return nil }
    updateID = fields["updateId"] ?? ""
    messageID = fields["messageId"] ?? ""
    threadID = fields["threadId"] ?? ""
    spaceID = fields["spaceId"] ?? ""
    botID = fields["botId"] ?? ""
    self.category = category
    draft = fields["kind"] == "radar_draft" ? (fields["text"] ?? "").trimmed : ""
    title = (fields["title"] ?? "").trimmed
    if fields["kind"] == "radar_draft", draft.isEmpty { return nil }
  }
  /// Fields for a local notification that keeps a reply which could not be sent.
  public func draftFields(_ text: String, title: String) -> [String: String] {
    [
      "kind": "radar_draft", "updateId": updateID, "messageId": messageID, "threadId": threadID,
      "spaceId": spaceID, "botId": botID, "text": text, "title": title,
    ]
  }
  /// Our action identifiers; the default tap, "Open brief" and anything unknown open the chat.
  public static func response(action: String, text: String?) -> Response {
    switch Action(rawValue: action) {
    case .primary?: return .primary
    case .later?: return .later
    case .notImportant?: return .notImportant
    case .tell?: return .tell((text ?? "").trimmed)
    case .brief?, nil: return .open
    }
  }
  /// The words the primary action sends when the update has no offer to read.
  public var fallbackInstruction: String? {
    switch Category(rawValue: category) {
    case .reply?: return "Draft reply"
    case .decide?: return "Handle it"
    default: return nil
    }
  }
  /// The personal conversation, as a thread target.
  public var target: JSON { ["botId": .string(botID), "threadKind": "personal"] }
}

extension String {
  fileprivate var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

extension JSON {
  var doubleValue: Double? {
    if case .number(let value) = self, value.isFinite { return value }
    return nil
  }
}
