import NegroniCore
import UIKit

/// UIKit controls and drawing primitives for the shared response vocabulary.
@MainActor final class ResponseUIView: UIView {
  private let session: ResponseUIState
  private let content = Theme.stack()
  private let errors = Theme.stack(spacing: 4)
  private let relayout: () -> Void
  private let onInputFocus: () -> Void
  private let followUp: (String) -> Void
  private let refresh: () async throws -> ResponseUI
  private let loadImage: (String) async -> UIImage?
  private var renderedSpec: JSON = .null
  private var updates: [() -> Void] = []
  private var local: [String: JSON] = [:]
  private var disabled: Bool
  init(
    session: ResponseUIState, live: Bool, onInputFocus: @escaping () -> Void,
    relayout: @escaping () -> Void,
    refresh: @escaping () async throws -> ResponseUI,
    loadImage: @escaping (String) async -> UIImage? = { _ in nil },
    followUp: @escaping (String) -> Void
  ) {
    self.session = session
    self.disabled = live
    self.relayout = relayout
    self.onInputFocus = onInputFocus
    self.refresh = refresh
    self.loadImage = loadImage
    self.followUp = followUp
    super.init(frame: .zero)
    let stack = Theme.stack(spacing: 8)
    addSubview(stack)
    stack.pin(to: self)
    stack.addArrangedSubview(content)
    stack.addArrangedSubview(errors)
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
      (view: ResponseUIView, _) in
      view.updateTextStyles()
      view.relayout()
    }
    session.onChange = { [weak self] in self?.update() }
    update()
  }
  required init?(coder: NSCoder) { fatalError() }
  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    updateTextStyles()
  }
  private func updateTextStyles() {
    func apply(_ view: UIView) {
      if let drawing = view as? ResponseUIDrawing { drawing.updateAccessibility(traitCollection) }
      if let label = view as? ResponseUINumericLabel {
        label.updateFont(traitCollection)
      } else if let label = view as? UILabel, label.adjustsFontForContentSizeCategory {
        let style =
          (label.font?.fontDescriptor.object(forKey: .textStyle) as? String)
          .map { UIFont.TextStyle(rawValue: $0) } ?? .body
        label.font = .preferredFont(forTextStyle: style, compatibleWith: traitCollection)
      } else if let field = view as? UITextField {
        field.font = .preferredFont(forTextStyle: .body, compatibleWith: traitCollection)
        field.invalidateIntrinsicContentSize()
      }
      for child in view.subviews { apply(child) }
    }
    apply(content)
    setNeedsLayout()
  }
  func receive(_ block: ResponseUI, live: Bool) {
    disabled = live
    session.receive(block)
    update()
  }
  private var editable: Bool { session.document.complete && !disabled }
  private func update() {
    let spec = session.document.spec
    if spec != renderedSpec {
      updates = []
      for child in content.arrangedSubviews { child.removeFromSuperview() }
      renderedSpec = spec
      content.addArrangedSubview(element(spec["root"].string))
      updateTextStyles()
    }
    for update in updates { update() }
    for child in errors.arrangedSubviews { child.removeFromSuperview() }
    errors.isHidden = session.error == nil
    if let error = session.error {
      errors.addArrangedSubview(
        Theme.label(
          error == "conflict"
            ? "Changed on another device. Your edits are unsaved." : "Couldn’t save these values.",
          style: .caption1, color: UIColor(hex: Palette.destructive)))
      let retry = Theme.button(error == "conflict" ? "Refresh values" : "Retry") { [weak self] in
        guard let self else { return }
        endEditing(true)
        Task { [self] in
          if error == "conflict" {
            do { self.session.reload(try await self.refresh()) } catch {
              // Keep the draft and the retry control visible.
            }
          } else {
            await self.session.retry()
          }
        }
      }
      retry.isEnabled = !session.saving
      responseButton(retry)
      errors.addArrangedSubview(retry)
    }
    relayout()
  }
  private func read(_ expression: JSON) -> JSON {
    ResponseUI.evaluate(expression, state: session.state)
  }
  private func change(_ path: JSON, _ value: JSON) {
    var state = session.state
    state[String(path.string.dropFirst())] = value
    _ = session.change(state)
  }
  private func value(_ path: JSON) -> JSON {
    session.state[String(path.string.dropFirst())] ?? .null
  }
  private func element(_ id: String) -> UIView {
    let node = session.document.spec["elements"][id]
    guard !node.isNull else { return UIView() }
    let p = node["props"]
    let children = node["children"].array.map(\.string)
    let type = node["type"].string
    var view: UIView
    switch type {
    case "Stack", "Grid", "Card":
      let gap: CGFloat = ["small": 12, "medium": 18, "large": 24][p["gap"].string] ?? 18
      let stack = Theme.stack(spacing: gap)
      if type == "Card" {
        stack.backgroundColor = Theme.card
        stack.layer.cornerRadius = 18
        stack.layer.borderWidth = 0.5
        stack.layer.borderColor = Theme.border.cgColor
        stack.isLayoutMarginsRelativeArrangement = true
        stack.directionalLayoutMargins = .init(top: 20, leading: 20, bottom: 20, trailing: 20)
        if !p["title"].string.isEmpty {
          stack.addArrangedSubview(Theme.label(p["title"].string, style: .headline))
        }
        if !p["description"].string.isEmpty {
          stack.addArrangedSubview(
            Theme.label(p["description"].string, style: .body, color: Theme.muted))
        }
      }
      let mediaRow = type == "Stack" && p["direction"].string == "horizontal"
        && children.count == 2
        && session.document.spec["elements"][children[0]]["type"].string == "Image"
        && ["Stack", "Text", "Card"].contains(
          session.document.spec["elements"][children[1]]["type"].string)
      if mediaRow {
        stack.addArrangedSubview(
          ResponseUIMediaRow(
            image: element(children[0]), detail: element(children[1]), relayout: relayout))
      } else if type == "Grid" || (type == "Stack" && p["direction"].string == "horizontal") {
        stack.addArrangedSubview(
          ResponseUIGrid(
            children.map { element($0) },
            columns: type == "Grid" ? (p["columns"].uiInteger ?? 2) : children.count,
            spacing: gap))
      } else {
        for child in children { stack.addArrangedSubview(element(child)) }
      }
      view = stack
    case "Text":
      let style: UIFont.TextStyle =
        ["heading": .headline, "caption": .caption1][p["style"].string] ?? .body
      let label = Theme.label(
        style: style, color: p["style"].string == "caption" ? Theme.muted : Theme.ink)
      updates.append { [weak self, weak label] in
        label?.text = self.map { ResponseUI.format($0.read(p["text"])) }
      }
      view = label
    case "Metric":
      let stack = Theme.stack(spacing: 8)
      stack.addArrangedSubview(Theme.label(p["label"].string, style: .body, color: Theme.muted))
      let output = Theme.label(style: .title1)
      output.accessibilityLabel = p["label"].string
      updates.append { [weak self, weak output] in
        guard let self else { return }
        let text = ResponseUI.format(read(p["value"]), decimals: p["decimals"].uiInteger)
        output?.text = [text, p["unit"].string].filter { !$0.isEmpty }.joined(separator: " ")
        output?.accessibilityValue = output?.text
      }
      stack.addArrangedSubview(output)
      view = stack
    case "Link":
      let button = Theme.button(p["label"].string, symbol: "arrow.up.right") {
        if let url = URL(string: p["url"].string),
          ["http", "https"].contains(url.scheme?.lowercased() ?? "")
        {
          UIApplication.shared.open(url)
        }
      }
      responseButton(button, leading: true)
      view = button
    case "Image":
      view = ResponseUIImageView(props: p, load: loadImage, relayout: relayout)
    case "Input":
      let stack = Theme.stack(spacing: 10)
      stack.addArrangedSubview(Theme.label(p["label"].string, style: .body))
      let input = ResponseUITextField()
      input.backgroundColor = Theme.secondary
      input.layer.cornerRadius = 14
      input.layer.borderWidth = 0.5
      input.layer.borderColor = Theme.border.cgColor
      input.textColor = Theme.ink
      input.font = .preferredFont(forTextStyle: .body)
      input.adjustsFontForContentSizeCategory = true
      input.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
      input.accessibilityLabel = p["label"].string
      input.placeholder = p["placeholder"].string
      input.keyboardType =
        p["input"].string == "number"
        ? ((p["min"].uiNumber ?? -1) < 0 ? .numbersAndPunctuation : .decimalPad) : .default
      input.autocorrectionType = .no
      input.addAction(UIAction { [weak self] _ in self?.onInputFocus() }, for: .editingDidBegin)
      input.addAction(
        UIAction { [weak self, weak input] _ in
          guard let self, let input, editable else { return }
          if p["input"].string == "number" {
            let decimal = Locale.current.decimalSeparator ?? "."
            if let number = Double((input.text ?? "").replacingOccurrences(of: decimal, with: ".")),
              number.isFinite
            {
              change(p["bind"], .number(number))
            }
          } else {
            change(p["bind"], .string(input.text ?? ""))
          }
        }, for: .editingChanged)
      input.addAction(
        UIAction { [weak self, weak input] _ in
          guard let self else { return }
          input?.text = fieldText(value(p["bind"]))
          Task { [self] in await self.session.flush() }
        }, for: .editingDidEnd)
      updates.append { [weak self, weak input] in
        guard let self, let input else { return }
        input.isEnabled = editable
        if !input.isFirstResponder { input.text = fieldText(value(p["bind"])) }
      }
      stack.addArrangedSubview(input)
      view = stack
    case "Slider":
      let stack = Theme.stack(spacing: 8)
      let label = Theme.label(p["label"].string, style: .body)
      let output = ResponseUINumericLabel()
      output.textAlignment = .right
      output.setContentHuggingPriority(.required, for: .horizontal)
      output.setContentCompressionResistancePriority(.required, for: .horizontal)
      label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      let header = ResponseUIControlHeader(label: label, value: output)
      let slider = ResponseUISlider()
      slider.minimumValue = 0
      slider.maximumValue = 1
      slider.tintColor = Theme.ink
      slider.minimumTrackTintColor = Theme.ink
      slider.maximumTrackTintColor = Theme.border
      slider.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
      slider.accessibilityLabel = p["label"].string
      let min = p["min"].uiNumber ?? 0
      let max = p["max"].uiNumber ?? 1
      let step = p["step"].uiNumber ?? 1
      slider.addAction(
        UIAction { [weak self, weak slider] _ in
          guard let self, let slider, editable else { return }
          let number = min * (1 - Double(slider.value)) + max * Double(slider.value)
          let snapped = min + ((number - min) / step).rounded() * step
          change(
            p["bind"], .number(Swift.min(max, Swift.max(min, snapped.isFinite ? snapped : number))))
        }, for: .valueChanged)
      slider.addAction(
        UIAction { [weak self] _ in Task { await self?.session.flush() } },
        for: [.touchUpInside, .touchUpOutside, .touchCancel])
      updates.append { [weak self, weak slider, weak output] in
        guard let self else { return }
        let current = value(p["bind"])
        let number = current.uiNumber ?? min
        let scale = Swift.max(abs(min), abs(max), 1)
        let lo = min / scale
        let hi = max / scale
        slider?.value = hi == lo ? 0 : Float((number / scale - lo) / (hi - lo))
        slider?.isEnabled = editable && hi != lo
        slider?.accessibilityValue = ResponseUI.format(current)
        output?.text = ResponseUI.format(current)
      }
      stack.addArrangedSubview(header)
      stack.addArrangedSubview(slider)
      view = stack
    case "Select":
      let stack = Theme.stack(spacing: 10)
      stack.addArrangedSubview(Theme.label(p["label"].string, style: .body))
      let button = UIButton(type: .system)
      button.configuration = .tinted()
      button.configuration?.image = UIImage(systemName: "chevron.down")
      responseButton(button, leading: true)
      button.showsMenuAsPrimaryAction = true
      button.accessibilityLabel = p["label"].string
      updates.append { [weak self, weak button] in
        guard let self else { return }
        let current = value(p["bind"])
        let options = p["options"].array
        button?.configuration?.title = options.first { $0["value"] == current }?["label"].string
        button?.isEnabled = editable
        button?.menu = UIMenu(
          children: options.map { option in
            UIAction(title: option["label"].string, state: option["value"] == current ? .on : .off)
            { [weak self] _ in self?.change(p["bind"], option["value"]) }
          })
      }
      stack.addArrangedSubview(button)
      view = stack
    case "Checklist":
      let stack = Theme.stack(spacing: 12)
      for item in p["items"].array {
        let row = Theme.stack(.horizontal, spacing: 16)
        row.alignment = .center
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
        let label = Theme.label(item["label"].string)
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let toggle = ResponseUISwitch()
        toggle.onTintColor = Theme.ink
        toggle.accessibilityLabel = item["label"].string
        toggle.addAction(
          UIAction { [weak self, weak toggle] _ in
            self?.change(item["bind"], .bool(toggle?.isOn ?? false))
          }, for: .valueChanged)
        updates.append { [weak self, weak toggle] in
          guard let self else { return }
          toggle?.isOn = value(item["bind"]).bool
          toggle?.isEnabled = editable
        }
        row.addArrangedSubview(label)
        row.addArrangedSubview(toggle)
        stack.addArrangedSubview(row)
      }
      view = stack
    case "Button":
      let action = p["action"]
      let button = Theme.button(p["label"].string) { [weak self] in
        guard let self, editable else { return }
        switch action["type"].string {
        case "reset":
          endEditing(true)
          _ = session.change(session.document.spec["state"].dictionary)
        case "set":
          endEditing(true)
          change(action["path"], action["value"])
        case "follow_up":
          endEditing(true)
          Task { [self] in
            await self.session.flush()
            if self.session.error == nil && !self.session.dirty {
              self.followUp(action["prompt"].string)
            }
          }
        default: break
        }
      }
      responseButton(button)
      updates.append { [weak self, weak button] in button?.isEnabled = self?.editable ?? false }
      view = button
    case "Disclosure":
      let stack = Theme.stack(spacing: 12)
      let body = Theme.stack(spacing: 16)
      for child in children { body.addArrangedSubview(element(child)) }
      let button = Theme.button(p["title"].string, symbol: "chevron.down") { [weak self] in
        guard let self else { return }
        if p["bind"].isNull {
          local[id] = .bool(!(local[id]?.bool ?? false))
          update()
        } else {
          change(p["bind"], .bool(!value(p["bind"]).bool))
        }
      }
      responseButton(button, leading: true)
      updates.append { [weak self, weak body, weak button] in
        guard let self else { return }
        let expanded = p["bind"].isNull ? (local[id]?.bool ?? false) : value(p["bind"]).bool
        body?.isHidden = !expanded
        button?.accessibilityValue = expanded ? "Expanded" : "Collapsed"
        button?.configuration?.image = UIImage(systemName: expanded ? "chevron.up" : "chevron.down")
        button?.isEnabled = p["bind"].isNull || editable
      }
      stack.addArrangedSubview(button)
      stack.addArrangedSubview(body)
      view = stack
    case "Tabs":
      let stack = Theme.stack(spacing: 16)
      let panels = children.map { child -> UIStackView in
        let panel = Theme.stack()
        panel.addArrangedSubview(element(child))
        return panel
      }
      let picker = ResponseUITabs(labels: p["labels"].array.map(\.string)) { [weak self] selected in
        guard let self else { return }
        let index = JSON.number(Double(selected))
        if p["bind"].isNull {
          local[id] = index
          update()
        } else {
          change(p["bind"], index)
        }
      }
      updates.append { [weak self, weak picker] in
        guard let self else { return }
        let index =
          p["bind"].isNull ? (local[id]?.uiInteger ?? 0) : (value(p["bind"]).uiInteger ?? 0)
        picker?.selectedIndex = index
        picker?.controlsEnabled = p["bind"].isNull || editable
        for (offset, panel) in panels.enumerated() { panel.isHidden = offset != index }
      }
      stack.addArrangedSubview(picker)
      for panel in panels { stack.addArrangedSubview(panel) }
      view = stack
    case "Progress":
      let stack = Theme.stack(spacing: 10)
      let label = Theme.label(style: .body)
      let bar = UIProgressView()
      bar.progressTintColor = Theme.ink
      updates.append { [weak self, weak label, weak bar] in
        guard let self else { return }
        let current = read(p["value"])
        let max = p["max"].uiNumber ?? 100
        let fraction = Swift.min(1, Swift.max(0, (current.uiNumber ?? 0) / max))
        bar?.progress = Float(fraction)
        label?.text =
          "\(p["label"].string): \(ResponseUI.format(current)) / \(ResponseUI.format(.number(max)))"
        bar?.accessibilityLabel = p["label"].string
        bar?.accessibilityValue = ResponseUI.format(.number(fraction * 100)) + "%"
      }
      stack.addArrangedSubview(label)
      stack.addArrangedSubview(bar)
      view = stack
    case "Timeline":
      let stack = Theme.stack(spacing: 12)
      for item in p["items"].array {
        let status =
          ["pending": "Pending", "active": "Active", "done": "Done"][item["status"].string]
          ?? "Pending"
        let row = Theme.stack(.horizontal, spacing: 8)
        let text = Theme.stack(spacing: 4)
        let symbol = UIImageView(
          image: UIImage(
            systemName: item["status"].string == "done" ? "checkmark.circle" : "circle"))
        symbol.tintColor = Theme.ink
        symbol.widthAnchor.constraint(equalToConstant: 20).isActive = true
        symbol.isAccessibilityElement = true
        symbol.accessibilityLabel = status
        text.addArrangedSubview(Theme.label(item["label"].string, style: .body))
        if !item["detail"].string.isEmpty {
          text.addArrangedSubview(
            Theme.label(item["detail"].string, style: .body, color: Theme.muted))
        }
        row.alignment = .top
        row.addArrangedSubview(symbol)
        row.addArrangedSubview(text)
        stack.addArrangedSubview(row)
      }
      view = stack
    case "Table":
      let rows = Theme.stack(spacing: 8)
      if !p["caption"].string.isEmpty {
        rows.addArrangedSubview(
          Theme.label(p["caption"].string, style: .caption1, color: Theme.muted))
      }
      for (rowIndex, row) in p["rows"].array.enumerated() {
        if p["columns"].array.count == 2 && row.array.count == 2 {
          if rowIndex > 0 {
            let separator = UIView()
            separator.backgroundColor = Theme.border
            separator.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
            rows.addArrangedSubview(separator)
          }
          let entry = ResponseUITableRow(columns: p["columns"].array.map(\.string), relayout: relayout)
          updates.append { [weak self, weak entry] in
            guard let self else { return }
            entry?.update(
              label: ResponseUI.format(read(row.array[0])),
              value: ResponseUI.format(read(row.array[1])))
          }
          rows.addArrangedSubview(entry)
          continue
        }
        let entry = Theme.stack(spacing: 4)
        for (index, cell) in row.array.enumerated() {
          let label = Theme.label(style: .body)
          updates.append { [weak self, weak label] in
            guard let self else { return }
            label?.text = "\(p["columns"].array[index].string): \(ResponseUI.format(read(cell)))"
          }
          entry.addArrangedSubview(label)
        }
        rows.addArrangedSubview(entry)
      }
      view = rows
    case "Chart":
      let stack = Theme.stack(spacing: 8)
      let chart = ResponseUIChart()
      stack.addArrangedSubview(Theme.label(p["title"].string, style: .headline))
      chart.heightAnchor.constraint(equalToConstant: 220).isActive = true
      let drawing = ResponseUIDrawing(chart)
      stack.addArrangedSubview(drawing)
      for (index, series) in p["series"].array.enumerated() {
        stack.addArrangedSubview(
          Theme.label(
            "\(index == 0 ? "━" : "┄") \(series["label"].string)", style: .caption1,
            color: Theme.muted))
      }
      let data = Theme.stack(spacing: 4)
      for series in p["series"].array {
        data.addArrangedSubview(Theme.label(series["label"].string, style: .subheadline))
        for point in series["points"].array {
          let label = Theme.label(style: .caption1)
          updates.append { [weak self, weak label] in
            guard let self else { return }
            label?.text = "\(ResponseUI.format(point["x"])): \(ResponseUI.format(read(point["y"])))"
          }
          data.addArrangedSubview(label)
        }
      }
      addDisclosure("View data", body: data, to: stack, drawing: drawing)
      updates.append { [weak self, weak chart] in
        guard let self else { return }
        chart?.props = p
        chart?.state = session.state
        chart?.setNeedsDisplay()
      }
      view = stack
    case "Diagram":
      let stack = Theme.stack(spacing: 8)
      if !p["title"].string.isEmpty {
        stack.addArrangedSubview(Theme.label(p["title"].string, style: .headline))
      }
      let diagram = ResponseUIDiagram(p)
      diagram.heightAnchor.constraint(equalToConstant: CGFloat(p["nodes"].array.count * 84 + 12))
        .isActive = true
      let drawing = ResponseUIDrawing(diagram)
      stack.addArrangedSubview(drawing)
      let data = Theme.stack(spacing: 6)
      for node in p["nodes"].array {
        data.addArrangedSubview(
          Theme.label(
            [node["label"].string, node["detail"].string].filter { !$0.isEmpty }.joined(
              separator: ": "), style: .subheadline))
      }
      let names = Dictionary(
        uniqueKeysWithValues: p["nodes"].array.map { ($0["id"].string, $0["label"].string) })
      for edge in p["edges"].array {
        data.addArrangedSubview(
          Theme.label(
            "\(names[edge["from"].string] ?? "") → \(names[edge["to"].string] ?? "")\(edge["label"].string.isEmpty ? "" : ": " + edge["label"].string)",
            style: .caption1))
      }
      addDisclosure("View data", body: data, to: stack, drawing: drawing)
      view = stack
    default: view = Theme.label(session.document.summary)
    }
    let wrapper = Theme.stack(spacing: 0)
    wrapper.addArrangedSubview(view)
    if let visible = node.dictionary["visible"] {
      updates.append { [weak self, weak wrapper] in
        wrapper?.isHidden = !(self?.read(visible).uiTruthy ?? false)
      }
    }
    return wrapper
  }
  private func fieldText(_ value: JSON) -> String {
    if case .number(let number) = value {
      return String(number).replacingOccurrences(
        of: ".", with: Locale.current.decimalSeparator ?? ".")
    }
    return value.string
  }
  private func addDisclosure(
    _ title: String, body: UIView, to stack: UIStackView,
    drawing: ResponseUIDrawing? = nil
  ) {
    body.isHidden = true
    let button = Theme.button(title, symbol: "chevron.down") { [weak self, weak body] in
      body?.isHidden.toggle()
      self?.relayout()
    }
    responseButton(button, leading: true)
    let minimumHeights = button.constraints.filter {
      $0.firstAttribute == .height && $0.secondItem == nil && $0.relation == .greaterThanOrEqual
    }
    drawing?.showAccessibleData = { [weak body, weak button] accessible in
      if accessible { NSLayoutConstraint.deactivate(minimumHeights) }
      body?.isHidden = !accessible
      button?.isHidden = accessible
      if !accessible { NSLayoutConstraint.activate(minimumHeights) }
    }
    stack.addArrangedSubview(button)
    stack.addArrangedSubview(body)
  }
}

