import Foundation

public enum AttachmentPreview {
  public static func filename(name: String, suggested: String?, mimeType: String?) -> String {
    let safe = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : URL(fileURLWithPath: name).lastPathComponent
    let fallback = (safe.isEmpty || [".", "..", "/"].contains(safe)) ? "Attachment" : safe
    if !URL(fileURLWithPath: fallback).pathExtension.isEmpty { return fallback }
    if let suggested {
      let candidate = URL(fileURLWithPath: suggested).lastPathComponent
      if !candidate.isEmpty, !URL(fileURLWithPath: candidate).pathExtension.isEmpty { return candidate }
    }
    let mime = (mimeType ?? "").lowercased().split(separator: ";").first.map(String.init) ?? ""
    let extensions = [
      "text/markdown": "md", "text/x-markdown": "md", "text/plain": "txt",
      "text/html": "html", "text/csv": "csv", "application/json": "json",
      "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    ]
    return extensions[mime].map { fallback + "." + $0 } ?? fallback
  }
  public static func text(_ url: URL) -> Bool {
    ["md", "markdown", "txt", "csv", "json", "log"].contains(url.pathExtension.lowercased())
  }
}
