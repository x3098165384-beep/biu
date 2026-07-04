import { describe, expect, test } from "vitest";

import { normalizeDanmakuMessage, normalizeSuperChatMessage } from "@/service/live-danmaku";

describe("live danmaku service", () => {
  test("normalizes DANMU_MSG", () => {
    const line = normalizeDanmakuMessage({
      cmd: "DANMU_MSG",
      info: {
        0: { 4: 123 } as any,
        1: "hello",
        2: { 0: 1, 1: "user", 2: 0 },
      },
    } as any);

    expect(line).toMatchObject({
      type: "danmaku",
      username: "user",
      text: "hello",
      time: 123000,
    });
  });

  test("normalizes SUPER_CHAT_MESSAGE", () => {
    const line = normalizeSuperChatMessage({
      cmd: "SUPER_CHAT_MESSAGE",
      data: {
        ts: 456,
        message: "support",
        price: 30,
        user_info: { uname: "sc-user" },
      },
    } as any);

    expect(line).toMatchObject({
      type: "super_chat",
      username: "sc-user",
      text: "support",
      price: 30,
      time: 456000,
    });
  });

  test("ignores empty messages", () => {
    expect(
      normalizeDanmakuMessage({
        cmd: "DANMU_MSG",
        info: { 0: {} as any, 1: " ", 2: { 0: 1, 1: "user", 2: 0 } },
      } as any),
    ).toBeUndefined();

    expect(
      normalizeSuperChatMessage({
        cmd: "SUPER_CHAT_MESSAGE",
        data: { message: " ", user_info: { uname: "sc-user" } },
      } as any),
    ).toBeUndefined();
  });
});
