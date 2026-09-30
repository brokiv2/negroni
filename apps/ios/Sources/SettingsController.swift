import AuthenticationServices
import NegroniCore
import SafariServices
import UIKit

final class SettingsController: ListController {
  let botID: String
  init(botID: String) {
    self.botID = botID
    super.init(title: "Settings")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    sections = [
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
      ]),
      ListSection(rows: [
        ListRow(
          title: "Account", symbol: "person.crop.circle",
          action: { [weak self] in self?.push(AccountController()) },
          accessory: .disclosureIndicator)
      ]),
    ]
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
  private var connections: [JSON] = [], catalog: [JSON] = [], query = "", catalogError = false
  private let search = UISearchController(searchResultsController: nil)
  init() { super.init(title: "Connections") }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    search.searchResultsUpdater = self
    search.obscuresBackgroundDuringPresentation = false
    search.searchBar.placeholder = "Search apps"
    navigationItem.searchController = search
  }
  override func load() async throws {
    async let catalogRequest = API.shared.rpc("connections/catalog")
    connections = try await API.shared.rpc("connections/list").array
    render()
    do {
      catalog = try await catalogRequest.array
      catalogError = false
    } catch {
      if Task.isCancelled { throw error }
      catalogError = true
    }
    render()
  }
  func updateSearchResults(for searchController: UISearchController) {
    query = searchController.searchBar.text ?? ""
    render()
  }
  private func render() {
    let saved = connections.filter {
      query.isEmpty
        || ($0["displayName"].string + $0["provider"].string).localizedCaseInsensitiveContains(
          query)
    }.map { connection in
      let app = catalog.first {
        $0["slug"] == connection["provider"] && $0["connectorId"] == connection["connectorId"]
      }
      let service = app?["name"].string ?? connection["provider"].string.capitalized
      let name = connection["displayName"].string
      let state =
        [
          "connected": "Connected", "pending": "Finish connecting", "revoked": "Disconnected",
          "error": "Needs attention",
        ][connection["status"].string] ?? ""
      let rename: () -> Void = { [weak self] in
        self?.prompt("Account name", value: name) { [weak self] value in
          self?.mutate(
            "connections/rename", ["connectionId": connection["id"], "displayName": .string(value)])
        }
      }
      let remove: () -> Void = { [weak self] in self?.removeConnection(connection) }
      return ListRow(
        title: service,
        detail: [name == connection["provider"].string ? "" : name, state].filter { !$0.isEmpty }
          .joined(separator: " · "),
        symbol: "app", imageURL: app?["logo"].string,
        iconRequest: [
          "connectorId": connection["connectorId"], "provider": connection["provider"],
        ],
        action: { [weak self] in
          guard let self else { return }
          let sheet = UIAlertController(title: service, message: name, preferredStyle: .actionSheet)
          sheet.addAction(UIAlertAction(title: "Rename", style: .default) { _ in rename() })
          if connection["status"].string == "pending" {
            sheet.addAction(
              UIAlertAction(title: "Check connection", style: .default) { [weak self] _ in
                self?.finishConnection(connection["id"])
              })
          }
          sheet.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in remove() })
          sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
          sheet.popoverPresentationController?.sourceView = self.view
          sheet.popoverPresentationController?.sourceRect = CGRect(
            x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1)
          self.present(sheet, animated: true)
        },
        menu: UIMenu(children: [
          UIAction(title: "Rename", image: UIImage(systemName: "pencil")) { _ in rename() },
          UIAction(title: "Delete", image: UIImage(systemName: "trash"), attributes: .destructive) {
            _ in remove()
          },
        ]), accessory: .disclosureIndicator, deleteAction: remove)
    }
    let apps = catalog.filter {
      query.isEmpty
        || ($0["name"].string + $0["description"].string).localizedCaseInsensitiveContains(query)
    }.prefix(80).map { app in
      ListRow(
        title: app["name"].string, detail: app["description"].string, symbol: "app",
        imageURL: app["logo"].string,
        iconRequest: ["connectorId": app["connectorId"], "provider": app["slug"]],
        action: { [weak self] in self?.connect(app) })
    }

    sections = [
      ListSection(title: "Connected accounts", rows: saved),
      ListSection(
        title: "Add connection", rows: Array(apps),
        footer: catalogError
          ? "Could not load the app catalog. Pull to retry."
          : catalog.isEmpty ? "Loading apps…" : nil),
    ]
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
    presentConnection(app) { [weak self] _ in self?.reloadData() }
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
