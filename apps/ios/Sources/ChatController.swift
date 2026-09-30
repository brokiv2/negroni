import ImageIO
import NegroniCore
import PhotosUI
import QuickLook
import UIKit
import UniformTypeIdentifiers

final class ChatController: UIViewController, UITableViewDataSource, UITableViewDelegate,
  UIDocumentPickerDelegate, PHPickerViewControllerDelegate
{
  let target: JSON
  let composer = ComposerView()
  private let table = UITableView(frame: .zero, style: .plain)
  private var snapshot: JSON = [:], messages: [JSON] = [], bot: JSON = [:]
  private var stream: Task<Void, Never>?, refreshTask: Task<Void, Never>?,
    statusTask: Task<Void, Never>?
  private var attachments: [JSON] = []
  private var outgoing: [JSON] = []
  private var threadModel: JSON?
  private var modelPreferenceKey: String {
    "chat-model:\(API.shared.base.absoluteString):\(API.shared.spaceID):\(target["groupId"].string):\(target["feedItemId"].string)"
  }
  private let workingIndicator = ChatWorkingView()
  private let toolActivity = ToolActivityView()
  private let activityFooter = UIStackView()
  private let activityCell = UITableViewCell()
  private var hasActivity = false
  private var followsLatest = true
  private var adjustingScroll = false
  private var renderedActions: [JSON] = []
  private var renderedWorking = false
  private var answering = Set<String>()
  private var activities: [JSON] = []
  private var activityTask: Task<Void, Never>?

  private var cursor = -1
  private var lastReadCursor = -2
  private var earlierMessages: [JSON] = []
  private var olderCursor: JSON = .null
  private let connection = UIButton(type: .system)
  private let identity = UIButton(type: .system)
  private var previousViewportHeight: CGFloat = 0
  private var connectedApps: [JSON] = []
  private var active = false
  var notificationThreadID: String { snapshot["threadId"].string }
  init(target: JSON, title: String? = nil) {
    self.target = target
    super.init(nibName: nil, bundle: nil)
    self.title = title
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    navigationItem.largeTitleDisplayMode = .never
    table.backgroundColor = .clear
    table.separatorStyle = .none
    table.keyboardDismissMode = .interactive
    table.dataSource = self
    table.delegate = self
    table.estimatedRowHeight = 140
    table.rowHeight = UITableView.automaticDimension
    table.register(MessageCell.self, forCellReuseIdentifier: "message")
    table.contentInset = UIEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
    table.refreshControl = UIRefreshControl()
    table.refreshControl?.addTarget(self, action: #selector(refreshOlder), for: .valueChanged)
    view.addSubview(table)
    view.addSubview(composer)
    table.translatesAutoresizingMaskIntoConstraints = false
    composer.translatesAutoresizingMaskIntoConstraints = false
    view.keyboardLayoutGuide.followsUndockedKeyboard = true
    NSLayoutConstraint.activate([
      table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      table.bottomAnchor.constraint(equalTo: composer.topAnchor),
      composer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
    ])
    composer.onSend = { [weak self] text in self?.send(text) }
    composer.onStop = { [weak self] in self?.stop() }
    composer.onError = { [weak self] in self?.showError($0) }
    composer.onAttach = { [weak self] in self?.attachFile() }
    composer.onVoiceSettings = { [weak self] in
      self?.navigationController?.pushViewController(VoiceSettingsController(), animated: true)
    }
    activityCell.backgroundColor = .clear
    activityCell.selectionStyle = .none
    activityCell.contentView.addSubview(activityFooter)
    activityFooter.pin(to: activityCell.contentView)
    activityFooter.axis = .vertical
    let workingHeight = workingIndicator.heightAnchor.constraint(equalToConstant: 64)
    workingHeight.priority = .init(999)
    workingHeight.isActive = true
    activityFooter.addArrangedSubview(toolActivity)
    activityFooter.addArrangedSubview(workingIndicator)
    toolActivity.onOpen = { [weak self] in self?.openActivity() }
    setupHeader()
    NotificationCenter.default.addObserver(
      self, selector: #selector(pushReceived), name: Notifications.threadUpdated, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification,
      object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification,
      object: nil)
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    active = true
    connect()
  }
  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    active = false
    disconnect()
    composer.cancelRecording()
  }
  @objc private func background() {
    disconnect()
    composer.cancelRecording()
  }
  @objc private func foreground() { if active { connect() } }
  @objc private func pushReceived() {
    guard active else { return }
    Task { try? await refresh() }
  }
  private func setupHeader() {
    if target["groupId"].isNull && target["feedItemId"].isNull {
      let stack = Theme.stack(spacing: 0)
      stack.alignment = .center
      identity.setTitleColor(Theme.ink, for: .normal)
      identity.titleLabel?.font = .preferredFont(forTextStyle: .headline)
      identity.tintColor = Theme.ink
      identity.configuration = .plain()
      identity.configuration?.title = title ?? "Negroni"
      identity.configuration?.image = RobotAvatar.image(
        color: "", size: 28, main: target["threadKind"].string == "personal")
      identity.configuration?.imagePadding = 7
      identity.configuration?.contentInsets = .zero
      identity.configuration?.titleLineBreakMode = .byTruncatingTail
      identity.configuration?.titleTextAttributesTransformer =
        UIConfigurationTextAttributesTransformer { attributes in
          var result = attributes
          result.font = .preferredFont(forTextStyle: .headline)
          return result
        }
      identity.widthAnchor.constraint(greaterThanOrEqualToConstant: 140).isActive = true
      identity.titleLabel?.numberOfLines = 1
      identity.addAction(
        UIAction { [weak self] _ in
          guard let self else { return }
          self.navigationController?.pushViewController(
            AssistantSettingsController(botID: self.target["botId"].string), animated: true)
        }, for: .touchUpInside)
      connection.setTitle("Checking Mac…", for: .normal)
      connection.setTitleColor(Theme.muted, for: .normal)
      connection.titleLabel?.font = .preferredFont(forTextStyle: .caption2)
      connection.addAction(
        UIAction { [weak self] _ in
          guard let self else { return }
          self.navigationController?.pushViewController(
            ComputerController(botID: self.target["botId"].string), animated: true)
        }, for: .touchUpInside)
      stack.addArrangedSubview(identity)
      stack.addArrangedSubview(connection)
      let titleView = UIView(frame: CGRect(x: 0, y: 0, width: 200, height: 48))
      titleView.addSubview(stack)
      stack.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        stack.centerXAnchor.constraint(equalTo: titleView.centerXAnchor),
        stack.centerYAnchor.constraint(equalTo: titleView.centerYAnchor),
        stack.widthAnchor.constraint(equalTo: titleView.widthAnchor),
      ])
      navigationItem.titleView = titleView
    }
    let menu = UIMenu(children: [
      UIAction(title: "Ongoing work", image: UIImage(systemName: "clock.arrow.circlepath")) {
        [weak self] _ in
        guard let self else { return }
        self.navigationController?.pushViewController(
          AssistantWorkController(target: self.target), animated: true)
      },
      UIAction(title: "Models", image: UIImage(systemName: "cpu")) { [weak self] _ in
        self?.navigationController?.pushViewController(ModelsController(), animated: true)
      },
    ])
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "ellipsis"), menu: menu)
  }
  private func connect() {
    guard stream == nil else { return }
    stream = Task { [weak self] in
      guard let self else { return }
      do {
        try await refresh()
      } catch { showConnectionError(error) }
      while !Task.isCancelled && active {
        do {
          try await API.shared.subscribe(target: target, cursor: cursor) { [weak self] event in
            self?.received(event)
          }
        } catch { if Task.isCancelled { break } }
        if Task.isCancelled { break }
        try? await Task.sleep(for: .seconds(1))
        do { try await refresh() } catch { showConnectionError(error) }
      }
    }
    statusTask = Task { [weak self] in
      await self?.refreshIdentity()
      await self?.loadModels()
      await self?.refreshComputer()
      await self?.refreshConnectedApps()
      var ticks = 0
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(4))
        if Task.isCancelled { break }
        // Reconcile even if a proxy leaves an apparently open stream stalled.
        ticks += 1
        if self?.composer.running == true || ticks % 5 == 0 { try? await self?.refresh() }
        if ticks % 5 == 0 {
          await self?.refreshIdentity()
          await self?.refreshComputer()
          await self?.refreshConnectedApps()
        }
      }
    }
  }
  private func disconnect() {
    stream?.cancel()
    stream = nil
    refreshTask?.cancel()
    refreshTask = nil
    statusTask?.cancel()
    statusTask = nil
    activityTask?.cancel()
    activityTask = nil
  }
  private func received(_ event: JSON) {
    cursor = max(cursor, event["seq"].int)
    if event["type"].string == "thread.cleared" {
      earlierMessages = []
      olderCursor = .null
    }
    let next = ThreadLogic.apply(event, to: snapshot)
    if next != snapshot { render(next) }
    // Reconcile server-derived blocks at most four times a second during a stream.
    guard refreshTask == nil else { return }
    refreshTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled, let self else { return }
      try? await refresh()
      refreshTask = nil
    }
  }
  private func refresh() async throws {
    let next = try await API.shared.rpc("threads/get", target)
    try Task.checkCancellation()
    guard next["cursor"].int >= cursor else { return }
    render(next)
    if activityTask == nil {
      activityTask = Task { [weak self] in
        guard let self else { return }
        defer { activityTask = nil }
        if let result = try? await API.shared.rpc("threads/activity", target), !Task.isCancelled {
          activities = result.array
          render(snapshot)
        }
      }
    }
    composer.ready = true
    cursor = max(cursor, next["cursor"].int)
    if lastReadCursor != cursor {
      _ = try? await API.shared.rpc("threads/markRead", target)
      lastReadCursor = cursor
    }
  }
  private func render(_ next: JSON) {
    let nearBottom = followsLatest && !table.isDragging && !table.isDecelerating
    let hadActivity = hasActivity
    let wasAdjusting = adjustingScroll
    adjustingScroll = true
    defer { adjustingScroll = wasAdjusting }
    let first = messages.isEmpty
    snapshot = next
    let latest = next["messages"].array.filter { !ThreadLogic.visibleBlocks($0).isEmpty }
    let latestIDs = Set(latest.map { $0["id"].string })
    outgoing = ThreadLogic.unconfirmed(outgoing, in: latest)
    let rows = earlierMessages.filter { !latestIDs.contains($0["id"].string) } + latest + outgoing
    if earlierMessages.isEmpty { olderCursor = next["olderCursor"] }
    composer.running = ThreadLogic.running(next) || !outgoing.isEmpty || composer.sending
    let working = ThreadLogic.working(next) || !outgoing.isEmpty || composer.sending
    workingIndicator.configure(
      name: title ?? "Assistant", color: bot["color"].string,
      main: target["threadKind"].string == "personal")
    let currentRun = next["run"]["id"].string
    let activityRun = currentRun.isEmpty ? latest.last?["runId"].string ?? "" : currentRun
    let actions = activities.filter { $0["runId"].string == activityRun }
    toolActivity.isHidden = actions.isEmpty || !outgoing.isEmpty
    workingIndicator.isHidden = !working
    let activityChanged = actions != renderedActions || working != renderedWorking
    renderedActions = actions
    renderedWorking = working
    toolActivity.configure(actions)
    hasActivity = !toolActivity.isHidden || working
    if rows.isEmpty {
      let empty = UIView()
      let welcome = Theme.stack(spacing: 18)
      welcome.alignment = .center
      let mascot = UIImageView(
        image: RobotAvatar.image(
          color: bot["color"].string, size: 88, main: target["threadKind"].string == "personal"))
      welcome.addArrangedSubview(mascot)
      welcome.addArrangedSubview(Theme.label("What’s on your mind?", style: .title3))
      empty.addSubview(welcome)
      welcome.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        welcome.centerXAnchor.constraint(equalTo: empty.centerXAnchor),
        welcome.centerYAnchor.constraint(equalTo: empty.centerYAnchor, constant: -35),
      ])
      table.backgroundView = empty
    } else {
      table.backgroundView = nil
    }
    guard rows != messages || hasActivity != hadActivity else {
      if activityChanged {
        // Tool text can change height without changing any chat message.
        UIView.performWithoutAnimation {
          table.performBatchUpdates(nil) { [weak self] _ in
            if nearBottom { self?.scrollToEnd(animated: false) }
          }
        }
      }
      return
    }
    let previous = messages
    messages = rows
    if previous.count <= rows.count && zip(previous, rows).allSatisfy({ $0["id"] == $1["id"] }) {
      let changed = previous.indices.filter { previous[$0] != rows[$0] }.map {
        IndexPath(row: $0, section: 0)
      }
      let inserted = (previous.count..<rows.count).map { IndexPath(row: $0, section: 0) }
      UIView.performWithoutAnimation {
        table.performBatchUpdates {
          if hasActivity != hadActivity {
            let path = IndexPath(row: 0, section: 1)
            if hasActivity {
              table.insertRows(at: [path], with: .none)
            } else {
              table.deleteRows(at: [path], with: .none)
            }
          }
          if !changed.isEmpty { table.reloadRows(at: changed, with: .none) }
          if !inserted.isEmpty { table.insertRows(at: inserted, with: .none) }
        } completion: { [weak self] _ in
          if nearBottom || first { self?.scrollToEnd(animated: false) }
        }
      }
    } else {
      table.reloadData()
    }
    table.layoutIfNeeded()
    if nearBottom || first { scrollToEnd(animated: false) }
  }
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let height = table.bounds.height
    if previousViewportHeight > 0, abs(height - previousViewportHeight) > 1,
      followsLatest, !table.isDragging, !table.isDecelerating
    {
      scrollToEnd(animated: false)
    }
    previousViewportHeight = height
  }
  private func scrollToEnd(animated: Bool) {
    let wasAdjusting = adjustingScroll
    adjustingScroll = true
    defer { adjustingScroll = wasAdjusting }
    if !messages.isEmpty {
      table.layoutIfNeeded()
      let bottom = max(
        -table.adjustedContentInset.top,
        table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
      table.setContentOffset(
        CGPoint(x: 0, y: bottom),
        animated: animated && !UIAccessibility.isReduceMotionEnabled)
    }
  }
  private func showConnectionError(_ error: Error) {
    guard !Task.isCancelled else { return }
    if let error = error as? APIError, error.status == 401 {
      API.shared.invalidateSession()
      SceneDelegate.restart()
      return
    }
    guard messages.isEmpty else { return }
    let stack = Theme.stack()
    stack.addArrangedSubview(
      Theme.label(error.localizedDescription, style: .callout, color: Theme.muted))
    stack.addArrangedSubview(
      Theme.button(
        "Try again",
        action: { [weak self] in
          self?.disconnect()
          self?.connect()
        }))
    let container = UIView()
    container.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
    ])
    table.backgroundView = container
  }
  @objc private func refreshOlder() {
    Task {
      defer { table.refreshControl?.endRefreshing() }
      do {
        guard !olderCursor.isNull else {
          try await refresh()
          return
        }
        let page = try await API.shared.rpc(
          "threads/messages", target.merging(["before": olderCursor]))
        let existing = Set(messages.map { $0["id"].string })
        let earlier = page["messages"].array.filter {
          !existing.contains($0["id"].string) && !ThreadLogic.visibleBlocks($0).isEmpty
        }
        let height = table.contentSize.height
        earlierMessages = earlier + earlierMessages
        messages = earlier + messages
        olderCursor = page["olderCursor"]
        snapshot["olderCursor"] = olderCursor
        snapshot["messages"] = .array(messages)
        table.reloadData()
        table.layoutIfNeeded()
        table.contentOffset.y += table.contentSize.height - height
      } catch { showError(error) }
    }
  }
  private func refreshComputer() async {
    guard !target["botId"].string.isEmpty else { return }
    do {
      let status = try await API.shared.rpc("computer/status", ["botId": target["botId"]])
      let desktop = status["kind"].string == "desktop"
      connection.setTitle(
        desktop
          ? "Mac connected"
          : status["state"].string == "running" ? "Computer ready" : "Computer sleeping",
        for: .normal)

    } catch { connection.setTitle("Mac unavailable · Retry", for: .normal) }
  }
  private func refreshIdentity() async {
    guard !target["botId"].string.isEmpty else { return }
    guard let current = try? await API.shared.rpc("bots/get", ["botId": target["botId"]]),
      !Task.isCancelled
    else { return }
    bot = current
    title = current["name"].string
    identity.configuration?.title = title
    identity.configuration?.image = RobotAvatar.image(
      color: current["color"].string, size: 28, main: target["threadKind"].string == "personal")
  }
  private func loadModels() async {
    do {
      async let choices = API.shared.rpc("models/choices")
      async let routing = API.shared.rpc("models/routing")
      let current: JSON
      if !target["botId"].string.isEmpty {
        current = try await API.shared.rpc("bots/get", ["botId": target["botId"]])
      } else {
        if let data = UserDefaults.standard.data(forKey: modelPreferenceKey) {
          threadModel = try? JSON.decode(data)
        }
        current = [
          "modelId": threadModel?["modelId"] ?? .null,
          "modelProvider": threadModel?["provider"] ?? .null,
        ]
      }
      let (catalog, routes) = try await (choices, routing)
      let bot = current
      composer.modelButton.isHidden = false
      let selected = bot["modelId"].string
      var actions: [UIMenuElement] = [
        UIAction(title: "Auto", state: selected.isEmpty ? .on : .off) { [weak self] _ in
          self?.chooseModel(nil)
        }
      ]
      for route in routes["enabled"].array {
        let model = catalog.array.first {
          $0["id"] == route["modelId"] && $0["provider"] == route["provider"]
        }
        let label = model?["label"].string ?? route["modelId"].string
        let provider = model?["providerName"].string ?? route["provider"].string
        actions.append(
          UIAction(
            title: label, subtitle: provider,
            state: selected == route["modelId"].string && bot["modelProvider"] == route["provider"]
              ? .on : .off
          ) { [weak self] _ in self?.chooseModel(route) })
      }
      actions.append(
        UIMenu(
          options: .displayInline,
          children: [
            UIAction(title: "Manage models…", image: UIImage(systemName: "gearshape")) {
              [weak self] _ in
              self?.navigationController?.pushViewController(ModelsController(), animated: true)
            }
          ]))
      composer.modelButton.menu = UIMenu(title: "Chat model", children: actions)
      composer.modelButton.configuration?.title =
        selected.isEmpty
        ? "Auto"
        : catalog.array.first {
          $0["id"].string == selected && $0["provider"] == bot["modelProvider"]
        }?["label"].string ?? selected
    } catch {
      composer.modelButton.configuration?.title = "Retry models"
      composer.modelButton.menu = UIMenu(children: [
        UIAction(title: "Retry") { [weak self] _ in Task { await self?.loadModels() } },
        UIAction(title: "Model settings") { [weak self] _ in
          self?.navigationController?.pushViewController(ModelsController(), animated: true)
        },
      ])
    }
  }
  private func chooseModel(_ route: JSON?) {
    if target["botId"].string.isEmpty {
      threadModel = route
      if let route, let data = try? route.encoded() {
        UserDefaults.standard.set(data, forKey: modelPreferenceKey)
      } else {
        UserDefaults.standard.removeObject(forKey: modelPreferenceKey)
      }
      Task { await loadModels() }
      return
    }
    Task {
      do {
        _ = try await API.shared.rpc(
          "bots/update",
          [
            "botId": target["botId"], "modelProvider": route?["provider"] ?? .null,
            "modelId": route?["modelId"] ?? .null,
          ])
        await loadModels()
      } catch { showError(error) }
    }
  }
  private func send(_ text: String) {
    followsLatest = true
    guard composer.ready, !composer.sending, !composer.uploading,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
    else { return }
    let nonce = UUID().uuidString
    let messageText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let sentAttachments = attachments
    let blocks: [JSON] =
      (messageText.isEmpty ? [] : [["kind": "text", "text": .string(messageText)]])
      + sentAttachments.map { artifact in
        [
          "kind": "file", "artifactId": artifact["id"], "name": artifact["name"],
          "mimeType": artifact["mimeType"],
        ]
      }
    outgoing.append([
      "id": .string(nonce), "role": "user", "blocks": .array(blocks),
      "afterSeq": .number(Double(ThreadLogic.lastUserSequence(snapshot["messages"].array))),
    ])
    composer.sending = true
    composer.setDraft("")
    attachments = []
    composer.attachmentCount = 0
    composer.attachmentNames = ""
    render(snapshot)
    scrollToEnd(animated: false)
    Task {
      do {
        let receipt = try await API.shared.rpc(
          "threads/send",
          target.merging([
            "text": .string(text), "artifactIds": .array(sentAttachments.map { $0["id"] }),
            "clientNonce": .string(nonce),
          ]).merging(threadModel.map { ["model": $0] } ?? [:]))
        if let index = outgoing.firstIndex(where: { $0["id"].string == nonce }),
          !receipt["seq"].isNull
        {
          outgoing[index]["receiptSeq"] = receipt["seq"]
        }
        composer.sending = false
        render(snapshot)
        // A failed refresh must not turn an accepted send into a failed draft.
        do { try await refresh() } catch { showConnectionError(error) }
      } catch {
        let notConfirmed = outgoing.contains { $0["id"].string == nonce }
        outgoing.removeAll { $0["id"].string == nonce }
        if !notConfirmed {
          composer.sending = false
          render(snapshot)
          return
        }
        composer.sending = false
        if composer.draft.isEmpty {
          composer.setDraft(text)
        } else {
          composer.setDraft(text + "\n" + composer.draft)
        }
        attachments.insert(contentsOf: sentAttachments, at: 0)
        composer.attachmentCount = attachments.count
        composer.attachmentNames = attachments.map { $0["name"].string }.joined(separator: ", ")
        render(snapshot)
        showError(error)
      }
    }
  }

  private func refreshConnectedApps() async {
    guard let result = try? await API.shared.rpc("connections/list"), !Task.isCancelled else {
      return
    }
    let current = result.array.filter { $0["status"].string == "connected" }
    if current != connectedApps {
      connectedApps = current
      table.reloadData()
    }
  }
  private func connectApp(message: JSON, block: JSON) {
    let app = block.merging([
      "connectorId": block["connectorId"].isNull ? "composio" : block["connectorId"]
    ])
    presentConnection(app) { [weak self] account in
      guard let self else { return }
      connectedApps.removeAll { $0["id"] == account["id"] }
      connectedApps.append(account)
      table.reloadData()
      // The stable nonce makes network retries and repeated taps safe. Preserve any
      // draft and attachments: authorization is not a composer send.
      if let continuation = ConnectionIntent.continuation(
        message: message, block: block, target: target)
      {
        _ = try await API.shared.rpc(
          "threads/send", continuation.merging(threadModel.map { ["model": $0] } ?? [:]))
      }
      try await refresh()
    }
  }

  private func openActivity() {
    let current = snapshot["run"]["id"].string
    let runID = current.isEmpty ? activities.last?["runId"].string ?? "" : current
    let body = runID.isEmpty ? target : target.merging(["runId": .string(runID)])
    let nav = UINavigationController(rootViewController: ToolActivityController(target: body))
    nav.modalPresentationStyle = .pageSheet
    nav.sheetPresentationController?.detents = [.medium(), .large()]
    nav.sheetPresentationController?.prefersGrabberVisible = true
    present(nav, animated: true)
  }
  private func stop() {
    Task {
      do {
        _ = try await API.shared.rpc("threads/stop", target)
        try await refresh()
      } catch { showError(error) }
    }
  }
  private func answer(_ message: JSON, _ block: JSON, value: String? = nil) {
    if let value {
      submitAnswer(message, value: value)
      return
    }
    if !block["emailDraft"].isNull {
      let editor = EmailDraftController(block["emailDraft"])
      editor.onSubmit = { [weak self] answer in
        guard let self else { return }
        _ = try await API.shared.rpc(
          "threads/answer",
          self.target.merging([
            "runId": message["runId"], "messageId": message["id"], "answer": .string(answer),
          ]))
        self.followsLatest = true
        try? await self.refresh()
      }
      let nav = UINavigationController(rootViewController: editor)
      nav.isModalInPresentation = true
      nav.modalPresentationStyle = .pageSheet
      nav.sheetPresentationController?.detents = [.large()]
      present(nav, animated: true)
      return
    }
    if block["input"].string != "secret" {
      return
    }
    let actions = block["kind"].string == "choice" ? block["options"].array : block["actions"].array
    let alert = UIAlertController(
      title: block["text"].string.isEmpty ? block["question"].string : block["text"].string,
      message: block["detail"].string.isEmpty ? nil : block["detail"].string, preferredStyle: .alert
    )
    let login =
      block["input"].string == "secret" && block["credential"]["auth"]["type"].string == "login"
    let submit: (String, String?) -> Void = { [weak self] value, username in
      self?.submitAnswer(message, value: value, username: username)
    }
    if actions.isEmpty {
      if login {
        alert.addTextField {
          $0.placeholder = "Username"
          $0.autocapitalizationType = .none
          $0.textContentType = .username
        }
      }
      alert.addTextField {
        $0.isSecureTextEntry = block["input"].string == "secret"
        $0.placeholder = login ? "Password" : "Your answer"
        if login { $0.textContentType = .password }
      }
      alert.addAction(
        UIAlertAction(title: "Send", style: .default) { _ in
          guard let value = alert.textFields?.last?.text, !value.isEmpty else { return }
          submit(value, login ? alert.textFields?.first?.text : nil)
        })
    } else {
      for action in actions {
        alert.addAction(
          UIAlertAction(title: action["label"].string, style: .default) { _ in
            submit(action["id"].string, nil)
          })
      }
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    present(alert, animated: true)
  }
  private func submitAnswer(_ message: JSON, value: String, username: String? = nil) {
    let id = message["id"].string
    guard !composer.sending, answering.insert(id).inserted else { return }
    composer.sending = true
    render(snapshot)
    Task {
      defer {
        answering.remove(id)
        composer.sending = false
        render(snapshot)
      }
      do {
        var input = target.merging([
          "runId": message["runId"], "messageId": message["id"], "answer": .string(value),
        ])
        if let username { input["username"] = .string(username) }
        _ = try await API.shared.rpc("threads/answer", input)
        followsLatest = true
        try? await refresh()
      } catch { showError(error) }
    }
  }
  private func attachFile() {
    let menu = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
    menu.addAction(
      UIAlertAction(title: "Photo library", style: .default) { [weak self] _ in
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        self?.present(picker, animated: true)
      })
    menu.addAction(
      UIAlertAction(title: "Choose file", style: .default) { [weak self] _ in self?.pickDocument() }
    )
    if !attachments.isEmpty {
      menu.addAction(
        UIAlertAction(title: "Remove attachments (\(attachments.count))", style: .destructive) {
          [weak self] _ in
          self?.attachments.removeAll()
          self?.composer.attachmentCount = 0
          self?.composer.attachmentNames = ""
        })
    }
    menu.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    menu.popoverPresentationController?.sourceView = composer
    menu.popoverPresentationController?.sourceRect = CGRect(x: 20, y: 20, width: 44, height: 44)
    present(menu, animated: true)
  }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self)
    else { return }
    provider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
      Task { @MainActor in
        guard let self else { return }
        if let error {
          self.showError(error)
          return
        }
        guard let image = object as? UIImage, let data = image.jpegData(compressionQuality: 0.85)
        else { return }
        do { try await self.upload(data: data, name: "Photo.jpg", mime: "image/jpeg") } catch {
          self.showError(error)
        }
      }
    }
  }
  private func upload(data: Data, name: String, mime: String) async throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try data.write(to: file, options: [.atomic, .completeFileProtection])
    defer { try? FileManager.default.removeItem(at: file) }
    try await upload(url: file, name: name, mime: mime)
  }
  private func upload(url: URL, name: String, mime: String) async throws {
    guard !composer.uploading else { return }
    let limits = try await API.shared.raw(path: "api/artifacts/limits")
    guard attachments.count < limits["maxCount"].int else {
      throw APIError(status: 0, message: "Send these attachments before adding more files.")
    }
    composer.uploading = true
    composer.attachmentNames = "Uploading \(name)…"
    defer {
      composer.uploading = false
      composer.attachmentNames = attachments.map { $0["name"].string }.joined(separator: ", ")
    }
    let artifact = try await API.shared.uploadFile(url: url, name: name, mime: mime, target: target)
    attachments.append(artifact)
    composer.attachmentCount = attachments.count
  }
  private func pickDocument() {

    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
    picker.delegate = self
    present(picker, animated: true)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL])
  {
    guard let url = urls.first else { return }
    Task {
      do {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let mime =
          UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
          ?? "application/octet-stream"
        try await upload(url: url, name: url.lastPathComponent, mime: mime)
      } catch { showError(error) }
    }
  }
  func numberOfSections(in tableView: UITableView) -> Int { 2 }
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    guard !adjustingScroll, abs(scrollView.bounds.height - previousViewportHeight) < 1 else {
      return
    }
    followsLatest =
      scrollView.contentSize.height - scrollView.contentOffset.y
      - scrollView.bounds.height + scrollView.adjustedContentInset.bottom < 80
  }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    section == 0 ? messages.count : (hasActivity ? 1 : 0)
  }
  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    if indexPath.section == 1 { return activityCell }
    let message = messages[indexPath.row]
    let cell =
      tableView.dequeueReusableCell(withIdentifier: "message", for: indexPath) as! MessageCell
    cell.configure(
      message, target: target, connections: connectedApps,
      canAnswer: (snapshot["activeRuns"].array + [snapshot["run"]]).contains {
        $0["id"] == message["runId"] && $0["status"].string == "waiting_input"
      } && !answering.contains(message["id"].string),
      open: { [weak self] block in
        self?.navigationController?.pushViewController(
          AttachmentController(target: self?.target ?? [:], block: block), animated: true)
      }, answer: { [weak self] block, value in self?.answer(message, block, value: value) },
      connect: { [weak self] block in self?.connectApp(message: message, block: block) })
    return cell
  }
  func tableView(
    _ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath, point: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard indexPath.section == 0 else { return nil }
    let text = ThreadLogic.plainText(messages[indexPath.row])
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { _ in
      UIMenu(children: [
        UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { _ in
          UIPasteboard.general.string = text
        }
      ])
    }
  }
}

