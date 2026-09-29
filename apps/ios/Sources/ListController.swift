import NegroniCore
import UIKit

struct ListRow {
  var title: String
  var detail: String = ""
  var symbol: String? = nil
  var color: UIColor? = nil
  var image: UIImage? = nil
  var imageURL: String? = nil
  var iconRequest: JSON? = nil
  var action: (() -> Void)? = nil
  var menu: UIMenu? = nil
  var accessory: UITableViewCell.AccessoryType = .none
  var lines: Int = 2
  var deleteAction: (() -> Void)? = nil
  var deleteTitle: String = "Delete"
}
struct ListSection {
  var title: String? = nil
  var rows: [ListRow]
  var footer: String? = nil
}
class ListController: UITableViewController {
  var sections: [ListSection] = [] { didSet { if isViewLoaded { tableView.reloadData() } } }
  var loadTask: Task<Void, Never>?
  init(title: String) {
    super.init(style: .insetGrouped)
    self.title = title
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    tableView.backgroundColor = Theme.canvas
    tableView.estimatedRowHeight = 60
    tableView.rowHeight = UITableView.automaticDimension
    navigationItem.largeTitleDisplayMode = .automatic
    navigationController?.navigationBar.prefersLargeTitles = true
    refreshControl = UIRefreshControl()
    refreshControl?.addTarget(self, action: #selector(reloadData), for: .valueChanged)
  }
  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    reloadData()
  }
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    loadTask?.cancel()
  }
  func load() async throws {}
  @objc func reloadData() {
    loadTask?.cancel()
    if sections.isEmpty {
      let spinner = UIActivityIndicatorView(style: .medium)
      spinner.startAnimating()
      tableView.backgroundView = spinner
    }
    loadTask = Task { [weak self] in
      guard let self else { return }
      do {
        try await load()
        tableView.backgroundView = nil
      } catch {
        if Task.isCancelled { return }
        if sections.isEmpty {
          let label = Theme.label(
            error.localizedDescription + "\nPull to retry.", style: .callout, color: Theme.muted)
          label.textAlignment = .center
          tableView.backgroundView = label
        } else {
          showError(error, retry: { [weak self] in self?.reloadData() })
        }
      }
      refreshControl?.endRefreshing()
    }
  }
  override func numberOfSections(in tableView: UITableView) -> Int { sections.count }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    sections[section].rows.count
  }
  override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String?
  { sections[section].title }
  override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String?
  { sections[section].footer }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath)
    -> UITableViewCell
  {
    let row = sections[indexPath.section].rows[indexPath.row]
    let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
    var config = cell.defaultContentConfiguration()
    config.text = row.title
    config.secondaryText = row.detail.isEmpty ? nil : row.detail
    config.textProperties.color = row.color ?? Theme.ink
    config.secondaryTextProperties.color = Theme.muted
    config.secondaryTextProperties.numberOfLines = row.lines
    config.image = row.image ?? row.symbol.flatMap(UIImage.init(systemName:))
    config.imageProperties.tintColor = row.color ?? Theme.ink
    config.imageProperties.maximumSize = CGSize(width: 36, height: 36)
    cell.contentConfiguration = config
    if row.imageURL?.isEmpty == false || row.iconRequest != nil {
      Task { [weak cell] in
        let image = await ImageStore.shared.connectionImage(row.imageURL, request: row.iconRequest)
        guard let image, let cell,
          var current = cell.contentConfiguration as? UIListContentConfiguration
        else { return }
        current.image = image.withRenderingMode(.alwaysOriginal)
        cell.contentConfiguration = current
      }
    }
    cell.backgroundColor = Theme.card
    cell.accessoryType = row.accessory
    cell.selectionStyle = row.action == nil ? .none : .default
    return cell
  }
  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    sections[indexPath.section].rows[indexPath.row].action?()
  }
  override func tableView(
    _ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath, point: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard let menu = sections[indexPath.section].rows[indexPath.row].menu else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { _ in menu }
  }
  override func tableView(
    _ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath
  ) -> UISwipeActionsConfiguration? {
    guard let action = sections[indexPath.section].rows[indexPath.row].deleteAction else {
      return nil
    }
    let delete = UIContextualAction(
      style: .destructive, title: sections[indexPath.section].rows[indexPath.row].deleteTitle
    ) { _, _, completion in
      completion(true)
      action()
    }
    delete.image = UIImage(systemName: "trash")
    let configuration = UISwipeActionsConfiguration(actions: [delete])
    configuration.performsFirstActionWithFullSwipe = false
    return configuration
  }
  func push(_ controller: UIViewController) {
    navigationController?.pushViewController(controller, animated: true)
  }
  func mutate(_ procedure: String, _ body: JSON, completed: (() -> Void)? = nil) {
    Task {
      do {
        _ = try await API.shared.rpc(procedure, body)
        completed?()
        reloadData()
      } catch { showError(error) }
    }
  }
  func confirmDelete(_ title: String, action: @escaping () -> Void) {
    let alert = UIAlertController(title: title, message: nil, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in action() })
    present(alert, animated: true)
  }
}

final class TextController: UIViewController {
  let text: String
  init(title: String, text: String) {
    self.text = text
    super.init(nibName: nil, bundle: nil)
    self.title = title
  }
  required init?(coder: NSCoder) { fatalError() }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.canvas
    let textView = UITextView()
    textView.backgroundColor = Theme.canvas
    textView.isEditable = false
    textView.isSelectable = true
    textView.attributedText = Markdown.render(text)
    textView.textContainerInset = UIEdgeInsets(top: 20, left: 20, bottom: 30, right: 20)
    view.addSubview(textView)
    textView.pin(to: view)
  }
}
