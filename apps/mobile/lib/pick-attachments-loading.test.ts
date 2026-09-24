import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(async () => "eA=="), pick: vi.fn() }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: mock.pick }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: mock.pick }));
vi.mock("expo-file-system", () => ({
  File: class {
    info() {
      return { size: 1 };
    }
    base64 = mock.read;
  },
}));
import { pickDocuments, pickFromLibrary } from "./pick-attachments";
beforeEach(() => {
  vi.clearAllMocks();
});
describe("attachment memory limits", () => {
  it("reads only remaining image slots, even if the picker returns many assets", async () => {
    mock.pick.mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 100 }, (_, i) => ({
        fileName: `${i}.jpg`,
        uri: `${i}.jpg`,
        mimeType: "image/jpeg",
      })),
    });
    const result = await pickFromLibrary(3);
    expect(mock.read).toHaveBeenCalledTimes(1);
    expect(result.attachments).toHaveLength(1);
    expect(result.skipped).toHaveLength(99);
  });
  it("does not read rejected documents or files beyond the limit", async () => {
    mock.pick.mockResolvedValue({
      canceled: false,
      assets: [
        { name: "archive.zip", uri: "archive.zip", mimeType: "application/zip" },
        ...Array.from({ length: 10 }, (_, i) => ({
          name: `${i}.txt`,
          uri: `${i}.txt`,
          mimeType: "text/plain",
        })),
      ],
    });
    const result = await pickDocuments();
    expect(mock.read).toHaveBeenCalledTimes(4);
    expect(result.attachments).toHaveLength(4);
  });
});
