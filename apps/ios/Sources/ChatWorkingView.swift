import UIKit

final class ChatWorkingView: UIView {
  private let avatar = UIImageView()
  private let dots = (0..<3).map { _ in UIView() }
  override init(frame: CGRect) {
    super.init(frame: frame)
    let row = Theme.stack(.horizontal, spacing: 6)
    row.alignment = .center
    row.addArrangedSubview(avatar)
    row.setCustomSpacing(12, after: avatar)
    avatar.widthAnchor.constraint(equalToConstant: 30).isActive = true
    avatar.heightAnchor.constraint(equalToConstant: 30).isActive = true
    for dot in dots {
      dot.backgroundColor = Theme.muted
      dot.layer.cornerRadius = 3
      dot.widthAnchor.constraint(equalToConstant: 6).isActive = true
      dot.heightAnchor.constraint(equalToConstant: 6).isActive = true
      row.addArrangedSubview(dot)
    }
    addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
      row.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
    isAccessibilityElement = true
    NotificationCenter.default.addObserver(
      self, selector: #selector(updateMotion),
      name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
  }
  required init?(coder: NSCoder) { fatalError() }
  func configure(name: String, color: String, main: Bool) {
    avatar.image = RobotAvatar.image(color: color, size: 30, main: main)
    accessibilityLabel = "\(name) is working"
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateMotion()
  }
  @objc private func updateMotion() {
    for (index, dot) in dots.enumerated() {
      dot.layer.removeAllAnimations()
      guard window != nil, !UIAccessibility.isReduceMotionEnabled else { continue }
      let animation = CAKeyframeAnimation(keyPath: "opacity")
      animation.values = [0.25, 1, 0.25]
      animation.keyTimes = [0, 0.5, 1]
      animation.duration = 1.2
      animation.beginTime = CACurrentMediaTime() + Double(index) * 0.16
      animation.repeatCount = .infinity
      animation.timingFunctions = [
        CAMediaTimingFunction(name: .easeInEaseOut), CAMediaTimingFunction(name: .easeInEaseOut),
      ]
      dot.layer.add(animation, forKey: "working")
    }
  }
}
