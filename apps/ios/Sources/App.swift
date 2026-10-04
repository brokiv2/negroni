import AuthenticationServices
import CryptoKit
import NegroniCore
import UIKit

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) { Notifications.shared.register(deviceToken) }
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Before launch finishes, so the response that launched the app reaches the delegate.
    Notifications.shared.prepare()
    return true
  }
  func application(
    _ application: UIApplication, configurationForConnecting session: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration { UISceneConfiguration(name: "Default", sessionRole: session.role) }
}

@MainActor final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions
  ) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    self.window = window
    window.overrideUserInterfaceStyle = .light
    window.tintColor = Theme.ink
    API.shared.consent = { [weak self] recipient in
      guard let presenter = self?.topController else { return false }
      return await withCheckedContinuation { continuation in
        let alert = UIAlertController(
          title: "Share with \(recipient["name"].string)",
          message: [
            recipient["detail"].string, ConsentCopy.disclosures[recipient["use"].string] ?? "",
            "You can withdraw permission in Account → AI data sharing.",
          ].filter { !$0.isEmpty }.joined(separator: "\n\n"), preferredStyle: .alert)
        alert.addAction(
          UIAlertAction(title: "Cancel", style: .cancel) { _ in
            continuation.resume(returning: false)
          })
        alert.addAction(
          UIAlertAction(title: "Allow", style: .default) { _ in continuation.resume(returning: true)
          })
        alert.addAction(
          UIAlertAction(title: "Privacy policy", style: .default) { _ in
            if let url = URL(string: ConsentCopy.privacyURL) { UIApplication.shared.open(url) }
            continuation.resume(returning: false)
          })
        presenter.present(alert, animated: true)
      }
    }
    showRoot()
    window.makeKeyAndVisible()
  }
  var topController: UIViewController? {
    var current = window?.rootViewController
    while let controller = current {
      if let next = controller.presentedViewController {
        current = next
      } else if let tabs = controller as? UITabBarController {
        current = tabs.selectedViewController
      } else if let nav = controller as? UINavigationController {
        current = nav.visibleViewController
      } else {
        break
      }
    }
    return current
  }
  func showRoot() {
    window?.rootViewController =
      API.shared.token.isEmpty
      ? UINavigationController(rootViewController: SignInController()) : BootstrapController()
  }
  static func restart() {
    (UIApplication.shared.connectedScenes.first?.delegate as? SceneDelegate)?.showRoot()
  }
}

final class BootstrapController: UIViewController {
  private let spinner = UIActivityIndicatorView(style: .medium)
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    view.addSubview(spinner)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    spinner.startAnimating()
    load()
  }
  private func load() {
    Task {
      do {
        let me = try await API.shared.rpc("me")
        API.shared.spaceID = me["spaceId"].string
        let personal = try await API.shared.rpc("personal/thread")
        let tabs = MainTabController(botID: personal["botId"].string)
        Notifications.shared.configure()
        view.window?.rootViewController = tabs
      } catch let error as APIError where error.status == 401 {
        API.shared.invalidateSession()
        SceneDelegate.restart()
      } catch {
        spinner.stopAnimating()
        let stack = Theme.stack()
        stack.addArrangedSubview(Theme.label(error.localizedDescription, style: .body))
        stack.addArrangedSubview(
          Theme.button(
            "Try again",
            action: { [weak self] in
              stack.removeFromSuperview()
              self?.spinner.startAnimating()
              self?.load()
            }))
        stack.addArrangedSubview(
          Theme.button(
            "Server",
            action: { [weak self] in
              self?.present(
                UINavigationController(rootViewController: ServerController()), animated: true)
            }))
        view.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
          stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
          stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
          stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
        ])
      }
    }
  }
}

final class MainTabController: UITabBarController {
  let botID: String
  init(botID: String) {
    self.botID = botID
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    let screens: [(UIViewController, String, String)] = [
      (
        ChatController(target: ["botId": .string(botID), "threadKind": "personal"]), "Chat",
        "bubble.left.and.bubble.right"
      ), (FeedController(botID: botID), "For you", "rectangle.stack"),
      (TeamController(botID: botID), "Team", "person.2"),
      (SettingsController(botID: botID), "Settings", "gearshape"),
    ]
    viewControllers = screens.map { screen, title, symbol in
      let nav = UINavigationController(rootViewController: screen)
      nav.tabBarItem = UITabBarItem(
        title: title, image: UIImage(systemName: symbol), selectedImage: nil)
      nav.navigationBar.tintColor = Theme.ink
      return nav
    }
    tabBar.tintColor = Theme.ink
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Notifications.shared.flush(self)
  }
  /// Brings the personal conversation to the front, closing any sheet first.
  func showPersonalChat(_ then: @escaping (ChatController) -> Void = { _ in }) {
    let show = { [weak self] in
      guard let self else { return }
      selectedIndex = 0
      guard let nav = viewControllers?.first as? UINavigationController else { return }
      nav.popToRootViewController(animated: false)
      if let chat = nav.viewControllers.first as? ChatController { then(chat) }
    }
    if presentedViewController != nil {
      dismiss(animated: true, completion: show)
    } else {
      show()
    }
  }
  func sendRadar(_ text: String, updateID: String) {
    showPersonalChat { $0.sendRadar(text, updateID: updateID) }
  }
  func replyRadar(_ item: RadarItem) {
    showPersonalChat { $0.reply(to: item) }
  }
  func ask(_ text: String) {
    selectedIndex = 0
    if let nav = selectedViewController as? UINavigationController,
      let chat = nav.viewControllers.first as? ChatController
    {
      nav.popToRootViewController(animated: true)
      chat.composer.setDraft(text)
      chat.composer.textView.becomeFirstResponder()
    }
  }
}

