import ImageIO
import UIKit

@MainActor final class ImageStore {
  static let shared = ImageStore()
  private let cache = NSCache<NSURL, UIImage>()
  func image(_ raw: String) async -> UIImage? {
    guard let url = URL(string: raw), url.scheme == "https" else { return nil }
    if let image = cache.object(forKey: url as NSURL) { return image }
    guard let (data, response) = try? await URLSession.shared.data(from: url),
      (response as? HTTPURLResponse)?.statusCode == 200, data.count < 12 * 1024 * 1024,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let cg = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceThumbnailMaxPixelSize: 1000,
          kCGImageSourceCreateThumbnailWithTransform: true,
        ] as CFDictionary)
    else { return nil }
    let image = UIImage(cgImage: cg)
    cache.setObject(image, forKey: url as NSURL, cost: cg.bytesPerRow * cg.height)
    return image
  }
}

enum RobotAvatar {
  static func group(colors: [String], size: CGFloat) -> UIImage {
    let values = colors.isEmpty ? ["", ""] : Array(colors.prefix(3))
    return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
      for (index, color) in values.enumerated() {
        let side = values.count == 1 ? size : size * 0.68
        let offset =
          values.count == 1 ? 0 : CGFloat(index) * (size - side) / CGFloat(values.count - 1)
        let rect = CGRect(x: offset, y: offset, width: side, height: side)
        Theme.card.setFill()
        UIBezierPath(ovalIn: rect.insetBy(dx: -1.5, dy: -1.5)).fill()
        image(color: color, size: side).draw(in: rect)
      }
    }.withRenderingMode(.alwaysOriginal)
  }
  static let shapes: [String] = {
    guard let url = Bundle.main.url(forResource: "AvatarShapes", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let paths = try? JSONDecoder().decode([String].self, from: data)
    else { return [] }
    return paths
  }()
  static func image(color: String, size: CGFloat, main: Bool = false) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
    if color.hasPrefix("data:image"), let encoded = color.split(separator: ",").last,
      let data = Data(base64Encoded: String(encoded)), let image = UIImage(data: data)
    {
      return renderer.image { _ in
        UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: size, height: size)).addClip()
        image.draw(in: CGRect(x: 0, y: 0, width: size, height: size))
      }.withRenderingMode(.alwaysOriginal)
    }
    if main, let mascot = UIImage(named: "NegroniMascot") {
      return renderer.image { _ in
        UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: size, height: size)).addClip()
        mascot.draw(in: CGRect(x: 0, y: 0, width: size, height: size))
      }.withRenderingMode(.alwaysOriginal)
    }
    let parts = color.components(separatedBy: "::shape_")
    let fill = parts.first?.hasPrefix("#") == true ? UIColor(hex: parts[0]) : Theme.userBubble
    return renderer.image { context in
      fill.setFill()
      if parts.count == 2, let index = Int(parts[1]), !shapes.isEmpty {
        let path = shapePath(shapes[((index % shapes.count) + shapes.count) % shapes.count])
        var transform = CGAffineTransform(scaleX: size / 259, y: size / 259).translatedBy(
          x: 15, y: 15)
        if let scaled = path.copy(using: &transform) {
          context.cgContext.addPath(scaled)
          context.cgContext.fillPath()
        }
        Theme.ink.setFill()
        for x in [85.2705, 143.2705] {
          UIBezierPath(
            ovalIn: CGRect(
              x: (x - 10 + 15) * size / 259, y: (106.2705 - 7 + 15) * size / 259,
              width: 20 * size / 259, height: 14 * size / 259)
          ).fill()
        }
      } else {
        UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: size, height: size)).fill()
        Theme.ink.setFill()
        UIBezierPath(
          roundedRect: CGRect(
            x: size * 0.16, y: size * 0.28, width: size * 0.68, height: size * 0.44),
          cornerRadius: size * 0.23
        ).fill()
        Theme.card.setFill()
        for x in [CGFloat(0.34), CGFloat(0.55)] {
          UIBezierPath(
            roundedRect: CGRect(
              x: size * x, y: size * 0.41, width: size * 0.11, height: size * 0.17),
            cornerRadius: size * 0.055
          ).fill()
        }
      }
    }.withRenderingMode(.alwaysOriginal)
  }
  // The shared shipped paths use only these absolute SVG commands.
  private static func shapePath(_ source: String) -> CGPath {
    let regex = try! NSRegularExpression(pattern: "[MLCQZ]|-?[0-9]+(?:\\.[0-9]+)?")
    let tokens = regex.matches(in: source, range: NSRange(source.startIndex..., in: source)).map {
      (source as NSString).substring(with: $0.range)
    }
    let path = CGMutablePath()
    var i = 0
    func number() -> CGFloat {
      defer { i += 1 }
      return i < tokens.count ? CGFloat(Double(tokens[i]) ?? 0) : 0
    }
    func point() -> CGPoint { CGPoint(x: number(), y: number()) }
    while i < tokens.count {
      let command = tokens[i]
      i += 1
      switch command {
      case "M": path.move(to: point())
      case "L": path.addLine(to: point())
      case "C":
        let a = point()
        let b = point()
        let end = point()
        path.addCurve(to: end, control1: a, control2: b)
      case "Q":
        let a = point()
        let end = point()
        path.addQuadCurve(to: end, control: a)
      case "Z": path.closeSubpath()
      default: break
      }
    }
    return path
  }
}
