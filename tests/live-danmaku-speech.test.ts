import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  getLocalNaturalVoiceLabel,
  getTtsServerEngineLabel,
  getTtsServerEngineValue,
  getTtsServerVoiceLabel,
  getTtsServerVoiceValue,
  getWindowsTtsVoiceLabel,
  resetLiveDanmakuSpeechRuntime,
  useLiveDanmakuSpeech,
} from "@/store/live-danmaku-speech";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import { buildTtsServerUrl, defaultLiveDanmakuSpeechSettings, type LiveDanmakuLine } from "@shared/live";

class FakeSpeechSynthesisUtterance {
  lang = "";
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend?: () => void;
  onerror?: () => void;

  constructor(public text: string) {}
}

const makeLine = (id: string, text: string, type: LiveDanmakuLine["type"] = "danmaku"): LiveDanmakuLine => ({
  id,
  type,
  username: "user",
  text,
  time: Date.now(),
});

describe("live danmaku speech TTS Server helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
  });

  afterEach(() => {
    resetLiveDanmakuSpeechRuntime();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("supports MultiTTS engine config fields", () => {
    const engine = {
      code: "microsoft",
      name: "微软语音",
      type: "inner",
    };

    expect(getTtsServerEngineValue(engine)).toBe("microsoft");
    expect(getTtsServerEngineLabel(engine)).toBe("微软语音");
  });

  test("supports MultiTTS offline Microsoft voice config fields", () => {
    const voice = {
      code: "zh-CN-XiaoxiaoNeural",
      name: "晓晓",
      desc: "zh-CN,Xiaoxiao",
      param: "Microsoft Xiaoxiao (Natural) - Chinese (Simplified, China)",
    };

    expect(getTtsServerVoiceValue(voice)).toBe("zh-CN-XiaoxiaoNeural");
    expect(getTtsServerVoiceLabel(voice)).toBe("晓晓 (zh-CN,Xiaoxiao)");
  });

  test("keeps standard TTS Server forwarder fields working", () => {
    expect(getTtsServerEngineValue({ name: "com.google.android.tts", label: "Google" })).toBe(
      "com.google.android.tts",
    );
    expect(getTtsServerEngineLabel({ name: "com.google.android.tts", label: "Google" })).toBe("Google");
    expect(getTtsServerVoiceValue({ name: "zh-CN", locale: "zh-CN", localeName: "中文" })).toBe("zh-CN");
    expect(getTtsServerVoiceLabel({ name: "zh-CN", locale: "zh-CN", localeName: "中文" })).toBe("zh-CN (中文)");
  });

  test("passes selected MultiTTS voice code to the TTS request", () => {
    const url = buildTtsServerUrl({
      baseUrl: "http://127.0.0.1:1233",
      text: "测试",
      engine: "microsoft",
      voice: "zh-CN-XiaoxiaoNeural",
      locale: "zh-CN",
      rate: 1,
      pitch: 100,
    });

    expect(url).toContain("engine=microsoft");
    expect(url).toContain("voice=zh-CN-XiaoxiaoNeural");
    expect(url).toContain("locale=zh-CN");
  });

  test("labels Windows system voices with language", () => {
    expect(
      getWindowsTtsVoiceLabel({
        id: "voice-id",
        name: "Microsoft Xiaoxiao",
        language: "zh-CN",
      }),
    ).toBe("Microsoft Xiaoxiao (zh-CN)");
  });

  test("labels local natural voices with description", () => {
    expect(
      getLocalNaturalVoiceLabel({
        engine: "microsoft",
        code: "zh-CN-XiaoxiaoNeural",
        name: "晓晓",
        desc: "zh-CN,Xiaoxiao",
        folder: "E:/voices/microsoft/zh-CN-XiaoxiaoNeural",
        manifestPath: "E:/voices/microsoft/zh-CN-XiaoxiaoNeural/AppxManifest.xml",
        installed: false,
      }),
    ).toBe("晓晓 (zh-CN,Xiaoxiao)");
  });

  test("keeps only the latest normal danmaku while respecting the normal speech interval", () => {
    const spoken: FakeSpeechSynthesisUtterance[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      speak: vi.fn((utterance: FakeSpeechSynthesisUtterance) => {
        spoken.push(utterance);
      }),
      addEventListener: vi.fn(),
    });
    useFullScreenPlayerSettings.getState().update({
      liveDanmakuSpeech: {
        ...defaultLiveDanmakuSpeechSettings,
        duckingEnabled: false,
        enabled: true,
        minIntervalSeconds: 20,
        provider: "webSpeech",
      },
    });
    useLiveDanmakuSpeech.getState().refreshSupport();

    useLiveDanmakuSpeech.getState().enqueue(makeLine("1", "first"));
    expect(spoken.map(item => item.text)).toEqual(["first"]);

    vi.setSystemTime(121000);
    useLiveDanmakuSpeech.getState().enqueue(makeLine("2", "old pending"));
    useLiveDanmakuSpeech.getState().enqueue(makeLine("3", "latest pending"));
    expect(spoken.map(item => item.text)).toEqual(["first"]);
    expect(useLiveDanmakuSpeech.getState().queueLength).toBe(1);

    spoken[0].onend?.();
    expect(spoken.map(item => item.text)).toEqual(["first", "latest pending"]);

    spoken[1].onend?.();
    expect(spoken.map(item => item.text)).toEqual(["first", "latest pending"]);
  });

  test("lets super chat bypass the normal danmaku interval", () => {
    const spoken: FakeSpeechSynthesisUtterance[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      speak: vi.fn((utterance: FakeSpeechSynthesisUtterance) => {
        spoken.push(utterance);
      }),
      addEventListener: vi.fn(),
    });
    useFullScreenPlayerSettings.getState().update({
      liveDanmakuSpeech: {
        ...defaultLiveDanmakuSpeechSettings,
        duckingEnabled: false,
        enabled: true,
        minIntervalSeconds: 20,
        provider: "webSpeech",
      },
    });
    useLiveDanmakuSpeech.getState().refreshSupport();

    useLiveDanmakuSpeech.getState().enqueue(makeLine("1", "normal"));
    spoken[0].onend?.();

    vi.setSystemTime(105000);
    useLiveDanmakuSpeech.getState().enqueue(makeLine("2", "paid", "super_chat"));

    expect(spoken.map(item => item.text)).toEqual(["normal", "SC，paid"]);
  });
});
