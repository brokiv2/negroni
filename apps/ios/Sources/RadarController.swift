import NegroniCore
import UIKit

/// Radar: what it watches, when it may interrupt, and what it has learned.
final class RadarController: ListController {
  private var status: JSON = [:]
  private var connections: [JSON] = []
  private var showOtherApps = false, showAdvanced = false, briefRequested = false
  private var settings: JSON { status["settings"] }
  init() { super.init(title: "Radar") }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.largeTitleDisplayMode = .never
  }
  override func load() async throws {
    async let accounts = try? API.shared.rpc("connections/list")
    status = try await RadarStore.shared.loadStatus()
    connections = await accounts?.array ?? []
    render()
  }

  private func render() {
    let enabled = settings["enabled"].bool
    var result = [ListSection(rows: overviewRows(enabled))]
    if enabled {
      result.append(
        ListSection(
          title: "Today",
          rows: [
            ListRow(
              title: "Today",
              cell: { [weak self] in
                RadarCountsCell(self?.status["today"] ?? [:]) {
                  self?.push(RadarSkippedController())
                }
              })
          ]))
    }
    result.append(ListSection(title: "Sources", rows: sourceRows()))
    result.append(
      ListSection(
        title: "Tell me",
        rows: [
          ListRow(
            title: "Tell me",
            cell: { [weak self] in
              RadarLevelCell(level: self?.settings["level"].string ?? "") {
                self?.configure(["level": .string($0)])
              }
            })
        ]))
    result.append(ListSection(rows: quietRows()))
    result.append(ListSection(title: "Briefs", rows: briefRows()))
    result.append(
      ListSection(rows: [
        ListRow(
          title: "Meeting prep", symbol: "person.2", switchValue: settings["meetingPrep"].bool,
          onSwitch: { [weak self] in self?.configure(["meetingPrep": .bool($0)]) })
      ]))
    if let learned = learnedSection() { result.append(learned) }
    result.append(
      ListSection(rows: [
        ListRow(
          title: "Advanced", symbol: "slider.horizontal.3",
          action: { [weak self] in
            self?.showAdvanced.toggle()
            self?.render()
          }, accessory: showAdvanced ? .none : .disclosureIndicator)
      ]))
    if showAdvanced { result += advancedSections() }
    sections = result
  }

  private func overviewRows(_ enabled: Bool) -> [ListRow] {
    let line = [RadarStatusLine.text(status, now: Date()), status["error"].string]
      .filter { !$0.isEmpty }.joined(separator: "\n")
    var rows = [
      ListRow(
        title: "Radar", detail: line, symbol: "dot.radiowaves.left.and.right", lines: 0,
        switchValue: enabled, onSwitch: { [weak self] in self?.setEnabled($0) })
    ]
    guard enabled else { return rows }
    let paused = RadarTime.parse(settings["pausedUntil"].string).map { $0 > Date() } ?? false
    rows.append(
      paused
        ? ListRow(
          title: "Resume", symbol: "play",
          action: { [weak self] in self?.configure(["pausedUntil": .null]) })
        : ListRow(title: "Pause", symbol: "pause", action: { [weak self] in self?.choosePause() }))
    return rows
  }
  private func setEnabled(_ on: Bool) {
    guard on else { return configure(["enabled": false]) }
    configure(["enabled": true, "timeZone": .string(TimeZone.current.identifier)]) {
      try? await Notifications.shared.request()
      _ = try? await API.shared.rpc("radar/check")
    }
  }
  private func choosePause() {
    let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
    for pause in RadarTime.Pause.allCases {
      sheet.addAction(
        UIAlertAction(title: pause.title, style: .default) { [weak self] _ in
          let until = RadarTime.pausedUntil(
            pause, now: Date(), timeZone: RadarStore.shared.timeZone)
          self?.configure(["pausedUntil": .string(until)])
        })
    }
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    sheet.popoverPresentationController?.sourceView = view
    sheet.popoverPresentationController?.sourceRect = CGRect(
      x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
    present(sheet, animated: true)
  }
  /// Saves a settings change. Controls that already show the new value skip the redraw.
  private func configure(
    _ patch: JSON, refresh: Bool = true, then: (() async -> Void)? = nil
  ) {
    Task {
      do {
        status = try await API.shared.rpc("radar/configure", patch)
        RadarStore.shared.apply(status)
        await then?()
        if refresh { render() }
      } catch {
        render()
        showError(error)
      }
    }
  }

  // MARK: Sources

  private func sourceRows() -> [ListRow] {
    let sources = status["sources"].array
    // A disconnected account matters only while Radar is still meant to read it.
    let readable = sources.filter {
      $0["supported"].bool && ($0["state"].string != "revoked" || $0["enabled"].bool)
    }
    let other = sources.filter { !$0["supported"].bool }
    var rows = readable.map(sourceRow)
    if !other.isEmpty {
      rows.append(
        ListRow(
          title: "Other apps", detail: String(other.count), symbol: "square.grid.2x2",
          action: { [weak self] in
            self?.showOtherApps.toggle()
            self?.render()
          }, accessory: showOtherApps ? .none : .disclosureIndicator))
      if showOtherApps {
        rows += other.map { source in
          ListRow(
            title: accountName(source), detail: ConnectedApp.name(source["source"].string),
            symbol: "app", iconRequest: icon(source), switchValue: false, switchEnabled: false)
        }
      }
    }
    rows.append(
      ListRow(
        title: "Connect app", symbol: "plus",
        action: { [weak self] in self?.push(ConnectionsController(browsing: true)) }))
    return rows
  }
  private func connection(_ source: JSON) -> JSON? {
    connections.first { $0["id"] == source["connectionId"] }
  }
  private func accountName(_ source: JSON) -> String {
    let account = source["account"].string
    let name = account.isEmpty ? source["label"].string : account
    return name.isEmpty ? ConnectedApp.name(source["source"].string) : name
  }
  private func icon(_ source: JSON) -> JSON {
    ["connectorId": connection(source)?["connectorId"] ?? "composio", "provider": source["source"]]
  }
  private func sourceRow(_ source: JSON) -> ListRow {
    let slug = source["source"].string
    let app = ConnectedApp.name(slug)
    let broken =
      source["state"].string == "revoked" || connection(source)?["status"].string == "error"
    let problem =
      broken
      ? "Needs reconnect" : source["state"].string == "error" ? source["lastError"].string : ""
    var row = ListRow(
      title: accountName(source),
      detail: [app, problem].filter { !$0.isEmpty }.joined(separator: " · "),
      symbol: RadarSourceMark.symbol(slug), iconRequest: icon(source))
    if broken {
      row.action = { [weak self] in self?.reconnect(source) }
      row.accessory = .disclosureIndicator
    } else {
      row.switchValue = source["enabled"].bool
      row.onSwitch = { [weak self] in self?.setSource(source["connectionId"], $0) }
    }
    return row
  }
  private func setSource(_ id: JSON, _ enabled: Bool) {
    Task {
      do {
        status = try await API.shared.rpc(
          "radar/source", ["connectionId": id, "enabled": .bool(enabled)])
        RadarStore.shared.apply(status)
      } catch { showError(error) }
      render()
    }
  }
  /// A new authorization through the usual connection flow; the new account takes the old
  /// one's place in Radar.
  private func reconnect(_ source: JSON) {
    let slug = source["source"].string
    let app: JSON = [
      "name": .string(ConnectedApp.name(slug)), "slug": .string(slug), "provider": .string(slug),
      "connectorId": connection(source)?["connectorId"] ?? "composio",
    ]
    presentConnection(app, reuseConnected: false) { [weak self] account in
      var next = try await API.shared.rpc(
        "radar/source", ["connectionId": account["id"], "enabled": true])
      if account["id"] != source["connectionId"] {
        next =
          (try? await API.shared.rpc(
            "radar/source", ["connectionId": source["connectionId"], "enabled": false])) ?? next
      }
      RadarStore.shared.apply(next)
      self?.reloadData()
    }
  }

  // MARK: Timing

  private func quietRows() -> [ListRow] {
    let quiet = settings["quietHours"]
    var rows = [
      ListRow(
        title: "Quiet hours", symbol: "moon", switchValue: quiet["enabled"].bool,
        onSwitch: { [weak self] in self?.configure(["quietHours": ["enabled": .bool($0)]]) })
    ]
    guard quiet["enabled"].bool else { return rows }
    for (key, title) in [("start", "From"), ("end", "To")] {
      rows.append(
        ListRow(
          title: title,
          accessoryView: fitted([
            timePicker(quiet[key].string, label: title) { [weak self] in
              self?.configure(["quietHours": [key: .string($0)]], refresh: false)
            }
          ])))
    }
    return rows
  }
  private func briefRows() -> [ListRow] {
    var rows = [("morningBrief", "Morning", "sunrise"), ("eveningBrief", "Evening", "sunset")].map {
      key, title, symbol in
      let brief = settings[key]
      let toggle = UISwitch()
      toggle.isOn = brief["enabled"].bool
      toggle.accessibilityLabel = title
      toggle.addAction(
        UIAction { [weak self, weak toggle] _ in
          guard let toggle else { return }
          toggle.isEnabled = false
          self?.configure([key: ["enabled": .bool(toggle.isOn)]])
        }, for: .valueChanged)
      let picker = timePicker(brief["time"].string, label: title) { [weak self] in
        self?.configure([key: ["time": .string($0)]], refresh: false)
      }
      return ListRow(
        title: title, symbol: symbol,
        accessoryView: fitted(toggle.isOn ? [picker, toggle] : [toggle]))
    }
    rows.append(
      ListRow(
        title: briefRequested ? "Brief requested" : "Send a brief now", symbol: "paperplane",
        color: briefRequested ? Theme.muted : nil,
        action: briefRequested ? nil : { [weak self] in self?.requestBrief() }))
    return rows
  }
  private func requestBrief() {
    briefRequested = true
    render()
    Task {
      do {
        status = try await API.shared.rpc("radar/brief")
        RadarStore.shared.apply(status)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      } catch {
        briefRequested = false
        showError(error)
      }
      render()
    }
  }
  /// Settings times are wall-clock times in Radar's zone, so the picker shows them unconverted.
  private func timePicker(_ value: String, label: String, changed: @escaping (String) -> Void)
    -> UIDatePicker
  {
    let picker = UIDatePicker()
    picker.datePickerMode = .time
    picker.preferredDatePickerStyle = .compact
    picker.timeZone = TimeZone(identifier: "UTC")
    picker.date = RadarTime.clockDate(value) ?? Date(timeIntervalSince1970: 0)
    picker.tintColor = Theme.ink
    picker.accessibilityLabel = label
    picker.addAction(
      UIAction { [weak picker] _ in
        guard let picker else { return }
        changed(RadarTime.clockString(picker.date))
      }, for: .valueChanged)
    return picker
  }
  /// Accessory views are laid out by frame.
  private func fitted(_ views: [UIView]) -> UIView {
    let stack = UIStackView(arrangedSubviews: views)
    stack.spacing = 10
    stack.alignment = .center
    stack.frame = CGRect(
      origin: .zero, size: stack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize))
    return stack
  }

  // MARK: Learning

  private func learnedSection() -> ListSection? {
    let summary = status["summary"].string
    let people = status["people"].array.compactMap(RadarPerson.init)
    let rules = status["rules"].array.compactMap(RadarRule.init)
    guard !summary.isEmpty || !people.isEmpty || !rules.isEmpty else { return nil }
    var rows: [ListRow] = []
    if !summary.isEmpty { rows.append(ListRow(title: summary, lines: 0)) }
    rows += people.map { ListRow(title: $0.name, detail: $0.detail, symbol: "person") }
    rows += rules.map { rule in
      ListRow(
        title: rule.subject, detail: rule.title + (rule.learned ? " · Learned" : ""),
        symbol: rule.kind == "always"
          ? "bell.badge" : rule.kind == "digest" ? "tray" : "bell.slash",
        deleteAction: { [weak self] in self?.removeRule(rule.id) })
    }
    return ListSection(title: "What I’ve learned", rows: rows)
  }
  private func removeRule(_ id: String) {
    Task {
      do {
        status["rules"] = try await API.shared.rpc("radar/rule", ["removeId": .string(id)])
        RadarStore.shared.apply(status)
      } catch { showError(error) }
      render()
    }
  }

  // MARK: Advanced

  private func advancedSections() -> [ListSection] {
    let language = settings["language"].string
    let paths = settings["contextPaths"].array.map(\.string)
    let files =
      paths.map { path in
        ListRow(
          title: path, symbol: "doc.text",
          deleteAction: { [weak self] in
            self?.configure(["contextPaths": .array(paths.filter { $0 != path }.map(JSON.string))])
          })
      }
      + (paths.count < 10
        ? [
          ListRow(
            title: "Add file", symbol: "plus",
            action: { [weak self] in self?.addContextFile(paths) })
        ] : [])
    return [
      ListSection(rows: [
        ListRow(
          title: "Interruptions a day",
          accessoryView: capStepper(settings["maxInterruptsPerDay"].int)),
        ListRow(
          title: "Language", detail: language.isEmpty ? "Same as chat" : language,
          action: { [weak self] in self?.editLanguage(language) }),
      ]),
      ListSection(title: "Context files", rows: files),
    ]
  }
  private func capStepper(_ value: Int) -> UIView {
    let label = Theme.label(String(value), style: .body, color: Theme.muted)
    label.textAlignment = .right
    label.widthAnchor.constraint(equalToConstant: 32).isActive = true
    let stepper = UIStepper()
    stepper.minimumValue = 0
    stepper.maximumValue = 30
    stepper.value = Double(value)
    stepper.accessibilityLabel = "Interruptions a day"
    stepper.addAction(
      UIAction { [weak self, weak stepper] _ in
        guard let stepper else { return }
        label.text = String(Int(stepper.value))
        self?.configure(["maxInterruptsPerDay": .number(stepper.value)], refresh: false)
      }, for: .valueChanged)
    return fitted([label, stepper])
  }
  private func editLanguage(_ current: String) {
    let alert = UIAlertController(title: "Language", message: nil, preferredStyle: .alert)
    alert.addTextField {
      $0.text = current
      $0.placeholder = "Same as chat"
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(
      UIAlertAction(title: "Save", style: .default) { [weak self, weak alert] _ in
        let value = alert?.textFields?.first?.text ?? ""
        self?.configure(["language": .string(value.trimmingCharacters(in: .whitespacesAndNewlines))]
        )
      })
    present(alert, animated: true)
  }
  private func addContextFile(_ paths: [String]) {
    prompt("Context file", placeholder: "Notes/priorities.md") { [weak self] value in
      let path = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !paths.contains(path) else { return }
      self?.configure(["contextPaths": .array((paths + [path]).map(JSON.string))])
    }
  }
}

