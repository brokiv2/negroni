import Foundation

public struct ResponseUIStateConflict: Error, Sendable { public init() {} }

/// Serial, versioned state writes. Retained by the thread so scrolling cannot discard a draft.
@MainActor public final class ResponseUIState {
  public private(set) var document: ResponseUI
  public private(set) var state: [String: JSON]
  public private(set) var error: String?
  public private(set) var saving = false
  public var dirty: Bool { state != document.state }
  public var onChange: (() -> Void)?
  private var remote: ResponseUI
  private let save: (Int, [String: JSON]) async throws -> ResponseUI
  private var timer: Task<Void, Never>?
  private var flight: Task<Void, Never>?
  private var failed: (revision: Int, state: [String: JSON])?
  public init(
    _ document: ResponseUI, save: @escaping (Int, [String: JSON]) async throws -> ResponseUI
  ) {
    self.document = document
    self.remote = document
    self.state = document.state
    self.save = save
  }
  @discardableResult public func change(_ next: [String: JSON]) -> Bool {
    guard document.complete, document.accepts(next) else { return false }
    state = next
    onChange?()
    schedule()
    return true
  }
  public func receive(_ next: ResponseUI) {
    guard next.id == document.id else { return }
    if !document.complete {
      document = next
      remote = next
      state = next.state
      onChange?()
      return
    }
    guard next.revision > document.revision, next.revision >= remote.revision else { return }
    remote = next
    if saving { return }
    timer?.cancel()
    if let failed, next.revision == failed.revision + 1, next.state == failed.state {
      document = next
      self.failed = nil
      error = nil
      onChange?()
      if dirty { schedule() }
      return
    }
    if dirty {
      error = "conflict"
    } else {
      document = next
      state = next.state
    }
    onChange?()
  }
  private func schedule() {
    timer?.cancel()
    guard error == nil else { return }
    timer = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      await self?.flush()
    }
  }
  public func flush() async {
    timer?.cancel()
    timer = nil
    if let flight {
      await flight.value
      return
    }
    guard error == nil, document.complete, dirty || failed != nil else { return }
    saving = true
    flight = Task { [self] in
      while error == nil && (dirty || failed != nil) {
        let attempt = failed ?? (document.revision, state)
        do {
          let result = try await save(attempt.revision, attempt.state)
          guard result.id == document.id, result.revision == attempt.revision + 1,
            result.state == attempt.state
          else { throw URLError(.cannotParseResponse) }
          document = result
          failed = nil
          if remote.revision > result.revision {
            if dirty {
              error = "conflict"
            } else {
              document = remote
              state = remote.state
            }
          }
        } catch {
          failed = attempt
          self.error = error is ResponseUIStateConflict ? "conflict" : "save"
        }
        onChange?()
      }
      saving = false
      flight = nil
      onChange?()
    }
    onChange?()
    await flight?.value
  }
  public func retry() async {
    guard error == "save" else { return }
    error = nil
    await flush()
  }
  public func reload(_ next: ResponseUI) {
    guard !saving, next.id == document.id else { return }
    timer?.cancel()
    document = next
    remote = next
    state = next.state
    error = nil
    failed = nil
    onChange?()
  }
}