private final class ResponseUINumericLabel: UILabel {
  override init(frame: CGRect) {
    super.init(frame: frame)
    adjustsFontForContentSizeCategory = true
    numberOfLines = 0
    textColor = Theme.ink
    updateFont(traitCollection)
  }
  required init?(coder: NSCoder) { fatalError() }
  func updateFont(_ traits: UITraitCollection) {
    font = UIFontMetrics(forTextStyle: .body).scaledFont(
      for: .monospacedDigitSystemFont(ofSize: 17, weight: .semibold), compatibleWith: traits)
  }
}

/// Text data remains available at accessibility sizes without fixed drawing labels clipping.
private final class ResponseUIDrawing: UIView {
  private let drawing: UIView
  private var bottom: NSLayoutConstraint!
  private var accessible: Bool?
  var showAccessibleData: ((Bool) -> Void)? {
    didSet { if let accessible { showAccessibleData?(accessible) } }
  }
  init(_ drawing: UIView) {
    self.drawing = drawing
    super.init(frame: .zero)
    addSubview(drawing)
    accessibilityIdentifier = "response-ui-drawing"
    drawing.translatesAutoresizingMaskIntoConstraints = false
    bottom = drawing.bottomAnchor.constraint(equalTo: bottomAnchor)
    NSLayoutConstraint.activate([
      drawing.leadingAnchor.constraint(equalTo: leadingAnchor),
      drawing.trailingAnchor.constraint(equalTo: trailingAnchor),
      drawing.topAnchor.constraint(equalTo: topAnchor),
    ])
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
      (view: ResponseUIDrawing, _) in view.updateAccessibility()
    }
    updateAccessibility()
  }
  required init?(coder: NSCoder) { fatalError() }
  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    updateAccessibility()
  }
  func updateAccessibility(_ traits: UITraitCollection? = nil) {
    let next = (traits ?? traitCollection).preferredContentSizeCategory.isAccessibilityCategory
    guard next != accessible else { return }
    accessible = next
    bottom.isActive = !next
    isHidden = next
    showAccessibleData?(next)
  }
}

