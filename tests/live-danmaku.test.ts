import { describe, expect, test } from "vitest";

import { normalizeDanmakuMessage, normalizeSuperChatMessage } from "@/service/live-danmaku";
import {
  buildLiveDanmakuCandidates,
  getLiveDanmakuSpeechText,
  isLiveDanmakuLineBlocked,
  mergeLiveDanmakuLine,
  trimLiveDanmakuSpeechQueue,
} from "@shared/live";

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

  test("folds repeated messages and trims max lines", () => {
    const settings = { duplicateWindowSeconds: 10, maxLines: 2 };
    const first = { id: "1", type: "danmaku" as const, username: "a", text: "same", time: 1000 };
    const repeated = { id: "2", type: "danmaku" as const, username: "b", text: "same", time: 2000 };
    const other = { id: "3", type: "danmaku" as const, username: "c", text: "other", time: 3000 };

    const folded = mergeLiveDanmakuLine([first], repeated, settings);
    expect(folded).toMatchObject([{ id: "2", text: "same", repeatCount: 2 }]);

    const trimmed = mergeLiveDanmakuLine(folded, other, { duplicateWindowSeconds: 0, maxLines: 1 });
    expect(trimmed).toEqual([other]);
  });

  test("builds websocket candidates from danmaku host list", () => {
    const candidates = buildLiveDanmakuCandidates([
      { host: "a.chat.bilibili.com", wss_port: 2245 },
      { host: "a.chat.bilibili.com", wss_port: 2245 },
      { host: "b.chat.bilibili.com", wss_port: 2245 },
      { host: "skip.chat.bilibili.com" },
    ]);

    expect(candidates).toEqual([
      {
        host: "a.chat.bilibili.com",
        port: 2245,
        address: "wss://a.chat.bilibili.com:2245/sub",
      },
      {
        host: "b.chat.bilibili.com",
        port: 2245,
        address: "wss://b.chat.bilibili.com:2245/sub",
      },
    ]);
  });

  test("builds speech text without username or super chat price", () => {
    expect(
      getLiveDanmakuSpeechText({
        id: "1",
        type: "danmaku",
        username: "user",
        text: "hello",
        time: 1000,
      }),
    ).toBe("hello");

    expect(
      getLiveDanmakuSpeechText({
        id: "2",
        type: "super_chat",
        username: "sc-user",
        text: "support",
        price: 30,
        time: 1000,
      }),
    ).toBe("SC，support");
  });

  test("blocks speech candidate by configured keywords", () => {
    const line = { id: "1", type: "danmaku" as const, username: "user", text: "hello blocked", time: 1000 };

    expect(isLiveDanmakuLineBlocked(line, "blocked")).toBe(true);
    expect(isLiveDanmakuLineBlocked(line, "other")).toBe(false);
  });

  test("speech queue drops oldest normal danmaku before super chat", () => {
    const trimmed = trimLiveDanmakuSpeechQueue(
      [
        { id: "1", type: "danmaku", text: "normal-1" },
        { id: "2", type: "super_chat", text: "SC，support" },
        { id: "3", type: "danmaku", text: "normal-2" },
      ],
      2,
    );

    expect(trimmed.map(item => item.id)).toEqual(["2", "3"]);
  });

  test("speech queue keeps latest messages when every item is super chat", () => {
    const trimmed = trimLiveDanmakuSpeechQueue(
      [
        { id: "1", type: "super_chat", text: "SC，one" },
        { id: "2", type: "super_chat", text: "SC，two" },
        { id: "3", type: "super_chat", text: "SC，three" },
      ],
      2,
    );

    expect(trimmed.map(item => item.id)).toEqual(["2", "3"]);
  });
});
