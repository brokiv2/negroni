import NegroniCore
import SafariServices
import UIKit

final class ModelsController: ListController {
  private var catalog: [JSON] = [], credentials: [JSON] = [], routing: JSON = [:]
  init() { super.init(title: "Models") }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    async let all = API.shared.rpc("models/list")
    async let connected = API.shared.rpc("models/credentials")
    async let routes = API.shared.rpc("models/routing")
    async let choices = API.shared.rpc("models/choices")
    (credentials, routing, catalog) = try await (connected.array, routes, choices.array)
    render()
    catalog = try await all.array
    render()
  }
  private func label(_ route: JSON) -> String {
    catalog.first { $0["provider"] == route["provider"] && $0["id"] == route["modelId"] }?["label"]
      .string ?? route["modelId"].string
  }
  private func render() {
    let enabled = routing["enabled"].array.map { route in
      ListRow(
        title: label(route),
        detail: catalog.first { $0["provider"] == route["provider"] }?["providerName"].string
          ?? route["provider"].string, symbol: "checkmark.circle",
        action: { [weak self] in self?.openProvider(route["provider"].string) })
    }
    let roles: [(String, String)] = [
      ("conversation", "Default chat"), ("task", "Complex tasks"), ("router", "Auto router"),
    ]
    let roleRows = roles.map { key, title in
      ListRow(
        title: title, detail: routing[key].isNull ? "Default" : label(routing[key]),
        action: { [weak self] in self?.chooseRole(key, title: title) },
        accessory: .disclosureIndicator)
    }
    let ids = Set(catalog.map { $0["provider"].string } + credentials.map { $0["provider"].string })
      .sorted()
    let providers = ids.map { id in
      ListRow(
        title: catalog.first { $0["provider"].string == id }?["providerName"].string ?? id,
        detail: credentials.first { $0["provider"].string == id }?["label"].string ?? "",
        symbol: credentials.contains { $0["provider"].string == id }
          ? "checkmark.circle" : "plus.circle", action: { [weak self] in self?.openProvider(id) },
        accessory: .disclosureIndicator)
    }
    sections = [
      ListSection(title: "Enabled models", rows: enabled),
      ListSection(title: "Automatic selection", rows: roleRows),
      ListSection(title: "Providers", rows: providers),
    ]
  }
  private func openProvider(_ id: String) {
    push(
      ProviderController(
        provider: id, catalog: catalog.filter { $0["provider"].string == id },
        credential: credentials.first { $0["provider"].string == id }))
  }
  private func chooseRole(_ key: String, title: String) {
    let alert = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet)
    let select: (JSON) -> Void = { [weak self] route in
      guard let self else { return }
      var next = self.routing
      next[key] = route
      self.mutate("models/saveRouting", next)
    }
    alert.addAction(UIAlertAction(title: "Default", style: .default) { _ in select(.null) })
    for route in routing["enabled"].array {
      alert.addAction(UIAlertAction(title: label(route), style: .default) { _ in select(route) })
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.popoverPresentationController?.sourceView = view
    alert.popoverPresentationController?.sourceRect = CGRect(
      x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
    present(alert, animated: true)
  }
}

