import NegroniCore
import UIKit

final class TeamController: ListController {
  let botID: String
  private var bots: [JSON] = []
  init(botID: String) {
    self.botID = botID
    super.init(title: "Team")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "plus"),
      primaryAction: UIAction { [weak self] _ in self?.createGroup() })
  }
  override func load() async throws {
    async let b = API.shared.rpc("bots/list")
    async let g = API.shared.rpc("groups/list")
    let (botRows, groups) = try await (b, g)
    bots = botRows.array
    let groupRows = groups.array.map { group in
      ListRow(
        title: group["name"].string, detail: group["preview"].string,
        image: RobotAvatar.group(
          colors: group["members"].array.map { member in
            bots.first { $0["id"] == member["botId"] }?["color"].string ?? ""
          }, size: 40),
        action: { [weak self] in
          self?.push(ChatController(target: ["groupId": group["id"]], title: group["name"].string))
        }, accessory: .disclosureIndicator)
    }
    let children = bots.filter { $0["parentBotId"].string == botID }
    let others = bots.filter { $0["id"].string != botID && $0["parentBotId"].string != botID }
    let makeRow: (JSON) -> ListRow = { [weak self] bot in
      ListRow(
        title: bot["name"].string, detail: bot["description"].string,
        symbol: "face.smiling.inverse",
        image: RobotAvatar.image(color: bot["color"].string, size: 40),
        action: { [weak self] in
          self?.push(ChatController(target: ["botId": bot["id"]], title: bot["name"].string))
        }, accessory: .disclosureIndicator)
    }
    sections = [
      ListSection(
        title: "Group chats",
        rows: groupRows.isEmpty
          ? [
            ListRow(
              title: "New group", symbol: "plus", action: { [weak self] in self?.createGroup() })
          ] : groupRows),
      ListSection(
        title: "Your assistant’s team", rows: children.map(makeRow),
        footer: children.isEmpty ? "Specialists created by your assistant appear here." : nil),
      ListSection(title: "Other assistants", rows: others.map(makeRow)),
    ]
  }
  private func createGroup() { push(GroupEditorController(bots: bots)) }
}
final class GroupEditorController: ListController {
  let bots: [JSON]
  private var selected = Set<String>()
  init(bots: [JSON]) {
    self.bots = bots
    super.init(title: "New group")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "Create", primaryAction: UIAction { [weak self] _ in self?.create() })
  }
  override func load() async throws { render() }
  private func render() {
    sections = [
      ListSection(
        title: "Choose assistants",
        rows: bots.map { bot in
          ListRow(
            title: bot["name"].string,
            image: RobotAvatar.image(color: bot["color"].string, size: 36),
            action: { [weak self] in
              guard let self else { return }
              let id = bot["id"].string
              if self.selected.contains(id) {
                self.selected.remove(id)
              } else {
                self.selected.insert(id)
              }
              self.render()
            }, accessory: selected.contains(bot["id"].string) ? .checkmark : .none)
        })
    ]
    navigationItem.rightBarButtonItem?.isEnabled = (2...6).contains(selected.count)
  }
  private func create() {
    prompt("Group name") { [weak self] name in
      guard let self else { return }
      Task {
        do {
          let group = try await API.shared.rpc(
            "groups/create",
            ["name": .string(name), "botIds": .array(self.selected.map(JSON.string))])
          let navigation = self.navigationController
          navigation?.popViewController(animated: false)
          navigation?.pushViewController(
            ChatController(target: ["groupId": group["id"]], title: name), animated: true)
        } catch { self.showError(error) }
      }
    }
  }
}

final class ComputerController: ListController {
  let botID: String
  init(botID: String) {
    self.botID = botID
    super.init(title: "Computer")
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    let status = try await API.shared.rpc("computer/status", ["botId": .string(botID)])
    let local = status["kind"].string == "desktop"
    var rows = [
      ListRow(
        title: local ? "Mac connected" : "Computer: \(status["state"].string)",
        symbol: "desktopcomputer"),
      ListRow(
        title: "Check connection", symbol: "arrow.clockwise",
        action: { [weak self] in self?.reloadData() }),
      ListRow(
        title: "Agent files", detail: "Files in this agent’s workspace", symbol: "folder",
        action: { [weak self] in
          guard let self else { return }
          self.push(FilesController(botID: self.botID, path: "/"))
        }, accessory: .disclosureIndicator),
    ]
    if !local && status["state"].string != "running" {
      rows.append(
        ListRow(
          title: "Start computer", symbol: "power",
          action: { [weak self] in
            guard let self else { return }
            self.mutate("computer/boot", ["botId": .string(self.botID)])
          }))
    }
    sections = [
      ListSection(
        rows: rows,
        footer: local ? "Chat and tools are available. Live screen sharing is not connected." : nil)
    ]
  }
}
final class FilesController: ListController {
  let botID: String, path: String
  init(botID: String, path: String) {
    self.botID = botID
    self.path = path
    super.init(title: path == "/" ? "Agent files" : URL(fileURLWithPath: path).lastPathComponent)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func load() async throws {
    let files = try await API.shared.rpc(
      "computer/files", ["botId": .string(botID), "path": .string(path)])
    sections = [
      ListSection(
        rows: files.array.map { file in
          ListRow(
            title: URL(fileURLWithPath: file["path"].string).lastPathComponent,
            symbol: file["kind"].string == "dir" ? "folder" : "doc",
            action: { [weak self] in self?.open(file) }, accessory: .disclosureIndicator)
        })
    ]
  }
  private func open(_ file: JSON) {
    if file["kind"].string == "dir" {
      push(FilesController(botID: botID, path: file["path"].string))
    } else {
      Task {
        do {
          let content = try await API.shared.rpc(
            "computer/readFile", ["botId": .string(botID), "path": file["path"]])
          push(
            TextController(
              title: URL(fileURLWithPath: file["path"].string).lastPathComponent,
              text: content["content"].string))
        } catch { showError(error) }
      }
    }
  }
}