private func responseButton(_ button: UIButton, leading: Bool = false) {
  var configuration = button.configuration ?? .tinted()
  configuration.baseForegroundColor = Theme.ink
  configuration.baseBackgroundColor = Theme.secondary
  configuration.background.backgroundColor = Theme.secondary
  configuration.cornerStyle = .large
  configuration.contentInsets = .init(top: 14, leading: 16, bottom: 14, trailing: 16)
  configuration.imagePadding = 12
  configuration.imagePlacement = .trailing
  configuration.titleAlignment = leading ? .leading : .center
  configuration.titleLineBreakMode = .byWordWrapping
  configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
    [weak button] attributes in
    var attributes = attributes
    attributes.font = UIFont.preferredFont(
      forTextStyle: .body, compatibleWith: button?.traitCollection)
    return attributes
  }
  button.configuration = configuration
  button.contentHorizontalAlignment = leading ? .leading : .center
  button.titleLabel?.numberOfLines = 0
  button.titleLabel?.adjustsFontForContentSizeCategory = true
  button.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
}

private final class ResponseUITextField: UITextField {
  override func textRect(forBounds bounds: CGRect) -> CGRect { bounds.insetBy(dx: 14, dy: 12) }
  override func editingRect(forBounds bounds: CGRect) -> CGRect { textRect(forBounds: bounds) }
  override func placeholderRect(forBounds bounds: CGRect) -> CGRect { textRect(forBounds: bounds) }
  override var intrinsicContentSize: CGSize {
    CGSize(width: super.intrinsicContentSize.width, height: max(52, (font?.lineHeight ?? 20) + 24))
  }
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.preferredContentSizeCategory
      != previousTraitCollection?.preferredContentSizeCategory
    {
      font = .preferredFont(forTextStyle: .body, compatibleWith: traitCollection)
      invalidateIntrinsicContentSize()
    }
  }
}