final class SignInController: UIViewController, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private let email = UITextField(), password = UITextField()
  private var nonce = ""
  private let stack = Theme.stack(spacing: 16)
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Negroni"
    view.backgroundColor = Theme.canvas
    email.placeholder = "Email"
    email.keyboardType = .emailAddress
    email.textContentType = .username
    email.autocapitalizationType = .none
    password.placeholder = "Password"
    password.isSecureTextEntry = true
    password.textContentType = .password
    for field in [email, password] {
      field.borderStyle = .roundedRect
      field.heightAnchor.constraint(equalToConstant: 48).isActive = true
    }
    let mascot = UIImageView(image: RobotAvatar.image(color: "", size: 80, main: true))
    mascot.contentMode = .scaleAspectFit
    mascot.heightAnchor.constraint(equalToConstant: 80).isActive = true
    stack.addArrangedSubview(mascot)
    stack.addArrangedSubview(Theme.label("Sign in to Negroni", style: .title1))
    stack.addArrangedSubview(email)
    stack.addArrangedSubview(password)
    stack.addArrangedSubview(
      Theme.button("Sign in", primary: true) { [weak self] in self?.signIn() })
    let apple = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
    apple.heightAnchor.constraint(equalToConstant: 48).isActive = true
    apple.addTarget(self, action: #selector(appleSignIn), for: .touchUpInside)
    stack.addArrangedSubview(apple)
    stack.addArrangedSubview(
      Theme.button("Create account") { [weak self] in
        self?.navigationController?.pushViewController(CreateAccountController(), animated: true)
      })
    stack.addArrangedSubview(
      Theme.button("Forgot password?") { [weak self] in self?.recoverPassword() })
    stack.addArrangedSubview(
      Theme.button(
        "Server",
        action: { [weak self] in
          self?.navigationController?.pushViewController(ServerController(), animated: true)
        }))
    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -30),
    ])
  }
  private func recoverPassword() {
    prompt("Account email", value: email.text ?? "", placeholder: "Email") { [weak self] email in
      Task {
        do {
          let config = try await API.shared.raw(path: "api/auth/capabilities")
          guard config["passwordReset"].bool, !config["resetUrl"].string.isEmpty else {
            throw APIError(
              status: 0, message: "Password recovery is not configured on this server.")
          }
          _ = try await API.shared.raw(
            path: "api/auth/request-password-reset",
            body: ["email": .string(email), "redirectTo": config["resetUrl"]])
          let alert = UIAlertController(
            title: "Check your email",
            message: "If this account exists, a recovery link will arrive shortly.",
            preferredStyle: .alert)
          alert.addAction(UIAlertAction(title: "OK", style: .default))
          self?.present(alert, animated: true)
        } catch { self?.showError(error) }
      }
    }
  }
  private func signIn() {
    Task {
      do {
        view.endEditing(true)
        try await API.shared.authenticate(email: email.text ?? "", password: password.text ?? "")
        password.text = ""
        SceneDelegate.restart()
      } catch { showError(error) }
    }
  }
  @objc private func appleSignIn() {
    nonce = UUID().uuidString + UUID().uuidString
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.email, .fullName]
    request.nonce = nonce
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    controller.performRequests()
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    view.window!
  }
  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let data = credential.identityToken, let token = String(data: data, encoding: .utf8)
    else { return }
    Task {
      do {
        try await API.shared.authenticateApple(token: token, nonce: nonce)
        SceneDelegate.restart()
      } catch { showError(error) }
    }
  }
  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) { if (error as? ASAuthorizationError)?.code != .canceled { showError(error) } }
}

final class ServerController: UIViewController {
  private let field = UITextField()
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Server"
    view.backgroundColor = Theme.canvas
    field.text = API.shared.base.absoluteString
    field.placeholder = "https://your-server.example"
    field.keyboardType = .URL
    field.autocapitalizationType = .none
    field.autocorrectionType = .no
    field.borderStyle = .roundedRect
    field.heightAnchor.constraint(equalToConstant: 48).isActive = true
    let stack = Theme.stack()
    stack.addArrangedSubview(Theme.label("Negroni server", style: .headline))
    stack.addArrangedSubview(field)
    stack.addArrangedSubview(
      Theme.button("Connect", primary: true) { [weak self] in
        guard let self else { return }
        Task {
          do {
            try await API.shared.changeServer(self.field.text ?? "")
            SceneDelegate.restart()
          } catch { self.showError(error) }
        }
      })
    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 28),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
    ])
  }
}

final class CreateAccountController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Create account"
    view.backgroundColor = Theme.canvas
    let name = UITextField()
    let email = UITextField()
    let password = UITextField()
    name.placeholder = "Name"
    name.textContentType = .name
    email.placeholder = "Email"
    email.textContentType = .emailAddress
    email.keyboardType = .emailAddress
    email.autocapitalizationType = .none
    password.placeholder = "Password"
    password.textContentType = .newPassword
    password.isSecureTextEntry = true
    let stack = Theme.stack(spacing: 16)
    for field in [name, email, password] {
      field.borderStyle = .roundedRect
      field.heightAnchor.constraint(equalToConstant: 48).isActive = true
      stack.addArrangedSubview(field)
    }
    let submit = Theme.button("Create account", primary: true) { [weak self] in
      guard let self else { return }
      Task {
        do {
          try await API.shared.createAccount(
            email: email.text ?? "", password: password.text ?? "", name: name.text ?? "")
          password.text = ""
          SceneDelegate.restart()
        } catch { self.showError(error) }
      }
    }
    stack.addArrangedSubview(submit)
    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
    ])
  }
}
