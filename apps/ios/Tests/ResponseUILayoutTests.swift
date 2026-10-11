import NegroniCore
import UIKit
import XCTest

@testable import Negroni

final class ResponseUILayoutTests: XCTestCase {
  private func fixture() -> JSON {
    [
      "kind": "response_ui", "id": "layout", "summary": "Budget controls",
      "spec": [
        "root": "root", "summary": "Budget controls",
        "state": ["amount": 120, "people": 3, "tip": 10, "choice": "A"],
        "elements": [
          "root": [
            "type": "Card", "props": ["title": "Budget"],
            "children": ["inputs", "slider", "select", "button", "image"],
          ],
          "inputs": [
            "type": "Stack", "props": ["direction": "horizontal"],
            "children": ["amount", "people"],
          ],
          "amount": [
            "type": "Input",
            "props": [
              "label": "Amount", "input": "number",
              "bind": "/amount", "min": 0, "max": 1000,
            ],
          ],
          "people": [
            "type": "Input",
            "props": [
              "label": "People", "input": "number",
              "bind": "/people", "min": 1, "max": 50, "step": 1,
            ],
          ],
          "slider": [
            "type": "Slider",
            "props": [
              "label": "Tip", "bind": "/tip",
              "min": 0, "max": 30, "step": 1,
            ],
          ],
          "select": [
            "type": "Select",
            "props": [
              "label": "Choice", "bind": "/choice",
              "options": [
                ["label": "Option A", "value": "A"], ["label": "Option B", "value": "B"],
              ],
            ],
          ],
          "button": [
            "type": "Button",
            "props": [
              "label": "Compare",
              "action": ["type": "follow_up", "prompt": "Compare these values"],
            ],
          ],
          "image": [
            "type": "Image",
            "props": [
              "artifactId": "image-preview",
              "alt": "A preview image", "caption": "Image caption", "aspectRatio": .number(1.5),
            ],
          ],
        ],
      ],
    ]
  }
  @MainActor
  private func mount(
    _ view: UIView, category: UIContentSizeCategory = .large
  ) -> UIViewController {
    let host = UIViewController()
    let child = UIViewController()
    host.view.frame = CGRect(x: 0, y: 0, width: 390, height: 3000)
    host.addChild(child)
    host.view.addSubview(child.view)
    child.view.frame = host.view.bounds
    child.didMove(toParent: host)
    child.view.traitOverrides.preferredContentSizeCategory = category
    view.traitOverrides.preferredContentSizeCategory = category
    host.setOverrideTraitCollection(
      UITraitCollection(traitsFrom: [
        UITraitCollection(userInterfaceIdiom: .phone),
        UITraitCollection(preferredContentSizeCategory: category),
      ]), forChild: child)
    child.view.addSubview(view)
    host.view.updateTraitsIfNeeded()
    child.view.updateTraitsIfNeeded()
    func commitTraits(_ current: UIView) {
      current.updateTraitsIfNeeded()
      for child in current.subviews { commitTraits(child) }
    }
    commitTraits(view)
    view.translatesAutoresizingMaskIntoConstraints = false
    let height = view.heightAnchor.constraint(equalToConstant: 1)
    NSLayoutConstraint.activate([
      view.leadingAnchor.constraint(equalTo: child.view.leadingAnchor, constant: 16),
      view.topAnchor.constraint(equalTo: child.view.topAnchor),
      view.widthAnchor.constraint(equalToConstant: 358),
    ])
    for _ in 0..<3 {
      height.isActive = false
      child.view.layoutIfNeeded()
      height.constant =
        view.systemLayoutSizeFitting(
          CGSize(width: 358, height: 0), withHorizontalFittingPriority: .required,
          verticalFittingPriority: .fittingSizeLevel
        ).height
      height.isActive = true
      child.view.setNeedsLayout()
    }
    child.view.layoutIfNeeded()
    return host
  }
  @MainActor
  private func descendants<T: UIView>(_ view: UIView, as type: T.Type) -> [T] {
    ((view as? T).map { [$0] } ?? [])
      + view.subviews.flatMap { descendants($0, as: type) }
  }
  @MainActor
  private func fitAndAttach(_ view: UIView, name: String) {
    let height = view.constraints.first {
      $0.firstAttribute == .height && $0.secondItem == nil && $0.relation == .equal
    }
    height?.isActive = false
    let fitted = view.systemLayoutSizeFitting(
      CGSize(width: 358, height: 0),
      withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    height?.constant = fitted.height
    height?.isActive = true
    view.superview?.layoutIfNeeded()
    let image = UIGraphicsImageRenderer(bounds: view.bounds).image { context in
      Theme.canvas.setFill()
      context.fill(view.bounds)
      view.layer.render(in: context.cgContext)
    }
    let attachment = XCTAttachment(image: image)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
  @MainActor
  func testAssistantMessageCellGivesResponseTheFullChatWidth() throws {
    let document = try XCTUnwrap(ResponseUI(fixture()))
    let (view, _) = response(document)
    let cell = MessageCell(style: .default, reuseIdentifier: nil)
    cell.configure(
      ["id": "message-preview", "role": "assistant", "blocks": [document.block]],
      target: ["botId": "bot-preview"], connections: [], host: nil, relayout: {}, canAnswer: false,
      open: { _ in }, answer: { _, _ in }, connect: { _ in }, response: { _ in view },
      openComputer: {})
    cell.frame = CGRect(x: 0, y: 0, width: 390, height: 2000)
    cell.layoutIfNeeded()
    XCTAssertEqual(view.bounds.width, 358, accuracy: 1)
    XCTAssertEqual(
      try XCTUnwrap(descendants(view, as: UITextField.self).first).bounds.width,
      318, accuracy: 1)
  }
  @MainActor
  private func response(
    _ document: ResponseUI, load: @escaping (String) async -> UIImage? = { _ in nil },
    followUp: @escaping (String) -> Void = { _ in }
  ) -> (ResponseUIView, ResponseUIState) {
    let state = ResponseUIState(document) { revision, values in
      try XCTUnwrap(document.replacingState(values, revision: revision + 1))
    }
    return (
      ResponseUIView(
        session: state, live: false, onInputFocus: {}, relayout: {},
        refresh: { document }, loadImage: load, followUp: followUp), state
    )
  }
  @MainActor
  func testPhoneControlsUseChatWidthAndKeepStateWhenEdited() async throws {
    let document = try XCTUnwrap(ResponseUI(fixture()))
    let (view, state) = response(document)
    let host = mount(view)
    defer { withExtendedLifetime(host) {} }
    let fields = descendants(view, as: UITextField.self)
    XCTAssertEqual(fields.count, 2)
    for field in fields {
      XCTAssertEqual(field.bounds.width, 318, accuracy: 1)
      XCTAssertGreaterThanOrEqual(field.bounds.height, 52)
      XCTAssertEqual(try XCTUnwrap(field.font).pointSize, 17, accuracy: 0.1)
      XCTAssertTrue(field.adjustsFontForContentSizeCategory)
      XCTAssertGreaterThanOrEqual(field.textRect(forBounds: field.bounds).minX, 14)
    }
    let first = fields[0].convert(fields[0].bounds, to: view)
    let second = fields[1].convert(fields[1].bounds, to: view)
    XCTAssertGreaterThan(second.minY, first.maxY)
    XCTAssertEqual(second.minX, first.minX, accuracy: 0.1)
    let slider = try XCTUnwrap(descendants(view, as: UISlider.self).first)
    XCTAssertEqual(slider.bounds.width, 318, accuracy: 1)
    XCTAssertGreaterThanOrEqual(slider.bounds.height, 56)
    XCTAssertEqual(slider.trackRect(forBounds: slider.bounds).height, 6)
    XCTAssertGreaterThanOrEqual(try XCTUnwrap(slider.thumbImage(for: .normal)).size.width, 34)
    for button in descendants(view, as: UIButton.self) {
      XCTAssertGreaterThanOrEqual(button.bounds.height, 52)
      XCTAssertEqual(button.bounds.width, 318, accuracy: 1)
    }
    fields[0].text = "245"
    fields[0].sendActions(for: .editingChanged)
    slider.value = 0.5
    slider.sendActions(for: .valueChanged)
    XCTAssertEqual(state.state["amount"], 245)
    XCTAssertEqual(state.state["tip"], 15)
    XCTAssertEqual(slider.accessibilityValue, "15")
    XCTAssertTrue(descendants(view, as: UITextField.self).first === fields[0])
    fitAndAttach(view, name: "UIKit response at 390pt")
    await state.flush()
    XCTAssertEqual(state.document.revision, 1)
    XCTAssertFalse(state.dirty)
  }
  @MainActor
  func testAccessibilitySizeKeepsWideFieldsAndFollowUpWaitsForSavedValues() async throws {
    let document = try XCTUnwrap(ResponseUI(fixture()))
    let followedUp = expectation(description: "Saved values reach follow-up")
    followedUp.assertForOverFulfill = true
    var state: ResponseUIState!
    let rendered = response(
      document,
      followUp: { text in
        XCTAssertEqual(text, "Compare these values")
        XCTAssertFalse(state.dirty)
        XCTAssertNil(state.error)
        XCTAssertEqual(state.document.state["amount"], 250)
        followedUp.fulfill()
      })
    let view = rendered.0
    state = rendered.1
    let host = mount(view, category: .accessibilityExtraLarge)
    defer { withExtendedLifetime(host) {} }
    let field = try XCTUnwrap(descendants(view, as: UITextField.self).first)
    XCTAssertEqual(view.traitCollection.preferredContentSizeCategory, .accessibilityExtraLarge)
    XCTAssertEqual(field.traitCollection.preferredContentSizeCategory, .accessibilityExtraLarge)
    XCTAssertEqual(field.bounds.width, 318, accuracy: 1)
    XCTAssertGreaterThanOrEqual(field.bounds.height, 52)
    XCTAssertGreaterThan(try XCTUnwrap(field.font).pointSize, 17)
    let pixel = 1 / max(1, field.traitCollection.displayScale)
    XCTAssertGreaterThanOrEqual(
      field.bounds.height + pixel,
      try XCTUnwrap(field.font).lineHeight + 24)
    field.text = "250"
    field.sendActions(for: .editingChanged)
    let button = try XCTUnwrap(
      descendants(view, as: UIButton.self).first {
        $0.accessibilityLabel == "Compare"
      })
    button.sendActions(for: .primaryActionTriggered)
    await fulfillment(of: [followedUp], timeout: 2)
  }
  @MainActor
  func testManySectionsUseFullWidthNativeMenuAndKeepSelectedState() throws {
    var raw = fixture()
    let names = (1...8).map { "Section \($0)" }
    let ids = (1...8).map { "section\($0)" }
    raw["spec"]["state"]["tab"] = 0
    raw["spec"]["elements"]["root"]["children"] = .array(
      raw["spec"]["elements"]["root"]["children"].array + ["tabs"])
    raw["spec"]["elements"]["tabs"] = [
      "type": "Tabs",
      "props": ["labels": .array(names.map(JSON.string)), "bind": "/tab"],
      "children": .array(ids.map(JSON.string)),
    ]
    for (index, id) in ids.enumerated() {
      raw["spec"]["elements"][id] = ["type": "Text", "props": ["text": .string(names[index])]]
    }
    let document = try XCTUnwrap(ResponseUI(raw))
    let (view, state) = response(document)
    let host = mount(view)
    defer { withExtendedLifetime(host) {} }
    let menu = try XCTUnwrap(
      descendants(view, as: UIButton.self).first { $0.menu?.children.count == 8 })
    XCTAssertFalse(menu.isHidden)
    XCTAssertTrue(menu.showsMenuAsPrimaryAction)
    XCTAssertEqual(menu.bounds.width, 318, accuracy: 1)
    XCTAssertGreaterThanOrEqual(menu.bounds.height, 52)
    XCTAssertTrue(try XCTUnwrap(descendants(view, as: UISegmentedControl.self).first).isHidden)
    var values = state.state
    values["tab"] = 7
    XCTAssertTrue(state.change(values))
    XCTAssertEqual(menu.configuration?.title, "Section 8")
    let selected = try XCTUnwrap(menu.menu?.children.last as? UIAction)
    XCTAssertEqual(selected.state, .on)
    XCTAssertEqual(selected.title, "Section 8")
  }
  @MainActor
  func testComposedImageUsesInjectedArtifactLoaderAndKeepsFallbackText() async throws {
    let document = try XCTUnwrap(ResponseUI(fixture()))
    let loaded = expectation(description: "Owned image requested")
    let image = previewImage()
    let (view, _) = response(
      document,
      load: { artifactID in
        XCTAssertEqual(artifactID, "image-preview")
        loaded.fulfill()
        return image
      })
    let host = mount(view)
    defer { withExtendedLifetime(host) {} }
    await fulfillment(of: [loaded], timeout: 2)
    await Task.yield()
    let picture = try XCTUnwrap(
      descendants(view, as: UIImageView.self).first {
        $0.accessibilityLabel == "A preview image"
      })
    fitAndAttach(view, name: "UIKit response with owned image")
    XCTAssertTrue(picture.image === image)
    XCTAssertFalse(picture.isHidden)
    XCTAssertEqual(picture.accessibilityLabel, "A preview image")
    XCTAssertEqual(picture.contentMode, .scaleAspectFit)
    XCTAssertEqual(picture.bounds.width, 318, accuracy: 1)
    XCTAssertEqual(picture.bounds.height, 212, accuracy: 1)
    let (missing, _) = response(document)
    let fallback = try XCTUnwrap(
      descendants(missing, as: UILabel.self).first {
        $0.text == "A preview image"
      })
    XCTAssertFalse(fallback.isHidden)
    XCTAssertTrue(descendants(missing, as: UILabel.self).contains { $0.text == "Image caption" })
  }
  @MainActor
  func testOwnedImageLoaderRejectsStaleContextInvalidTargetMimeAndOversizePayload() async throws {
    let store = ImageStore.shared
    let payload: JSON = [
      "id": "image-preview", "mimeType": "image/png",
      "contentBase64": .string(try XCTUnwrap(previewImage().pngData()).base64EncodedString()),
    ]
    var fetches = 0
    let blocked = await store.ownedArtifactImage(
      "image-preview", target: ["botId": "bot-preview"],
      contextMatches: { false },
      fetch: { _ in
        fetches += 1
        return payload
      })
    XCTAssertNil(blocked)
    XCTAssertEqual(fetches, 0)
    let invalid = await store.ownedArtifactImage(
      "image-preview", target: [:],
      contextMatches: { true },
      fetch: { _ in
        fetches += 1
        return payload
      })
    XCTAssertNil(invalid)
    XCTAssertEqual(fetches, 0)
    var matches = true
    let stale = await store.ownedArtifactImage(
      "image-preview", target: ["groupId": "group-preview"],
      contextMatches: { matches },
      fetch: { request in
        XCTAssertEqual(request, ["groupId": "group-preview", "artifactId": "image-preview"])
        fetches += 1
        matches = false
        return payload
      })
    XCTAssertNil(stale)
    XCTAssertEqual(fetches, 1)
    let valid = await store.ownedArtifactImage(
      "image-preview", target: ["botId": "bot-preview"],
      contextMatches: { true }, fetch: { _ in payload })
    XCTAssertNotNil(valid)
    let feed = await store.ownedArtifactImage(
      "image-preview", target: ["feedItemId": "feed-preview"],
      contextMatches: { true },
      fetch: { request in
        XCTAssertEqual(request, ["feedItemId": "feed-preview", "artifactId": "image-preview"])
        return payload
      })
    XCTAssertNotNil(feed)
    var wrongID = payload
    wrongID["id"] = "another-image"
    let wrongArtifact = await store.ownedArtifactImage(
      "image-preview", target: ["botId": "bot-preview"],
      contextMatches: { true }, fetch: { _ in wrongID })
    XCTAssertNil(wrongArtifact)
    var invalidMime = payload
    invalidMime["mimeType"] = "text/html"
    XCTAssertNil(store.artifactImage(invalidMime))
    var corrupt = payload
    corrupt["contentBase64"] = "not-base64"
    XCTAssertNil(store.artifactImage(corrupt))
    let oversized: JSON = [
      "mimeType": "image/png",
      "contentBase64": .string(String(repeating: "A", count: 16 * 1024 * 1024 + 4)),
    ]
    XCTAssertNil(store.artifactImage(oversized))
  }
  @MainActor
  private func previewImage() -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: 600, height: 360), format: format).image {
      _ in
      Theme.ink.setFill()
      UIBezierPath(rect: CGRect(x: 0, y: 0, width: 600, height: 360)).fill()
    }
  }
  @MainActor
  func testResetAndSetFinishFocusedEditingBeforeUpdatingFields() throws {
    var raw = fixture()
    raw["spec"]["elements"]["root"]["children"] = .array(
      raw["spec"]["elements"]["root"]["children"].array + ["reset", "set"])
    raw["spec"]["elements"]["reset"] = [
      "type": "Button",
      "props": ["label": "Reset values", "action": ["type": "reset"]],
    ]
    raw["spec"]["elements"]["set"] = [
      "type": "Button",
      "props": ["label": "Set amount", "action": ["type": "set", "path": "/amount", "value": 60]],
    ]
    let document = try XCTUnwrap(ResponseUI(raw))
    let (view, state) = response(document)
    let host = mount(view)
    let previous = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows).first { $0.isKeyWindow }
    let window = previous?.windowScene.map { UIWindow(windowScene: $0) } ?? UIWindow()
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer {
      window.isHidden = true
      previous?.makeKey()
    }
    host.view.layoutIfNeeded()
    let field = try XCTUnwrap(descendants(view, as: UITextField.self).first)
    for (title, expected) in [("Reset values", 120.0), ("Set amount", 60.0)] {
      XCTAssertTrue(field.becomeFirstResponder())
      field.text = "250"
      field.sendActions(for: .editingChanged)
      XCTAssertEqual(state.state["amount"], 250)
      let button = try XCTUnwrap(
        descendants(view, as: UIButton.self).first { $0.accessibilityLabel == title })
      button.sendActions(for: .primaryActionTriggered)
      XCTAssertFalse(field.isFirstResponder)
      XCTAssertEqual(state.state["amount"]?.uiNumber, expected)
      XCTAssertEqual(
        Double(
          (field.text ?? "").replacingOccurrences(
            of: Locale.current.decimalSeparator ?? ".", with: ".")), expected)
    }
  }
  @MainActor
  func testAccessibilityChartsAndDiagramsExposeTextDataWithoutFixedDrawings() throws {
    var raw = fixture()
    raw["spec"]["elements"]["root"]["children"] = .array(
      raw["spec"]["elements"]["root"]["children"].array + ["chart", "diagram"])
    raw["spec"]["elements"]["chart"] = [
      "type": "Chart",
      "props": [
        "title": "Comparison", "style": "line",
        "series": [["label": "Budget", "points": [["x": 1, "y": 20]]]],
      ],
    ]
    raw["spec"]["elements"]["diagram"] = [
      "type": "Diagram",
      "props": [
        "nodes": [["id": "plan", "label": "Plan", "detail": "Review budget"]], "edges": [],
      ],
    ]
    let document = try XCTUnwrap(ResponseUI(raw))
    let (view, _) = response(document)
    let host = mount(view, category: .accessibilityExtraLarge)
    defer { withExtendedLifetime(host) {} }
    let drawings = descendants(view, as: UIView.self).filter {
      $0.accessibilityIdentifier == "response-ui-drawing"
    }
    XCTAssertEqual(drawings.count, 2)
    XCTAssertTrue(drawings.allSatisfy(\.isHidden))
    for text in ["1: 20", "Plan: Review budget"] {
      let label = try XCTUnwrap(descendants(view, as: UILabel.self).first { $0.text == text })
      var ancestor: UIView? = label
      while let current = ancestor {
        XCTAssertFalse(current.isHidden)
        ancestor = current.superview
      }
      XCTAssertGreaterThan(try XCTUnwrap(label.font).pointSize, 17)
    }
  }
}
