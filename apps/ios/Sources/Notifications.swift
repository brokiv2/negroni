import NegroniCore
import UIKit
import UserNotifications

@MainActor final class Notifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notifications()
  func configure() {
    UNUserNotificationCenter.current().delegate = self
    Task {
      let settings = await UNUserNotificationCenter.current().notificationSettings()
      if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
      {
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }
  func request() async throws {
    let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [
      .alert, .badge, .sound,
    ])
    guard granted else {
      throw APIError(status: 0, message: "Notifications are disabled in iOS Settings.")
    }
    UIApplication.shared.registerForRemoteNotifications()
  }
  func register(_ data: Data) {
    let token = data.map { String(format: "%02x", $0) }.joined()
    #if DEBUG
      let environment = "development"
    #else
      let environment = "production"
    #endif
    Task {
      _ = try? await API.shared.rpc(
        "notifications/registerPush",
        ["provider": "apns", "token": .string(token), "environment": .string(environment)])
    }
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions { [.banner, .list] }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    let botID = info["botId"] as? String ?? info["rakazo.botId"] as? String
    let groupID = info["groupId"] as? String
    await MainActor.run {
      guard
        let tabs = (UIApplication.shared.connectedScenes.first?.delegate as? SceneDelegate)?.window?
          .rootViewController as? MainTabController
      else { return }
      tabs.selectedIndex = 0
      guard let nav = tabs.selectedViewController as? UINavigationController else { return }
      if let groupID {
        nav.pushViewController(
          ChatController(target: ["groupId": .string(groupID)], title: "Group"), animated: true)
      } else if let botID, botID != tabs.botID {
        nav.pushViewController(ChatController(target: ["botId": .string(botID)]), animated: true)
      }
    }
  }
}
