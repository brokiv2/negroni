import AuthenticationServices
import NegroniCore
import SafariServices
import UIKit

final class SettingsController: ListController {
  let botID: String
  // Settings → Computer: the host Mac's WARP switch, shown to the deployment owner only.
  private var vpnStatus: HostVpnStatus?
  private var vpnTarget: Bool?
  private var vpnError: String?
  private static let vpnReadTimeout: TimeInterval = 5
  private var vpnStatusTask: Task<Void, Never>?
  init(botID: String) {
    self.botID = botID
    super.init(title: "Settings")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    vpnStatusTask?.cancel()
    vpnStatusTask = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(3)) } catch { return }
        guard let self, !Task.isCancelled else { return }
        try? await self.load()
      }
    }
  }
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    vpnStatusTask?.cancel()
    vpnStatusTask = nil
  }
  override func load() async throws {
    if sections.isEmpty { render() }
    // A running switch owns the status; its reads go through a tunnel that is reconnecting.
    guard vpnTarget == nil else { return }
    do {
      let status = HostVpnStatus(
        try await API.shared.rpc("computer/vpnStatus", timeout: Self.vpnReadTimeout))
      guard !Task.isCancelled, vpnTarget == nil else { return }
      let changed = vpnStatus != status || (vpnError != nil && HostVpn.settled(status, enabled: nil))
      vpnStatus = status
      if HostVpn.settled(status, enabled: nil) { vpnError = nil }
      if changed { render() }
    } catch let error as APIError where (400..<500).contains(error.status) {
      vpnStatus = nil  // FORBIDDEN for everyone but the deployment owner.
      render()
    } catch {
      return  // Transient: keep the last known state.
    }
  }
  private func render() {
    var result = [
      ListSection(rows: [
        ListRow(
          title: "Assistant", detail: "Name, personality and memory", symbol: "face.smiling",
          action: { [weak self] in
            guard let self else { return }
            self.push(AssistantSettingsController(botID: self.botID))
          }, accessory: .disclosureIndicator),
        ListRow(
          title: "Connections", symbol: "link",
          action: { [weak self] in self?.push(ConnectionsController()) },
          accessory: .disclosureIndicator),
        ListRow(
          title: "Models", symbol: "cpu", action: { [weak self] in self?.push(ModelsController()) },
          accessory: .disclosureIndicator),
        ListRow(
          title: "Voice", symbol: "waveform",
          action: { [weak self] in self?.push(VoiceSettingsController()) },
          accessory: .disclosureIndicator),
        ListRow(
          title: "Computer", symbol: "desktopcomputer",
          action: { [weak self] in
            guard let self else { return }
            self.push(ComputerController(botID: self.botID))
          }, accessory: .disclosureIndicator),
      ])
    ]
    if let vpn = HostVpn.row(status: vpnStatus, target: vpnTarget) {
      result.append(
        ListSection(
          title: "Computer",
          rows: [
            ListRow(
              title: "WARP VPN", detail: vpn.switching ? "Switching…" : "",
              symbol: "lock.shield", switchValue: vpn.isOn, switchEnabled: vpn.enabled,
              onSwitch: { [weak self] enabled in self?.switchVpn(enabled) })
          ], footer: vpnError))
    }
    result.append(
      ListSection(rows: [
        ListRow(
          title: "Account", symbol: "person.crop.circle",
          action: { [weak self] in self?.push(AccountController()) },
          accessory: .disclosureIndicator)
      ]))
    sections = result
  }
  private func switchVpn(_ enabled: Bool) {
    guard vpnTarget == nil else { return }
    vpnTarget = enabled
    vpnError = nil
    render()
    Task { [weak self] in
      var failure: String?
      do {
        let settled = try await HostVpn.switchVpn(
          enabled: enabled,
          setVpn: { try await API.shared.rpc("computer/setVpn", ["enabled": .bool($0)])["accepted"].bool },
          readStatus: {
            HostVpnStatus(
              try await API.shared.rpc("computer/vpnStatus", timeout: Self.vpnReadTimeout))
          },
          onStatus: { [weak self] status in
            self?.vpnStatus = status
            self?.render()
          })
        if HostVpn.failed(settled, enabled: enabled) { failure = "Could not switch the VPN" }
      } catch {
        failure = error.localizedDescription.isEmpty ? "Could not switch the VPN" : error.localizedDescription
      }
      guard let self, !Task.isCancelled else { return }
      self.vpnTarget = nil
      self.vpnError = failure
      self.render()
    }
  }
}
final class AccountController: ListController {
  private var appleLink: AppleAccountLink?
  init() { super.init(title: "Account") }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    let me = try await API.shared.rpc("me")
    sections = [
      ListSection(rows: [
        ListRow(title: me["name"].string, detail: me["email"].string, symbol: "person.crop.circle"),
        ListRow(
          title: "Connect Apple ID", symbol: "apple.logo",
          action: { [weak self] in
            guard let self else { return }
            self.appleLink = AppleAccountLink(presenter: self)
            self.appleLink?.start()
          }),
        ListRow(
          title: "Server", detail: API.shared.base.host ?? "", symbol: "server.rack",
          action: { [weak self] in self?.push(ServerController()) }, accessory: .disclosureIndicator
        ),
        ListRow(
          title: "Notifications", symbol: "bell",
          action: { [weak self] in
            Task {
              do { try await Notifications.shared.request() } catch { self?.showError(error) }
            }
          }),
        ListRow(
          title: "AI data sharing", symbol: "hand.raised",
          action: { [weak self] in self?.push(ConsentController()) },
          accessory: .disclosureIndicator),
      ]),
      ListSection(
        rows: [
          ListRow(title: "Sign out", action: { [weak self] in self?.signOut() }),
          ListRow(
            title: "Delete account", color: .systemRed,
            action: { [weak self] in self?.deleteAccount() }),
        ],
        footer:
          "Negroni \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""))"
      ),
    ]
  }
  private func deleteAccount() {
    let alert = UIAlertController(
      title: "Delete account permanently?",
      message:
        "This deletes your assistants, conversations, memories, files and connections. It cannot be undone.",
      preferredStyle: .alert)
    alert.addTextField {
      $0.placeholder = "Password"
      $0.isSecureTextEntry = true
      $0.textContentType = .password
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(
      UIAlertAction(title: "Delete account", style: .destructive) { [weak self] _ in
        guard let password = alert.textFields?.first?.text, !password.isEmpty else { return }
        Task {
          do {
            _ = try await API.shared.raw(
              path: "api/auth/delete-user", body: ["password": .string(password)])
            try API.shared.clearCredentials()
            SceneDelegate.restart()
          } catch { self?.showError(error) }
        }
      })
    present(alert, animated: true)
  }
  private func signOut() {
    let alert = UIAlertController(title: "Sign out?", message: nil, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(
      UIAlertAction(title: "Sign out", style: .destructive) { [weak self] _ in
        Task {
          do {
            try await API.shared.signOut()
            SceneDelegate.restart()
          } catch { self?.showError(error) }
        }
      })
    present(alert, animated: true)
  }
}
final class ConsentController: ListController {
  init() { super.init(title: "AI data sharing") }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    let status = try await API.shared.rpc("aiConsent/status")
    sections = [
      ListSection(
        rows: status["recipients"].array.map { recipient in
          ListRow(
            title: recipient["name"].string, detail: recipient["detail"].string,
            action: { [weak self] in
              guard let self else { return }
              if recipient["allowed"].bool {
                self.mutate("aiConsent/revoke", ["key": recipient["key"]])
              } else {
                Task {
                  do {
                    try await API.shared.ensureConsent([recipient["use"]])
                    self.reloadData()
                  } catch { self.showError(error) }
                }
              }
            }, accessory: recipient["allowed"].bool ? .checkmark : .none, lines: 0)
        })
    ]
  }
}
final class AssistantSettingsController: ListController {
  let botID: String
  init(botID: String) {
    self.botID = botID
    super.init(title: "Assistant")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    let bot = try await API.shared.rpc("bots/get", ["botId": .string(botID)])
    sections = [
      ListSection(rows: [
        ListRow(
          title: "Name", detail: bot["name"].string,
          action: { [weak self] in
            self?.prompt("Assistant name", value: bot["name"].string) { [weak self] value in
              guard let self else { return }
              self.mutate("bots/update", ["botId": .string(self.botID), "name": .string(value)])
            }
          }),
        ListRow(
          title: "Instructions", detail: bot["instructions"].string,
          action: { [weak self] in
            guard let self else { return }
            self.push(
              EditorController(title: "Instructions", text: bot["instructions"].string) { text in
                _ = try await API.shared.rpc(
                  "bots/update", ["botId": .string(self.botID), "instructions": .string(text)])
              })
          }, accessory: .disclosureIndicator),
        ListRow(
          title: "Memory", symbol: "brain",
          action: { [weak self] in
            guard let self else { return }
            self.push(MemoryController(botID: self.botID))
          }, accessory: .disclosureIndicator),
      ])
    ]
  }
}
final class EditorController: UIViewController {
  private let editor = UITextView(), initial: String, save: (String) async throws -> Void
  init(title: String, text: String, save: @escaping (String) async throws -> Void) {
    self.initial = text
    self.save = save
    super.init(nibName: nil, bundle: nil)
    self.title = title
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    editor.backgroundColor = Theme.canvas
    editor.textColor = Theme.ink
    editor.font = .preferredFont(forTextStyle: .body)
    editor.text = initial
    editor.textContainerInset = UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
    view.addSubview(editor)
    editor.pin(to: view)
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "Save",
      primaryAction: UIAction { [weak self] _ in
        guard let self else { return }
        Task {
          do {
            try await self.save(self.editor.text)
            self.navigationController?.popViewController(animated: true)
          } catch { self.showError(error) }
        }
      })
  }
}
final class MemoryController: ListController {
  let botID: String
  init(botID: String) {
    self.botID = botID
    super.init(title: "Memory")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    let memories = try await API.shared.rpc("memory/list", ["botId": .string(botID)])
    sections = [
      ListSection(
        rows: memories.array.map { memory in
          ListRow(
            title: memory["text"].string.isEmpty ? memory["content"].string : memory["text"].string,
            action: { [weak self] in
              self?.push(
                EditorController(title: "Memory", text: memory["content"].string) { text in
                  _ = try await API.shared.rpc(
                    "memory/update", ["documentId": memory["id"], "content": .string(text)])
                })
            }, accessory: .disclosureIndicator, lines: 3)
        }, footer: memories.array.isEmpty ? "Saved memories appear here." : nil)
    ]
  }
}

