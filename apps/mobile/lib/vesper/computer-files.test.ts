import { describe, expect, it } from "vitest";
import {
  breadcrumbs,
  type ComputerFileEntry,
  FILE_PREVIEW_MAX_CHARS,
  fileName,
  formatFileSize,
  isReadableFile,
  joinPath,
  parentPath,
  previewContent,
  sortFileEntries,
} from "./computer-files";

describe("fileName", () => {
  it("takes the last segment and survives a trailing slash", () => {
    expect(fileName("/home/agent/notes.md")).toBe("notes.md");
    expect(fileName("/home/agent/")).toBe("agent");
    expect(fileName("/")).toBe("/");
  });
});

describe("parentPath", () => {
  it("returns null at the root and the directory above otherwise", () => {
    expect(parentPath("/")).toBeNull();
    expect(parentPath("")).toBeNull();
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/home/agent/notes.md")).toBe("/home/agent");
    expect(parentPath("/home/agent/")).toBe("/home");
  });
});

describe("joinPath", () => {
  it("does not double the separator", () => {
    expect(joinPath("/", "home")).toBe("/home");
    expect(joinPath("/home", "agent")).toBe("/home/agent");
    expect(joinPath("/home/", "agent")).toBe("/home/agent");
  });
});

describe("sortFileEntries", () => {
  it("puts folders first, then names case-insensitively", () => {
    const entries: ComputerFileEntry[] = [
      { path: "/zebra.txt", kind: "file", size: 1 },
      { path: "/Downloads", kind: "dir", size: 0 },
      { path: "/apple.txt", kind: "file", size: 1 },
      { path: "/archive", kind: "dir", size: 0 },
    ];
    expect(sortFileEntries(entries).map((entry) => entry.path)).toEqual([
      "/archive",
      "/Downloads",
      "/apple.txt",
      "/zebra.txt",
    ]);
  });

  it("does not mutate its input", () => {
    const entries: ComputerFileEntry[] = [
      { path: "/b.txt", kind: "file", size: 1 },
      { path: "/a", kind: "dir", size: 0 },
    ];
    sortFileEntries(entries);
    expect(entries[0]?.path).toBe("/b.txt");
  });
});

describe("formatFileSize", () => {
  it("steps through the units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatFileSize(1024 * 1024 * 1024 * 3)).toBe("3 GB");
  });

  it("says nothing rather than guessing on a bad number", () => {
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(-1)).toBe("");
  });
});

describe("isReadableFile", () => {
  it("opens text and extensionless files, refuses known binaries", () => {
    expect(isReadableFile("/home/agent/notes.md")).toBe(true);
    expect(isReadableFile("/home/agent/data.CSV")).toBe(true);
    expect(isReadableFile("/home/agent/Makefile")).toBe(true);
    expect(isReadableFile("/home/agent/shot.png")).toBe(false);
    expect(isReadableFile("/home/agent/report.pdf")).toBe(false);
  });

  it("does not treat a dotfile as an extension", () => {
    expect(isReadableFile("/home/agent/.bashrc")).toBe(true);
  });
});

describe("breadcrumbs", () => {
  it("is a single workspace crumb at the root", () => {
    expect(breadcrumbs("/")).toEqual([{ label: "Workspace", path: "/" }]);
  });

  it("makes every ancestor reachable", () => {
    expect(breadcrumbs("/home/agent/notes")).toEqual([
      { label: "Workspace", path: "/" },
      { label: "home", path: "/home" },
      { label: "agent", path: "/home/agent" },
      { label: "notes", path: "/home/agent/notes" },
    ]);
  });
});

describe("previewContent", () => {
  it("passes short content through untouched", () => {
    expect(previewContent("hello")).toEqual({ text: "hello", truncated: false });
  });

  it("caps a large file and says that it did", () => {
    const result = previewContent("x".repeat(FILE_PREVIEW_MAX_CHARS + 10));
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(FILE_PREVIEW_MAX_CHARS);
  });
});
