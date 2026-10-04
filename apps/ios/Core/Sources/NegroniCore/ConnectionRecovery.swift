import Foundation

public enum ConnectionRecovery {
  public static func transient(_ error: Error, httpStatus: Int? = nil) -> Bool {
    if let httpStatus { return [502, 503, 504].contains(httpStatus) }
    guard let error = error as? URLError else { return false }
    return [.timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
            .dnsLookupFailed, .notConnectedToInternet].contains(error.code)
  }

  @MainActor
  public static func read<T>(
    operation: () async throws -> T,
    shouldRetry: (Error) -> Bool,
    timeout: TimeInterval = 45,
    sleep: (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
    now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
  ) async throws -> T {
    let deadline = now() + timeout
    var attempt = 0
    while true {
      try Task.checkCancellation()
      do { return try await operation() } catch {
        try Task.checkCancellation()
        let wait = HostVpn.backoff[min(attempt, HostVpn.backoff.count - 1)]
        guard shouldRetry(error), now() + wait < deadline else { throw error }
        attempt += 1
        try await sleep(wait)
      }
    }
  }
}
