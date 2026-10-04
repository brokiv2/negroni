import UIKit
@preconcurrency import UserNotifications
import XCTest
@testable import Negroni

final class NotificationCallbackTests: XCTestCase {
  @MainActor
  func testForegroundCallbacksCompleteOnceOnTheMainThread() async throws {
    let delegate: UNUserNotificationCenterDelegate = Notifications()
    let center = UNUserNotificationCenter.current()
    for kind in [nil, "radar_draft"] as [String?] {
      let completed = expectation(description: "Presentation completed")
      completed.assertForOverFulfill = true
      let notification = try fixture(fields: kind.map { ["kind": $0] } ?? [:])
      DispatchQueue.global().async {
        XCTAssertFalse(Thread.isMainThread)
        delegate.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: { options in
          XCTAssertTrue(Thread.isMainThread)
          XCTAssertEqual(options, [.banner, .list])
          completed.fulfill()
        })
      }
      await fulfillment(of: [completed], timeout: 3)
    }
  }
  @MainActor
  func testBackgroundCallbacksCompleteOnceOnTheMainThread() async throws {
    let delegate: UNUserNotificationCenterDelegate = Notifications()
    let center = UNUserNotificationCenter.current()
    let cases: [([String: String], String)] = [
      ([:], UNNotificationDefaultActionIdentifier),
      (["botId": "bot-preview"], UNNotificationDismissActionIdentifier),
      (["botId": "bot-preview", "spaceId": "space-preview"], UNNotificationDefaultActionIdentifier),
      (["groupId": "group-preview", "spaceId": "other-space"], UNNotificationDefaultActionIdentifier),
      (["kind": "radar", "updateId": "missing-update", "spaceId": "space-preview"], "radar.later"),
    ]
    for (fields, action) in cases {
      let completed = expectation(description: "System response completed")
      completed.assertForOverFulfill = true
      let coder = NSKeyedArchiver(requiringSecureCoding: true)
      coder.encode(try fixture(fields: fields), forKey: "notification")
      coder.encode(action, forKey: "actionIdentifier")
      coder.finishEncoding()
      let decoder = try NSKeyedUnarchiver(forReadingFrom: coder.encodedData)
      let response = try XCTUnwrap(UNNotificationResponse(coder: decoder))
      XCTAssertEqual(response.actionIdentifier, action)
      XCTAssertEqual(response.notification.request.content.userInfo as? [String: String], fields)
      DispatchQueue.global().async {
        XCTAssertFalse(Thread.isMainThread)
        delegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: {
          XCTAssertTrue(Thread.isMainThread)
          completed.fulfill()
        })
      }
      await fulfillment(of: [completed], timeout: 3)
    }
  }
  private func fixture(fields: [String: String]) throws -> UNNotification {
    let content = UNMutableNotificationContent()
    content.userInfo = fields
    let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    let coder = NSKeyedArchiver(requiringSecureCoding: true)
    coder.encode(request, forKey: "request")
    coder.encode(Date(), forKey: "date")
    coder.finishEncoding()
    let decoder = try NSKeyedUnarchiver(forReadingFrom: coder.encodedData)
    return try XCTUnwrap(UNNotification(coder: decoder))
  }
}