private final class ResponseUISlider: UISlider {
  override init(frame: CGRect) {
    super.init(frame: frame)
    updateThumb()
  }
  required init?(coder: NSCoder) { fatalError() }
  override func trackRect(forBounds bounds: CGRect) -> CGRect {
    var rect = super.trackRect(forBounds: bounds)
    rect.origin.y = bounds.midY - 3
    rect.size.height = 6
    return rect
  }
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
      updateThumb()
    }
  }
  private func updateThumb() {
    let thumb = UIGraphicsImageRenderer(size: CGSize(width: 36, height: 36)).image { context in
      let circle = UIBezierPath(ovalIn: CGRect(x: 2, y: 2, width: 32, height: 32))
      context.cgContext.setShadow(
        offset: CGSize(width: 0, height: 1), blur: 2,
        color: Theme.ink.withAlphaComponent(0.15).cgColor)
      Theme.card.setFill()
      circle.fill()
      context.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
      Theme.border.setStroke()
      circle.lineWidth = 1
      circle.stroke()
    }.withRenderingMode(.alwaysOriginal)
    setThumbImage(thumb, for: .normal)
    setThumbImage(thumb, for: .highlighted)
  }
}

private final class ResponseUISwitch: UISwitch {
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    bounds.insetBy(
      dx: min(0, (bounds.width - 44) / 2),
      dy: min(0, (bounds.height - 44) / 2)
    ).contains(point)
  }
}

