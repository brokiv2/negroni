import { File } from "expo-file-system";
import { type ApiRequestContext, captureApiRequestContext } from "./api";

const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;

export function appendDictationTranscript(draft: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return draft;
  if (!draft) return spoken;
  return `${draft.trimEnd()} ${spoken}`;
}

export async function transcribeRecording(
  uri: string,
  options: VoiceRequestOptions = {},
): Promise<string> {
  const file = new File(uri);
  try {
    if (!file.exists || file.size <= 0) throw new Error("That recording is empty.");
    if (file.size > MAX_TRANSCRIBE_BYTES) {
      throw new Error("That recording is too long. Try a shorter message.");
    }
    return await transcribeAudioBase64(await file.base64(), "audio/mp4", options);
  } finally {
    try {
      file.delete();
    } catch {
      // Recorder files are temporary and may already have been removed by the OS.
    }
  }
}

export type VoiceRequestOptions = { signal?: AbortSignal; requestContext?: ApiRequestContext };

async function voiceRequest<T>(
  path: string,
  body: unknown,
  options: VoiceRequestOptions,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 60_000);
  try {
    const context = options.requestContext ?? (await captureApiRequestContext());
    const res = await fetch(`${context.apiBase}/api/voice/${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", origin: "rakazo://", ...context.headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(error.error ?? `Voice request failed (${res.status})`);
    }
    return await read(res);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function transcribeAudioBase64(
  audioBase64: string,
  mimeType: string,
  options: VoiceRequestOptions = {},
): Promise<string> {
  return voiceRequest("transcribe", { audioBase64, mimeType }, options, async (res) => {
    const body = (await res.json()) as { text?: string };
    return body.text?.trim() ?? "";
  });
}

export async function synthesizeCallSpeech(
  text: string,
  botId: string,
  options: VoiceRequestOptions,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return voiceRequest(
    "speak",
    { text, botId },
    options,
    async (res) => ({ bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "audio/mpeg" }),
  );
}
