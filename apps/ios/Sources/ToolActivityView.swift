import NegroniCore
import UIKit

enum ToolPresentation {
  static func symbol(_ name: String) -> String {
    let name = name.lowercased()
    if name.contains("mail") || name.contains("message") { return "envelope" }
    if name.contains("calendar") || name.contains("meeting") { return "calendar" }
    if name.contains("search") { return "magnifyingglass" }
    if name.contains("browser") || name.contains("url") { return "globe" }
    if name.contains("file") || name.contains("document") { return "doc.text" }
    if name.contains("subagent") || name.contains("bot") { return "person.2" }
    if name.contains("mac_") || name.contains("screen") || name == "shell" {
      return "desktopcomputer"
    }
    return "sparkle"
  }
  static func label(_ item: JSON) -> String {
    switch item["name"].string {
    case "COMPOSIO_SEARCH_TOOLS": return "Find connected tools"
    case "mac_osascript": return "Use your Mac"
    case "mac_open_url": return "Open a webpage"
    case "screen_view": return "Read the screen"
    case "screen_info": return "Check the display"
    case "shell": return "Run a command"
    default: return item["label"].string
    }
  }
  static func iconRequest(_ name: String) -> JSON? {
    let name = name.lowercased()
    let services = [
      "gmail", "googlecalendar", "googledrive", "slack", "notion", "github", "youtube", "linkedin",
      "granola",
    ]
    guard let service = services.first(where: { name.hasPrefix($0 + "_") }) else { return nil }
    return ["connectorId": "composio", "provider": .string(service)]
  }
}

final class ToolActivityView: UIView {
  private let stack = UIStackView()
  private var shown: [JSON] = []
  var onOpen: (() -> Void)?
  override init(frame: CGRect) {
    super.init(frame: frame)
    stack.axis = .vertical
    stack.spacing = 2
    addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
      stack.topAnchor.constraint(equalTo: topAnchor, constant: 6),
      stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
    ])
  }
  required init?(coder: NSCoder) { fatalError() }
  func configure(_ items: [JSON]) {
    guard items != shown else { return }
    shown = items
    for view in stack.arrangedSubviews { view.removeFromSuperview() }
    for item in items.suffix(3) {
      let row = ToolActivityRow(item: item)
      row.addAction(UIAction { [weak self] _ in self?.onOpen?() }, for: .touchUpInside)
      stack.addArrangedSubview(row)
    }
    if items.count > 3 {
      let all = UIButton(type: .system)
      var configuration = UIButton.Configuration.plain()
      configuration.title = "View all \(items.count) actions"
      configuration.image = UIImage(systemName: "chevron.right")
      configuration.preferredSymbolConfigurationForImage = .init(pointSize: 10, weight: .medium)
      configuration.imagePlacement = .trailing
      configuration.imagePadding = 6
      configuration.baseForegroundColor = Theme.muted
      configuration.contentInsets = .init(top: 8, leading: 28, bottom: 8, trailing: 0)
      configuration.titleTextAttributesTransformer = .init { value in
        var value = value
        value.font = .preferredFont(forTextStyle: .footnote)
        return value
      }
      all.configuration = configuration
      all.contentHorizontalAlignment = .leading
      all.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      all.addAction(UIAction { [weak self] _ in self?.onOpen?() }, for: .touchUpInside)
      stack.addArrangedSubview(all)
    }
  }
  func measuredHeight(width: CGFloat) -> CGFloat {
    guard !shown.isEmpty else { return 0 }
    return systemLayoutSizeFitting(
      CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel
    ).height
  }
}