final class MessageCell: UITableViewCell {
  private let bubble = UIView(), stack = Theme.stack(spacing: 8)
  private var leading: NSLayoutConstraint!, trailing: NSLayoutConstraint!
  private var imageTasks: [Task<Void, Never>] = []
  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    selectionStyle = .none
    backgroundColor = .clear
    bubble.layer.cornerRadius = 22
    contentView.addSubview(bubble)
    bubble.translatesAutoresizingMaskIntoConstraints = false
    bubble.addSubview(stack)
    stack.isLayoutMarginsRelativeArrangement = true
    stack.pin(to: bubble)
    leading = bubble.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16)
    trailing = bubble.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -32)
    NSLayoutConstraint.activate([
      leading, trailing, bubble.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      bubble.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
    ])
  }
  required init?(coder: NSCoder) { fatalError() }
  override func prepareForReuse() {
    super.prepareForReuse()
    imageTasks.forEach { $0.cancel() }
    imageTasks = []
  }
  func configure(
    _ message: JSON, target: JSON, connections: [JSON], canAnswer: Bool,
    open: @escaping (JSON) -> Void,
    answer: @escaping (JSON, String?) -> Void,
    connect: @escaping (JSON) -> Void
  ) {
    imageTasks.forEach { $0.cancel() }
    imageTasks = []
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    let user = message["role"].string == "user"
    bubble.backgroundColor = user ? Theme.userBubble : .clear
    stack.directionalLayoutMargins =
      user
      ? .init(top: 10, leading: 14, bottom: 10, trailing: 14)
      : .init(top: 8, leading: 0, bottom: 8, trailing: 0)
    leading.constant = user ? 48 : 16
    trailing.constant = -16
    for block in ThreadLogic.visibleBlocks(message) {
      if block["kind"].string == "ask", !block["emailDraft"].isNull {
        let card = EmailDraftCardView(block) { answer(block, nil) }
        card.isUserInteractionEnabled = canAnswer
        stack.addArrangedSubview(card)
        continue
      }
      switch block["kind"].string {
      case "card":
        if !block["weather"].isNull {
          stack.addArrangedSubview(WeatherCardView(block["weather"]))
        } else {
          if !block["title"].string.isEmpty {
            stack.addArrangedSubview(Theme.label(block["title"].string, style: .headline))
          }
          for line in block["lines"].array {
            stack.addArrangedSubview(Theme.label("\(line["k"].string): \(line["v"].string)"))
          }
        }
      case "text", "progress", "ask", "channel_message":
        let text = UITextView()
        text.isEditable = false
        text.isSelectable = true
        text.isScrollEnabled = false
        text.backgroundColor = .clear
        text.textContainerInset = .zero
        text.textContainer.lineFragmentPadding = 0
        text.attributedText = Markdown.render(block["text"].string)
        text.adjustsFontForContentSizeCategory = true
        text.linkTextAttributes = [.foregroundColor: UIColor.link]
        stack.addArrangedSubview(text)
        if block["kind"].string == "ask" && block["status"].string != "answered" && canAnswer {
          addAnswers(block, actions: block["actions"].array, answer: answer)
        }
      case "app_connect":
        let row = Theme.stack(.horizontal, spacing: 10)
        row.alignment = .center
        let icon = UIImageView(image: UIImage(systemName: "app"))
        icon.contentMode = .scaleAspectFit
        NSLayoutConstraint.activate([
          icon.widthAnchor.constraint(equalToConstant: 28),
          icon.heightAnchor.constraint(equalToConstant: 28),
        ])
        row.addArrangedSubview(icon)
        let name = Theme.label(block["name"].string, style: .headline)
        name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        row.addArrangedSubview(name)
        let connected = connections.contains {
          $0["provider"] == block["provider"]
            && $0["connectorId"]
              == (block["connectorId"].isNull ? "composio" : block["connectorId"])
        }
        let button = Theme.button(
          connected ? "Connected" : "Connect",
          action: { connect(block.merging(["status": connected ? "connected" : "pending"])) })
        button.isEnabled = !connected || !block["requestId"].string.isEmpty
        row.addArrangedSubview(button)
        stack.addArrangedSubview(row)
        imageTasks.append(
          Task {
            let image = await ImageStore.shared.connectionImage(
              block["logo"].string,
              request: [
                "connectorId": block["connectorId"].isNull ? "composio" : block["connectorId"],
                "provider": block["provider"],
              ])
            guard !Task.isCancelled else { return }
            if let image { icon.image = image }
          })
      case "subagent", "child_bot", "cloud_agent":
        let detail = [
          block["name"].string, block["title"].string, block["result"].string,
          block["progress"].string, block["status"].string,
        ].filter { !$0.isEmpty }.joined(separator: " · ")
        stack.addArrangedSubview(Theme.label(detail, style: .callout, color: Theme.muted))
      case "choice":
        stack.addArrangedSubview(Theme.label(block["question"].string))
        if block["answerId"].string.isEmpty && canAnswer {
          addAnswers(block, actions: block["options"].array, answer: answer)
        }
      case "file", "image":
        if block["kind"].string == "image" {
          let preview = UIImageView()
          preview.contentMode = .scaleAspectFit
          preview.clipsToBounds = true
          preview.layer.cornerRadius = 14
          preview.heightAnchor.constraint(equalToConstant: 210).isActive = true
          stack.addArrangedSubview(preview)
          imageTasks.append(
            Task {
              guard
                let url = try? await API.shared.downloadFile(
                  id: block["artifactId"].string, name: block["name"].string)
              else { return }
              defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
              guard !Task.isCancelled,
                let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                let image = CGImageSourceCreateThumbnailAtIndex(
                  source, 0,
                  [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1000,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                  ] as CFDictionary)
              else { return }
              preview.image = UIImage(cgImage: image)
            })
        }
        stack.addArrangedSubview(
          Theme.button(block["name"].string, symbol: "doc", action: { open(block) }))
      default:
        if !block["summary"].string.isEmpty {
          stack.addArrangedSubview(
            Theme.label(block["summary"].string, style: .caption1, color: Theme.muted))
        }
      }
    }

  }
  private func addAnswers(_ block: JSON, actions: [JSON], answer: @escaping (JSON, String?) -> Void)
  {
    if actions.isEmpty {
      // Ordinary free text is answered in the existing composer, without a duplicate Reply control.
      if block["input"].string == "secret" {
        stack.addArrangedSubview(
          Theme.button("Enter securely", symbol: "lock", action: { answer(block, nil) }))
      }
      return
    }
    for action in actions {
      let button = UIButton(type: .system)
      var config = UIButton.Configuration.tinted()
      config.title = action["label"].string
      config.baseForegroundColor = Theme.ink
      config.baseBackgroundColor = Theme.userBubble
      config.cornerStyle = .large
      config.contentInsets = .init(top: 12, leading: 14, bottom: 12, trailing: 14)
      config.titleAlignment = .leading
      button.configuration = config
      button.contentHorizontalAlignment = .leading
      button.titleLabel?.numberOfLines = 0
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      button.addAction(UIAction { _ in answer(block, action["id"].string) }, for: .touchUpInside)
      stack.addArrangedSubview(button)
    }
  }

}

