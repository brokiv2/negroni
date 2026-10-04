import XCTest

@testable import NegroniCore

@MainActor final class ConnectionRecoveryTests: XCTestCase {
  func testStartupRecoversFromTunnelDropsWithoutManualRefresh() async throws {
    var time: TimeInterval = 0
    var attempts = 0
    let value = try await ConnectionRecovery.read(
      operation: {
        attempts += 1
        if attempts < 3 { throw URLError(.networkConnectionLost) }
        return "ready"
      }, shouldRetry: { ConnectionRecovery.transient($0) },
      sleep: { time += $0 }, now: { time })
    XCTAssertEqual(value, "ready")
    XCTAssertEqual(attempts, 3)
    XCTAssertEqual(time, 2)
  }

  func testPersistentFailureStopsAtDeadline() async {
    var time: TimeInterval = 0
    do {
      _ = try await ConnectionRecovery.read(
        operation: { throw URLError(.cannotConnectToHost) },
        shouldRetry: { ConnectionRecovery.transient($0) },
        timeout: 10, sleep: { time += $0 }, now: { time })
      XCTFail("Expected connection failure")
    } catch { XCTAssertEqual((error as? URLError)?.code, .cannotConnectToHost) }
    XCTAssertLessThan(time, 10)
    XCTAssertGreaterThan(time, 7)
  }

  func testAuthErrorsAndCancellationNeverRetry() async {
    XCTAssertFalse(ConnectionRecovery.transient(URLError(.cancelled)))
    XCTAssertFalse(ConnectionRecovery.transient(URLError(.secureConnectionFailed)))
    XCTAssertFalse(ConnectionRecovery.transient(NSError(domain: "api", code: 401), httpStatus: 401))
    XCTAssertTrue(ConnectionRecovery.transient(NSError(domain: "api", code: 502), httpStatus: 502))
    var reads = 0
    do {
      _ = try await ConnectionRecovery.read(
        operation: { reads += 1; throw CancellationError() },
        shouldRetry: { ConnectionRecovery.transient($0) },
        sleep: { _ in XCTFail("Cancellation must not retry") })
      XCTFail("Expected cancellation")
    } catch { XCTAssertTrue(error is CancellationError) }
    XCTAssertEqual(reads, 1)
  }
}