/// The value stays readable when text size or a long label needs a separate line.
private final class ResponseUIControlHeader: UIStackView {
  private let label: UILabel
  private let value: UILabel
  init(label: UILabel, value: UILabel) {
    self.label = label
    self.value = value
    super.init(frame: .zero)
    spacing = 8
    axis = .vertical
    addArrangedSubview(label)
    addArrangedSubview(value)
  }
  required init(coder: NSCoder) { fatalError() }
  override func layoutSubviews() {
    let stacked =
      traitCollection.preferredContentSizeCategory.isAccessibilityCategory
      || label.intrinsicContentSize.width + value.intrinsicContentSize.width + 16 > bounds.width
    axis = stacked ? .vertical : .horizontal
    alignment = stacked ? .fill : .firstBaseline
    spacing = stacked ? 8 : 16
    super.layoutSubviews()
  }
}

/// Native menus keep every section reachable instead of squeezing many tiny segments.
private final class ResponseUITabs: UIView {
  private let labels: [String]
  private let choose: (Int) -> Void
  private let segments: UISegmentedControl
  private let button = UIButton(type: .system)
  var selectedIndex = 0 { didSet { updateSelection() } }
  var controlsEnabled = true {
    didSet {
      segments.isEnabled = controlsEnabled
      button.isEnabled = controlsEnabled
    }
  }
  init(labels: [String], choose: @escaping (Int) -> Void) {
    self.labels = labels
    self.choose = choose
    self.segments = UISegmentedControl(items: labels)
    super.init(frame: .zero)
    button.configuration = .tinted()
    button.configuration?.image = UIImage(systemName: "chevron.down")
    responseButton(button, leading: true)
    button.showsMenuAsPrimaryAction = true
    addSubview(segments)
    addSubview(button)
    segments.pin(to: self)
    button.pin(to: self)
    heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
    segments.addAction(
      UIAction { [weak self] _ in
        guard let self else { return }
        choose(segments.selectedSegmentIndex)
      }, for: .valueChanged)
    updateSelection()
  }
  required init?(coder: NSCoder) { fatalError() }
  override func layoutSubviews() {
    let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traitCollection)
    segments.setTitleTextAttributes([.font: font], for: .normal)
    let segmentWidth = bounds.width / CGFloat(max(1, labels.count))
    let useMenu =
      labels.count > 4
      || traitCollection.preferredContentSizeCategory.isAccessibilityCategory
      || labels.contains {
        ($0 as NSString).size(withAttributes: [.font: font]).width + 32 > segmentWidth
      }
    segments.isHidden = useMenu
    button.isHidden = !useMenu
    super.layoutSubviews()
  }
  private func updateSelection() {
    guard labels.indices.contains(selectedIndex) else { return }
    segments.selectedSegmentIndex = selectedIndex
    button.configuration?.title = labels[selectedIndex]
    button.accessibilityLabel = labels[selectedIndex]
    button.menu = UIMenu(
      children: labels.enumerated().map { index, label in
        UIAction(title: label, state: index == selectedIndex ? .on : .off) { [weak self] _ in
          self?.choose(index)
        }
      })
  }
}