enum Markdown {
  static func render(_ value: String, style: UIFont.TextStyle = .body, color: UIColor = Theme.ink)
    -> NSAttributedString
  {
    let result = NSMutableAttributedString(string: "")
    for block in MarkdownDocument.blocks(value) {
      if result.length > 0 { result.append(NSAttributedString(string: "\n")) }
      let paragraph = NSMutableParagraphStyle()
      paragraph.lineSpacing = 2
      paragraph.paragraphSpacing = block.kind == "list" ? 3 : 7
      var font = UIFont.preferredFont(forTextStyle: style)
      if block.kind == "heading" {
        font = UIFont.preferredFont(
          forTextStyle: block.level == 1 ? .title1 : block.level == 2 ? .title2 : .headline)
      }
      if block.kind == "code" {
        font = UIFont.monospacedSystemFont(ofSize: font.pointSize - 1, weight: .regular)
      }
      if block.kind == "list" || block.kind == "quote" { paragraph.headIndent = 18 }
      let base: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
      ]
      if !block.prefix.isEmpty {
        result.append(NSAttributedString(string: block.prefix, attributes: base))
      }
      if block.kind == "code" {
        result.append(NSAttributedString(string: block.text, attributes: base))
        continue
      }
      guard
        let inline = try? AttributedString(
          markdown: block.text,
          options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
      else {
        result.append(NSAttributedString(string: block.text, attributes: base))
        continue
      }
      for run in inline.runs {
        var attributes = base
        var traits = UIFontDescriptor.SymbolicTraits()
        let intent = run.inlinePresentationIntent ?? []
        if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
        if intent.contains(.emphasized) { traits.insert(.traitItalic) }
        attributes[.font] = traits.isEmpty ? font : font.withTraits(traits)
        if intent.contains(.code) {
          attributes[.font] = UIFont.monospacedSystemFont(
            ofSize: font.pointSize - 1, weight: .regular)
          attributes[.backgroundColor] = Theme.secondary
        }
        if intent.contains(.strikethrough) {
          attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
        }
        if let link = run.link,
          ["https", "http", "mailto"].contains(link.scheme?.lowercased() ?? "")
        {
          attributes[.link] = link
        }
        result.append(
          NSAttributedString(string: String(inline[run.range].characters), attributes: attributes))
      }
    }
    return result
  }
}

extension UIFont {
  fileprivate func withTraits(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
    UIFont(descriptor: fontDescriptor.withSymbolicTraits(traits) ?? fontDescriptor, size: pointSize)
  }
}

final class AttachmentController: UIViewController, QLPreviewControllerDataSource {
  let target: JSON, block: JSON
  private var localURL: URL?
  init(target: JSON, block: JSON) {
    self.target = target
    self.block = block
    super.init(nibName: nil, bundle: nil)
    title = block["name"].string
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    let spinner = UIActivityIndicatorView(style: .medium)
    spinner.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
    view.addSubview(spinner)
    spinner.startAnimating()
    Task {
      do {
        let url = try await API.shared.downloadFile(
          id: block["artifactId"].string, name: block["name"].string)
        localURL = url
        let preview = QLPreviewController()
        preview.dataSource = self
        addChild(preview)
        view.addSubview(preview.view)
        preview.view.pin(to: view)
        preview.didMove(toParent: self)
        spinner.removeFromSuperview()
      } catch {
        spinner.stopAnimating()
        showError(error)
      }
    }
  }
  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { localURL == nil ? 0 : 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int)
    -> QLPreviewItem
  { localURL! as NSURL }
  deinit {
    if let localURL {
      try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent())
    }
  }
}