final class VoiceSettingsController: ListController {
  init() { super.init(title: "Voice") }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    async let c = API.shared.rpc("voice/catalog")
    async let s = API.shared.rpc("voice/status")
    let (catalog, status) = try await (c, s)
    sections = [
      ListSection(
        title: "Speech providers",
        rows: catalog.array.map { provider in
          ListRow(
            title: provider["name"].string, detail: provider["description"].string,
            action: { [weak self] in
              self?.prompt("\(provider["name"].string) API key", secure: true) { [weak self] key in
                self?.mutate("voice/connect", ["provider": provider["id"], "apiKey": .string(key)])
              }
            },
            menu: provider["id"] == status["provider"]
              ? UIMenu(children: [
                UIAction(title: "Choose voice", image: UIImage(systemName: "waveform")) {
                  [weak self] _ in self?.push(VoiceListController(provider: provider["id"].string))
                },
                UIAction(title: "Disconnect", attributes: .destructive) { [weak self] _ in
                  self?.confirmDelete("Disconnect this voice provider?") { [weak self] in
                    self?.mutate("voice/disconnect", ["provider": provider["id"]])
                  }
                },
              ]) : nil, accessory: provider["id"] == status["provider"] ? .checkmark : .none)
        },
        footer: status["transcribe"].bool
          ? "Dictation is ready." : "Connect a speech provider to use dictation.")
    ]
  }
}

