import UIKit

// Semantic colors generated from the shared palette by Scripts/generate-theme.mjs.
extension UIColor {
  convenience init(hex: String) {
    var digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
    let v = UInt64(digits, radix: 16) ?? 0
    self.init(
      red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255,
      blue: CGFloat(v & 255) / 255, alpha: 1)
  }
}
enum Theme {
  static let canvas = UIColor(hex: Palette.background)
  static let card = UIColor(hex: Palette.card)
  static let ink = UIColor(hex: Palette.foreground)
  static let secondary = UIColor(hex: Palette.secondary)
  static let muted = UIColor(hex: Palette.mutedForeground)
  static let userBubble = UIColor(hex: Palette.chatUser)
  static let border = UIColor(hex: Palette.border)
  static func label(
    _ text: String = "", style: UIFont.TextStyle = .body, color: UIColor = Theme.ink
  ) -> UILabel {
    let label = UILabel()
    label.text = text
    label.font = .preferredFont(forTextStyle: style)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = color
    label.numberOfLines = 0
    return label
  }
  static func button(
    _ title: String? = nil, symbol: String? = nil, primary: Bool = false,
    action: @escaping () -> Void
  ) -> UIButton {
    var config: UIButton.Configuration = primary ? .filled() : .plain()
    config.title = title
    config.image = symbol.flatMap(UIImage.init(systemName:))
    config.imagePadding = 8
    config.baseForegroundColor = primary ? card : ink
    config.baseBackgroundColor = ink
    config.cornerStyle = .capsule
    config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
    let button = UIButton(configuration: config, primaryAction: UIAction { _ in action() })
    button.accessibilityLabel = title
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    return button
  }
  static func stack(_ axis: NSLayoutConstraint.Axis = .vertical, spacing: CGFloat = 12)
    -> UIStackView
  {
    let view = UIStackView()
    view.axis = axis
    view.spacing = spacing
    return view
  }
}
extension UIView {
  func pin(to other: UIView, inset: CGFloat = 0) {
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: other.leadingAnchor, constant: inset),
      trailingAnchor.constraint(equalTo: other.trailingAnchor, constant: -inset),
      topAnchor.constraint(equalTo: other.topAnchor, constant: inset),
      bottomAnchor.constraint(equalTo: other.bottomAnchor, constant: -inset),
    ])
  }
}
extension UIViewController {
  func showError(_ error: Error, retry: (() -> Void)? = nil) {
    if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
    let alert = UIAlertController(
      title: "Could not complete", message: error.localizedDescription, preferredStyle: .alert)
    if let retry {
      alert.addAction(UIAlertAction(title: "Try again", style: .default) { _ in retry() })
    }
    alert.addAction(UIAlertAction(title: "Close", style: .cancel))
    if presentedViewController == nil { present(alert, animated: true) }
  }
  func prompt(
    _ title: String, value: String = "", placeholder: String? = nil, secure: Bool = false,
    action: @escaping (String) -> Void
  ) {
    let alert = UIAlertController(title: title, message: nil, preferredStyle: .alert)
    alert.addTextField { field in
      field.text = value
      field.placeholder = placeholder
      field.isSecureTextEntry = secure
      field.autocapitalizationType = .none
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(
      UIAlertAction(title: "Save", style: .default) { _ in
        if let value = alert.textFields?.first?.text,
          !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
          action(value)
        }
      })
    present(alert, animated: true)
  }
}
extension URLError.Code { fileprivate var isCancellation: Bool { self == .cancelled } }
