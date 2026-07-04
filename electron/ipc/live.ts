import { ipcMain, type WebContents } from "electron";
import log from "electron-log";
import got from "got";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";

import { BilibiliApiClient, LiveWS, type MessageData } from "bilibili-live-danmaku";

import { getCookieString } from "../network/cookie";
import { UserAgent } from "../network/user-agent";
import { userStore } from "../store";
import { channel } from "./channel";
import {
  buildLiveDanmakuCandidates,
  extractLiveAudioCandidates,
  getLiveStatusMessage,
  LiveStatus,
  sortLiveAudioCandidates,
  type LiveAudioCandidate,
  type LiveAudioPlayUrls,
  type LiveDanmakuCandidate,
  type LiveDanmakuLine,
  type LiveDanmakuLineType,
} from "../../shared/live";

interface LiveRoomPlayInfoResponse {
  code: number;
  message?: string;
  msg?: string;
  data?: {
    live_status?: LiveStatus;
    playurl_info?: {
      playurl?: {
        stream?: Parameters<typeof extractLiveAudioCandidates>[0];
      };
    };
  };
}

interface LiveDanmakuConnection {
  roomId: number;
  live: LiveWS;
}

interface LiveRoomInitResponse {
  code: number;
  message?: string;
  msg?: string;
  data?: {
    room_id?: number;
  };
}

interface LiveDanmakuInfo {
  token?: string;
  host_list?: {
    host: string;
    port: number;
    wss_port: number;
    ws_port: number;
  }[];
}

interface ConnectedLiveDanmaku {
  live: LiveWS;
  candidate: LiveDanmakuCandidate;
  usedFallback: boolean;
}

const liveRequestHeaders = async () => ({
  Cookie: await getCookieString(),
  Referer: "https://live.bilibili.com/",
  Origin: "https://live.bilibili.com",
  "User-Agent": UserAgent,
});

const parseCookieValue = (cookie: string, key: string) =>
  cookie
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith(`${key}=`))
    ?.slice(key.length + 1);

const getDanmakuBuvid = (cookie: string) =>
  parseCookieValue(cookie, "buvid4") || parseCookieValue(cookie, "buvid3") || parseCookieValue(cookie, "buvid_fp");

const isAllowedLiveMediaHost = (host: string) => {
  const hostname = host.toLowerCase();
  return [
    "bilivideo.com",
    "bilivideo.cn",
    "bilibili.com",
    "hdslb.com",
    "acgvideo.com",
    "biliapi.net",
    "biliapi.com",
  ].some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`));
};

class LiveHlsProxy {
  private server?: http.Server;
  private port?: number;
  private readonly token = randomUUID();

  async proxify(url: string) {
    await this.ensureStarted();
    return `http://127.0.0.1:${this.port}/hls/${encodeURIComponent(url)}?token=${this.token}`;
  }

  private async ensureStarted() {
    if (this.server?.listening && this.port) return;

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        if (address && typeof address === "object") {
          this.port = address.port;
          resolve();
        } else {
          reject(new Error("直播代理启动失败"));
        }
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      if (!req.url) {
        res.writeHead(400).end();
        return;
      }

      const proxyUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (proxyUrl.searchParams.get("token") !== this.token) {
        res.writeHead(403).end();
        return;
      }

      const encodedTarget = proxyUrl.pathname.replace(/^\/hls\//, "");
      const targetUrl = new URL(decodeURIComponent(encodedTarget));
      if (!isAllowedLiveMediaHost(targetUrl.hostname)) {
        res.writeHead(403).end();
        return;
      }

      const headers = await liveRequestHeaders();
      const upstream = await got.get(targetUrl.toString(), {
        headers,
        timeout: { request: 12000 },
        throwHttpErrors: false,
        responseType: "buffer",
      });

      if (upstream.statusCode >= 400) {
        res.writeHead(upstream.statusCode).end(upstream.body);
        return;
      }

      const contentType = upstream.headers["content-type"] || "";
      const isManifest =
        contentType.includes("mpegurl") ||
        contentType.includes("application/vnd.apple.mpegurl") ||
        targetUrl.pathname.endsWith(".m3u8");

      if (!isManifest) {
        res.writeHead(upstream.statusCode, {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": contentType || "application/octet-stream",
        });
        res.end(upstream.body);
        return;
      }

      const text = upstream.body.toString("utf8");
      const rewritten = await this.rewriteManifest(text, targetUrl);
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "Content-Type": "application/vnd.apple.mpegurl",
      });
      res.end(rewritten);
    } catch (error) {
      log.warn("[live-hls-proxy] request failed", error);
      res.writeHead(502).end();
    }
  }

  private async rewriteManifest(text: string, baseUrl: URL) {
    const rewriteUrl = async (raw: string) => {
      const target = new URL(raw, baseUrl);
      if (!isAllowedLiveMediaHost(target.hostname)) return raw;
      return this.proxify(target.toString());
    };

    const lines = await Promise.all(
      text.split(/\r?\n/).map(async line => {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch?.[1]) {
          const nextUri = await rewriteUrl(uriMatch[1]);
          return line.replace(uriMatch[1], nextUri);
        }
        if (!line.trim() || line.startsWith("#")) return line;
        return rewriteUrl(line.trim());
      }),
    );

    return lines.join("\n");
  }
}