final class ConnectionsController: ListController, UISearchResultsUpdating {
  private var connections: [JSON] = [], catalog: [JSON] = [], query = ""
  private let search = UISearchController(searchResultsController: nil)
  private let provider: String?
  private let browsing: Bool
  private var showDisconnected = false
  init(provider: String? = nil, browsing: Bool = false) {
    self.provider = provider
    self.browsing = browsing
    super.init(title: provider.map(Self.serviceName) ?? (browsing ? "Add app" : "Connections"))
  }
  required init?(coder: NSCoder) { fatalError() }
  private static func serviceName(_ value: String) -> String { ConnectedApp.name(value) }
  override func viewDidLoad() {
    super.viewDidLoad()
    search.searchResultsUpdater = self
    search.obscuresBackgroundDuringPresentation = false
    search.searchBar.placeholder = provider == nil ? "Search apps" : "Search accounts"
    navigationItem.searchController = search
    if !browsing && provider == nil {
      navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .add, primaryAction: UIAction { [weak self] _ in
        self?.push(ConnectionsController(browsing: true))
      })
    }
  }
  override func load() async throws {
    if browsing {
      catalog = try await API.shared.rpc("connections/catalog").array
    } else {
      connections = try await API.shared.rpc("connections/list").array
    }
    render()
    // Identity reads belong to the account detail, never block the app directory.
    if let provider {
      for account in connections.filter({ $0["provider"].string == provider && $0["status"].string == "connected" }) {
        if Task.isCancelled { return }
        if let updated = try? await API.shared.rpc("connections/complete", ["connectionId": account["id"]]),
           let index = connections.firstIndex(where: { $0["id"] == updated["id"] }) {
          connections[index] = updated
          render()
        }
      }
    }
  }
  func updateSearchResults(for searchController: UISearchController) {
    query = searchController.searchBar.text ?? ""
    render()
  }
  private func matches(_ value: String) -> Bool {
    query.isEmpty || value.localizedCaseInsensitiveContains(query)
  }
  private func label(_ account: JSON) -> String {
    let identity = account["accountLabel"].string
    return identity.isEmpty ? account["displayName"].string : identity
  }
  private func render() {
    if browsing {
      sections = [ListSection(rows: catalog.filter { matches($0["name"].string) }.map { app in
        ListRow(title: app["name"].string, symbol: "app", imageURL: app["logo"].string,
          iconRequest: ["connectorId": app["connectorId"], "provider": app["slug"]],
          action: { [weak self] in self?.connect(app) }, accessory: .disclosureIndicator)
      })]
      return
    }
    guard let provider else {
      let groups = Dictionary(grouping: connections.filter { $0["status"].string != "revoked" }, by: { $0["provider"].string })
      let rows = groups.keys.sorted { Self.serviceName($0) < Self.serviceName($1) }.compactMap { key -> ListRow? in
        let accounts = groups[key]!
        guard matches(Self.serviceName(key) + " " + accounts.map { label($0) }.joined(separator: " ")) else { return nil }
        let connected = accounts.filter { $0["status"].string == "connected" }.count
        let detail = connected == 0 ? "Needs attention" : "\(connected) " + (connected == 1 ? "account" : "accounts")
        return ListRow(title: Self.serviceName(key), detail: detail, symbol: "app",
          iconRequest: ["connectorId": accounts[0]["connectorId"], "provider": .string(key)],
          action: { [weak self] in self?.push(ConnectionsController(provider: key)) }, accessory: .disclosureIndicator)
      }
      sections = [ListSection(title: "Your apps", rows: rows,
        footer: rows.isEmpty ? "Connect an app with +." : nil)]
      // Old disconnected accounts remain removable, but never clutter Your apps.
      let revoked = connections.filter { $0["status"].string == "revoked" }
      if !revoked.isEmpty {
        sections.append(ListSection(rows: [ListRow(title: "Disconnected accounts", detail: String(revoked.count),
          action: { [weak self] in self?.showDisconnected.toggle(); self?.render() }, accessory: .disclosureIndicator)]))
        if showDisconnected { sections.append(ListSection(rows: revoked.filter { matches(label($0)) }.map(accountRow))) }
      }
      return
    }
    let accounts = connections.filter { $0["provider"].string == provider }
    let active = accounts.filter { $0["status"].string != "revoked" && matches(label($0)) }
    sections = [ListSection(title: "Connected accounts", rows: active.map(accountRow))]
    if let account = accounts.first {
      sections.append(ListSection(rows: [ListRow(title: "Connect another account", symbol: "plus",
        action: { [weak self] in
          self?.connect(["name": .string(Self.serviceName(provider)), "slug": .string(provider), "connectorId": account["connectorId"]])
        })]))
    }
  }
  private func accountRow(_ connection: JSON) -> ListRow {
    let name = label(connection)
    let rename: () -> Void = { [weak self] in
      self?.prompt("Account nickname", value: connection["displayName"].string) { [weak self] value in
        self?.mutate("connections/rename", ["connectionId": connection["id"], "displayName": .string(value)])
      }
    }
    let remove: () -> Void = { [weak self] in self?.removeConnection(connection) }
    let state = ["connected": "Connected", "pending": "Finish connecting", "revoked": "Disconnected", "error": "Needs attention"][connection["status"].string] ?? ""
    let nickname = connection["displayName"].string
    let generatedName = nickname.range(of: #"^.+\s+[0-9]+$"#, options: .regularExpression) != nil
    let detail = [nickname == name || generatedName ? "" : nickname, state].filter { !$0.isEmpty }.joined(separator: " · ")
    return ListRow(title: name, detail: detail, symbol: "person.crop.circle",
      action: { [weak self] in
        guard let self else { return }
        let sheet = UIAlertController(title: name, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Rename", style: .default) { _ in rename() })
        if connection["status"].string == "pending" {
          sheet.addAction(UIAlertAction(title: "Check connection", style: .default) { [weak self] _ in self?.finishConnection(connection["id"]) })
        }
        sheet.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in remove() })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        sheet.popoverPresentationController?.sourceView = self.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1)
        self.present(sheet, animated: true)
      }, menu: UIMenu(children: [
        UIAction(title: "Rename", image: UIImage(systemName: "pencil")) { _ in rename() },
        UIAction(title: "Delete", image: UIImage(systemName: "trash"), attributes: .destructive) { _ in remove() }
      ]), accessory: .disclosureIndicator, deleteAction: remove)
  }
  private func removeConnection(_ connection: JSON) {
    let remove = { [weak self] in
      guard let self else { return }
      Task {
        do {
          if connection["status"].string != "revoked" {
            _ = try await API.shared.rpc("connections/revoke", ["connectionId": connection["id"]])
          }
          _ = try await API.shared.rpc("connections/remove", ["connectionId": connection["id"]])
          self.reloadData()
        } catch { self.showError(error) }
      }
    }
    if connection["status"].string == "revoked" {
      remove()
    } else {
      confirmDelete("Disconnect and remove this account?", action: remove)
    }
  }
  private func connect(_ app: JSON) {
    presentConnection(app, reuseConnected: false) { [weak self] _ in self?.reloadData() }
  }
  private func finishConnection(_ id: JSON) {
    Task {
      do {
        _ = try await API.shared.rpc("connections/complete", ["connectionId": id])
        reloadData()
      } catch { showError(error, retry: { [weak self] in self?.finishConnection(id) }) }
    }
  }
}

