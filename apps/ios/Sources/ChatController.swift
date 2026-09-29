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
  private var cursor = -1
  private var lastReadCursor = -2
  private var earlierMessages: [JSON] = []
  private var olderCursor: JSON = .null
  private let connection = UIButton(type: .system)
  private let identity = UIButton(type: .system)
  private var active = false
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
    table.contentInset = UIEdgeInsets(top: 14, left: 0, bottom: 14, right: 0)
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
    setupHeader()
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
      UIAction(title: "Models", image: UIImage(systemName: "cpu")) { [weak self] _ in
        self?.navigationController?.pushViewController(ModelsController(), animated: true)
      }
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
        await loadModels()
        await refreshComputer()
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
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(20))
        if Task.isCancelled { break }
        await self?.refreshComputer()
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
    render(next)
    composer.ready = true
    cursor = max(cursor, next["cursor"].int)
    if lastReadCursor != cursor {
      _ = try? await API.shared.rpc("threads/markRead", target)
      lastReadCursor = cursor
    }
  }
  private func render(_ next: JSON) {
    let nearBottom = table.contentSize.height - table.contentOffset.y - table.bounds.height < 120
    let first = messages.isEmpty
    snapshot = next
    let latest = next["messages"].array.filter { !$0["blocks"].array.isEmpty }
    let latestIDs = Set(latest.map { $0["id"].string })
    let rows = earlierMessages.filter { !latestIDs.contains($0["id"].string) } + latest
    if earlierMessages.isEmpty { olderCursor = next["olderCursor"] }
    composer.running = ThreadLogic.running(next)
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
    guard rows != messages else { return }
    let previous = messages
    messages = rows
    if previous.count <= rows.count && zip(previous, rows).allSatisfy({ $0["id"] == $1["id"] }) {
      let changed = previous.indices.filter { previous[$0] != rows[$0] }.map {
        IndexPath(row: $0, section: 0)
      }
      let inserted = (previous.count..<rows.count).map { IndexPath(row: $0, section: 0) }
      UIView.performWithoutAnimation {
        table.performBatchUpdates {
          if !changed.isEmpty { table.reloadRows(at: changed, with: .none) }
          if !inserted.isEmpty { table.insertRows(at: inserted, with: .none) }
        }
      }
    } else {
      table.reloadData()
    }
    table.layoutIfNeeded()
    if nearBottom || first { scrollToEnd(animated: false) }
  }
  private func scrollToEnd(animated: Bool) {
    if !messages.isEmpty {
      table.scrollToRow(
        at: IndexPath(row: messages.count - 1, section: 0), at: .bottom,
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
        let earlier = page["messages"].array.filter { !existing.contains($0["id"].string) }
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
      if bot.isNull || bot.dictionary.isEmpty {
        bot = try await API.shared.rpc("bots/get", ["botId": target["botId"]])
        identity.configuration?.title = bot["name"].string
        identity.configuration?.image = RobotAvatar.image(
          color: bot["color"].string, size: 28, main: target["threadKind"].string == "personal")
      }
    } catch { connection.setTitle("Mac unavailable · Retry", for: .normal) }
  }
  private func loadModels() async {
    do {
      async let choices = API.shared.rpc("models/choices")
      async let routing = API.shared.rpc("models/routing")
      guard !target["botId"].string.isEmpty else {
        composer.modelButton.isHidden = true
        return
      }
      async let current = API.shared.rpc("bots/get", ["botId": target["botId"]])
      let (catalog, routes, bot) = try await (choices, routing, current)
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
    guard composer.ready, !composer.sending,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
    else { return }
    composer.sending = true
    let ids = attachments.map { $0["id"] }
    Task {
      defer { composer.sending = false }
      do {
        if composer.running {
          _ = try await API.shared.rpc("threads/followUp", target.merging(["text": .string(text)]))
        } else {
          _ = try await API.shared.rpc(
            "threads/send",
            target.merging([
              "text": .string(text), "artifactIds": .array(ids),
              "clientNonce": .string(UUID().uuidString),
            ]))
          attachments.removeAll()
          composer.attachmentCount = 0
        }
        if composer.draft == text { composer.setDraft("") }
        try await refresh()
        scrollToEnd(animated: true)
      } catch { showError(error) }
    }
  }
  private func stop() {
    Task {
      do {
        _ = try await API.shared.rpc("threads/stop", target)
        try await refresh()
      } catch { showError(error) }
    }
  }
  private func answer(_ message: JSON, _ block: JSON) {
    let actions = block["kind"].string == "choice" ? block["options"].array : block["actions"].array
    let alert = UIAlertController(
      title: block["text"].string.isEmpty ? block["question"].string : block["text"].string,
      message: block["detail"].string.isEmpty ? nil : block["detail"].string, preferredStyle: .alert
    )
    let login =
      block["input"].string == "secret" && block["credential"]["auth"]["type"].string == "login"
    let submit: (String, String?) -> Void = { [weak self] value, username in
      guard let self else { return }
      Task {
        do {
          var input = self.target.merging([
            "runId": message["runId"], "messageId": message["id"], "answer": .string(value),
          ])
          if let username { input["username"] = .string(username) }
          _ = try await API.shared.rpc("threads/answer", input)
          try await self.refresh()
        } catch { self.showError(error) }
      }
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
    guard data.count <= 8 * 1024 * 1024 else {
      throw APIError(status: 0, message: "Choose a file smaller than 8 MB.")
    }
    let artifact = try await API.shared.rpc(
      "artifacts/create",
      target.merging([
        "name": .string(name), "mimeType": .string(mime),
        "contentBase64": .string(data.base64EncodedString()),
      ]))
    attachments.append(artifact)
    composer.attachmentCount = attachments.count
    composer.textView.accessibilityHint = attachments.map { $0["name"].string }.joined(
      separator: ", ")
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
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 8 * 1024 * 1024 else {
          throw APIError(status: 0, message: "Choose a file smaller than 8 MB.")
        }
        let data = try Data(contentsOf: url)
        let mime =
          UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
          ?? "application/octet-stream"
        try await upload(data: data, name: url.lastPathComponent, mime: mime)
      } catch { showError(error) }
    }
  }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    messages.count
  }
  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let message = messages[indexPath.row]
    let cell =
      tableView.dequeueReusableCell(withIdentifier: "message", for: indexPath) as! MessageCell
    cell.configure(
      message, target: target,
      open: { [weak self] block in
        self?.navigationController?.pushViewController(
          AttachmentController(target: self?.target ?? [:], block: block), animated: true)
      }, answer: { [weak self] block in self?.answer(message, block) })
    return cell
  }
  func tableView(
    _ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath, point: CGPoint
  ) -> UIContextMenuConfiguration? {
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
  private let bubble = UIView(), stack = Theme.stack(spacing: 10)
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
    stack.pin(to: bubble, inset: 14)
    leading = bubble.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16)
    trailing = bubble.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -32)
    NSLayoutConstraint.activate([
      leading, trailing, bubble.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 6),
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
    _ message: JSON, target: JSON, open: @escaping (JSON) -> Void, answer: @escaping (JSON) -> Void
  ) {
    imageTasks.forEach { $0.cancel() }
    imageTasks = []
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    let user = message["role"].string == "user"
    bubble.backgroundColor = user ? Theme.userBubble : Theme.secondary
    leading.constant = user ? 48 : 16
    trailing.constant = user ? -16 : -32
    for block in message["blocks"].array {
      switch block["kind"].string {
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
        if block["kind"].string == "ask" && block["status"].string != "answered" {
          stack.addArrangedSubview(Theme.button("Reply", action: { answer(block) }))
        }
      case "subagent", "child_bot", "cloud_agent":
        let detail = [
          block["name"].string, block["title"].string, block["result"].string,
          block["progress"].string, block["status"].string,
        ].filter { !$0.isEmpty }.joined(separator: " · ")
        stack.addArrangedSubview(Theme.label(detail, style: .callout, color: Theme.muted))
      case "choice":
        stack.addArrangedSubview(Theme.label(block["question"].string))
        if block["answerId"].string.isEmpty {
          stack.addArrangedSubview(Theme.button("Choose", action: { answer(block) }))
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
              if let artifact = try? await API.shared.rpc(
                "artifacts/get", target.merging(["artifactId": block["artifactId"]])),
                let data = Data(base64Encoded: artifact["contentBase64"].string), !Task.isCancelled
              {
                preview.image = UIImage(data: data)
              }
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
}

enum Markdown {
  static func render(_ value: String) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 3
    let result = NSMutableAttributedString(
      string: value,
      attributes: [
        .font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: Theme.ink,
        .paragraphStyle: paragraph,
      ])
    // Preserve native text selection while applying the common inline syntax.
    for (pattern, kind) in [
      ("\\[([^\\]]+)\\]\\((https?://[^\\s)]+)\\)", "link"), ("\\*\\*(.+?)\\*\\*", "bold"),
      ("`([^`]+)`", "code"),
    ] {
      guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
      for match in regex.matches(
        in: result.string, range: NSRange(location: 0, length: result.length)
      ).reversed() {
        let text = (result.string as NSString).substring(with: match.range(at: 1))
        var attributes: [NSAttributedString.Key: Any] = [
          .font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: Theme.ink,
        ]
        if kind == "bold" {
          attributes[.font] = UIFont.preferredFont(forTextStyle: .body).withTraits(.traitBold)
        }
        if kind == "code" {
          attributes[.font] = UIFont.monospacedSystemFont(
            ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize - 1, weight: .regular)
        }
        if kind == "link" {
          attributes[.link] = (result.string as NSString).substring(with: match.range(at: 2))
        }
        result.replaceCharacters(
          in: match.range, with: NSAttributedString(string: text, attributes: attributes))
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
        let artifact = try await API.shared.rpc(
          "artifacts/get", target.merging(["artifactId": block["artifactId"]]))
        guard let data = Data(base64Encoded: artifact["contentBase64"].string) else {
          throw APIError(status: 0, message: "This file could not be opened.")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
          UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = URL(fileURLWithPath: block["name"].string).lastPathComponent
        let url = directory.appendingPathComponent(name.isEmpty ? "Attachment" : name)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
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
