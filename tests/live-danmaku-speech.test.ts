import { describe, expect, test } from "vitest";

import {
  getTtsServerEngineLabel,
  getTtsServerEngineValue,
  getTtsServerVoiceLabel,
  getTtsServerVoiceValue,
} from "@/store/live-danmaku-speech";
import { buildTtsServerUrl } from "@shared/live";

describe("live danmaku speech TTS Server helpers", () => {
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
});
