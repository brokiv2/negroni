import NegroniCore
import SafariServices
import UIKit
import WebKit

final class FeedController: ListController {
  let botID: String
  private let categories = UISegmentedControl(items: ["Feed", "Saved", "Automations"])
  private var expanded = Set<String>(), hidden = false
  private var feedItems: [JSON] = []
  /// Sections above the selected tab: the Radar block (the level card, or Needs you and the
  /// latest brief), then the Feed / Saved / Automations control. They belong to For you, not
  /// to the Feed tab, so they stay while the tabs change.
  private var leadingSections = 0
  private var showAllOpen = false
  init(botID: String) {
    self.botID = botID
    super.init(title: "For you")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    categories.selectedSegmentIndex = 0
    categories.addTarget(self, action: #selector(categoryChanged), for: .valueChanged)
    updateToolbar()
    NotificationCenter.default.addObserver(
      self, selector: #selector(radarChanged), name: RadarStore.outcomesChanged, object: nil)
  }
  @objc private func radarChanged() {
    if viewIfLoaded?.window != nil { reloadData() }
  }
  private func updateToolbar() {
    defer {
      let radar = UIBarButtonItem(
        image: UIImage(systemName: "dot.radiowaves.left.and.right"),
        primaryAction: UIAction { [weak self] _ in self?.push(RadarController()) })
      radar.accessibilityLabel = "Radar"
      navigationItem.rightBarButtonItems = [navigationItem.rightBarButtonItem, radar].compactMap {
        $0
      }
    }
    let action: UIAction
    if categories.selectedSegmentIndex == 2 {
      action = UIAction(title: "New automation", image: UIImage(systemName: "plus")) {
        [weak self] _ in
        (self?.tabBarController as? MainTabController)?.ask("Хочу создать автоматизацию: ")
      }
      navigationItem.rightBarButtonItem = UIBarButtonItem(primaryAction: action)
    } else {
      let menu = UIMenu(children: [
        UIAction(title: "Feed settings", image: UIImage(systemName: "slider.horizontal.3")) {
          [weak self] _ in
          guard let self else { return }
          let nav = UINavigationController(rootViewController: FeedSettingsController())
          nav.modalPresentationStyle = .pageSheet
          nav.sheetPresentationController?.detents = [.medium(), .large()]
          nav.sheetPresentationController?.prefersGrabberVisible = true
          self.present(nav, animated: true)
        },
        UIAction(
          title: hidden ? "Show feed" : "Hidden posts", image: UIImage(systemName: "eye.slash")
        ) { [weak self] _ in
          self?.hidden.toggle()
          self?.reloadData()
          self?.updateToolbar()
        },
      ])
      navigationItem.rightBarButtonItem = UIBarButtonItem(
        image: UIImage(systemName: "slider.horizontal.3"), menu: menu)
    }
  }
  @objc private func categoryChanged() {
    hidden = false
    updateToolbar()
    // The control is a row of this list, so the list changes after its own touch ends. Needs
    // you and the control stay; the old tab's sections go while the new tab loads.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      sections = Array(sections.prefix(leadingSections))
      reloadData()
    }
  }
  override func load() async throws {
    // Needs you comes first, whichever tab is selected.
    async let radarBlock = radarContent()
    var tab: [ListSection]
    var articles: [JSON] = []
    if categories.selectedSegmentIndex == 2 {
      let bots = try await API.shared.rpc("bots/list")
      var ids = Set([botID])
      var changed = true
      while changed {
        changed = false
        for bot in bots.array
        where ids.contains(bot["parentBotId"].string) && !ids.contains(bot["id"].string) {
          ids.insert(bot["id"].string)
          changed = true
        }
      }
      var routines: [JSON] = []
      for id in ids {
        routines += try await API.shared.rpc("routines/list", ["botId": .string(id)]).array
      }
      tab = [
        ListSection(
          rows: routines.map { routine in
            let id = routine["id"].string
            let menu = UIMenu(children: [
              UIAction(
                title: routine["active"].bool ? "Pause" : "Resume",
                image: UIImage(systemName: routine["active"].bool ? "pause" : "play")
              ) { [weak self] _ in
                self?.mutate(
                  "routines/update",
                  ["routineId": routine["id"], "active": .bool(!routine["active"].bool)])
              },
              UIAction(title: "Edit in chat", image: UIImage(systemName: "pencil")) {
                [weak self] _ in
                (self?.tabBarController as? MainTabController)?.ask(
                  "Изменим автоматизацию «\(routine["name"].string)»: ")
              },
              UIAction(
                title: "Delete", image: UIImage(systemName: "trash"), attributes: .destructive
              ) { [weak self] _ in
                self?.confirmDelete("Delete \(routine["name"].string)?") { [weak self] in
                  self?.mutate("routines/remove", ["routineId": routine["id"]])
                }
              },
            ])
            return ListRow(
              title: routine["name"].string,
              detail: expanded.contains(id)
                ? routine["prompt"].string + "\n\n" + (routine["active"].bool ? "Active" : "Paused")
                : "", symbol: routine["active"].bool ? "clock" : "pause.circle",
              action: { [weak self] in
                guard let self else { return }
                if self.expanded.contains(id) {
                  self.expanded.remove(id)
                } else {
                  self.expanded.insert(id)
                }
                self.reloadData()
              }, menu: menu, accessory: .disclosureIndicator, lines: 0,
              deleteAction: { [weak self] in
                self?.confirmDelete("Delete \(routine["name"].string)?") { [weak self] in
                  self?.mutate("routines/remove", ["routineId": routine["id"]])
                }
              })
          },
          footer: routines.isEmpty
            ? "Ask Negroni in chat to schedule a task."
            : "Touch and hold an automation to pause, edit or delete it.")
      ]
    } else {
      let items = try await API.shared.rpc(
        "feed/list",
        ["saved": .bool(categories.selectedSegmentIndex == 1), "hidden": .bool(hidden)])
      articles = items.array
      tab = items.array.map { item in
        ListSection(rows: [
          ListRow(
            title: item["title"].string,
            action: { [weak self] in self?.push(ArticleController(item: item)) },
            menu: UIMenu(children: [
              UIAction(
                title: item["saved"].bool ? "Unsave" : "Save",
                image: UIImage(systemName: "bookmark")
              ) { [weak self] _ in
                self?.mutate(
                  "feed/update", ["id": item["id"], "saved": .bool(!item["saved"].bool)])
              },
              UIAction(
                title: item["hidden"].bool ? "Restore" : "Hide",
                image: UIImage(systemName: "eye.slash")
              ) { [weak self] _ in
                self?.mutate(
                  "feed/update", ["id": item["id"], "hidden": .bool(!item["hidden"].bool)])
              },
            ]),
            deleteAction: { [weak self] in
              self?.mutate(
                "feed/update", ["id": item["id"], "hidden": .bool(!item["hidden"].bool)])
            }, deleteTitle: item["hidden"].bool ? "Restore" : "Hide")
        ])
      }
      if articles.isEmpty {
        tab.append(
          ListSection(rows: [], footer: "Articles and posts selected for you will appear here."))
      }
    }
    let leading = await radarBlock + [tabsSection()]
    try Task.checkCancellation()
    feedItems = articles
    leadingSections = leading.count
    sections = leading + tab
  }
  /// Feed / Saved / Automations, a row of its own with no card behind it.
  private func tabsSection() -> ListSection {
    ListSection(rows: [
      ListRow(title: "", cell: { [categories] in SegmentedControlCell(categories) })
    ])
  }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath)
    -> UITableViewCell
  {
    let index = indexPath.section - leadingSections
    guard categories.selectedSegmentIndex != 2, feedItems.indices.contains(index) else {
      return super.tableView(tableView, cellForRowAt: indexPath)
    }
    let cell = FeedCardCell(style: .default, reuseIdentifier: nil)
    let item = feedItems[index]
    cell.configure(item, discuss: { [weak self] in
      self?.push(ChatController(target: ["feedItemId": item["id"]], title: item["title"].string))
    }, save: { [weak self] in
      self?.mutate("feed/update", ["id": item["id"], "saved": .bool(!item["saved"].bool)])
    }, info: { [weak self] in
      let alert = UIAlertController(title: "Why this post", message: item["reason"].string, preferredStyle: .actionSheet)
      alert.addAction(UIAlertAction(title: "Not interested in this topic", style: .destructive) { _ in
        self?.mutate("feed/interest", ["topic": item["topic"], "action": "exclude"])
      })
      alert.addAction(UIAlertAction(title: "Hide this post", style: .default) { _ in
        self?.mutate("feed/update", ["id": item["id"], "hidden": true])
      })
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
      alert.popoverPresentationController?.sourceView = self?.view
      alert.popoverPresentationController?.sourceRect = CGRect(x: 20, y: 80, width: 1, height: 1)
      self?.present(alert, animated: true)
    })
    return cell
  }