/// Images are supplied by the chat's authenticated artifact loader, never generated URLs.
private final class ResponseUIImageView: UIStackView {
  private let picture = UIImageView()
  private let fallback: UILabel
  private var imageHeight: NSLayoutConstraint?
  private var task: Task<Void, Never>?
  init(props: JSON, load: @escaping (String) async -> UIImage?, relayout: @escaping () -> Void) {
    self.fallback = Theme.label(props["alt"].string)
    super.init(frame: .zero)
    axis = .vertical
    spacing = 12
    picture.contentMode = .scaleAspectFit
    picture.backgroundColor = Theme.secondary
    picture.layer.cornerRadius = 14
    picture.clipsToBounds = true
    picture.isAccessibilityElement = true
    picture.accessibilityLabel = props["alt"].string
    picture.isHidden = true
    picture.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    picture.setContentHuggingPriority(.defaultLow, for: .vertical)
    picture.heightAnchor.constraint(lessThanOrEqualToConstant: 420).isActive = true
    addArrangedSubview(picture)
    addArrangedSubview(fallback)
    if !props["caption"].string.isEmpty {
      addArrangedSubview(Theme.label(props["caption"].string, color: Theme.muted))
    }
    let artifactID = props["artifactId"].string
    task = Task { [weak self] in
      let image = await load(artifactID)
      guard !Task.isCancelled, let self, let image else { return }
      picture.image = image
      let ratio =
        props["aspectRatio"].uiNumber ?? Double(image.size.width / max(1, image.size.height))
      let height = picture.heightAnchor.constraint(
        equalTo: picture.widthAnchor,
        multiplier: CGFloat(1 / max(0.1, min(10, ratio))))
      height.priority = .defaultHigh
      height.isActive = true
      imageHeight = height
      picture.isHidden = false
      fallback.isHidden = true
      relayout()
    }
  }
  required init(coder: NSCoder) { fatalError() }
  deinit { task?.cancel() }
}

/// A poster and its description remain a compact row while phone text is comfortably readable.
private final class ResponseUIMediaRow: UIStackView {
  private let image: UIView
  private let detail: UIView
  private let relayout: () -> Void
  private var imageWidth: NSLayoutConstraint!
  init(image: UIView, detail: UIView, relayout: @escaping () -> Void) {
    self.image = image
    self.detail = detail
    self.relayout = relayout
    super.init(frame: .zero)
    accessibilityIdentifier = "response-ui-media-row"
    axis = .horizontal
    alignment = .top
    spacing = 12
    addArrangedSubview(image)
    addArrangedSubview(detail)
    imageWidth = image.widthAnchor.constraint(equalToConstant: 108)
    imageWidth.isActive = true
    detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
      (view: ResponseUIMediaRow, _) in view.setNeedsLayout()
    }
  }
  required init(coder: NSCoder) { fatalError() }
  override func layoutSubviews() {
    if bounds.width > 0 {
      let compact = bounds.width >= 240
        && !traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        && !image.isHidden && !detail.isHidden
      let nextAxis: NSLayoutConstraint.Axis = compact ? .horizontal : .vertical
      let nextWidth = min(128, bounds.width * 0.34)
      let changed = axis != nextAxis || (compact && abs(imageWidth.constant - nextWidth) > 0.5)
      if !compact { imageWidth.isActive = false }
      if axis != nextAxis {
        axis = nextAxis
        alignment = compact ? .top : .fill
      }
      imageWidth.isActive = compact
      imageWidth.constant = nextWidth
      if changed { DispatchQueue.main.async { [weak self] in self?.relayout() } }
    }
    super.layoutSubviews()
  }
}

