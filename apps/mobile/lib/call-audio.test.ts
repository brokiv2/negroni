import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  play: vi.fn(),
  listener: undefined as undefined | ((status: { didJustFinish: boolean }) => void),
  removeListener: vi.fn(),
  prepare: vi.fn(),
  stop: vi.fn(),
  release: vi.fn(),
  record: vi.fn(),
  remove: vi.fn(),
  write: vi.fn(),
  audioMode: vi.fn(),
  deleteFile: vi.fn(),
  status: vi.fn(),
  isRecording: false,
  permission: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    uri = "test.mp3";
    write = mock.write;
    delete = mock.deleteFile;
  },
}));
vi.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: { ios: {}, extension: ".m4a" } },
  AudioModule: {
    AudioRecorder: class {
      prepareToRecordAsync = mock.prepare;
      record = mock.record;
      stop = mock.stop;
      release = mock.release;
      getStatus = mock.status;
      get isRecording() {
        return mock.isRecording;
      }
      uri = "recording.m4a";
    },
  },
  createAudioPlayer: () => ({
    play: mock.play,
    remove: mock.remove,
    addListener: (_event: string, listener: (status: { didJustFinish: boolean }) => void) => {
      mock.listener = listener;
      return { remove: mock.removeListener };
    },
    currentStatus: { didJustFinish: false },
  }),
  requestRecordingPermissionsAsync: mock.permission,
  setAudioModeAsync: mock.audioMode,
}));

import { playCallAudio, recordCallTurn, requestCallMicrophone } from "./call-audio";

beforeEach(() => {
  vi.clearAllMocks();
  mock.audioMode.mockResolvedValue(undefined);
  mock.prepare.mockResolvedValue(undefined);
  mock.stop.mockResolvedValue(undefined);
  mock.isRecording = false;
});
describe("native call cleanup", () => {
  it("handles denied microphone permission without creating audio resources", async () => {
    mock.permission.mockResolvedValueOnce({ granted: false });
    await expect(requestCallMicrophone(new AbortController().signal)).rejects.toThrow(
      "Enable microphone access",
    );
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("ignores a permission grant arriving after hangup", async () => {
    const controller = new AbortController();
    mock.permission.mockImplementationOnce(async () => {
      controller.abort();
      return { granted: true };
    });
    await expect(requestCallMicrophone(controller.signal)).rejects.toThrow("Call ended");
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("finishes playback on the completion event rather than polling status", async () => {
    mock.play.mockImplementationOnce(() => mock.listener?.({ didJustFinish: true }));
    await playCallAudio(new Uint8Array([1]), new AbortController().signal);
    expect(mock.audioMode).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      }),
    );
    expect(mock.removeListener).toHaveBeenCalledOnce();
    expect(mock.remove).toHaveBeenCalledOnce();
  });
  it("does not start a recorder after hanging up during preparation", async () => {
    const controller = new AbortController();
    mock.prepare.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(recordCallTurn(controller.signal)).rejects.toThrow("Call ended");
    expect(mock.record).not.toHaveBeenCalled();
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.deleteFile).toHaveBeenCalledOnce();
    expect(mock.audioMode).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowsRecording: false, playsInSilentMode: true }),
    );
  });
  it("restores audio mode when cancelled while activating the microphone", async () => {
    const controller = new AbortController();
    mock.audioMode.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(recordCallTurn(controller.signal)).rejects.toThrow("Call ended");
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.audioMode).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowsRecording: false, playsInSilentMode: true }),
    );
  });
  it("does not touch native audio for an already cancelled call", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(recordCallTurn(controller.signal)).rejects.toThrow("Call ended");
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("releases playback and deletes the clip on interruption", async () => {
    const controller = new AbortController();
    const result = playCallAudio(new Uint8Array([1]), controller.signal);
    const rejection = expect(result).rejects.toThrow("Call ended");
    await vi.waitFor(() => expect(mock.play).toHaveBeenCalled());
    controller.abort();
    await rejection;
    expect(mock.remove).toHaveBeenCalledOnce();
    expect(mock.deleteFile).toHaveBeenCalledOnce();
  });
});