  /// Off: one question. On: what needs the owner, then the latest brief.
  private func radarContent() async -> [ListSection] {
    // A server without Radar keeps the plain feed.
    guard let status = try? await RadarStore.shared.loadStatus() else { return [] }
    guard status["settings"]["enabled"].bool else {
      return [
        ListSection(rows: [
          ListRow(
            title: "When should I interrupt you?",
            cell: { [weak self] in RadarLevelCardCell { self?.enableRadar($0) } })
        ])
      ]
    }
    var result: [ListSection] = []
    let page = try? await API.shared.rpc("radar/updates", ["view": "open", "limit": 50])
    let open = page?["items"].array.compactMap(RadarItem.init) ?? []
    // Right after it is turned on, nothing has been checked yet.
    let starting = status["lastCycleAt"].isNull
    if !open.isEmpty || starting {
      let shown = showAllOpen ? open : Array(open.prefix(5))
      var rows = shown.map(needsYouRow)
      if open.count > shown.count {
        rows.append(
          ListRow(
            title: "\(open.count - shown.count) more",
            action: { [weak self] in
              self?.showAllOpen = true
              self?.reloadData()
            }))
      }
      result.append(
        ListSection(
          title: "Needs you", rows: rows,
          footer: open.isEmpty ? "Taking a look around. I’ll follow up shortly." : nil))
    }
    if let brief = await latestBrief(status) { result.append(brief) }
    return result
  }
  private func needsYouRow(_ item: RadarItem) -> ListRow {
    let done = UIContextualAction(style: .normal, title: "Done") { [weak self] _, _, finish in
      finish(true)
      self?.radarFeedback(item, "done")
    }
    done.image = UIImage(systemName: "checkmark")
    done.backgroundColor = Theme.ink
    let later = UIContextualAction(style: .normal, title: "Later") { [weak self] _, view, finish in
      finish(true)
      self?.presentRadarLater(item, from: view)
    }
    later.image = UIImage(systemName: "clock")
    later.backgroundColor = Theme.muted
    return ListRow(
      title: item.title, action: { [weak self] in self?.presentRadar(item, mode: .detail) },
      menu: radarActionsMenu(item), cell: { RadarRowCell(item, detail: item.why) },
      swipeActions: [done, later])
  }
  /// The newest brief from the last day. Its message (named by the status) is read from the
  /// personal conversation, and the card opens the chat at that message.
  private func latestBrief(_ status: JSON) async -> ListSection? {
    let id = status["lastBriefMessageId"].string
    guard !id.isEmpty, let sent = RadarTime.parse(status["lastBriefAt"].string),
      Date().timeIntervalSince(sent) < 86_400,
      let page = try? await API.shared.rpc(
        "threads/messages",
        ["botId": .string(botID), "threadKind": "personal", "around": ["messageId": .string(id)]]),
      let message = page["messages"].array.first(where: { $0["id"].string == id })
    else { return nil }
    let blocks = message["blocks"].array
    guard let block = blocks.first(where: { $0["kind"].string == "brief" }),
      let brief = RadarBrief(block)
    else { return nil }
    let narrative = blocks.filter { $0["kind"].string == "text" }.map { $0["text"].string }
      .joined(separator: "\n\n")
    return ListSection(
      title: brief.title.isEmpty ? nil : brief.title,
      rows: [
        ListRow(
          title: brief.title,
          action: { [weak self] in
            self?.radarTabs?.showPersonalChat { $0.focus(messageID: id) }
          }, cell: { RadarBriefCardCell(narrative: narrative, brief: brief) })
      ])
  }
  /// Turns Radar on at a level, asks for notifications and starts the first look around.
  private func enableRadar(_ level: String) {
    Task {
      do {
        RadarStore.shared.apply(
          try await API.shared.rpc(
            "radar/configure",
            [
              "enabled": true, "level": .string(level),
              "timeZone": .string(TimeZone.current.identifier),
            ]))
        try? await Notifications.shared.request()
        _ = try? await API.shared.rpc("radar/check")
      } catch { showError(error) }
      reloadData()
    }
  }
}

