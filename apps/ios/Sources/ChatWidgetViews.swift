import NegroniCore
import UIKit

final class WeatherCardView: UIView {
  init(_ weather: JSON) {
    super.init(frame: .zero)
    backgroundColor = Theme.card
    layer.cornerRadius = 24
    layer.borderWidth = 0.5
    layer.borderColor = Theme.border.cgColor
    let stack = Theme.stack(spacing: 16)
    addSubview(stack)
    stack.pin(to: self, inset: 20)
    stack.addArrangedSubview(Theme.label(weather["location"].string, style: .headline))
    let current = Theme.stack(.horizontal, spacing: 16)
    current.alignment = .center
    let icon = UIImageView(image: UIImage(systemName: Self.symbol(weather["condition"].string)))
    icon.tintColor = Theme.ink
    icon.contentMode = .scaleAspectFit
    icon.widthAnchor.constraint(equalToConstant: 52).isActive = true
    icon.heightAnchor.constraint(equalToConstant: 52).isActive = true
    let temperature = Theme.label(
      "\(weather["temperature"].int)°\(weather["unit"].string)", style: .largeTitle)
    current.addArrangedSubview(temperature)
    current.addArrangedSubview(UIView())
    current.addArrangedSubview(icon)
    stack.addArrangedSubview(current)
    stack.addArrangedSubview(
      Theme.label(weather["description"].string, style: .subheadline, color: Theme.muted))
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    let forecast = Theme.stack(.horizontal, spacing: 22)
    forecast.alignment = .top
    scroll.addSubview(forecast)
    forecast.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      forecast.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
      forecast.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
      forecast.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      forecast.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      forecast.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
    ])
    for item in weather["forecast"].array {
      let column = Theme.stack(spacing: 8)
      column.alignment = .center
      column.addArrangedSubview(
        Theme.label(item["label"].string, style: .caption1, color: Theme.muted))
      let symbol = UIImageView(image: UIImage(systemName: Self.symbol(item["condition"].string)))
      symbol.tintColor = Theme.ink
      symbol.contentMode = .scaleAspectFit
      symbol.heightAnchor.constraint(equalToConstant: 24).isActive = true
      column.addArrangedSubview(symbol)
      column.addArrangedSubview(Theme.label("\(item["temperature"].int)°", style: .headline))
      if !item["precipitation"].isNull {
        column.addArrangedSubview(
          Theme.label("\(item["precipitation"].int)%", style: .caption2, color: Theme.muted))
      }
      forecast.addArrangedSubview(column)
    }
    if !weather["forecast"].array.isEmpty {
      scroll.heightAnchor.constraint(equalToConstant: 112).isActive = true
      stack.addArrangedSubview(scroll)
    }
    let dates = ISO8601DateFormatter()
    if let date = dates.date(from: weather["observedAt"].string) {
      stack.addArrangedSubview(
        Theme.label(
          DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short),
          style: .caption2, color: Theme.muted))
    }
    let url = URL(string: weather["sourceUrl"].string)
    let source = Theme.button(url?.host() ?? "Weather source", symbol: "arrow.up.right") {
      if let url, url.scheme == "https" { UIApplication.shared.open(url) }
    }
    source.contentHorizontalAlignment = .leading
    source.configuration?.contentInsets = .zero
    source.configuration?.baseForegroundColor = Theme.muted
    source.configuration?.titleTextAttributesTransformer = .init { attributes in
      var attributes = attributes
      attributes.font = .preferredFont(forTextStyle: .caption1)
      return attributes
    }
    stack.addArrangedSubview(source)
  }
  required init?(coder: NSCoder) { fatalError() }
  private static func symbol(_ condition: String) -> String {
    switch condition {
    case "clear": return "sun.max"
    case "rain": return "cloud.rain"
    case "snow": return "cloud.snow"
    case "storm": return "cloud.bolt.rain"
    case "fog": return "cloud.fog"
    default: return "cloud.sun"
    }
  }
}