const hlsProxy = new LiveHlsProxy();
const danmakuConnections = new Map<number, LiveDanmakuConnection>();

const assertResponseOk = (response: { code: number; message?: string; msg?: string }, fallback: string) => {
  if (response.code !== 0) {
    throw new Error(response.message || response.msg || fallback);
  }
};

const probeManifest = async (url: string) => {
  try {
    const response = await got.get(url, {
      headers: await liveRequestHeaders(),
      timeout: { request: 8000 },
      throwHttpErrors: false,
      responseType: "text",
    });
    return response.statusCode >= 200 && response.statusCode < 400 && response.body.includes("#EXTM3U");
  } catch {
    return false;
  }
};

const getLiveAudioPlayUrls = async (roomId: number): Promise<LiveAudioPlayUrls> => {
  const response = await got
    .get("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo", {
      searchParams: {
        room_id: roomId,
        protocol: "0,1",
        format: "0,1,2",
        codec: "0,1",
        qn: 10000,
        platform: "web",
        ptype: 8,
        only_audio: 1,
      },
      headers: await liveRequestHeaders(),
      responseType: "json",
      timeout: { request: 12000 },
    })
    .json<LiveRoomPlayInfoResponse>();

  assertResponseOk(response, "获取直播流失败");
  if (response.data?.live_status !== LiveStatus.Live) {
    throw new Error(getLiveStatusMessage(response.data?.live_status));
  }

  const candidates = extractLiveAudioCandidates(response.data.playurl_info?.playurl?.stream);
  if (!candidates.length) {
    throw new Error("没有可播放的直播音频流");
  }

  const probedCandidates = await Promise.all(
    candidates.map(async candidate => ({
      ...candidate,
      available: await probeManifest(candidate.audioUrl),
      proxiedUrl: await hlsProxy.proxify(candidate.audioUrl),
    })),
  );
  const sorted = sortLiveAudioCandidates(probedCandidates).map((candidate, index) => ({
    ...candidate,
    priority: index,
  }));

  return {
    roomId,
    audioUrl: sorted[0].proxiedUrl || sorted[0].audioUrl,
    candidates: sorted,
  };
};

const createLineId = (type: LiveDanmakuLineType, time: number, text: string) => `${type}-${time}-${text}`;