/// Hosts a segmented control as a list row, without the card around other rows.
final class SegmentedControlCell: UITableViewCell {
  init(_ control: UISegmentedControl) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = .clear
    selectionStyle = .none
    contentView.addSubview(control)
    control.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      control.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      control.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      control.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 6),
      control.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -6),
    ])
  }
  required init?(coder: NSCoder) { fatalError() }
}

final class FeedCardCell: UITableViewCell {
  private var imageTask: Task<Void, Never>?
  func configure(_ item: JSON, discuss: @escaping () -> Void, save: @escaping () -> Void, info: @escaping () -> Void) {
    backgroundColor = Theme.canvas
    selectionStyle = .none
    let stack = Theme.stack(spacing: 14)
    contentView.addSubview(stack)
    stack.pin(to: contentView, inset: 18)
    let title = Theme.label("", style: .title3)
    title.attributedText = Markdown.render(item["title"].string, style: .headline)
    stack.addArrangedSubview(title)
    let summary = UITextView()
    summary.isEditable = false
    summary.isSelectable = true
    summary.isScrollEnabled = false
    summary.backgroundColor = .clear
    summary.textContainerInset = .zero
    summary.textContainer.lineFragmentPadding = 0
    summary.linkTextAttributes = [.foregroundColor: Theme.ink, .underlineStyle: NSUnderlineStyle.single.rawValue]
    summary.attributedText = Markdown.render(item["summary"].string, style: .body)
    stack.addArrangedSubview(summary)
    if !item["imageUrl"].string.isEmpty {
      let image = UIImageView()
      image.contentMode = .scaleAspectFill
      image.clipsToBounds = true
      image.layer.cornerRadius = 18
      image.backgroundColor = Theme.secondary
      image.heightAnchor.constraint(equalToConstant: 210).isActive = true
      stack.addArrangedSubview(image)
      imageTask = Task {
        if let loaded = await ImageStore.shared.image(item["imageUrl"].string), !Task.isCancelled { image.image = loaded }
        else { image.isHidden = true }
      }
    }
    let source = URL(string: item["url"].string)?.host ?? item["topic"].string
    if let url = URL(string: item["url"].string), url.scheme == "https" {
      let sourceButton = UIButton(type: .system)
      sourceButton.setTitle(source + " ↗", for: .normal)
      sourceButton.titleLabel?.font = UIFont.preferredFont(forTextStyle: .caption1)
      sourceButton.tintColor = Theme.muted
      sourceButton.contentHorizontalAlignment = .leading
      sourceButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      sourceButton.addAction(UIAction { _ in UIApplication.shared.open(url) }, for: .touchUpInside)
      stack.addArrangedSubview(sourceButton)
    } else if !source.isEmpty { stack.addArrangedSubview(Theme.label(source, style: .caption1, color: Theme.muted)) }
    let actions = Theme.stack(.horizontal, spacing: 14)
    let saved = UIButton(type: .system)
    saved.setImage(UIImage(systemName: item["saved"].bool ? "heart.fill" : "heart"), for: .normal)
    saved.tintColor = Theme.ink
    saved.accessibilityLabel = item["saved"].bool ? "Unsave" : "Save"
    saved.addAction(UIAction { _ in save() }, for: .touchUpInside)
    saved.widthAnchor.constraint(equalToConstant: 44).isActive = true
    saved.heightAnchor.constraint(equalToConstant: 44).isActive = true
    actions.addArrangedSubview(saved)
    actions.addArrangedSubview(Theme.button("Discuss", symbol: "bubble.left", action: discuss))
    actions.addArrangedSubview(UIView())
    let why = UIButton(type: .system)
    why.setImage(UIImage(systemName: "info.circle"), for: .normal)
    why.tintColor = Theme.muted
    why.accessibilityLabel = "Why this post"
    why.addAction(UIAction { _ in info() }, for: .touchUpInside)
    why.widthAnchor.constraint(equalToConstant: 44).isActive = true
    actions.addArrangedSubview(why)
    stack.addArrangedSubview(actions)
  }
  override func prepareForReuse() {
    super.prepareForReuse()
    imageTask?.cancel()
  }
}