/// Two-column breakdowns keep the values aligned without forcing the labels onto one line.
private final class ResponseUITableRow: UIStackView {
  private let label = Theme.label()
  private let value = ResponseUINumericLabel()
  private let columns: [String]
  private let relayout: () -> Void
  private var valueWidth: NSLayoutConstraint!
  init(columns: [String], relayout: @escaping () -> Void) {
    self.columns = columns
    self.relayout = relayout
    super.init(frame: .zero)
    accessibilityIdentifier = "response-ui-table-row"
    isAccessibilityElement = true
    axis = .horizontal
    alignment = .top
    spacing = 12
    label.isAccessibilityElement = false
    value.isAccessibilityElement = false
    value.textAlignment = .right
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    addArrangedSubview(label)
    addArrangedSubview(value)
    valueWidth = value.widthAnchor.constraint(equalToConstant: 114)
    valueWidth.isActive = true
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
      (view: ResponseUITableRow, _) in view.setNeedsLayout()
    }
  }
  required init(coder: NSCoder) { fatalError() }
  func update(label: String, value: String) {
    self.label.text = label
    self.value.text = value
    accessibilityLabel = "\(columns[0]): \(label). \(columns[1]): \(value)"
  }
  override func layoutSubviews() {
    if bounds.width > 0 {
      let compact = bounds.width >= 240
        && !traitCollection.preferredContentSizeCategory.isAccessibilityCategory
      let nextAxis: NSLayoutConstraint.Axis = compact ? .horizontal : .vertical
      let nextWidth = bounds.width * 0.36
      let changed = axis != nextAxis || (compact && abs(valueWidth.constant - nextWidth) > 0.5)
      if !compact { valueWidth.isActive = false }
      if axis != nextAxis {
        axis = nextAxis
        alignment = compact ? .top : .fill
      }
      value.textAlignment = compact ? .right : .natural
      valueWidth.isActive = compact
      valueWidth.constant = nextWidth
      if changed { DispatchQueue.main.async { [weak self] in self?.relayout() } }
    }
    super.layoutSubviews()
  }
}

/// One column on a phone, more columns when the available width permits it.
private final class ResponseUIGrid: UIStackView {
  private let items: [UIView]
  private let columns: Int
  private let gap: CGFloat
  private var count = 0
  init(_ items: [UIView], columns: Int, spacing: CGFloat) {
    self.items = items
    self.columns = max(1, columns)
    self.gap = spacing
    super.init(frame: .zero)
    axis = .vertical
    self.spacing = spacing
    rebuild(1)
  }
  required init(coder: NSCoder) { fatalError() }
  override func layoutSubviews() {
    let desired =
      traitCollection.userInterfaceIdiom == .phone
        || traitCollection.preferredContentSizeCategory.isAccessibilityCategory
      ? 1 : min(columns, max(1, Int(bounds.width / 280)))
    if desired != count { rebuild(desired) }
    super.layoutSubviews()
  }
  private func rebuild(_ next: Int) {
    for item in items { item.removeFromSuperview() }
    for child in arrangedSubviews { child.removeFromSuperview() }
    count = next
    for start in stride(from: 0, to: items.count, by: next) {
      let row = Theme.stack(.horizontal, spacing: gap)
      row.alignment = .top
      row.distribution = .fillEqually
      for index in start..<min(start + next, items.count) { row.addArrangedSubview(items[index]) }
      for _ in row.arrangedSubviews.count..<next { row.addArrangedSubview(UIView()) }
      addArrangedSubview(row)
    }
  }
}