export const normalizeDanmakuMessage = (data: MessageData.DANMU_MSG): LiveDanmakuLine | undefined => {
  const text = data.info?.[1]?.trim();
  if (!text) return undefined;

  const username = data.info?.[2]?.[1] || "匿名用户";
  const time = (data.info?.[0]?.[4] || Math.floor(Date.now() / 1000)) * 1000;

  return {
    id: createLineId("danmaku", time, `${username}-${text}`),
    type: "danmaku",
    username,
    text,
    time,
  };
};

export const normalizeSuperChatMessage = (data: MessageData.SUPER_CHAT_MESSAGE): LiveDanmakuLine | undefined => {
  const text = data.data?.message?.trim();
  if (!text) return undefined;

  const username = data.data?.user_info?.uname || "匿名用户";
  const time = (data.data?.ts || Math.floor(Date.now() / 1000)) * 1000;

  return {
    id: createLineId("super_chat", time, `${username}-${text}`),
    type: "super_chat",
    username,
    text,
    price: data.data?.price,
    time,
  };
};

const closeDanmaku = (webContentsId: number) => {
  const connection = danmakuConnections.get(webContentsId);
  if (!connection) return;
  connection.live.close();
  danmakuConnections.delete(webContentsId);
};

const sendDanmakuStatus = (webContents: WebContents, status: "connected" | "closed" | "error", message?: string) => {
  webContents.send(channel.live.danmakuStatus, { status, message });
};

const getLongRoomId = async (roomId: number) => {
  const response = await got
    .get("https://api.live.bilibili.com/room/v1/Room/room_init", {
      searchParams: { id: roomId },
      headers: await liveRequestHeaders(),
      responseType: "json",
      timeout: { request: 12000 },
    })
    .json<LiveRoomInitResponse>();

  assertResponseOk(response, "获取直播间信息失败");

  const longRoomId = response.data?.room_id;
  if (!longRoomId) {
    throw new Error("直播间不存在");
  }

  return longRoomId;
};

const getDanmakuInfo = async (roomId: number) => {
  const client = new BilibiliApiClient({
    cookie: await getCookieString(),
    userAgent: UserAgent,
  });
  const response = await client.xliveGetDanmuInfo({ id: roomId });
  return response.data as LiveDanmakuInfo;
};

