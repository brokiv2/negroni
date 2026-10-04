import NegroniCore
import UIKit

/// Source mark, then sender (or the app) and time.
final class RadarMetaRow: UIStackView {
  private let icon = UIImageView()
  private var iconTask: Task<Void, Never>?
  init(_ item: RadarItem, showSource: Bool = false) {
    super.init(frame: .zero)
    axis = .horizontal
    spacing = 6
    alignment = .center
    icon.contentMode = .scaleAspectFit
    icon.widthAnchor.constraint(equalToConstant: 16).isActive = true
    icon.heightAnchor.constraint(equalToConstant: 16).isActive = true
    icon.isAccessibilityElement = false
    let app = item.source.isEmpty ? "" : ConnectedApp.name(item.source)
    let parts = [
      item.sender.isEmpty ? app : item.sender, showSource && !item.sender.isEmpty ? app : "",
      item.occurredAt.map { RadarTime.when($0, now: Date()) } ?? "",
    ]
    let label = Theme.label(
      parts.filter { !$0.isEmpty }.joined(separator: " · "), style: .caption1, color: Theme.muted)
    label.numberOfLines = 1
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    addArrangedSubview(icon)
    addArrangedSubview(label)
    iconTask = RadarSourceMark.load(item.source, into: icon)
  }
  required init(coder: NSCoder) { fatalError() }
  deinit { iconTask?.cancel() }
}

/// The verbatim words from the source that ground the reason.
final class RadarQuoteView: UIStackView {
  init(_ text: String) {
    super.init(frame: .zero)
    axis = .horizontal
    spacing = 10
    let bar = UIView()
    bar.backgroundColor = Theme.userBubble
    bar.layer.cornerRadius = 1.5
    bar.widthAnchor.constraint(equalToConstant: 3).isActive = true
    let label = Theme.label(text, style: .callout, color: Theme.muted)
    let font = UIFont.preferredFont(forTextStyle: .callout)
    label.font = UIFont(
      descriptor: font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor,
      size: 0)
    addArrangedSubview(bar)
    addArrangedSubview(label)
  }
  required init(coder: NSCoder) { fatalError() }
}

