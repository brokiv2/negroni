import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureApiRequestContext } from "./api";
import { appendDictationTranscript, synthesizeCallSpeech, transcribeAudioBase64 } from "./voice";

vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("./api", () => ({
  captureApiRequestContext: vi.fn(),
}));

describe("mobile speech", () => {
  beforeEach(() => {
    vi.mocked(captureApiRequestContext).mockResolvedValue({
      apiBase: "https://support.example",
      headers: {
        authorization: "Bearer support-token",
        "x-rakazo-space-id": "space-support",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("transcribes through the captured mobile server and space", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "  Send the summary  " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(transcribeAudioBase64("YXVkaW8=", "audio/mp4")).resolves.toBe("Send the summary");
    expect(fetch).toHaveBeenCalledWith("https://support.example/api/voice/transcribe", {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: {
        "content-type": "application/json",
        origin: "rakazo://",
        authorization: "Bearer support-token",
        "x-rakazo-space-id": "space-support",
      },
      body: JSON.stringify({ audioBase64: "YXVkaW8=", mimeType: "audio/mp4" }),
    });
  });

  it("appends a transcript without erasing the current draft", () => {
    expect(appendDictationTranscript("Ask the bot", "  to summarize this  ")).toBe(
      "Ask the bot to summarize this",
    );
    expect(appendDictationTranscript("", "  New message  ")).toBe("New message");
    expect(appendDictationTranscript("Keep this", "   ")).toBe("Keep this");
  });

  it("keeps synthesis on the captured bot, server and space", async () => {
    const context = { apiBase: "https://original.example", headers: { "x-rakazo-space-id": "original" } };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([4, 5]), {
      headers: { "content-type": "audio/wav" },
    }));
    const clip = await synthesizeCallSpeech("Reply", "bot-original", { requestContext: context });
    expect(clip).toEqual({ bytes: new Uint8Array([4, 5]), mimeType: "audio/wav" });
    expect(fetch).toHaveBeenCalledWith("https://original.example/api/voice/speak", expect.objectContaining({
      headers: expect.objectContaining(context.headers),
      body: JSON.stringify({ text: "Reply", botId: "bot-original" }),
    }));
  });

  it.each(["hangup", "deadline"])("aborts an outstanding voice request on %s", async (reason) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = transcribeAudioBase64("YQ==", "audio/mp4", {
      signal: controller.signal,
      requestContext: { apiBase: "https://original.example", headers: {} },
    });
    const rejection = expect(result).rejects.toThrow("aborted");
    if (reason === "hangup") controller.abort();
    else await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("surfaces provider errors without returning audio", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Provider unavailable" }), { status: 503 }));
    await expect(synthesizeCallSpeech("Reply", "bot", {})).rejects.toThrow("Provider unavailable");
  });
});