final class FeedSettingsController: ListController {
  private var profile: JSON = [:]
  init() { super.init(title: "Feed settings") }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
  }
  override func load() async throws {
    profile = try await API.shared.rpc("feed/profile")
    let research = try await API.shared.rpc("feed/research")
    let researchState = research["state"].string
    let dateFormatter = ISO8601DateFormatter()
    dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let nextCheck =
      dateFormatter.date(from: research["nextCheckAt"].string).map {
        " · Next: " + $0.formatted(date: .abbreviated, time: .shortened)
      } ?? ""
    let researchDetail =
      researchState == "learning"
      ? "Add a topic or let interests emerge from conversations."
      : researchState == "researching"
        ? "Checking sources"
        : researchState == "needs_attention"
          ? research["error"].string
          : "\(research["checksUsed"].int) of \(research["checksPerDay"].int) checks in the last 24 hours"
            + nextCheck
    sections = [
      ListSection(
        title: "Discovery",
        rows: [
          ListRow(
            title: "Find articles for me", symbol: "sparkle.magnifyingglass",
            switchValue: profile["researchEnabled"].bool,
            onSwitch: { [weak self] value in
              self?.mutate("feed/configure", ["researchEnabled": .bool(value)])
            }),
          ListRow(
            title: "Checks per day", detail: "\(profile["researchChecksPerDay"].int)",
            action: { [weak self] in
              self?.prompt(
                "Checks per day", value: String(self?.profile["researchChecksPerDay"].int ?? 3)
              ) { [weak self] value in
                if let count = Int(value) {
                  self?.mutate("feed/configure", ["researchChecksPerDay": .number(Double(count))])
                }
              }
            }),
        ],
        footer: profile["researchEnabled"].bool
          ? researchDetail : "Reads public sources and adds relevant articles to For you."),
      ListSection(rows: [
        ListRow(
          title: "Learn interests from conversations",
          detail: profile["learningEnabled"].bool ? "On" : "Off", symbol: "sparkles",
          action: { [weak self] in
            guard let self else { return }
            self.mutate(
              "feed/configure", ["learningEnabled": .bool(!self.profile["learningEnabled"].bool)])
          }),
        ListRow(
          title: "Add topic", symbol: "plus",
          action: { [weak self] in
            self?.prompt("Follow a topic") { [weak self] value in
              self?.mutate("feed/interest", ["topic": .string(value), "action": "follow"])
            }
          }),
      ]),
      ListSection(
        title: "Interests",
        rows: profile["interests"].array.map { item in
          ListRow(
            title: item["topic"].string, detail: item["reason"].string,
            menu: UIMenu(children: [
              UIAction(title: "Exclude", image: UIImage(systemName: "minus.circle")) {
                [weak self] _ in
                self?.mutate("feed/interest", ["topic": item["topic"], "action": "exclude"])
              },
              UIAction(title: "Forget", attributes: .destructive) { [weak self] _ in
                self?.mutate("feed/interest", ["topic": item["topic"], "action": "forget"])
              },
            ]))
        }),
      ListSection(
        title: "Sources",
        rows: [
          ListRow(
            title: "Source domains",
            detail: profile["sourceDomains"].array.map(\.string).joined(separator: ", "),
            action: { [weak self] in
              guard let self else { return }
              self.prompt(
                "Sources",
                value: self.profile["sourceDomains"].array.map(\.string).joined(separator: ", "),
                placeholder: "example.com, another.org"
              ) { [weak self] value in
                self?.mutate(
                  "feed/configure",
                  [
                    "sourceDomains": .array(
                      value.split(separator: ",").map {
                        .string($0.trimmingCharacters(in: .whitespaces))
                      })
                  ])
              }
            }),
          ListRow(
            title: "Articles per day", detail: "\(profile["maxItems"].int)",
            action: { [weak self] in
              self?.prompt(
                "Articles per day", value: String(self?.profile["maxItems"].int ?? 5)
              ) { [weak self] value in
                if let n = Int(value) {
                  self?.mutate("feed/configure", ["maxItems": .number(Double(n))])
                }
              }
            }),
        ]),
    ]
  }
}

