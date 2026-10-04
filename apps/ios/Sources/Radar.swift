import NegroniCore
import UIKit

/// What the owner did to an update on this device, until the server's lists catch up.
enum RadarOutcome: Equatable {
  case done, notImportant, muted, important, always, sent
  case later(Date)
  init?(feedback kind: String, until: Date?) {
    switch kind {
    case "done": self = .done
    case "not_important": self = .notImportant
    case "mute_sender": self = .muted
    case "important": self = .important
    case "always_sender": self = .always
    case "snooze":
      guard let until else { return nil }
      self = .later(until)
    default: return nil
    }
  }
  /// The update is settled: cards stop offering their actions. A snooze lasts until its time,
  /// when the update comes back.
  var settles: Bool {
    switch self {
    case .done, .notImportant, .muted: return true
    case .later(let date): return date > Date()
    case .important, .always, .sent: return false
    }
  }
  var label: String? {
    switch self {
    case .done: return "Done"
    case .notImportant: return "Not important"
    case .muted: return "Never about this"
    case .later(let date): return "Later · " + RadarTime.when(date, now: Date())
    case .important, .always, .sent: return nil
    }
  }
}

@MainActor final class RadarStore {
  static let shared = RadarStore()
  /// The owner acted on an update here; lists and cards that show it redraw.
  static let outcomesChanged = Notification.Name("negroni.radar.outcomes")
  /// The open list was read again; chat cards redraw.
  static let openChanged = Notification.Name("negroni.radar.open")
  private(set) var status: JSON?
  private(set) var outcomes: [String: RadarOutcome] = [:]
  private var openIDs = Set<String>(), checkedIDs = Set<String>(), seenMessages = Set<String>()
  private var openTask: Task<Void, Never>?
  private var openReadAt: Date?
  /// Bumped when cards become unchecked, so a read already in flight does not check them.
  private var openGeneration = 0
  /// Cards keep these across redraws.
  var expandedQuotes = Set<String>(), expandedBriefs = Set<String>()

  /// Later, pause and brief times are wall-clock times in Radar's zone, not the phone's.
  var timeZone: TimeZone {
    TimeZone(identifier: status?["settings"]["timeZone"].string ?? "") ?? .current
  }
  var rules: [RadarRule] { status?["rules"].array.compactMap(RadarRule.init) ?? [] }

  @discardableResult func loadStatus() async throws -> JSON {
    let next = try await API.shared.rpc("radar/status")
    status = next
    return next
  }
  func apply(_ next: JSON) { status = next }

  /// Whether a card still offers its actions. An update counts as settled once the owner acted
  /// here, or when the open list read after the card appeared no longer has it.
  func isOpen(_ id: String) -> Bool {
    if outcomes[id]?.settles == true { return false }
    return !checkedIDs.contains(id) || openIDs.contains(id)
  }
  /// The chat came back: closures that happened elsewhere show on the next read.
  func invalidateOpen() {
    checkedIDs = []
    openReadAt = nil
    openGeneration += 1
  }
  /// Cards in view, by message and update: reads the open list again when one of them has not
  /// been checked yet. A card in a new message (a snoozed update coming back, say) counts as
  /// unchecked, so it offers its actions until the list says otherwise.
  func track(_ cards: [(message: String, update: String)]) {
    let fresh = cards.filter { !seenMessages.contains($0.message) }
    if !fresh.isEmpty {
      seenMessages.formUnion(fresh.map(\.message))
      checkedIDs.subtract(fresh.map(\.update))
      openReadAt = nil
      openGeneration += 1
    }
    let ids = cards.map(\.update)
    guard ids.contains(where: { !checkedIDs.contains($0) }), openTask == nil,
      openReadAt.map({ Date().timeIntervalSince($0) > 30 }) ?? true
    else { return }
    let checking = Set(ids)
    let generation = openGeneration
    openReadAt = Date()
    openTask = Task { [weak self] in
      if self?.status == nil { _ = try? await self?.loadStatus() }
      let page = try? await API.shared.rpc("radar/updates", ["view": "open", "limit": 100])
      guard let self else { return }
      openTask = nil
      // One page cannot prove that an update beyond it is closed.
      guard let page, page["nextCursor"].isNull else { return }
      openIDs = Set(page["items"].array.map { $0["id"].string })
      if generation == openGeneration { checkedIDs.formUnion(checking) }
      NotificationCenter.default.post(name: Self.openChanged, object: nil)
    }
  }

  func feedback(_ id: String, _ kind: String, until: Date? = nil, timeout: TimeInterval = 30)
    async throws
  {
    var input: JSON = ["id": .string(id), "kind": .string(kind)]
    if let until { input["until"] = .string(RadarTime.iso(until)) }
    _ = try await API.shared.rpc("radar/feedback", input, timeout: timeout)
    if let outcome = RadarOutcome(feedback: kind, until: until) { record(id, outcome) }
  }
  func record(_ id: String, _ outcome: RadarOutcome?) {
    outcomes[id] = outcome
    NotificationCenter.default.post(name: Self.outcomesChanged, object: nil)
  }

  /// One update as the server stores it, decision trace included (`radar/update`, read only).
  func update(_ id: String) async -> RadarItem? {
    guard let view = try? await API.shared.rpc("radar/update", ["id": .string(id)]) else {
      return nil
    }
    return RadarItem(view)
  }
}

