import XCTest

@testable import NegroniCore

@MainActor
final class HostVpnTests: XCTestCase {
  /// Fake clock: `sleep` advances time instead of waiting.
  private final class Clock {
    var time: TimeInterval = 0
    var waits: [TimeInterval] = []
    func sleep(_ seconds: TimeInterval) async throws {
      waits.append(seconds)
      time += seconds
    }
  }

  func testStatusDecodesWireValuesAndTreatsUnknownAsUnavailable() {
    XCTAssertEqual(
      HostVpnStatus(["state": "connected", "switching": false]),
      HostVpnStatus(state: .connected))
    XCTAssertEqual(
      HostVpnStatus(["state": "connecting", "switching": true]),
      HostVpnStatus(state: .connecting, switching: true))
    XCTAssertEqual(HostVpnStatus(["state": "disconnected"]).state, .disconnected)
    XCTAssertEqual(HostVpnStatus(["state": "bogus"]).state, .unavailable)
    XCTAssertEqual(HostVpnStatus(.null).state, .unavailable)
  }

  func testSettledRequiresTheWantedStableState() {
    XCTAssertTrue(HostVpn.settled(HostVpnStatus(state: .connected), enabled: true))
    XCTAssertFalse(HostVpn.settled(HostVpnStatus(state: .connected, switching: true), enabled: true))
    XCTAssertFalse(HostVpn.settled(HostVpnStatus(state: .disconnected), enabled: true))
    XCTAssertFalse(HostVpn.settled(HostVpnStatus(state: .connecting), enabled: nil))
    XCTAssertTrue(HostVpn.settled(HostVpnStatus(state: .disconnected), enabled: nil))
    XCTAssertTrue(HostVpn.failed(nil, enabled: false))
    XCTAssertTrue(HostVpn.failed(HostVpnStatus(state: .connected), enabled: false))
    XCTAssertFalse(HostVpn.failed(HostVpnStatus(state: .disconnected), enabled: false))
  }

  func testRowHidesWithoutWarpAndKeepsConnectingSwitchable() {
    XCTAssertNil(HostVpn.row(status: nil, target: nil))
    XCTAssertNil(HostVpn.row(status: HostVpnStatus(state: .unavailable), target: nil))
    XCTAssertEqual(
      HostVpn.row(status: HostVpnStatus(state: .unavailable), target: true),
      HostVpnRow(isOn: true, enabled: false, switching: true))
    XCTAssertEqual(
      HostVpn.row(status: HostVpnStatus(state: .connected), target: nil),
      HostVpnRow(isOn: true, enabled: true, switching: false))
    XCTAssertEqual(
      HostVpn.row(status: HostVpnStatus(state: .disconnected), target: nil),
      HostVpnRow(isOn: false, enabled: true, switching: false))
    XCTAssertEqual(
      HostVpn.row(status: HostVpnStatus(state: .connecting), target: nil),
      HostVpnRow(isOn: true, enabled: true, switching: true))
    XCTAssertEqual(
      HostVpn.row(status: HostVpnStatus(state: .connected, switching: true), target: nil),
      HostVpnRow(isOn: true, enabled: false, switching: true))
    XCTAssertEqual(
      HostVpn.row(status: HostVpnStatus(state: .connected), target: false),
      HostVpnRow(isOn: false, enabled: false, switching: true))
  }

  func testSwitchSkipsTunnelDropsAndStopsOnceSettled() async throws {
    let clock = Clock()
    var reads: [Result<HostVpnStatus, Error>] = [
      .failure(URLError(.networkConnectionLost)),
      .success(HostVpnStatus(state: .connecting, switching: true)),
      .success(HostVpnStatus(state: .connected)),
      .success(HostVpnStatus(state: .disconnected)),
    ]
    var requested: [Bool] = []
    var seen: [HostVpnStatus] = []
    let result = try await HostVpn.switchVpn(
      enabled: true,
      setVpn: { requested.append($0); return true },
      readStatus: { try reads.removeFirst().get() },
      onStatus: { seen.append($0) },
      sleep: clock.sleep, now: { clock.time })
    XCTAssertEqual(requested, [true])
    XCTAssertEqual(result, HostVpnStatus(state: .connected))
    XCTAssertEqual(seen.map(\.state), [.connecting, .connected])
    XCTAssertEqual(clock.waits, [0.8, 1.2, 1.8])
    XCTAssertEqual(reads.count, 1)
  }

  func testSwitchGivesUpAtTheDeadlineWithRepeatedBackoff() async throws {
    let clock = Clock()
    let result = try await HostVpn.switchVpn(
      enabled: false, setVpn: { _ in true },
      readStatus: { throw URLError(.timedOut) },
      sleep: clock.sleep, now: { clock.time })
    XCTAssertNil(result)
    XCTAssertEqual(clock.waits, [0.8, 1.2, 1.8, 2.5, 3, 3, 3, 3])
    XCTAssertLessThanOrEqual(clock.time, HostVpn.settleTimeout)
    XCTAssertTrue(HostVpn.failed(result, enabled: false))
  }

  func testOverlappingSwitchWaitsForAnyStableState() async throws {
    let clock = Clock()
    var reads = [HostVpnStatus(state: .connected, switching: true), HostVpnStatus(state: .connected)]
    let result = try await HostVpn.switchVpn(
      enabled: false, setVpn: { _ in false },
      readStatus: { reads.removeFirst() },
      sleep: clock.sleep, now: { clock.time })
    XCTAssertEqual(result, HostVpnStatus(state: .connected))
    XCTAssertTrue(HostVpn.failed(result, enabled: false))
  }

  func testRejectedSetVpnThrowsWithoutPolling() async {
    let clock = Clock()
    struct Unavailable: Error {}
    do {
      _ = try await HostVpn.switchVpn(
        enabled: true, setVpn: { _ in throw Unavailable() },
        readStatus: { XCTFail("No status reads after a rejected switch"); return HostVpnStatus(state: .connected) },
        sleep: clock.sleep, now: { clock.time })
      XCTFail("Expected the rejection to propagate")
    } catch {
      XCTAssertTrue(error is Unavailable)
    }
    XCTAssertTrue(clock.waits.isEmpty)
  }
}