@MainActor
final class AppleAccountLink: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private weak var presenter: UIViewController?
  private let nonce = UUID().uuidString + UUID().uuidString
  init(presenter: UIViewController) { self.presenter = presenter }
  func start() {
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.email, .fullName]
    request.nonce = nonce
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    controller.performRequests()
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    presenter!.view.window!
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
        _ = try await API.shared.raw(
          path: "api/auth/link-social",
          body: [
            "provider": "apple", "idToken": ["token": .string(token), "nonce": .string(nonce)],
          ])
        let alert = UIAlertController(
          title: "Apple ID connected", message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Done", style: .default))
        presenter?.present(alert, animated: true)
      } catch { presenter?.showError(error) }
    }
  }
  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) {
    if (error as? ASAuthorizationError)?.code != .canceled { presenter?.showError(error) }
  }
}

final class VoiceListController: ListController {
  let provider: String
  init(provider: String) {
    self.provider = provider
    super.init(title: "Voice")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    async let choices = API.shared.rpc("voice/voices", ["provider": .string(provider)])
    async let status = API.shared.rpc("voice/status")
    let (voices, current) = try await (choices, status)
    sections = [
      ListSection(
        rows: voices.array.map { voice in
          ListRow(
            title: voice["label"].string, detail: voice["description"].string,
            action: { [weak self] in
              guard let self else { return }
              self.mutate(
                "voice/setVoice", ["provider": .string(self.provider), "voiceId": voice["id"]])
            }, accessory: voice["id"] == current["voiceId"] ? .checkmark : .none)
        })
    ]
  }
}