enum RadarSourceMark {
  static func symbol(_ source: String) -> String {
    switch source {
    case "gmail": return "envelope"
    case "googlecalendar": return "calendar"
    case "granola_mcp": return "waveform"
    case "slack": return "number"
    case "todoist": return "checklist"
    case "googledrive": return "doc"
    default: return "app"
    }
  }
  @MainActor private static var missing = Set<String>()
  /// The source's symbol at once, replaced by the connector's logo when the server has one.
  @MainActor static func load(_ source: String, into view: UIImageView) -> Task<Void, Never>? {
    view.image = UIImage(systemName: symbol(source))
    view.tintColor = Theme.muted
    guard !source.isEmpty, !missing.contains(source) else { return nil }
    return Task { [weak view] in
      let image = await ImageStore.shared.connectionImage(
        nil, request: ["connectorId": "composio", "provider": .string(source)])
      guard !Task.isCancelled else { return }
      guard let image else {
        missing.insert(source)
        return
      }
      view?.image = image.withRenderingMode(.alwaysOriginal)
    }
  }
}

extension UIViewController {
  var radarTabs: MainTabController? {
    (view.window?.rootViewController ?? tabBarController) as? MainTabController
  }
  /// The primary button: hand the offer to the personal conversation, or open the source.
  func acceptRadar(_ item: RadarItem) {
    let primary = item.primary
    switch primary.kind {
    case .open: openRadarSource(item)
    case .send: radarTabs?.sendRadar(primary.title, updateID: item.id)
    }
  }
  func openRadarSource(_ item: RadarItem) {
    guard let url = item.url else { return }
    UIApplication.shared.open(url)
    Task { try? await RadarStore.shared.feedback(item.id, "opened") }
  }
  func radarFeedback(_ item: RadarItem, _ kind: String, until: Date? = nil) {
    Task { [weak self] in
      do {
        try await RadarStore.shared.feedback(item.id, kind, until: until)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      } catch { self?.showError(error) }
    }
  }
  /// Later: the times are read when the menu opens, in the Radar time zone.
  func radarLaterMenu(_ item: RadarItem, inline: Bool = false) -> UIMenu {
    UIMenu(
      title: inline ? "" : "Later", image: UIImage(systemName: "clock"),
      options: inline ? .displayInline : [],
      children: [
        UIDeferredMenuElement.uncached { [weak self] completion in
          completion(
            RadarTime.later(now: Date(), timeZone: RadarStore.shared.timeZone).map { choice in
              UIAction(title: choice.option.title) { _ in
                self?.radarFeedback(item, "snooze", until: choice.date)
              }
            })
        }
      ])
  }
  func presentRadarLater(_ item: RadarItem, from source: UIView?) {
    let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
    for choice in RadarTime.later(now: Date(), timeZone: RadarStore.shared.timeZone) {
      sheet.addAction(
        UIAlertAction(title: choice.option.title, style: .default) { [weak self] _ in
          self?.radarFeedback(item, "snooze", until: choice.date)
        })
    }
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    sheet.popoverPresentationController?.sourceView = source ?? view
    present(sheet, animated: true)
  }
  /// Never about this, Always tell me (both need a sender address) and Why this.
  func radarMoreActions(_ item: RadarItem, why: Bool = true) -> [UIMenuElement] {
    var actions: [UIMenuElement] = []
    if item.hasSenderAddress {
      actions.append(
        UIAction(title: "Never about this", image: UIImage(systemName: "bell.slash")) {
          [weak self] _ in self?.radarFeedback(item, "mute_sender")
        })
      actions.append(
        UIAction(
          title: "Always tell me", image: UIImage(systemName: "bell.badge"),
          state: RadarStore.shared.outcomes[item.id] == .always ? .on : .off
        ) { [weak self] _ in self?.radarFeedback(item, "always_sender") })
    }
    if why {
      actions.append(
        UIAction(title: "Why this", image: UIImage(systemName: "questionmark.circle")) {
          [weak self] _ in self?.presentRadar(item, mode: .why)
        })
    }
    return actions
  }
  /// Every action on one menu, for compact rows and long presses.
  func radarActionsMenu(_ item: RadarItem) -> UIMenu {
    guard RadarStore.shared.isOpen(item.id) else {
      return UIMenu(children: radarMoreActions(item))
    }
    let primary = item.primary
    return UIMenu(children: [
      UIMenu(
        options: .displayInline,
        children: [
          UIAction(
            title: primary.title,
            image: UIImage(systemName: primary.kind == .open ? "arrow.up.forward" : "sparkles"),
            attributes: RadarStore.shared.outcomes[item.id] == .sent ? .disabled : []
          ) { [weak self] _ in self?.acceptRadar(item) },
          radarLaterMenu(item),
          UIAction(title: "Not important", image: UIImage(systemName: "hand.thumbsdown")) {
            [weak self] _ in self?.radarFeedback(item, "not_important")
          },
        ]),
      UIMenu(options: .displayInline, children: radarMoreActions(item)),
    ])
  }
  func presentRadar(_ item: RadarItem, mode: RadarUpdateController.Mode) {
    let nav = UINavigationController(
      rootViewController: RadarUpdateController(item: item, mode: mode))
    nav.modalPresentationStyle = .pageSheet
    nav.sheetPresentationController?.detents = [.medium(), .large()]
    nav.sheetPresentationController?.prefersGrabberVisible = true
    present(nav, animated: true)
  }
}