final class ArticleController: UIViewController {
  let item: JSON
  init(item: JSON) {
    self.item = item
    super.init(nibName: nil, bundle: nil)
    title = "Article"
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    let scroll = UIScrollView()
    let stack = Theme.stack(spacing: 18)
    view.addSubview(scroll)
    scroll.pin(to: view)
    scroll.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(
        equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(
        equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -32),
      stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
    ])
    if !item["imageUrl"].string.isEmpty {
      let image = UIImageView()
      image.contentMode = .scaleAspectFill
      image.clipsToBounds = true
      image.layer.cornerRadius = 18
      image.heightAnchor.constraint(equalToConstant: 210).isActive = true
      stack.addArrangedSubview(image)
      Task {
        if let loaded = await ImageStore.shared.image(item["imageUrl"].string) {
          image.image = loaded
        } else {
          image.isHidden = true
        }
      }
    }
    let title = Theme.label("", style: .title1)
    title.attributedText = Markdown.render(item["title"].string, style: .title1)
    stack.addArrangedSubview(title)
    if let postID = EmbeddedPostView.postID(item["url"].string) {
      let button = Theme.button("Show post from X", symbol: "quote.bubble") {}
      button.addAction(
        UIAction { _ in
          button.isHidden = true
          let post = EmbeddedPostView(postID: postID)
          stack.insertArrangedSubview(post, at: min(2, stack.arrangedSubviews.count))
        }, for: .touchUpInside)
      stack.addArrangedSubview(button)
    }
    let body = UITextView()
    body.isEditable = false
    body.isSelectable = true
    body.isScrollEnabled = false
    body.backgroundColor = .clear
    body.attributedText = Markdown.render(
      [item["summary"].string, item["content"].string].filter { !$0.isEmpty }.joined(
        separator: "\n\n"))
    stack.addArrangedSubview(body)
    stack.addArrangedSubview(
      Theme.button("Discuss this article", symbol: "bubble.left", primary: true) { [weak self] in
        guard let self else { return }
        self.navigationController?.pushViewController(
          ChatController(target: ["feedItemId": self.item["id"]], title: self.item["title"].string),
          animated: true)
      })
    if let url = URL(string: item["url"].string), ["https", "http"].contains(url.scheme ?? "") {
      stack.addArrangedSubview(
        Theme.button("Open source", symbol: "safari") { [weak self] in
          self?.present(SFSafariViewController(url: url), animated: true)
        })
    }
    let menu = UIMenu(children: [
      UIAction(
        title: item["saved"].bool ? "Unsave" : "Save", image: UIImage(systemName: "bookmark")
      ) { [weak self] _ in self?.update("saved") },
      UIAction(
        title: item["hidden"].bool ? "Restore" : "Hide", image: UIImage(systemName: "eye.slash")
      ) { [weak self] _ in self?.update("hidden") },
    ])
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "ellipsis"), menu: menu)
  }
  private func update(_ key: String) {
    Task {
      do {
        _ = try await API.shared.rpc(
          "feed/update", ["id": item["id"], key: .bool(!item[key].bool)])
        navigationController?.popViewController(animated: true)
      } catch { showError(error) }
    }
  }
}

