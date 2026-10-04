import Foundation
import NegroniCore
import Security

struct APIError: LocalizedError {
  let status: Int
  let message: String
  var errorDescription: String? { message }
}

enum Keychain {
  private static let service = "negroni.native"
  static func read(_ key: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: key, kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func legacy(_ key: String) -> String? {
    for service in ["app:no-auth", "app"] {
      let encoded = Data(key.utf8)
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: encoded, kSecAttrGeneric as String: encoded,
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var item: CFTypeRef?
      if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
        let data = item as? Data
      {
        return String(data: data, encoding: .utf8)
      }
    }
    return nil
  }
  static func save(_ value: String, key: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
    let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
    let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if update == errSecItemNotFound {
      let add = query.merging(attributes) { _, new in new }.merging([
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      ]) { _, new in new }
      guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else {
        throw APIError(status: 0, message: "Could not securely save this session.")
      }
    } else if update != errSecSuccess {
      throw APIError(status: 0, message: "Could not securely save this session.")
    }
  }
}

@MainActor final class API {
  static let shared = API()
  private let configuration: [String: String]
  private(set) var base: URL
  private(set) var token: String
  var spaceID = ""
  var consent: ((JSON) async -> Bool)?
  var sessionExpired: (() -> Void)?
  private let session: URLSession
  private init() {
    let path = Bundle.main.url(forResource: "ClientConfiguration", withExtension: "plist")
    configuration = path.flatMap { NSDictionary(contentsOf: $0) as? [String: String] } ?? [:]
    let fallback = configuration["APIBaseURL"] ?? "http://localhost:3100"
    let stored = Keychain.read("server") ?? Keychain.legacy("rakazo.api_base") ?? fallback
    base = Endpoint.normalize(stored) ?? Endpoint.normalize(fallback)!
    let tokenKey = "session:" + base.absoluteString
    if let native = Keychain.read(tokenKey) {
      token = native
    } else {
      token = Keychain.legacy("rakazo.session_token") ?? ""
      if !token.isEmpty { try? Keychain.save(token, key: tokenKey) }
    }
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 30
    config.timeoutIntervalForResource = 600
    config.waitsForConnectivity = false
    config.httpCookieStorage = nil
    session = URLSession(configuration: config)
  }
  private func request(path: String, body: JSON?, timeout: TimeInterval = 30, space: Bool = true)
    throws -> URLRequest
  {
    var request = URLRequest(url: base.appendingPathComponent(path))
    request.httpMethod = body == nil ? "GET" : "POST"
    request.timeoutInterval = timeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("rakazo://", forHTTPHeaderField: "Origin")
    // Tunnel credentials belong only to the configured gateway, never a custom host.
    if base.host == Endpoint.normalize(configuration["APIBaseURL"] ?? "")?.host,
      let key = configuration["TunnelKey"], !key.isEmpty
    {
      request.setValue(key, forHTTPHeaderField: "x-negroni-tunnel-key")
    }
    if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if space && !spaceID.isEmpty {
      request.setValue(spaceID, forHTTPHeaderField: "x-rakazo-space-id")
    }
    request.httpBody = try body?.encoded()
    return request
  }
  private func perform(_ request: URLRequest) async throws -> (JSON, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw APIError(status: 0, message: "No response from the server.")
    }
    guard data.count <= 16 * 1024 * 1024 else {
      throw APIError(status: 0, message: "The server response is too large.")
    }
    let json = (try? JSON.decode(data)) ?? .null
    guard (200..<300).contains(response.statusCode) else {
      let message = [
        json["json"]["message"].string, json["error"]["message"].string, json["message"].string,
        json["error"].string,
      ].first { !$0.isEmpty }
      throw APIError(
        status: response.statusCode,
        message: message ?? "Server unavailable (\(response.statusCode)). Try again.")
    }
    return (json, response)
  }
  /// `interactive: false` never asks for consent: a notification action in the background
  /// cannot show the alert, so a missing permission fails instead.
  func rpc(
    _ procedure: String, _ body: JSON = [:], requireConsent: Bool = true, interactive: Bool = true,
    timeout: TimeInterval = 30
  ) async throws -> JSON {
    let context = base
    let contextToken = token
    let contextSpace = spaceID
    if requireConsent {
      let uses: [JSON] =
        [
          "threads/send", "threads/answer", "threads/followUp", "artifacts/create",
          "routines/create", "routines/testRun",
        ].contains(procedure) || (procedure == "routines/update" && body["active"] != false)
        ? ["model", "memory"] : []
      if !uses.isEmpty {
        try await ensureConsent(uses, target: body, interactive: interactive, timeout: timeout)
      }
    }
    guard base == context, token == contextToken, spaceID == contextSpace else {
      throw CancellationError()
    }
    do {
      let (response, _) = try await perform(
        request(path: "rpc/" + procedure, body: ["json": body], timeout: timeout))
      guard base == context, token == contextToken, spaceID == contextSpace else {
        throw CancellationError()
      }
      return response["json"].isNull ? response : response["json"]
    } catch let error as APIError
      where error.status == 401 && ["me", "spaces/list"].contains(procedure) && !spaceID.isEmpty
    {
      let (response, _) = try await perform(
        request(path: "rpc/" + procedure, body: ["json": body], space: false))
      spaceID = ""
      return response["json"].isNull ? response : response["json"]
    }
  }
  func ensureConsent(
    _ uses: [JSON], target: JSON = [:], interactive: Bool = true, timeout: TimeInterval = 30
  ) async throws {
    var input: JSON = ["uses": .array(uses)]
    for key in ["botId", "groupId"] where !target[key].isNull { input[key] = target[key] }
    let origin = base
    let sessionToken = token
    let scope = spaceID
    let status = try await rpc("aiConsent/status", input, requireConsent: false, timeout: timeout)
    for recipient in status["recipients"].array
    where !recipient["allowed"].bool && uses.contains(recipient["use"]) {
      guard interactive else {
        throw APIError(status: 0, message: "Open Negroni to allow AI data sharing.")
      }
      guard await consent?(recipient) == true, base == origin, token == sessionToken,
        spaceID == scope
      else { throw CancellationError() }
      _ = try await rpc(
        "aiConsent/allow",
        ["scope": status["scope"], "version": status["version"], "keys": [recipient["key"]]],
        requireConsent: false)
    }
  }
  func authenticate(email: String, password: String) async throws {
    try await authenticate(
      path: "email", body: ["email": .string(email), "password": .string(password)])
  }
  func authenticateApple(token: String, nonce: String) async throws {
    try await authenticate(
      path: "social",
      body: ["provider": "apple", "idToken": ["token": .string(token), "nonce": .string(nonce)]])
  }
  func createAccount(email: String, password: String, name: String) async throws {
    _ = try await raw(
      path: "api/auth/sign-up/email",
      body: ["email": .string(email), "password": .string(password), "name": .string(name)])
    try await authenticate(email: email, password: password)
  }
  func clearCredentials() throws {
    try Keychain.save("", key: "session:" + base.absoluteString)
    invalidateSession()
  }
  private func authenticate(path: String, body: JSON) async throws {
    let (json, response) = try await perform(
      request(path: "api/auth/sign-in/" + path, body: body, space: false))
    var value = json["token"].string
    if value.isEmpty { value = json["session"]["token"].string }
    if value.isEmpty, let header = response.value(forHTTPHeaderField: "Set-Cookie"),
      let match = header.range(
        of: "(?:__Secure-)?better-auth\\.session_token=([^;,]+)", options: .regularExpression)
    {
      value =
        String(header[match]).components(separatedBy: "=").dropFirst().joined(separator: "=")
        .removingPercentEncoding ?? ""
    }
    guard !value.isEmpty else {
      throw APIError(status: 0, message: "Sign-in did not return a session.")
    }
    try Keychain.save(value, key: "session:" + base.absoluteString)
    token = value
    spaceID = ""
  }
  func changeServer(_ value: String) async throws {
    guard let next = Endpoint.normalize(value) else {
      throw APIError(
        status: 0, message: "Enter a server address, for example https://your-server.example")
    }
    var probe = URLRequest(url: next.appendingPathComponent("health"))
    probe.timeoutInterval = 10
    let (data, response) = try await URLSession.shared.data(for: probe)
    guard let response = response as? HTTPURLResponse, response.statusCode == 200,
      let health = try? JSON.decode(data), health["ok"].bool || health["status"].string == "ok"
    else { throw APIError(status: 0, message: "Negroni did not respond at this address.") }
    try Keychain.save(next.absoluteString, key: "server")
    base = next
    spaceID = ""
    token = Keychain.read("session:" + next.absoluteString) ?? ""
  }
  func invalidateSession() {
    token = ""
    spaceID = ""
  }
  func signOut() async throws {
    _ = try? await rpc("notifications/unregisterPush")
    _ = try await perform(request(path: "api/auth/sign-out", body: [:]))
    try Keychain.save("", key: "session:" + base.absoluteString)
    invalidateSession()
  }
  func subscribe(target: JSON, cursor: Int, event: @escaping @MainActor (JSON) -> Void) async throws
  {
    var req = try request(
      path: "rpc/threads/subscribe",
      body: ["json": target.merging(["cursor": .number(Double(cursor))])], timeout: 300)
    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    let (bytes, response) = try await session.bytes(for: req)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw APIError(
        status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: "Connection interrupted")
    }
    var decoder = SSEDecoder()
    for try await byte in bytes {
      try Task.checkCancellation()
      if let next = decoder.consume(byte: byte) { event(next) }
    }
  }
  func uploadFile(url: URL, name: String, mime: String, target: JSON) async throws -> JSON {
    let origin = base
    let sessionToken = token
    let scope = spaceID
    let limits = try await raw(path: "api/artifacts/limits")
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0, size <= limits["maxBytes"].int else {
      throw APIError(
        status: 413,
        message: "This server accepts files up to \(limits["maxBytes"].int / 1024 / 1024) MB.")
    }
    var req = try request(path: "api/artifacts/upload", body: nil, timeout: 600)
    var components = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
    components.queryItems =
      target.dictionary.map { URLQueryItem(name: $0.key, value: $0.value.string) }
      + [URLQueryItem(name: "name", value: name), URLQueryItem(name: "mimeType", value: mime)]
    req.url = components.url
    req.httpMethod = "POST"
    req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    req.setValue(String(size), forHTTPHeaderField: "Content-Length")
    let (data, response) = try await session.upload(for: req, fromFile: url)
    guard base == origin, token == sessionToken, spaceID == scope else { throw CancellationError() }
    let result = try JSON.decode(data)
    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode)
    else {
      throw APIError(
        status: (response as? HTTPURLResponse)?.statusCode ?? 0,
        message: result["error"].string.isEmpty
          ? "Upload failed. Try again." : result["error"].string)
    }
    return result
  }
  func downloadFile(id: String, name: String) async throws -> URL {
    let origin = base
    let sessionToken = token
    let scope = spaceID
    let req = try request(path: "api/artifacts/" + id + "/content", body: nil, timeout: 600)
    let (temporary, response) = try await session.download(for: req)
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard base == origin, token == sessionToken, spaceID == scope else { throw CancellationError() }
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw APIError(
        status: (response as? HTTPURLResponse)?.statusCode ?? 0,
        message: "This file could not be opened. Try again.")
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let safeName = URL(fileURLWithPath: name).lastPathComponent
    let url = directory.appendingPathComponent(safeName.isEmpty ? "Attachment" : safeName)
    try FileManager.default.moveItem(at: temporary, to: url)
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    return url
  }
  func transcribe(_ data: Data) async throws -> String {
    guard data.count <= 8 * 1024 * 1024 else {
      throw APIError(status: 0, message: "This recording is too long. Try a shorter one.")
    }
    try await ensureConsent(["voice"])
    let (json, _) = try await perform(
      request(
        path: "api/voice/transcribe",
        body: ["audioBase64": .string(data.base64EncodedString()), "mimeType": "audio/mp4"],
        timeout: 70))
    return json["text"].string
  }
  func raw(path: String, body: JSON? = nil) async throws -> JSON {
    try await perform(request(path: path, body: body)).0
  }
}
