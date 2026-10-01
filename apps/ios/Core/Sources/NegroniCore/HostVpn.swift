import Foundation

/// `computer/vpnStatus`: the host Mac's WARP state, readable only by the deployment owner.
public struct HostVpnStatus: Equatable, Sendable {
  public enum State: String, Sendable { case connected, disconnected, connecting, unavailable }
  public var state: State
  /// A toggle is scheduled or running on the host.
  public var switching: Bool
  public init(state: State, switching: Bool = false) {
    self.state = state
    self.switching = switching
  }
  public init(_ json: JSON) {
    state = State(rawValue: json["state"].string) ?? .unavailable
    switching = json["switching"].bool
  }
}

/// What the Settings → Computer row shows for a status and an in-flight toggle target.
public struct HostVpnRow: Equatable, Sendable {
  public var isOn: Bool
  /// Only a running toggle disables the switch; `connecting` stays switchable so it can be turned off.
  public var enabled: Bool
  public var switching: Bool
}

/// Mirrors `packages/core/src/host-vpn.ts` (`switchHostVpn`).
public enum HostVpn {
  /// How long the client keeps reading status after a switch while the tunnel reconnects.
  public static let settleTimeout: TimeInterval = 20
  /// Waits between status reads; the last value repeats until the deadline.
  public static let backoff: [TimeInterval] = [0.8, 1.2, 1.8, 2.5, 3.0]

  /// True once the host finished switching and reports the wanted state (`nil`: any stable state).
  public static func settled(_ status: HostVpnStatus, enabled: Bool?) -> Bool {
    if status.switching { return false }
    guard let enabled else { return status.state == .connected || status.state == .disconnected }
    return status.state == (enabled ? .connected : .disconnected)
  }

  /// True when the switch did not end in the wanted state before the deadline.
  public static func failed(_ settled: HostVpnStatus?, enabled: Bool) -> Bool {
    settled?.state != (enabled ? .connected : .disconnected)
  }

  /// `nil` hides the row: no status (not the owner, or unreachable) or no WARP on the host.
  public static func row(status: HostVpnStatus?, target: Bool?) -> HostVpnRow? {
    guard let status, status.state != .unavailable || target != nil else { return nil }
    let busy = target != nil || status.switching
    return HostVpnRow(
      isOn: target ?? (status.state != .disconnected), enabled: !busy,
      switching: busy || status.state == .connecting)
  }

  /// Asks the host to switch, then reads status with backoff until it settles. The switch drops
  /// the phone-to-Mac tunnel for a few seconds, so failed reads in between are skipped. Returns
  /// the last status read, or `nil` when none came back before the deadline. Cancellation stops
  /// the reads. A failed `setVpn` throws; nothing was scheduled then. Runs on the main actor so
  /// `onStatus` can update the interface directly.
  @MainActor
  public static func switchVpn(
    enabled: Bool,
    setVpn: (Bool) async throws -> Bool,
    readStatus: () async throws -> HostVpnStatus,
    onStatus: (HostVpnStatus) -> Void = { _ in },
    timeout: TimeInterval = settleTimeout,
    sleep: (TimeInterval) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64($0 * 1e9)) },
    now: () -> TimeInterval = { Date().timeIntervalSinceReferenceDate }
  ) async throws -> HostVpnStatus? {
    let accepted = try await setVpn(enabled)
    // Not accepted: another switch is running, so wait for whatever it settles on.
    let target: Bool? = accepted ? enabled : nil
    let deadline = now() + timeout
    var last: HostVpnStatus?
    var attempt = 0
    while !Task.isCancelled {
      let wait = backoff[min(attempt, backoff.count - 1)]
      attempt += 1
      if now() + wait > deadline { break }
      do { try await sleep(wait) } catch { break }
      if Task.isCancelled { break }
      guard let status = try? await readStatus() else { continue }
      if Task.isCancelled { break }
      last = status
      onStatus(status)
      if settled(status, enabled: target) { break }
    }
    return last
  }
}
