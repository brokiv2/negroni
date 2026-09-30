import NegroniCore
import SafariServices
import UIKit
import WebKit

final class FeedController: ListController {
  let botID: String
  private let categories = UISegmentedControl(items: ["Feed", "Saved", "Automations"])
  private var expanded = Set<String>(), hidden = false
  private var feedItems: [JSON] = []
  init(botID: String) {
    self.botID = botID
    super.init(title: "For you")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    categories.selectedSegmentIndex = 0
    categories.addTarget(self, action: #selector(categoryChanged), for: .valueChanged)
    let header = UIView(frame: CGRect(x: 0, y: 0, width: view.bounds.width, height: 56))
    header.addSubview(categories)
    categories.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      categories.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 20),
      categories.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -20),
      categories.centerYAnchor.constraint(equalTo: header.centerYAnchor),
    ])
    tableView.tableHeaderView = header
    updateToolbar()
  }
  private func updateToolbar() {
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
    sections = []
    updateToolbar()
    reloadData()
  }
  override func load() async throws {
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
      sections = [
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
      feedItems = items.array
      sections = items.array.map { item in
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
      if sections.isEmpty {
        sections = [
          ListSection(rows: [], footer: "Articles and posts selected for you will appear here.")
        ]
      }
    }
  }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath)
    -> UITableViewCell
  {
    guard categories.selectedSegmentIndex != 2, feedItems.indices.contains(indexPath.section) else {
      return super.tableView(tableView, cellForRowAt: indexPath)
    }
    let cell = FeedCardCell(style: .default, reuseIdentifier: nil)
    let item = feedItems[indexPath.section]
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
    let accounts = try await API.shared.rpc("connections/list").array
    let selectedAccounts = profile["accountResearchIds"].array.map(\.string)
    let observableAccounts = accounts.filter {
      $0["capabilities"].array.map(\.string).contains("background_read")
        || selectedAccounts.contains($0["id"].string)
    }
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
        footer: (profile["researchEnabled"].bool || !selectedAccounts.isEmpty)
          ? researchDetail : "Reads public sources and adds relevant articles to For you."),
      ListSection(
        title: "Connected sources",
        rows: observableAccounts.map { account in
          ListRow(
            title: account["accountLabel"].string.isEmpty ? account["displayName"].string : account["accountLabel"].string,
            detail: account["status"].string == "connected" ? "" : "Reconnect in Settings",
            symbol: "doc.text.magnifyingglass",
            switchValue: selectedAccounts.contains(account["id"].string),
            onSwitch: { [weak self] enabled in
              var ids = selectedAccounts.filter { $0 != account["id"].string }
              if enabled { ids.append(account["id"].string) }
              self?.mutate("feed/configure", ["accountResearchIds": .array(ids.map(JSON.string))])
            })
        } + [
          ListRow(
            title: "Connect app", symbol: "plus",
            action: { [weak self] in
              self?.navigationController?.pushViewController(
                ConnectionsController(), animated: true)
            })
        ],
        footer: "Reads new mail and recent meetings from selected accounts. Useful findings appear in For you."),
      ListSection(rows: [ListRow(title: "Important updates", symbol: "bell",
        switchValue: profile["accountAlerts"].bool,
        onSwitch: { [weak self] value in self?.mutate("feed/configure", ["accountAlerts": .bool(value), "accountTimeZone": .string(TimeZone.current.identifier)]) })],
        footer: "Up to two timely updates a day, between 08:00 and 22:00. Other findings stay in For you."),
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