final class EmbeddedPostView: WKWebView, WKNavigationDelegate {
  static func postID(_ raw: String) -> String? {
    guard let url = URL(string: raw), url.scheme == "https",
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].contains(url.host ?? "")
    else { return nil }
    let parts = url.pathComponents
    guard let position = parts.firstIndex(of: "status"), parts.indices.contains(position + 1) else {
      return nil
    }
    let id = parts[position + 1]
    return !id.isEmpty && id.count <= 25 && id.allSatisfy { $0.isASCII && $0.isNumber } ? id : nil
  }
  init(postID: String) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    super.init(frame: .zero, configuration: config)
    navigationDelegate = self
    isOpaque = false
    backgroundColor = .clear
    heightAnchor.constraint(equalToConstant: 440).isActive = true
    loadHTMLString(
      """
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:transparent}iframe{max-width:100%}</style></head><body>
      <blockquote class="twitter-tweet" data-dnt="true"><a href="https://twitter.com/i/status/\(postID)">Open post on X</a></blockquote>
      <script async src="https://platform.twitter.com/widgets.js"></script></body></html>
      """, baseURL: URL(string: "https://platform.twitter.com"))
  }
  required init?(coder: NSCoder) { fatalError() }
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.navigationType == .linkActivated {
      if let url = navigationAction.request.url, url.scheme == "https" {
        UIApplication.shared.open(url)
      }
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }
}