/// Today's counts; Skipped opens the list of what Radar kept quiet about.
final class RadarCountsCell: UITableViewCell {
  init(_ today: JSON, skipped: @escaping () -> Void) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = Theme.card
    selectionStyle = .none
    let row = Theme.stack(.horizontal, spacing: 0)
    row.distribution = .fillEqually
    contentView.addSubview(row)
    row.pin(to: contentView, inset: 6)
    for (key, title) in [
      ("seen", "Seen"), ("interrupted", "Told you"), ("briefed", "In brief"),
      ("skipped", "Skipped"),
    ] {
      var config = UIButton.Configuration.plain()
      config.title = String(today[key].int)
      config.subtitle = title
      config.titleAlignment = .center
      config.baseForegroundColor = Theme.ink
      config.titleTextAttributesTransformer = .init { attributes in
        var attributes = attributes
        attributes.font = .preferredFont(forTextStyle: .title2)
        return attributes
      }
      config.subtitleTextAttributesTransformer = .init { attributes in
        var attributes = attributes
        attributes.font = .preferredFont(forTextStyle: .caption1)
        attributes.foregroundColor = Theme.muted
        return attributes
      }
      let button = UIButton(configuration: config)
      if key == "skipped" {
        button.configuration?.image = UIImage(
          systemName: "chevron.right",
          withConfiguration: UIImage.SymbolConfiguration(textStyle: .caption2))
        button.configuration?.imagePlacement = .trailing
        button.configuration?.imagePadding = 4
        button.addAction(UIAction { _ in skipped() }, for: .touchUpInside)
      } else {
        button.isUserInteractionEnabled = false
      }
      row.addArrangedSubview(button)
    }
  }
  required init?(coder: NSCoder) { fatalError() }
}