/// An `update` block in the chat: one thing Radar decided the owner should know now.
final class RadarCardView: UIView {
  private let item: RadarItem
  private weak var host: UIViewController?
  init(_ item: RadarItem, host: UIViewController?, relayout: @escaping () -> Void) {
    self.item = item
    self.host = host
    super.init(frame: .zero)
    backgroundColor = Theme.card
    layer.cornerRadius = 20
    layer.borderWidth = 0.5
    layer.borderColor = Theme.border.cgColor
    let stack = Theme.stack(spacing: 10)
    addSubview(stack)
    stack.pin(to: self, inset: 16)
    let header = Theme.stack(.horizontal, spacing: 8)
    header.alignment = .center
    header.addArrangedSubview(RadarMetaRow(item))
    stack.addArrangedSubview(header)
    stack.addArrangedSubview(Theme.label(item.title, style: .headline))
    if !item.why.isEmpty { stack.addArrangedSubview(Theme.label(item.why, style: .body)) }
    if !item.evidence.isEmpty {
      let quote = RadarQuoteView(item.evidence)
      quote.isHidden = !RadarStore.shared.expandedQuotes.contains(item.id)
      stack.addArrangedSubview(quote)
      let toggle = UIButton(type: .system)
      toggle.setImage(
        UIImage(
          systemName: "quote.opening",
          withConfiguration: UIImage.SymbolConfiguration(textStyle: .footnote)), for: .normal)
      toggle.tintColor = Theme.muted
      toggle.accessibilityLabel = "Quote"
      toggle.widthAnchor.constraint(equalToConstant: 44).isActive = true
      toggle.heightAnchor.constraint(equalToConstant: 32).isActive = true
      toggle.addAction(
        UIAction { [id = item.id] _ in
          quote.isHidden.toggle()
          if quote.isHidden {
            RadarStore.shared.expandedQuotes.remove(id)
          } else {
            RadarStore.shared.expandedQuotes.insert(id)
          }
          relayout()
        }, for: .touchUpInside)
      header.addArrangedSubview(toggle)
    }
    stack.setCustomSpacing(14, after: stack.arrangedSubviews.last!)
    let outcome = RadarStore.shared.outcomes[item.id]
    let more = Self.iconButton("ellipsis", label: "More")
    more.menu = UIMenu(children: host?.radarMoreActions(item) ?? [])
    more.showsMenuAsPrimaryAction = true
    let row = Theme.stack(.horizontal, spacing: 4)
    row.alignment = .center
    if RadarStore.shared.isOpen(item.id) {
      let primary = item.primary
      let accept = Theme.button(primary.title, primary: true) { [weak self] in
        guard let self else { return }
        self.host?.acceptRadar(self.item)
      }
      accept.configuration?.image =
        outcome == .sent || primary.kind == .open
        ? UIImage(systemName: outcome == .sent ? "checkmark" : "arrow.up.forward") : nil
      accept.configuration?.imagePlacement = .trailing
      accept.isEnabled = outcome != .sent
      stack.addArrangedSubview(accept)
      let later = Theme.button("Later") {}
      later.menu = host?.radarLaterMenu(item, inline: true)
      later.showsMenuAsPrimaryAction = true
      let dismiss = Theme.button("Not important") { [weak self] in
        guard let self else { return }
        self.host?.radarFeedback(self.item, "not_important")
      }
      for button in [later, dismiss] { row.addArrangedSubview(Self.compact(button)) }
    } else if let label = outcome?.label {
      row.addArrangedSubview(Theme.label(label, style: .footnote, color: Theme.muted))
    }
    row.addArrangedSubview(Self.spacer())
    row.addArrangedSubview(more)
    stack.addArrangedSubview(row)
    isAccessibilityElement = false
  }
  required init?(coder: NSCoder) { fatalError() }
  /// A secondary action in a row: one line, at its natural width.
  static func compact(_ button: UIButton) -> UIButton {
    button.configuration?.contentInsets = .init(top: 10, leading: 10, bottom: 10, trailing: 10)
    button.configuration?.titleLineBreakMode = .byTruncatingTail
    button.setContentHuggingPriority(.required, for: .horizontal)
    button.setContentCompressionResistancePriority(.required, for: .horizontal)
    return button
  }
  /// Takes the free width of a row of compact actions.
  static func spacer() -> UIView {
    let view = UIView()
    view.setContentHuggingPriority(.init(1), for: .horizontal)
    view.setContentCompressionResistancePriority(.init(1), for: .horizontal)
    return view
  }
  static func iconButton(_ symbol: String, label: String) -> UIButton {
    let button = UIButton(type: .system)
    button.setImage(UIImage(systemName: symbol), for: .normal)
    button.tintColor = Theme.ink
    button.accessibilityLabel = label
    button.widthAnchor.constraint(equalToConstant: 44).isActive = true
    button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    return button
  }
}

/// Today's events, left to right.
final class RadarAgendaStrip: UIScrollView {
  init(_ events: [RadarBrief.Event]) {
    super.init(frame: .zero)
    showsHorizontalScrollIndicator = false
    let row = Theme.stack(.horizontal, spacing: 8)
    row.alignment = .top
    addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: contentLayoutGuide.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: contentLayoutGuide.trailingAnchor),
      row.topAnchor.constraint(equalTo: contentLayoutGuide.topAnchor),
      row.bottomAnchor.constraint(equalTo: contentLayoutGuide.bottomAnchor),
      row.heightAnchor.constraint(equalTo: frameLayoutGuide.heightAnchor),
    ])
    let time = DateFormatter()
    time.setLocalizedDateFormatFromTemplate("jmm")
    for event in events {
      let chip = Theme.stack(spacing: 2)
      chip.isLayoutMarginsRelativeArrangement = true
      chip.directionalLayoutMargins = .init(top: 8, leading: 10, bottom: 8, trailing: 10)
      chip.backgroundColor = Theme.canvas
      chip.layer.cornerRadius = 12
      chip.layer.borderWidth = 0.5
      chip.layer.borderColor = Theme.userBubble.cgColor
      let when = Theme.label(
        event.allDay ? "All day" : time.string(from: event.start), style: .caption1,
        color: Theme.muted)
      let title = Theme.label(event.title, style: .footnote)
      title.numberOfLines = 2
      chip.addArrangedSubview(when)
      chip.addArrangedSubview(title)
      chip.widthAnchor.constraint(lessThanOrEqualToConstant: 168).isActive = true
      chip.isAccessibilityElement = true
      chip.accessibilityLabel = [when.text, event.title, event.location].compactMap { $0 }
        .filter { !$0.isEmpty }.joined(separator: ", ")
      row.addArrangedSubview(chip)
    }
    heightAnchor.constraint(equalToConstant: 64).isActive = true
  }
  required init?(coder: NSCoder) { fatalError() }
}

