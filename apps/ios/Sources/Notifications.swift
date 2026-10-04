import NegroniCore
import UIKit
import UserNotifications

@MainActor final class Notifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notifications()
  static let threadUpdated = Notification.Name("negroni.threadUpdated")
  /// A notification opened while the app was still starting; handled once the tabs appear.
  private enum PendingOpen {
    case radar(RadarPush, RadarPush.Response), chat(ChatPush)
  }
  private var pending: PendingOpen?

  /// Runs before launch finishes so the response that launched the app is delivered.
  func prepare() {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    center.setNotificationCategories(Self.radarCategories)
  }
  func configure() {
    UNUserNotificationCenter.current().delegate = self
    Task {
      let settings = await UNUserNotificationCenter.current().notificationSettings()
      if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
      {
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }
  func request() async throws {
    let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [
      .alert, .badge, .sound,
    ])
    guard granted else {
      throw APIError(status: 0, message: "Notifications are disabled in iOS Settings.")
    }
    UIApplication.shared.registerForRemoteNotifications()
  }
  func register(_ data: Data) {
    let token = data.map { String(format: "%02x", $0) }.joined()
    #if DEBUG
      let environment = "development"
    #else
      let environment = "production"
    #endif
    Task {
      _ = try? await API.shared.rpc(
        "notifications/registerPush",
        ["provider": "apns", "token": .string(token), "environment": .string(environment)])
    }
  }

  /// Radar actions by category: the primary step opens the app, Later and Not important run in
  /// the background, and "Tell Negroni…" sends a typed instruction without opening it.
  private static var radarCategories: Set<UNNotificationCategory> {
    func action(
      _ id: RadarPush.Action, _ title: String, _ symbol: String,
      _ options: UNNotificationActionOptions = []
    ) -> UNNotificationAction {
      UNNotificationAction(
        identifier: id.rawValue, title: title, options: options,
        icon: UNNotificationActionIcon(systemImageName: symbol))
    }
    let later = action(.later, "Later", "clock")
    let notImportant = action(.notImportant, "Not important", "hand.thumbsdown", [.destructive])
    let tell = UNTextInputNotificationAction(
      identifier: RadarPush.Action.tell.rawValue, title: "Tell Negroni…", options: [],
      icon: UNNotificationActionIcon(systemImageName: "text.bubble"), textInputButtonTitle: "Send",
      textInputPlaceholder: "Message…")
    func category(_ id: RadarPush.Category, _ actions: [UNNotificationAction])
      -> UNNotificationCategory
    {
      UNNotificationCategory(
        identifier: id.rawValue, actions: actions, intentIdentifiers: [], options: [])
    }
    let primary = [
      RadarPush.Category.reply: ("Draft reply", "arrowshape.turn.up.left"),
      .decide: ("Handle it", "checkmark.circle"), .generic: ("Open", "arrow.up.forward.app"),
    ]
    return Set(
      primary.map { id, label in
        category(id, [action(.primary, label.0, label.1, [.foreground]), later, notImportant, tell])
      } + [category(.brief, [action(.brief, "Open brief", "sun.horizon", [.foreground]), tell])])
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let info = notification.request.content.userInfo
    let kind = info["kind"] as? String
    let threadID = info["threadId"] as? String
    let spaceID = info["spaceId"] as? String
    present(kind: kind, threadID: threadID, spaceID: spaceID, completionHandler: completionHandler)
  }
  private nonisolated func present(kind: String?, threadID: String?, spaceID: String?,
    completionHandler: @escaping (UNNotificationPresentationOptions) -> Void)
  {
    Task { @MainActor in
      completionHandler(presentationOptions(kind: kind, threadID: threadID, spaceID: spaceID))
    }
  }
  private func presentationOptions(kind: String?, threadID: String?, spaceID: String?) -> UNNotificationPresentationOptions {
    // A reply that could not be sent always shows, even over its own conversation.
    if kind == "radar_draft" { return [.banner, .list] }
    // Reconcile the conversation even when its notification stays silent.
    NotificationCenter.default.post(name: Self.threadUpdated, object: nil)
    let visibleChats = UIApplication.shared.connectedScenes
      .filter { $0.activationState == .foregroundActive }
      .compactMap { ($0.delegate as? SceneDelegate)?.topController as? ChatController }
    let alreadyVisible = visibleChats.contains { chat in
      ChatNotificationPolicy.suppress(
        threadID: threadID, spaceID: spaceID, visibleThreadID: chat.notificationThreadID,
        visibleSpaceID: API.shared.spaceID,
        foreground: UIApplication.shared.applicationState == .active)
    }
    return alreadyVisible ? [] : [.banner, .list]
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let content = response.notification.request.content
    var fields: [String: String] = [:]
    for (key, value) in content.userInfo {
      if let key = key as? String, let value = value as? String { fields[key] = value }
    }
    let action = response.actionIdentifier
    let typed = (response as? UNTextInputNotificationResponse)?.userText
    let title = content.title
    respond(fields: fields, category: content.categoryIdentifier, action: action,
      typed: typed, title: title, completionHandler: completionHandler)
  }
  // Finish iOS's response on the main thread as well as navigation. Avoid the async ObjC
  // bridge returning the system completion to a generic executor.
  private nonisolated func respond(fields: [String: String], category: String, action: String,
    typed: String? = nil, title: String = "", completionHandler: @escaping () -> Void)
  {
    Task { @MainActor in
      defer { completionHandler() }
      await receive(fields: fields, category: category, action: action, typed: typed, title: title)
    }
  }
  func receive(fields: [String: String], category: String, action: String, typed: String? = nil, title: String = "") async {
    guard action != UNNotificationDismissActionIdentifier else { return }
    if let push = RadarPush(fields, category: category) {
      // Returning ends the system's time for a background action, so the work is awaited.
      await handle(push, RadarPush.response(action: action, text: typed), title: title)
      return
    }
    guard let push = ChatPush(fields) else { return }
    receiveChat(push)
  }
  func receiveChat(_ push: ChatPush) {
    if let tabs = Self.tabs { openChat(push, in: tabs) } else { pending = .chat(push) }
  }

  private static var tabs: MainTabController? {
    (UIApplication.shared.connectedScenes.first?.delegate as? SceneDelegate)?.window?
      .rootViewController as? MainTabController
  }
  private func handle(_ push: RadarPush, _ response: RadarPush.Response, title: String) async {
    switch response {
    case .later, .notImportant, .tell:
      // A background launch has not read the account yet; the push names its space. While the
      // app starts in front, startup sets it instead.
      if API.shared.spaceID.isEmpty, Self.tabs == nil,
        UIApplication.shared.applicationState != .active
      {
        API.shared.spaceID = push.spaceID
      }
    case .open, .primary:
      break
    }
    switch response {
    case .later:
      try? await RadarStore.shared.feedback(
        push.updateID, "snooze", until: Date().addingTimeInterval(3600), timeout: 20)
    case .notImportant:
      try? await RadarStore.shared.feedback(push.updateID, "not_important", timeout: 20)
    case .tell(let text):
      await tell(text, push, title: title)
    case .open, .primary:
      if let tabs = Self.tabs {
        open(push, response, in: tabs)
      } else {
        pending = .radar(push, response)
      }
    }
  }
  /// "Tell Negroni…": the typed text goes to the personal conversation with the update
  /// attached. What could not be sent is kept in a notification that reopens it in the chat.
  private func tell(_ text: String, _ push: RadarPush, title: String) async {
    guard !text.isEmpty else { return }
    var input = push.target.merging([
      "text": .string(text), "clientNonce": .string(UUID().uuidString),
    ])
    if !push.updateID.isEmpty { input["radarUpdateId"] = .string(push.updateID) }
    do {
      _ = try await API.shared.rpc("threads/send", input, interactive: false, timeout: 12)
    } catch {
      let content = UNMutableNotificationContent()
      content.title = "Not sent"
      content.body = text
      content.userInfo = push.draftFields(text, title: title)
      try? await UNUserNotificationCenter.current().add(
        UNNotificationRequest(
          identifier: "radar-draft-" + UUID().uuidString, content: content, trigger: nil))
    }
  }
  func flush(_ tabs: MainTabController) {
    guard let pending else { return }
    self.pending = nil
    switch pending {
    case .radar(let push, let response): open(push, response, in: tabs)
    case .chat(let push): openChat(push, in: tabs)
    }
  }
  private func openChat(_ push: ChatPush, in tabs: MainTabController) {
    guard push.spaceID.isEmpty || push.spaceID == API.shared.spaceID else { return }
    let target = push.target(mainBotID: tabs.botID)
    tabs.showPersonalChat { personal in
      guard let nav = personal.navigationController else { return }
      if target == personal.target {
        personal.loadViewIfNeeded()
        personal.focus(messageID: push.messageID)
      } else {
        let chat = ChatController(target: target, title: push.groupID.isEmpty ? nil : "Group")
        chat.loadViewIfNeeded()
        nav.pushViewController(chat, animated: false)
        chat.focus(messageID: push.messageID)
      }
    }
  }
  /// The personal conversation at the update's message; the primary action also sends the
  /// offer (or opens the source) as the card's button would.
  private func open(_ push: RadarPush, _ response: RadarPush.Response, in tabs: MainTabController)
  {
    guard push.spaceID.isEmpty || push.spaceID == API.shared.spaceID else { return }
    tabs.showPersonalChat { chat in
      chat.loadViewIfNeeded()
      if push.isDraft {
        chat.restoreDraft(push)
        return
      }
      chat.focus(messageID: push.messageID)
      guard !push.updateID.isEmpty else { return }
      guard response == .primary else {
        Task { try? await RadarStore.shared.feedback(push.updateID, "opened") }
        return
      }
      Task {
        let item = await RadarStore.shared.update(push.updateID)
        if let item, item.primary.kind == .open {
          chat.openRadarSource(item)
        } else if let text = item?.primary.title ?? push.fallbackInstruction {
          chat.sendRadar(text, updateID: push.updateID)
        } else {
          try? await RadarStore.shared.feedback(push.updateID, "opened")
        }
      }
    }
  }
}
