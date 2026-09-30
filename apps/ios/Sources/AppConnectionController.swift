import AuthenticationServices
import NegroniCore
import UIKit

/// One authorization flow for Settings and contextual chat cards.
final class AppConnectionController: UIViewController,
  ASWebAuthenticationPresentationContextProviding
{
  private let app: JSON
  private let onConnected: (JSON) async throws -> Void
  private let status = Theme.label("", style: .callout, color: Theme.muted)
  private lazy var connectButton = Theme.button("Connect", primary: true) { [weak self] in
    self?.connect()
  }
  private var authSession: ASWebAuthenticationSession?
  private var operation: Task<Void, Never>?
  private var connectionID: JSON?
  private var completed: JSON?
  private var closed = false
  private var busy = false {
    didSet {
      connectButton.isEnabled = !busy
      connectButton.configuration?.showsActivityIndicator = busy
      isModalInPresentation = busy
    }
  }
  init(app: JSON, onConnected: @escaping (JSON) async throws -> Void) {
    self.app = app
    self.onConnected = onConnected
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .close,
      primaryAction: UIAction { [weak self] _ in
        self?.closed = true
        self?.operation?.cancel()
        self?.authSession?.cancel()
        self?.dismiss(animated: true)
      })
    let content = Theme.stack(spacing: 16)
    let icon = UIImageView(image: UIImage(systemName: "app.connected.to.app.below.fill"))
    icon.contentMode = .scaleAspectFit
    icon.tintColor = Theme.ink
    icon.heightAnchor.constraint(equalToConstant: 48).isActive = true
    content.addArrangedSubview(icon)
    let name = Theme.label(app["name"].string, style: .title2)
    name.textAlignment = .center
    content.addArrangedSubview(name)
    status.text =
      app["status"].string == "connected" ? "Connected" : "Connect your account to continue."
    connectButton.configuration?.title =
      app["status"].string == "connected" ? "Continue" : "Connect"
    status.textAlignment = .center
    content.addArrangedSubview(status)
    content.addArrangedSubview(connectButton)
    view.addSubview(content)
    content.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
      content.leadingAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
      content.trailingAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
      content.bottomAnchor.constraint(
        lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
    ])
    Task { [weak self] in
      guard let self else { return }
      if let image = await ImageStore.shared.connectionImage(
        app["logo"].string, request: ["connectorId": app["connectorId"], "provider": provider])
      {
        icon.image = image
      }
    }
  }
  private var provider: JSON { app["provider"].isNull ? app["slug"] : app["provider"] }
  private func connect() {
    guard !busy else { return }
    busy = true
    status.text = "Connecting…"
    operation = Task { [weak self] in
      guard let self else { return }
      do {
        if let completed {
          try await finish(completed)
          return
        }
        if let connectionID {
          try await verify(connectionID)
          return
        }
        let accounts = try await API.shared.rpc("connections/list").array
        if let existing = accounts.first(where: {
          $0["connectorId"] == app["connectorId"] && $0["provider"] == provider
            && $0["status"].string == "connected"
        }) {
          try await finish(existing)
          return
        }
        let result = try await API.shared.rpc(
          "connections/begin", ["connectorId": app["connectorId"], "provider": provider])
        try Task.checkCancellation()
        connectionID = result["connectionId"]
        if result["authorizationUrl"].isNull {
          try await verify(result["connectionId"])
          return
        }
        guard let url = URL(string: result["authorizationUrl"].string), url.scheme == "https" else {
          throw NSError(
            domain: "Connection", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Could not open the sign-in page."])
        }
        authSession = ASWebAuthenticationSession(url: url, callbackURLScheme: "negroni") {
          [weak self] _, error in
          Task { @MainActor in
            guard let self, !self.closed else { return }
            self.authSession = nil
            if let error {
              self.connectionID = nil
              self.busy = false
              self.status.text =
                (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                ? "Connection cancelled." : error.localizedDescription
              return
            }
            self.operation = Task {
              do { try await self.verify(result["connectionId"]) } catch { self.failed(error) }
            }
          }
        }
        authSession?.presentationContextProvider = self
        authSession?.prefersEphemeralWebBrowserSession = false
        if authSession?.start() != true {
          authSession = nil
          connectionID = nil
          throw NSError(
            domain: "Connection", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Could not start sign-in. Try again."])
        }
      } catch { failed(error) }
    }
  }
  private func verify(_ id: JSON) async throws {
    let result = try await API.shared.rpc("connections/complete", ["connectionId": id])
    guard result["status"].string == "connected" else {
      throw NSError(
        domain: "Connection", code: 3,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Still waiting for authorization. Finish sign-in, then try again."
        ])
    }
    try await finish(result)
  }
  private func finish(_ result: JSON) async throws {
    try Task.checkCancellation()
    completed = result
    status.text = "Connected"
    connectButton.configuration?.title = "Continue"
    try await onConnected(result)
    try Task.checkCancellation()
    busy = false
    dismiss(animated: true)
  }
  private func failed(_ error: Error) {
    busy = false
    if error is CancellationError { return }
    status.text = error.localizedDescription
    connectButton.configuration?.title = completed == nil ? "Try again" : "Continue"
  }
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    view.window!
  }
}

extension UIViewController {
  func presentConnection(_ app: JSON, onConnected: @escaping (JSON) async throws -> Void) {
    let controller = AppConnectionController(app: app, onConnected: onConnected)
    let navigation = UINavigationController(rootViewController: controller)
    navigation.modalPresentationStyle = .pageSheet
    navigation.sheetPresentationController?.detents = [.medium(), .large()]
    navigation.sheetPresentationController?.prefersGrabberVisible = true
    present(navigation, animated: true)
  }
}