/// One update in a compact list: brief rows, Needs you and Skipped.
final class RadarRowView: UIStackView {
  init(_ item: RadarItem, detail: String, settled: String? = nil) {
    super.init(frame: .zero)
    axis = .vertical
    spacing = 4
    addArrangedSubview(RadarMetaRow(item))
    let title = Theme.label(item.title, style: .subheadline)
    let font = UIFont.preferredFont(forTextStyle: .subheadline)
    title.font = UIFont(
      descriptor: font.fontDescriptor.withSymbolicTraits(.traitBold) ?? font.fontDescriptor, size: 0
    )
    title.textColor = settled == nil ? Theme.ink : Theme.muted
    addArrangedSubview(title)
    let text = settled ?? detail
    if !text.isEmpty {
      let label = Theme.label(text, style: .footnote, color: Theme.muted)
      label.numberOfLines = 2
      addArrangedSubview(label)
    }
  }
  required init(coder: NSCoder) { fatalError() }
}

final class RadarRowCell: UITableViewCell {
  init(_ item: RadarItem, detail: String, settled: String? = nil) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = Theme.card
    let row = RadarRowView(item, detail: detail, settled: settled)
    contentView.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      row.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
      row.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
    ])
  }
  required init?(coder: NSCoder) { fatalError() }
}

/// A `brief` block in the chat. The narrative is the message's text above it.
final class RadarBriefView: UIView {
  init(_ brief: RadarBrief, host: UIViewController?, relayout: @escaping () -> Void) {
    super.init(frame: .zero)
    backgroundColor = Theme.card
    layer.cornerRadius = 20
    layer.borderWidth = 0.5
    layer.borderColor = Theme.border.cgColor
    let stack = Theme.stack(spacing: 12)
    addSubview(stack)
    stack.pin(to: self, inset: 16)
    if !brief.title.isEmpty {
      stack.addArrangedSubview(Theme.label(brief.title, style: .caption1, color: Theme.muted))
    }
    if !brief.agenda.isEmpty { stack.addArrangedSubview(RadarAgendaStrip(brief.agenda)) }
    let expanded = RadarStore.shared.expandedBriefs.contains(brief.id)
    for item in brief.visibleItems(expanded: expanded) {
      stack.addArrangedSubview(Self.row(item, host: host))
    }
    if brief.hiddenCount > 0 && !expanded {
      let more = Theme.button("\(brief.hiddenCount) more") {
        RadarStore.shared.expandedBriefs.insert(brief.id)
        relayout()
      }
      more.contentHorizontalAlignment = .leading
      more.configuration?.contentInsets = .init(top: 8, leading: 0, bottom: 8, trailing: 0)
      stack.addArrangedSubview(more)
    }
  }
  required init?(coder: NSCoder) { fatalError() }
  private static func row(_ item: RadarItem, host: UIViewController?) -> UIView {
    let open = RadarStore.shared.isOpen(item.id)
    let row = Theme.stack(.horizontal, spacing: 8)
    row.alignment = .center
    let content = RadarRowView(
      item, detail: item.why,
      settled: open ? nil : RadarStore.shared.outcomes[item.id]?.label ?? "")
    content.isUserInteractionEnabled = true
    content.addGestureRecognizer(
      RadarTap { [weak host] in host?.presentRadar(item, mode: .detail) })
    content.isAccessibilityElement = true
    content.accessibilityLabel = [item.title, item.why].filter { !$0.isEmpty }.joined(
      separator: ", ")
    content.accessibilityTraits = .button
    let actions = RadarCardView.iconButton("ellipsis.circle", label: "Actions")
    actions.tintColor = Theme.muted
    actions.menu = host?.radarActionsMenu(item)
    actions.showsMenuAsPrimaryAction = true
    row.addArrangedSubview(content)
    row.addArrangedSubview(actions)
    return row
  }
}

