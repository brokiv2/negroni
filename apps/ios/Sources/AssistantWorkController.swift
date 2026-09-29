import NegroniCore
import UIKit

final class AssistantWorkController: ListController {
  private let target: JSON
  private var poll: Task<Void, Never>?
  private var previous: [JSON]?

  init(target: JSON) {
    self.target = target
    super.init(title: "Ongoing work")
  }
  required init?(coder: NSCoder) { fatalError() }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    poll?.cancel()
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(3))
        guard !Task.isCancelled, let self else { break }
        try? await load()
      }
    }
  }
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    poll?.cancel()
    poll = nil
  }
  override func load() async throws {
    let items = try await API.shared.rpc("work/list", target).array
    guard !Task.isCancelled, items != previous else { return }
    previous = items
    let open = items.filter { !["completed", "cancelled"].contains($0["status"].string) }
    let closed = items.filter { ["completed", "cancelled"].contains($0["status"].string) }
    var next: [ListSection] = []
    if !open.isEmpty { next.append(ListSection(rows: open.map(row))) }
    if !closed.isEmpty { next.append(ListSection(title: "Finished", rows: closed.map(row))) }
    if items.isEmpty {
      next = [ListSection(rows: [ListRow(title: "No ongoing work", detail: "Ask your assistant to follow something through.", symbol: "checkmark.circle")])]
    }
    sections = next
  }
  private func row(_ item: JSON) -> ListRow {
    let status = item["status"].string
    let closed = ["completed", "cancelled"].contains(status)
    return ListRow(
      title: item["title"].string, detail: statusText(item),
      symbol: symbol(status),
      action: { [weak self] in self?.open(item) },
      menu: closed ? nil : UIMenu(children: controls(item)),
      accessory: .disclosureIndicator,
      deleteAction: closed ? nil : { [weak self] in self?.change(item, action: "cancel") },
      deleteTitle: "Stop")
  }
  private func controls(_ item: JSON) -> [UIAction] {
    let status = item["status"].string
    guard !["completed", "cancelled"].contains(status) else { return [] }
    let resume = ["paused", "needs_input"].contains(status)
    return [
      UIAction(title: resume ? "Resume" : "Pause", image: UIImage(systemName: resume ? "play" : "pause")) { [weak self] _ in
        self?.change(item, action: resume ? "resume" : "pause")
      },
      UIAction(title: "Stop", image: UIImage(systemName: "stop"), attributes: .destructive) { [weak self] _ in
        self?.change(item, action: "cancel")
      },
    ]
  }
  private func open(_ item: JSON) {
    let detail = ListController(title: item["title"].string)
    var rows = [ListRow(title: statusText(item), detail: item["wakeReason"].string, symbol: symbol(item["status"].string), lines: 0)]
    rows.append(ListRow(title: "Task", detail: item["objective"].string, lines: 0))
    if !item["lastResult"].string.isEmpty {
      rows.append(ListRow(title: "Latest result", detail: item["lastResult"].string, lines: 0))
    }
    detail.sections = [ListSection(rows: rows)]
    let actions = controls(item)
    if !actions.isEmpty {
      detail.navigationItem.rightBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: UIMenu(children: actions))
    }
    navigationController?.pushViewController(detail, animated: true)
  }
  private func change(_ item: JSON, action: String) {
    Task { [weak self] in
      guard let self else { return }
      do {
        _ = try await API.shared.rpc("work/control", .object([
          "workId": item["id"], "version": item["version"], "action": .string(action),
        ]))
        if navigationController?.topViewController !== self { navigationController?.popToViewController(self, animated: true) }
        previous = nil
        try await load()
      } catch {
        let visible = navigationController?.topViewController ?? self
        visible.showError(error)
        previous = nil
        try? await load()
      }
    }
  }
  private func statusText(_ item: JSON) -> String {
    let status = item["status"].string
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if status == "waiting", let date = formatter.date(from: item["nextWakeAt"].string) {
      return "Next check: " + date.formatted(date: .abbreviated, time: .shortened)
    }
    return ["active": "Working", "waiting": "Waiting", "needs_input": "Needs attention", "paused": "Paused", "completed": "Completed", "cancelled": "Stopped"][status] ?? status
  }
  private func symbol(_ status: String) -> String {
    return ["active": "arrow.trianglehead.2.clockwise.rotate.90", "waiting": "clock", "needs_input": "exclamationmark.bubble", "paused": "pause.circle", "completed": "checkmark.circle", "cancelled": "stop.circle"][status] ?? "clock"
  }
}