private final class ResponseUIChart: UIView {
  var props: JSON = .null, state: [String: JSON] = [:]
  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
  }
  required init?(coder: NSCoder) { fatalError() }
  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let series = props["series"].array
    let points = series.flatMap { $0["points"].array }
    let values = points.compactMap { ResponseUI.evaluate($0["y"], state: state).uiNumber }
    guard !values.isEmpty else { return }
    let scale = max(1, values.map(abs).max() ?? 1)
    let lo = min(0, (values.min() ?? 0) / scale)
    let hi = max(0, (values.max() ?? 1) / scale)
    let range = hi == lo ? 1 : hi - lo
    let plot = CGRect(x: 44, y: 12, width: max(1, bounds.width - 58), height: 162)
    func y(_ value: Double) -> CGFloat {
      plot.maxY - CGFloat((value / scale - lo) / range) * plot.height
    }
    var keys: [JSON] = []
    for point in points where !keys.contains(point["x"]) { keys.append(point["x"]) }
    let numeric = keys.allSatisfy { $0.uiNumber != nil }
    let xScale = max(1, keys.compactMap(\.uiNumber).map(abs).max() ?? 1)
    let xLo = (keys.compactMap(\.uiNumber).min() ?? 0) / xScale
    let xHi = (keys.compactMap(\.uiNumber).max() ?? 1) / xScale
    func x(_ point: JSON) -> CGFloat {
      if numeric, let number = point.uiNumber, xHi > xLo {
        return plot.minX + CGFloat((number / xScale - xLo) / (xHi - xLo)) * plot.width
      }
      return plot.minX + CGFloat((keys.firstIndex(of: point) ?? 0) + 1) / CGFloat(keys.count + 1)
        * plot.width
    }
    ctx.setStrokeColor(Theme.border.cgColor)
    ctx.setLineWidth(0.5)
    ctx.move(to: CGPoint(x: plot.minX, y: plot.minY))
    ctx.addLine(to: CGPoint(x: plot.minX, y: plot.maxY))
    ctx.addLine(to: CGPoint(x: plot.maxX, y: plot.maxY))
    ctx.strokePath()
    let text: [NSAttributedString.Key: Any] = [
      .font: UIFont.preferredFont(forTextStyle: .caption2), .foregroundColor: Theme.muted,
    ]
    (ResponseUI.format(.number(hi * scale)) as NSString).draw(
      in: CGRect(x: 0, y: 8, width: 42, height: 28), withAttributes: text)
    (ResponseUI.format(.number(lo * scale)) as NSString).draw(
      in: CGRect(x: 0, y: plot.maxY - 16, width: 42, height: 28), withAttributes: text)
    ctx.saveGState()
    ctx.clip(to: plot.insetBy(dx: -3, dy: -3))
    for (index, line) in series.enumerated() {
      let alpha = CGFloat(1 - Double(index) * 0.12)
      ctx.setStrokeColor(Theme.ink.withAlphaComponent(alpha).cgColor)
      ctx.setFillColor(Theme.ink.withAlphaComponent(alpha).cgColor)
      ctx.setLineWidth(2)
      ctx.setLineDash(phase: 0, lengths: index == 0 ? [] : [CGFloat(3 + index), 3])
      var previous = false
      for point in line["points"].array {
        guard let number = ResponseUI.evaluate(point["y"], state: state).uiNumber else {
          previous = false
          continue
        }
        let px = x(point["x"])
        let py = y(number)
        if props["style"].string == "bar" {
          let width = min(28, plot.width / CGFloat(max(1, keys.count) * (series.count + 1)))
          let left = px - width * CGFloat(series.count) / 2 + CGFloat(index) * width
          ctx.fill(
            CGRect(
              x: left, y: min(py, y(0)), width: max(1, width - 2), height: max(1, abs(y(0) - py))))
        } else if props["style"].string == "scatter" {
          ctx.fillEllipse(in: CGRect(x: px - 3, y: py - 3, width: 6, height: 6))
        } else {
          if previous {
            ctx.addLine(to: CGPoint(x: px, y: py))
          } else {
            ctx.move(to: CGPoint(x: px, y: py))
          }
          previous = true
        }
      }
      ctx.strokePath()
    }
    ctx.restoreGState()
    let first = keys.first.map { ResponseUI.format($0) } ?? ""
    let last = keys.last.map { ResponseUI.format($0) } ?? ""
    (first as NSString).draw(
      in: CGRect(x: plot.minX, y: plot.maxY + 4, width: 90, height: 24), withAttributes: text)
    if keys.count > 1 {
      (last as NSString).draw(
        in: CGRect(x: max(plot.minX, plot.maxX - 70), y: plot.maxY + 4, width: 70, height: 24),
        withAttributes: text)
    }
    ([props["xLabel"].string, props["yLabel"].string].filter { !$0.isEmpty }.joined(
      separator: " · ") as NSString).draw(
        in: CGRect(x: plot.minX, y: 198, width: plot.width, height: 22), withAttributes: text)
    isAccessibilityElement = true
    accessibilityLabel = props["title"].string
    accessibilityValue = series.map { $0["label"].string }.joined(separator: ", ")
  }
}

private final class ResponseUIDiagram: UIView {
  private let props: JSON
  init(_ props: JSON) {
    self.props = props
    super.init(frame: .zero)
    isOpaque = false
  }
  required init?(coder: NSCoder) { fatalError() }
  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let nodes = props["nodes"].array
    let edges = props["edges"].array
    let indexes = Dictionary(
      uniqueKeysWithValues: nodes.enumerated().map { ($0.element["id"].string, $0.offset) })
    ctx.setStrokeColor(Theme.ink.cgColor)
    ctx.setLineWidth(1)
    for (edgeIndex, edge) in edges.enumerated() {
      guard let from = indexes[edge["from"].string], let to = indexes[edge["to"].string] else {
        continue
      }
      let x = CGFloat(4 + (edgeIndex % 5) * 5)
      let start = CGFloat(from * 84 + 38)
      let end = CGFloat(to * 84 + 38)
      ctx.move(to: CGPoint(x: 36, y: start))
      ctx.addLine(to: CGPoint(x: x, y: start))
      ctx.addLine(to: CGPoint(x: x, y: end))
      ctx.addLine(to: CGPoint(x: 36, y: end))
      ctx.strokePath()
      ctx.move(to: CGPoint(x: 30, y: end - 4))
      ctx.addLine(to: CGPoint(x: 36, y: end))
      ctx.addLine(to: CGPoint(x: 30, y: end + 4))
      ctx.strokePath()
    }
    for (index, node) in nodes.enumerated() {
      let box = CGRect(
        x: 36, y: CGFloat(index * 84 + 10), width: max(1, bounds.width - 44), height: 58)
      let shape = UIBezierPath(roundedRect: box, cornerRadius: 12)
      Theme.card.setFill()
      shape.fill()
      Theme.border.setStroke()
      shape.stroke()
      let text: [NSAttributedString.Key: Any] = [
        .font: UIFont.preferredFont(forTextStyle: .subheadline), .foregroundColor: Theme.ink,
      ]
      (node["label"].string as NSString).draw(in: box.insetBy(dx: 10, dy: 10), withAttributes: text)
    }
    isAccessibilityElement = true
    accessibilityLabel = props["title"].string.isEmpty ? "Diagram" : props["title"].string
    accessibilityValue = nodes.map { $0["label"].string }.joined(separator: ", ")
  }
}