final class ProviderController: ListController, UISearchResultsUpdating {
  let provider: String, catalog: [JSON]
  var credential: JSON?
  private var routing: JSON = [:], query = ""
  private let search = UISearchController(searchResultsController: nil)
  init(provider: String, catalog: [JSON], credential: JSON?) {
    self.provider = provider
    self.catalog = catalog
    self.credential = credential
    super.init(title: catalog.first?["providerName"].string ?? provider)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    search.searchResultsUpdater = self
    search.obscuresBackgroundDuringPresentation = false
    search.searchBar.placeholder = "Search models"
    navigationItem.searchController = search
  }
  override func load() async throws {
    routing = try await API.shared.rpc("models/routing")
    credential = try await API.shared.rpc("models/credentials").array.first {
      $0["provider"].string == provider
    }
    render()
  }
  func updateSearchResults(for searchController: UISearchController) {
    query = searchController.searchBar.text ?? ""
    render()
  }
  private func render() {
    var connectRows = [
      ListRow(
        title: credential == nil ? "Connect with API key" : "Update API key", symbol: "key",
        action: { [weak self] in self?.connect() })
    ]
    if catalog.first?["auth"].string == "oauth" || catalog.first?["auth"].string == "both" {
      connectRows.append(
        ListRow(
          title: "Sign in with subscription", symbol: "person.crop.circle",
          action: { [weak self] in self?.oauth() }))
    }
    let models = catalog.filter {
      query.isEmpty
        || ($0["label"].string + $0["id"].string).localizedCaseInsensitiveContains(query)
    }.map { model in
      let route: JSON = ["provider": .string(provider), "modelId": model["id"]]
      let selected = routing["enabled"].array.contains(route)
      return ListRow(
        title: model["label"].string, detail: model["billing"].string,
        action: { [weak self] in
          guard let self else { return }
          if self.credential == nil {
            self.connect()
            return
          }
          var next = self.routing
          var enabled = next["enabled"].array
          if selected {
            enabled.removeAll { $0 == route }
            for role in ["conversation", "task", "router"] where next[role] == route {
              next[role] = .null
            }
          } else {
            enabled.append(route)
          }
          next["enabled"] = .array(enabled)
          self.mutate("models/saveRouting", next)
        }, accessory: selected ? .checkmark : .none)
    }
    sections = [
      ListSection(rows: connectRows), ListSection(title: "Available models", rows: models),
    ]
  }
  private func connect() {
    let alert = UIAlertController(
      title: "Connect \(title ?? provider)",
      message:
        "Connecting lets this provider process messages and files for the models you enable.",
      preferredStyle: .alert)
    alert.addTextField {
      $0.placeholder = "API key"
      $0.isSecureTextEntry = true
      $0.autocapitalizationType = .none
      $0.autocorrectionType = .no
    }
    if provider == "openai-compatible" {
      alert.addTextField {
        $0.placeholder = "https://api.example/v1"
        $0.keyboardType = .URL
        $0.autocapitalizationType = .none
      }
      alert.addTextField {
        $0.placeholder = "Model ID"
        $0.autocapitalizationType = .none
      }
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(
      UIAlertAction(title: "Connect", style: .default) { [weak self] _ in
        guard let self, let key = alert.textFields?.first?.text, !key.isEmpty else { return }
        var input: JSON = ["provider": .string(self.provider), "apiKey": .string(key)]
        if self.provider == "openai-compatible" {
          input["baseUrl"] = .string(alert.textFields?[1].text ?? "")
          input["modelId"] = .string(alert.textFields?[2].text ?? "")
        }
        self.mutate("models/connect", input)
      })
    present(alert, animated: true)
  }
  private func oauth() {
    push(ModelSignInController(provider: provider, modelID: catalog.first?["id"].string))
  }
}

final class ModelSignInController: ListController {
  private let provider: String
  private let modelID: String?
  private var attempt: JSON = [:]
  private var poll: Task<Void, Never>?
  private var complete = false
  init(provider: String, modelID: String?) {
    self.provider = provider
    self.modelID = modelID
    super.init(title: "Provider sign-in")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    if attempt["loginId"].string.isEmpty {
      var input: JSON = ["provider": .string(provider)]
      if let modelID { input["modelId"] = .string(modelID) }
      attempt = try await API.shared.rpc("models/beginOAuth", input)
    }
    var rows = [
      ListRow(title: "Open sign-in page", symbol: "safari", action: { [weak self] in self?.open() })
    ]
    if attempt["mode"].string == "device-code" {
      rows.insert(
        ListRow(
          title: attempt["userCode"].string, detail: "Tap to copy your sign-in code",
          symbol: "doc.on.doc",
          action: { [weak self] in
            UIPasteboard.general.string = self?.attempt["userCode"].string
          }), at: 0)
      startPolling()
    } else {
      rows.append(
        ListRow(
          title: "Enter authorization code", symbol: "key",
          action: { [weak self] in
            self?.prompt("Authorization code", secure: true) { [weak self] code in
              guard let self else { return }
              Task {
                do {
                  _ = try await API.shared.rpc(
                    "models/submitOAuthCode",
                    ["loginId": self.attempt["loginId"], "code": .string(code)])
                  self.startPolling()
                } catch { self.showError(error) }
              }
            }
          }))
    }
    sections = [ListSection(rows: rows)]
  }
  private func open() {
    guard let url = URL(string: attempt["verificationUri"].string), url.scheme == "https" else {
      return
    }
    present(SFSafariViewController(url: url), animated: true)
  }
  private func startPolling() {
    guard poll == nil, !complete else { return }
    let deadline = Date().addingTimeInterval(Double(attempt["expiresInSeconds"].int))
    poll = Task { [weak self] in
      guard let self else { return }
      defer { poll = nil }
      do {
        while !Task.isCancelled && Date() < deadline {
          let status = try await API.shared.rpc(
            "models/completeOAuth", ["loginId": attempt["loginId"]])
          if status["status"].string == "ready" {
            _ = try await API.shared.rpc("models/finishOAuth", ["loginId": attempt["loginId"]])
            complete = true
            if presentedViewController != nil { dismiss(animated: true) }
            navigationController?.popViewController(animated: true)
            return
          }
          if status["status"].string == "error" {
            throw APIError(status: 0, message: status["error"].string)
          }
          try await Task.sleep(for: .seconds(2))
        }
        if !Task.isCancelled {
          throw APIError(
            status: 0, message: "Sign-in expired. Return to the provider and try again.")
        }
      } catch { showError(error) }
    }
  }
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Presenting the provider browser must not cancel its pending sign-in.
    if isMovingFromParent || navigationController == nil {
      poll?.cancel()
      if !complete, !attempt["loginId"].string.isEmpty {
        let id = attempt["loginId"]
        Task { _ = try? await API.shared.rpc("models/cancelOAuth", ["loginId": id]) }
      }
    }
  }
}
