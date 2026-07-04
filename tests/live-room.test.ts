import { beforeEach, describe, expect, test, vi } from "vitest";

import { getLiveAudioPlayUrl, parseLiveRoomInput } from "@/service/live-room";
import { liveRequest } from "@/service/request";

vi.mock("@/service/request", () => ({
  liveRequest: {
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("live-room service", () => {
  test("parseLiveRoomInput supports room id and live url", () => {
    expect(parseLiveRoomInput("7777")).toBe(7777);
    expect(parseLiveRoomInput("https://live.bilibili.com/7777?live_from=82002")).toBe(7777);
    expect(parseLiveRoomInput("https://example.com/7777")).toBeUndefined();
    expect(parseLiveRoomInput("")).toBeUndefined();
  });

  test("getLiveAudioPlayUrl selects hls fmp4 avc first", async () => {
    vi.mocked(liveRequest.get).mockResolvedValueOnce({
      code: 0,
      data: {
        live_status: 1,
        playurl_info: {
          playurl: {
            stream: [
              {
                protocol_name: "http_stream",
                format: [
                  {
                    format_name: "flv",
                    codec: [
                      {
                        codec_name: "avc",
                        current_qn: 250,
                        base_url: "/live.flv?",
                        url_info: [{ host: "https://flv.test", extra: "sig=1" }],
                      },
                    ],
                  },
                ],
              },
              {
                protocol_name: "http_hls",
                format: [
                  {
                    format_name: "ts",
                    codec: [
                      {
                        codec_name: "avc",
                        current_qn: 250,
                        base_url: "/live-ts.m3u8?",
                        url_info: [{ host: "https://hls.test", extra: "sig=2" }],
                      },
                    ],
                  },
                  {
                    format_name: "fmp4",
                    codec: [
                      {
                        codec_name: "hevc",
                        current_qn: 250,
                        base_url: "/live-hevc/index.m3u8?",
                        url_info: [{ host: "https://hls.test", extra: "sig=3" }],
                      },
                      {
                        codec_name: "avc",
                        current_qn: 250,
                        base_url: "/live-avc/index.m3u8?",
                        url_info: [{ host: "https://hls.test", extra: "sig=4" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });

    await expect(getLiveAudioPlayUrl(545068)).resolves.toMatchObject({
      audioUrl: "https://hls.test/live-avc/index.m3u8?sig=4",
      format: "fmp4",
      codec: "avc",
    });
  });
});