const connectToDanmakuCandidate = ({
  candidate,
  roomId,
  token,
  uid,
  buvid,
}: {
  candidate: LiveDanmakuCandidate;
  roomId: number;
  token: string;
  uid: number;
  buvid?: string;
}) =>
  new Promise<LiveWS>((resolve, reject) => {
    let settled = false;
    const live = new LiveWS(roomId, {
      address: candidate.address,
      authBody: {
        uid,
        roomid: roomId,
        protover: 3,
        platform: "web",
        type: 2,
        key: token,
        buvid,
      },
    });

    const timeout = setTimeout(() => {
      settle(() => {
        live.close();
        reject(new Error("弹幕连接超时"));
      });
    }, 8000);

    const cleanup = () => {
      clearTimeout(timeout);
      live.removeEventListener("CONNECT_SUCCESS", handleConnect);
      live.removeEventListener("error", handleError);
      live.removeEventListener("close", handleClose);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const handleConnect = () => {
      settle(() => resolve(live));
    };

    const handleError = (event: Event) => {
      settle(() => {
        live.close();
        reject(new Error(`弹幕节点连接错误: ${event.type}`));
      });
    };

    const handleClose = (event: CloseEvent) => {
      settle(() => {
        reject(new Error(`弹幕节点关闭: ${event.code || "unknown"} ${event.reason || ""}`.trim()));
      });
    };

    live.addEventListener("CONNECT_SUCCESS", handleConnect);
    live.addEventListener("error", handleError);
    live.addEventListener("close", handleClose);
  });

const connectLiveDanmakuWithFallback = async ({
  roomId,
  token,
  candidates,
  uid,
  buvid,
}: {
  roomId: number;
  token: string;
  candidates: LiveDanmakuCandidate[];
  uid: number;
  buvid?: string;
}): Promise<ConnectedLiveDanmaku> => {
  let lastError: unknown;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      log.info("[live-danmaku] connecting", {
        roomId,
        host: candidate.host,
        port: candidate.port,
        index,
        total: candidates.length,
      });
      const live = await connectToDanmakuCandidate({ candidate, roomId, token, uid, buvid });
      return {
        live,
        candidate,
        usedFallback: index > 0,
      };
    } catch (error) {
      lastError = error;
      log.warn("[live-danmaku] candidate failed", {
        roomId,
        host: candidate.host,
        port: candidate.port,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("弹幕节点全部连接失败");
};

const subscribeLiveDanmaku = async (webContents: WebContents, roomId: number) => {
  closeDanmaku(webContents.id);

  const longRoomId = await getLongRoomId(roomId);
  const danmakuInfo = await getDanmakuInfo(longRoomId);
  const token = danmakuInfo.token;
  const candidates = buildLiveDanmakuCandidates(danmakuInfo.host_list);
  if (!token) {
    throw new Error("获取弹幕鉴权失败");
  }
  if (!candidates.length) {
    throw new Error("没有可用的弹幕服务器");
  }

  const cookie = await getCookieString();
  const connected = await connectLiveDanmakuWithFallback({
    roomId: longRoomId,
    token,
    candidates,
    uid: Number(userStore.get("mid") || 0),
    buvid: getDanmakuBuvid(cookie),
  });
  const { live } = connected;
  danmakuConnections.set(webContents.id, { roomId: longRoomId, live });

  log.info("[live-danmaku] connected", {
    roomId,
    longRoomId,
    host: connected.candidate.host,
    port: connected.candidate.port,
    hostCount: candidates.length,
    usedFallback: connected.usedFallback,
  });
  sendDanmakuStatus(webContents, "connected");

  const handleError = (event: Event) => {
    log.warn("[live-danmaku] connection error", {
      roomId: longRoomId,
      host: connected.candidate.host,
      eventType: event.type,
    });
    sendDanmakuStatus(webContents, "error", "弹幕连接失败");
  };

  const handleClose = (event: CloseEvent) => {
    danmakuConnections.delete(webContents.id);
    log.warn("[live-danmaku] connection closed", {
      roomId: longRoomId,
      host: connected.candidate.host,
      code: event.code,
      reason: event.reason,
    });
    sendDanmakuStatus(webContents, "closed");
  };
  const handleDanmaku = ({ data }: { data: MessageData.DANMU_MSG }) => {
    const line = normalizeDanmakuMessage(data);
    if (line && !webContents.isDestroyed()) webContents.send(channel.live.danmakuMessage, line);
  };
  const handleSuperChat = ({ data }: { data: MessageData.SUPER_CHAT_MESSAGE }) => {
    const line = normalizeSuperChatMessage(data);
    if (line && !webContents.isDestroyed()) webContents.send(channel.live.danmakuMessage, line);
  };

  live.addEventListener("DANMU_MSG", handleDanmaku);
  live.addEventListener("SUPER_CHAT_MESSAGE", handleSuperChat);
  live.addEventListener("error", handleError);
  live.addEventListener("close", handleClose);

  webContents.once("destroyed", () => closeDanmaku(webContents.id));
};

export function registerLiveHandlers() {
  ipcMain.handle(channel.live.getAudioPlayUrls, async (_, roomId: number) => getLiveAudioPlayUrls(roomId));

  ipcMain.handle(channel.live.danmakuSubscribe, async (event, roomId: number) => {
    try {
      await subscribeLiveDanmaku(event.sender, roomId);
    } catch (error) {
      log.warn("[live-danmaku] subscribe failed", {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      });
      sendDanmakuStatus(event.sender, "error", "弹幕连接失败");
      throw error;
    }
  });

  ipcMain.handle(channel.live.danmakuClose, event => {
    closeDanmaku(event.sender.id);
  });
}

export type { LiveAudioCandidate };
