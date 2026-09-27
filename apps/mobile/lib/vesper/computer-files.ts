import { t } from "../i18n";

/**
 * The agent's workspace, read-only.
 *
 * `computer.files` returns a flat listing of one directory; `computer.readFile`
 * returns text. There is no write, mkdir or exec RPC — Phase 9 owns those — so
 * everything here is about presenting a listing, not changing one.
 */

export type ComputerFileEntry = { path: string; kind: "file" | "dir"; size: number };

export const COMPUTER_FILES_ROOT = "/";

export function fileName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return COMPUTER_FILES_ROOT;
  const cut = trimmed.lastIndexOf("/");
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

/** The directory above `path`, or null at the root. */
export function parentPath(path: string): string | null {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || trimmed === COMPUTER_FILES_ROOT) return null;
  const cut = trimmed.lastIndexOf("/");
  if (cut <= 0) return COMPUTER_FILES_ROOT;
  return trimmed.slice(0, cut);
}

export function joinPath(directory: string, name: string): string {
  const base = directory.replace(/\/+$/, "");
  return `${base}/${name}`;
}

/** Folders first, then names, case-insensitively — a listing people can scan. */
export function sortFileEntries(entries: readonly ComputerFileEntry[]): ComputerFileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return fileName(left.path).localeCompare(fileName(right.path), undefined, {
      sensitivity: "base",
    });
  });
}

const UNITS = 1024;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < UNITS) return t("{count} B", { count: Math.round(bytes) });
  const kb = bytes / UNITS;
  if (kb < UNITS) return t("{count} KB", { count: Math.round(kb) });
  const mb = kb / UNITS;
  if (mb < UNITS)
    return t("{count} MB", { count: mb < 10 ? Number(mb.toFixed(1)) : Math.round(mb) });
  const gb = mb / UNITS;
  return t("{count} GB", { count: gb < 10 ? Number(gb.toFixed(1)) : Math.round(gb) });
}

const TEXT_EXTENSIONS = new Set([
  "csv",
  "css",
  "env",
  "html",
  "ini",
  "js",
  "json",
  "jsonl",
  "log",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

/**
 * Whether tapping the row should try to open it. `computer.readFile` returns a
 * string, so a binary would come back as mojibake — better to say so up front
 * than to render 4 MB of noise.
 */
export function isReadableFile(path: string): boolean {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return true;
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export type Breadcrumb = { label: string; path: string };

/** Root plus one crumb per segment, so any ancestor is one tap away. */
export function breadcrumbs(path: string): Breadcrumb[] {
  const trimmed = path.replace(/\/+$/, "");
  const crumbs: Breadcrumb[] = [{ label: t("Workspace"), path: COMPUTER_FILES_ROOT }];
  if (!trimmed || trimmed === COMPUTER_FILES_ROOT) return crumbs;
  let walked = "";
  for (const segment of trimmed.split("/")) {
    if (!segment) continue;
    walked = `${walked}/${segment}`;
    crumbs.push({ label: segment, path: walked });
  }
  return crumbs;
}

/** Cap what the read-only viewer renders; a log file can be enormous. */
export const FILE_PREVIEW_MAX_CHARS = 20_000;

export function previewContent(content: string): { text: string; truncated: boolean } {
  if (content.length <= FILE_PREVIEW_MAX_CHARS) return { text: content, truncated: false };
  return { text: content.slice(0, FILE_PREVIEW_MAX_CHARS), truncated: true };
}
