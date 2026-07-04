import { liveRequest } from "./request";

export enum LiveStatus {
  Offline = 0,
  Live = 1,
  Round = 2,
}

interface LiveRoomInitData {
  room_id: number;
  short_id: number;
  uid: number;
  is_hidden: boolean;
  is_locked: boolean;
  live_status: LiveStatus;
  encrypted: boolean;
  room_shield: number;
}

interface LiveRoomInitResponse {
  code: number;
  msg?: string;
  message?: string;
  data?: LiveRoomInitData;
}

export interface LiveRoomBaseInfo {
  room_id: number;
  uid: number;
  title: string;
  cover: string;
  background?: string;
  uname: string;
  live_status: LiveStatus;
  short_id: number;
  area_name?: string;
  parent_area_name?: string;
  live_url?: string;
}

interface LiveRoomBaseInfoResponse {
  code: number;
  message?: string;
  msg?: string;
  data?: {
    by_room_ids?: Record<string, LiveRoomBaseInfo>;
  };
}

interface LiveUrlInfo {
  host: string;
  extra: string;
}

interface LiveCodec {
  codec_name: string;
  current_qn: number;
  base_url: string;
  url_info?: LiveUrlInfo[];
}

interface LiveFormat {
  format_name: string;
  codec?: LiveCodec[];
}

interface LiveStream {
  protocol_name: string;
  format?: LiveFormat[];
}

interface LiveRoomPlayInfoResponse {
  code: number;
  message?: string;
  msg?: string;
  data?: {
    live_status?: LiveStatus;
    playurl_info?: {
      playurl?: {
        stream?: LiveStream[];
      };
    };
  };
}

export interface LiveAudioPlayUrl {
  audioUrl: string;
  format: string;
  codec: string;
  quality: number;
}

interface LiveAudioCandidate {
  format: string;
  codec: string;
  quality: number;
  baseUrl: string;
  urlInfo: LiveUrlInfo;
}

const formatPriority = ["fmp4", "ts"];
const codecPriority = ["avc", "hevc"];

export const parseLiveRoomInput = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const liveUrlMatch = trimmed.match(/live\.bilibili\.com\/(?:blanc\/)?(\d+)/i);
  const roomId = liveUrlMatch?.[1] ?? (/^\d+$/.test(trimmed) ? trimmed : undefined);

  return roomId ? Number(roomId) : undefined;
};

const assertResponseOk = (response: { code: number; message?: string; msg?: string }, fallback: string) => {
  if (response.code !== 0) {
    throw new Error(response.message || response.msg || fallback);
  }
};

const assertRoomPlayable = (room: LiveRoomInitData) => {
  if (room.is_hidden) {
    throw new Error("直播间已隐藏");
  }
  if (room.is_locked) {
    throw new Error("直播间已锁定");
  }
  if (room.encrypted) {
    throw new Error("暂不支持密码直播间");
  }
  if (room.room_shield) {
    throw new Error("直播间当前不可播放");
  }
};

const getLiveStatusMessage = (status?: LiveStatus) => {
  if (status === LiveStatus.Offline) return "主播未开播";
  if (status === LiveStatus.Round) return "直播间正在轮播，暂不作为直播音频播放";
  return "直播间当前不可播放";
};

export const getLiveRoomInit = async (roomId: number) => {
  const response = await liveRequest.get<LiveRoomInitResponse>("/room/v1/Room/room_init", {
    params: { id: roomId },
  });

  assertResponseOk(response, "获取直播间信息失败");

  if (!response.data) {
    throw new Error("直播间不存在");
  }

  assertRoomPlayable(response.data);

  return response.data;
};

export const getLiveRoomBaseInfo = async (roomId: number) => {
  const response = await liveRequest.get<LiveRoomBaseInfoResponse>("/xlive/web-room/v1/index/getRoomBaseInfo", {
    params: {
      room_ids: roomId,
      req_biz: "web_room_componet",
    },
  });

  assertResponseOk(response, "获取直播间信息失败");

  const roomInfo = response.data?.by_room_ids?.[String(roomId)];
  if (!roomInfo) {
    throw new Error("直播间不存在");
  }

  return roomInfo;
};

export const getLiveRoomInfo = async (roomId: number) => {
  const init = await getLiveRoomInit(roomId);
  const baseInfo = await getLiveRoomBaseInfo(init.room_id);

  return {
    ...baseInfo,
    room_id: init.room_id,
    short_id: init.short_id || baseInfo.short_id,
    uid: init.uid || baseInfo.uid,
    live_status: init.live_status,
  };
};

export const getLiveAudioPlayUrl = async (roomId: number): Promise<LiveAudioPlayUrl> => {
  const response = await liveRequest.get<LiveRoomPlayInfoResponse>("/xlive/web-room/v2/index/getRoomPlayInfo", {
    params: {
      room_id: roomId,
      protocol: "0,1",
      format: "0,1,2",
      codec: "0,1",
      qn: 10000,
      platform: "web",
      ptype: 8,
      only_audio: 1,
    },
  });

  assertResponseOk(response, "获取直播流失败");

  if (response.data?.live_status !== LiveStatus.Live) {
    throw new Error(getLiveStatusMessage(response.data?.live_status));
  }

  const candidates =
    response.data.playurl_info?.playurl?.stream
      ?.filter(stream => stream.protocol_name === "http_hls")
      .flatMap(stream =>
        stream.format?.flatMap(format =>
          format.codec?.map(codec => ({
            format: format.format_name,
            codec: codec.codec_name,
            quality: codec.current_qn,
            baseUrl: codec.base_url,
            urlInfo: codec.url_info?.[0],
          })),
        ),
      )
      .filter((candidate): candidate is LiveAudioCandidate => Boolean(candidate?.urlInfo?.host && candidate.baseUrl)) ??
    [];

  const selected = candidates.toSorted((a, b) => {
    const formatA = formatPriority.indexOf(a.format);
    const formatB = formatPriority.indexOf(b.format);
    if (formatA !== formatB)
      return (
        (formatA === -1 ? Number.MAX_SAFE_INTEGER : formatA) - (formatB === -1 ? Number.MAX_SAFE_INTEGER : formatB)
      );

    const codecA = codecPriority.indexOf(a.codec);
    const codecB = codecPriority.indexOf(b.codec);
    if (codecA !== codecB)
      return (codecA === -1 ? Number.MAX_SAFE_INTEGER : codecA) - (codecB === -1 ? Number.MAX_SAFE_INTEGER : codecB);

    return b.quality - a.quality;
  })[0];

  if (!selected?.urlInfo) {
    throw new Error("没有可播放的直播音频流");
  }

  return {
    audioUrl: `${selected.urlInfo.host}${selected.baseUrl}${selected.urlInfo.extra}`,
    format: selected.format,
    codec: selected.codec,
    quality: selected.quality,
  };
};