private final class ToolActivityRow: UIControl {
  private let icon = UIImageView()
  private var iconTask: Task<Void, Never>?
  init(item: JSON) {
    super.init(frame: .zero)
    let status = item["status"].string
    let title = ToolPresentation.label(item)
    let content = UIStackView()
    content.alignment = .center
    content.spacing = 8
    content.isUserInteractionEnabled = false
    icon.contentMode = .scaleAspectFit
    icon.tintColor = Theme.muted
    icon.image = UIImage(systemName: ToolPresentation.symbol(item["name"].string))
    icon.widthAnchor.constraint(equalToConstant: 20).isActive = true
    icon.heightAnchor.constraint(equalToConstant: 20).isActive = true
    content.addArrangedSubview(icon)
    let label = Theme.label(title, style: .subheadline)
    label.textColor = Theme.muted
    label.numberOfLines = 2
    label.adjustsFontForContentSizeCategory = true
    content.addArrangedSubview(label)
    if status == "running" {
      let spinner = UIActivityIndicatorView(style: .medium)
      spinner.color = Theme.muted
      spinner.startAnimating()
      content.addArrangedSubview(spinner)
    } else {
      let symbol =
        status == "succeeded"
        ? "checkmark" : status == "error" ? "exclamationmark.circle" : "minus.circle"
      let state = UIImageView(
        image: UIImage(
          systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 12)))
      state.tintColor = status == "error" ? UIColor(hex: Palette.destructive) : Theme.muted
      state.setContentHuggingPriority(.required, for: .horizontal)
      content.addArrangedSubview(state)
    }
    let chevron = UIImageView(
      image: UIImage(
        systemName: "chevron.right",
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 10, weight: .medium)))
    chevron.tintColor = Theme.muted
    chevron.setContentHuggingPriority(.required, for: .horizontal)
    content.addArrangedSubview(chevron)
    addSubview(content)
    content.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      content.leadingAnchor.constraint(equalTo: leadingAnchor),
      content.trailingAnchor.constraint(equalTo: trailingAnchor),
      content.topAnchor.constraint(equalTo: topAnchor, constant: 10),
      content.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
      heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
    isAccessibilityElement = true
    accessibilityLabel = title
    accessibilityValue =
      [
        "running": "In progress", "succeeded": "Done", "error": "Failed",
        "interrupted": "Interrupted", "waiting": "Waiting for you",
      ][status]
    accessibilityTraits = .button
    accessibilityHint = "Show tool activity"
    if let request = ToolPresentation.iconRequest(item["name"].string) {
      iconTask = Task { [weak self] in
        if let image = await ImageStore.shared.connectionImage(nil, request: request),
          !Task.isCancelled
        {
          self?.icon.image = image.withRenderingMode(.alwaysOriginal)
        }
      }
    }
  }
  required init?(coder: NSCoder) { fatalError() }
  deinit { iconTask?.cancel() }
}

final class ToolActivityController: ListController {
  let target: JSON
  private var poll: Task<Void, Never>?
  private var previousItems: [JSON]?
  init(target: JSON) {
    self.target = target
    super.init(title: "Activity")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
    )
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(2))
        if Task.isCancelled { break }
        guard let self else { break }
        try? await load()
      }
    }
  }
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    poll?.cancel()
    poll = nil
  }
  override func load() async throws {
    let items = try await API.shared.rpc("threads/activity", target).array
    guard !Task.isCancelled, items != previousItems else { return }
    previousItems = items
    sections = [
      ListSection(
        rows: items.map { item in
          let status =
            [
              "running": "In progress", "succeeded": "Done", "error": "Failed",
              "interrupted": "Interrupted", "waiting": "Waiting for you",
            ][item["status"].string] ?? ""
          let duration =
            item["durationMs"].isNull
            ? "" : String(format: " · %.1f s", Double(item["durationMs"].int) / 1000)
          return ListRow(
            title: ToolPresentation.label(item), detail: status + duration,
            symbol: ToolPresentation.symbol(item["name"].string),
            iconRequest: ToolPresentation.iconRequest(item["name"].string))
        }, footer: items.isEmpty ? "Actions will appear here when the assistant uses a tool." : nil)
    ]
  }
}