final class RadarLevelCell: UITableViewCell {
  init(level: String, change: @escaping (String) -> Void) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = Theme.card
    selectionStyle = .none
    let control = UISegmentedControl(items: Radar.levels.map(\.title))
    control.selectedSegmentIndex = Radar.levels.firstIndex { $0.id == level } ?? 1
    control.addAction(
      UIAction { [weak control] _ in
        guard let control, Radar.levels.indices.contains(control.selectedSegmentIndex) else {
          return
        }
        change(Radar.levels[control.selectedSegmentIndex].id)
      }, for: .valueChanged)
    contentView.addSubview(control)
    control.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      control.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      control.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      control.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
      control.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
    ])
  }
  required init?(coder: NSCoder) { fatalError() }
}

/// What Radar stayed quiet about, with its reasons; "This was important" teaches it.
final class RadarSkippedController: ListController {
  private var items: [RadarItem] = []
  private var cursor: JSON = .null
  init() { super.init(title: "Skipped") }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.largeTitleDisplayMode = .never
    NotificationCenter.default.addObserver(
      self, selector: #selector(changed), name: RadarStore.outcomesChanged, object: nil)
  }
  @objc private func changed() { render() }
  override func load() async throws {
    let page = try await API.shared.rpc("radar/updates", ["view": "skipped", "limit": 50])
    items = page["items"].array.compactMap(RadarItem.init)
    cursor = page["nextCursor"]
    render()
  }
  private func loadMore() {
    guard !cursor.isNull else { return }
    Task {
      do {
        let page = try await API.shared.rpc(
          "radar/updates", ["view": "skipped", "limit": 50, "cursor": cursor])
        let known = Set(items.map(\.id))
        items += page["items"].array.compactMap(RadarItem.init).filter { !known.contains($0.id) }
        cursor = page["nextCursor"]
        render()
      } catch { showError(error) }
    }
  }
  private func render() {
    var rows = items.map(row)
    if !cursor.isNull {
      rows.append(ListRow(title: "Show more", action: { [weak self] in self?.loadMore() }))
    }
    sections = [ListSection(rows: rows, footer: items.isEmpty ? "Nothing skipped yet." : nil)]
  }
  private func row(_ item: RadarItem) -> ListRow {
    let marked =
      item.feedback == "important" || RadarStore.shared.outcomes[item.id] == .important
    let important = UIContextualAction(style: .normal, title: "Important") {
      [weak self] _, _, finish in
      finish(true)
      self?.radarFeedback(item, "important")
    }
    important.image = UIImage(systemName: "exclamationmark.circle")
    important.backgroundColor = Theme.ink
    return ListRow(
      title: item.title, action: { [weak self] in self?.presentRadar(item, mode: .detail) },
      menu: UIMenu(
        children: (marked
          ? []
          : [
            UIAction(
              title: "This was important", image: UIImage(systemName: "exclamationmark.circle")
            ) { [weak self] _ in self?.radarFeedback(item, "important") }
          ]) + radarMoreActions(item, why: true)),
      cell: {
        let cell = RadarRowCell(
          item, detail: item.reason.isEmpty ? item.why : item.reason,
          settled: marked ? "Marked important" : nil)
        cell.accessoryType = marked ? .checkmark : .none
        return cell
      }, swipeActions: marked ? [] : [important])
  }
}