/// A tap that runs a closure.
final class RadarTap: UITapGestureRecognizer {
  private let handler: () -> Void
  init(_ handler: @escaping () -> Void) {
    self.handler = handler
    super.init(target: nil, action: nil)
    addTarget(self, action: #selector(fire))
  }
  @objc private func fire() { handler() }
}

/// For you while Radar is off: one question, three answers.
final class RadarLevelCardCell: UITableViewCell {
  init(choose: @escaping (String) -> Void) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = Theme.card
    selectionStyle = .none
    let stack = Theme.stack(spacing: 10)
    contentView.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 18),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -16),
    ])
    let heading = Theme.stack(.horizontal, spacing: 10)
    heading.alignment = .center
    let icon = UIImageView(image: UIImage(systemName: "dot.radiowaves.left.and.right"))
    icon.tintColor = Theme.ink
    icon.setContentHuggingPriority(.required, for: .horizontal)
    heading.addArrangedSubview(icon)
    heading.addArrangedSubview(Theme.label("When should I interrupt you?", style: .headline))
    stack.addArrangedSubview(heading)
    stack.setCustomSpacing(14, after: heading)
    var buttons: [UIButton] = []
    for level in Radar.levels {
      var config: UIButton.Configuration = level.id == "important" ? .filled() : .tinted()
      config.title = level.title
      config.baseForegroundColor = level.id == "important" ? Theme.card : Theme.ink
      config.baseBackgroundColor = level.id == "important" ? Theme.ink : Theme.userBubble
      config.cornerStyle = .capsule
      config.contentInsets = .init(top: 12, leading: 14, bottom: 12, trailing: 14)
      let button = UIButton(configuration: config)
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      button.addAction(
        UIAction { [weak button] _ in
          for other in buttons { other.isEnabled = false }
          button?.configuration?.showsActivityIndicator = true
          choose(level.id)
        }, for: .touchUpInside)
      buttons.append(button)
      stack.addArrangedSubview(button)
    }
  }
  required init?(coder: NSCoder) { fatalError() }
}

/// For you: the latest brief's narrative and agenda; the whole brief opens in the chat.
final class RadarBriefCardCell: UITableViewCell {
  init(narrative: String, brief: RadarBrief) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = Theme.card
    accessoryType = .disclosureIndicator
    let stack = Theme.stack(spacing: 12)
    contentView.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 14),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -14),
    ])
    if !narrative.isEmpty {
      let text = Theme.label("", style: .subheadline)
      text.attributedText = Markdown.render(narrative, style: .subheadline)
      text.numberOfLines = 5
      stack.addArrangedSubview(text)
    }
    if !brief.agenda.isEmpty { stack.addArrangedSubview(RadarAgendaStrip(brief.agenda)) }
  }
  required init?(coder: NSCoder) { fatalError() }
}