final class EmailDraftCardView: UIView {
  init(_ block: JSON, open: @escaping () -> Void) {
    super.init(frame: .zero)
    backgroundColor = Theme.card
    layer.cornerRadius = 20
    layer.borderWidth = 0.5
    layer.borderColor = Theme.border.cgColor
    let draft = block["emailDraft"]
    let stack = Theme.stack(spacing: 10)
    addSubview(stack)
    stack.pin(to: self, inset: 16)
    let heading = Theme.stack(.horizontal, spacing: 8)
    let icon = UIImageView(image: UIImage(systemName: "envelope"))
    icon.tintColor = Theme.muted
    heading.addArrangedSubview(icon)
    heading.addArrangedSubview(
      Theme.label(draft["account"].string, style: .caption1, color: Theme.muted))
    heading.addArrangedSubview(UIView())
    stack.addArrangedSubview(heading)
    stack.addArrangedSubview(Theme.label(draft["subject"].string, style: .headline))
    stack.addArrangedSubview(
      Theme.label(
        draft["to"].array.map(\.string).joined(separator: ", "), style: .caption1,
        color: Theme.muted))
    let body = Theme.label(draft["body"].string, style: .body)
    body.numberOfLines = 5
    stack.addArrangedSubview(body)
    if block["status"].string != "answered" {
      stack.addArrangedSubview(
        Theme.button("Edit & send", symbol: "square.and.pencil", action: open))
    } else {
      let status =
        block["answer"].string == "send"
        ? "Send requested" : block["answer"].string == "cancel" ? "Cancelled" : "Reviewed"
      stack.addArrangedSubview(Theme.label(status, style: .caption1, color: Theme.muted))
    }
  }
  required init?(coder: NSCoder) { fatalError() }
}

final class EmailDraftController: UIViewController {
  private let draft: JSON
  private let to = UITextField(), cc = UITextField(), subject = UITextField(), body = UITextView()
  private var sending = false
  var onSubmit: ((String) async throws -> Void)?
  init(_ draft: JSON) {
    self.draft = draft
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Email draft"
    view.backgroundColor = Theme.canvas
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.close() }
    )
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "Send", primaryAction: UIAction { [weak self] _ in self?.send() })
    let stack = Theme.stack(spacing: 14)
    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      stack.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
    ])
    stack.addArrangedSubview(
      Theme.label(draft["account"].string, style: .caption1, color: Theme.muted))
    for (field, label, value) in [
      (to, "To", draft["to"].array.map(\.string).joined(separator: ", ")),
      (cc, "Cc", draft["cc"].array.map(\.string).joined(separator: ", ")),
      (subject, "Subject", draft["subject"].string),
    ] {
      field.text = value
      field.placeholder = label
      field.accessibilityLabel = label
      field.font = .preferredFont(forTextStyle: .body)
      field.textColor = Theme.ink
      field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      if field !== subject {
        field.keyboardType = .emailAddress
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
      }
      stack.addArrangedSubview(field)
    }
    body.text = draft["body"].string
    body.font = .preferredFont(forTextStyle: .body)
    body.adjustsFontForContentSizeCategory = true
    body.textColor = Theme.ink
    body.backgroundColor = .clear
    body.textContainerInset = .zero
    body.accessibilityLabel = "Email body"
    stack.addArrangedSubview(body)
  }
  private func close() {
    guard !sending else { return }
    let changed =
      to.text != draft["to"].array.map(\.string).joined(separator: ", ")
      || cc.text != draft["cc"].array.map(\.string).joined(separator: ", ")
      || subject.text != draft["subject"].string || body.text != draft["body"].string
    guard changed else {
      dismiss(animated: true)
      return
    }
    let alert = UIAlertController(title: "Discard edits?", message: nil, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Keep editing", style: .cancel))
    alert.addAction(
      UIAlertAction(title: "Discard edits", style: .destructive) { [weak self] _ in
        self?.dismiss(animated: true)
      })
    present(alert, animated: true)
  }
  private func send() {
    guard !sending else { return }
    func addresses(_ field: UITextField) -> [JSON] {
      (field.text ?? "").split(whereSeparator: { $0 == "," || $0 == ";" }).map {
        .string($0.trimmingCharacters(in: .whitespacesAndNewlines))
      }
    }
    let recipients = addresses(to)
    guard !recipients.isEmpty, recipients.allSatisfy({ $0.string.contains("@") }),
      !(subject.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !body.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      showError(APIError(status: 0, message: "Add a recipient, subject and message."))
      return
    }
    let reviewed = draft.merging([
      "to": .array(recipients), "cc": .array(addresses(cc)), "subject": .string(subject.text ?? ""),
      "body": .string(body.text),
    ])
    let answer: JSON = ["type": "email_review", "action": "send", "draft": reviewed]
    guard let data = try? JSONEncoder().encode(answer),
      let value = String(data: data, encoding: .utf8)
    else { return }
    sending = true
    isModalInPresentation = true
    navigationItem.rightBarButtonItem?.isEnabled = false
    navigationItem.leftBarButtonItem?.isEnabled = false
    Task {
      do {
        try await onSubmit?(value)
        dismiss(animated: true)
      } catch { showError(error) }
      sending = false
      isModalInPresentation = false
      navigationItem.rightBarButtonItem?.isEnabled = true
      navigationItem.leftBarButtonItem?.isEnabled = true
    }
  }
}