/// "Why this" (the decision in plain sentences and the evidence) and, from For you, the full
/// update with its actions.
final class RadarUpdateController: UIViewController {
  enum Mode { case why, detail }
  private var item: RadarItem
  private let mode: Mode
  private let stack = Theme.stack(spacing: 14)
  private var loading = true
  init(item: RadarItem, mode: Mode) {
    self.item = item
    self.mode = mode
    super.init(nibName: nil, bundle: nil)
    title = mode == .why ? "Why this" : nil
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
    )
    let scroll = UIScrollView()
    view.addSubview(scroll)
    scroll.pin(to: view)
    scroll.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(
        equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(
        equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 8),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28),
      stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
    ])
    NotificationCenter.default.addObserver(
      self, selector: #selector(render), name: RadarStore.outcomesChanged, object: nil)
    render()
    Task { [weak self] in
      guard let self else { return }
      if RadarStore.shared.status == nil { _ = try? await RadarStore.shared.loadStatus() }
      // Blocks and brief rows carry no decision trace; the update view does.
      if item.trace == nil, let full = await RadarStore.shared.update(item.id) {
        item = item.merged(with: full)
      }
      loading = false
      render()
    }
  }
  @objc private func render() {
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    stack.addArrangedSubview(RadarMetaRow(item, showSource: true))
    stack.addArrangedSubview(Theme.label(item.title, style: .title2))
    if !item.why.isEmpty { stack.addArrangedSubview(Theme.label(item.why, style: .body)) }
    if !item.evidence.isEmpty { stack.addArrangedSubview(RadarQuoteView(item.evidence)) }
    let lines = RadarExplanation.sentences(for: item, rules: RadarStore.shared.rules)
    if !lines.isEmpty {
      let heading = Theme.label("How I decided", style: .headline)
      stack.addArrangedSubview(heading)
      stack.setCustomSpacing(20, after: stack.arrangedSubviews[stack.arrangedSubviews.count - 2])
      let text = Theme.label(lines.joined(separator: "\n"), style: .callout, color: Theme.muted)
      text.setParagraphSpacing(6)
      stack.addArrangedSubview(text)
    } else if loading {
      let spinner = UIActivityIndicatorView(style: .medium)
      spinner.startAnimating()
      stack.addArrangedSubview(spinner)
    }
    if mode == .detail { addActions() }
  }
  private func addActions() {
    let skipped = item.disposition == "silent" && item.feedback != "important"
    let outcome = RadarStore.shared.outcomes[item.id]
    let closed =
      ["done", "dismissed", "expired"].contains(item.state)
      || outcome?.settles == true || (outcome == .important && skipped)
    let actions = Theme.stack(spacing: 8)
    if skipped && outcome != .important {
      actions.addArrangedSubview(
        Theme.button("This was important", primary: true) { [weak self] in
          self?.feedback("important")
        })
    } else if !closed {
      let primary = item.primary
      if primary.kind == .send {
        let accept = Theme.button(primary.title, primary: true) { [weak self] in
          guard let self else { return }
          self.acceptRadar(self.item)
        }
        accept.isEnabled = outcome != .sent
        actions.addArrangedSubview(accept)
      }
    }
    let links = Theme.stack(.horizontal, spacing: 8)
    links.distribution = .fillEqually
    if !skipped {
      links.addArrangedSubview(
        Theme.button("Reply in chat", symbol: "arrowshape.turn.up.left") { [weak self] in
          guard let self else { return }
          self.radarTabs?.replyRadar(self.item)
        })
    }
    if item.url != nil {
      let app = item.source.isEmpty ? "" : ConnectedApp.name(item.source)
      links.addArrangedSubview(
        Theme.button(app.isEmpty ? "Open" : "Open in \(app)", symbol: "arrow.up.forward") {
          [weak self] in
          guard let self else { return }
          self.openRadarSource(self.item)
        })
    }
    if !links.arrangedSubviews.isEmpty { actions.addArrangedSubview(links) }
    if !closed && !skipped {
      let row = Theme.stack(.horizontal, spacing: 4)
      row.alignment = .center
      let later = Theme.button("Later") {}
      later.menu = radarLaterMenu(item, inline: true)
      later.showsMenuAsPrimaryAction = true
      for button in [
        Theme.button("Done") { [weak self] in self?.feedback("done") }, later,
        Theme.button("Not important") { [weak self] in self?.feedback("not_important") },
      ] {
        row.addArrangedSubview(RadarCardView.compact(button))
      }
      row.addArrangedSubview(RadarCardView.spacer())
      let more = radarMoreActions(item, why: false)
      if !more.isEmpty {
        let button = RadarCardView.iconButton("ellipsis", label: "More")
        button.menu = UIMenu(children: more)
        button.showsMenuAsPrimaryAction = true
        row.addArrangedSubview(button)
      }
      actions.addArrangedSubview(row)
    } else if let label = outcome?.label {
      actions.addArrangedSubview(Theme.label(label, style: .footnote, color: Theme.muted))
    }
    stack.setCustomSpacing(24, after: stack.arrangedSubviews.last!)
    stack.addArrangedSubview(actions)
  }
  private func feedback(_ kind: String) {
    Task { [weak self] in
      guard let self else { return }
      do {
        try await RadarStore.shared.feedback(item.id, kind)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss(animated: true)
      } catch { showError(error) }
    }
  }
}

extension UILabel {
  /// Keeps one sentence per line readable when a sentence wraps.
  func setParagraphSpacing(_ spacing: CGFloat) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 2
    paragraph.paragraphSpacing = spacing
    attributedText = NSAttributedString(
      string: text ?? "",
      attributes: [
        .font: font as Any, .foregroundColor: textColor as Any, .paragraphStyle: paragraph,
      ])
  }
}
