import { liveRequest } from "./request";
import {
  extractLiveAudioCandidates,
  getLiveStatusMessage,
  LiveStatus,
  type LiveAudioCandidate,
  type LiveAudioPlayUrls,
  type LiveStream,
} from "@shared/live";

export { LiveStatus };

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
  candidates?: LiveAudioCandidate[];
  format: string;
  codec: string;
  quality: number;
}

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

export const getLiveAudioPlayUrls = async (roomId: number): Promise<LiveAudioPlayUrls> => {
  if (typeof window !== "undefined" && window.electron?.getLiveAudioPlayUrls) {
    return window.electron.getLiveAudioPlayUrls(roomId);
  }

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

  const candidates = extractLiveAudioCandidates(response.data.playurl_info?.playurl?.stream);
  const selected = candidates[0];

  if (!selected) {
    throw new Error("没有可播放的直播音频流");
  }

  return {
    roomId,
    audioUrl: selected.proxiedUrl || selected.audioUrl,
    candidates,
  };
};

export const getLiveAudioPlayUrl = async (roomId: number): Promise<LiveAudioPlayUrl> => {
  const data = await getLiveAudioPlayUrls(roomId);
  const selected = data.candidates[0];
  if (!selected) {
    throw new Error("没有可播放的直播音频流");
  }

  return {
    audioUrl: selected.proxiedUrl || selected.audioUrl || data.audioUrl,
    candidates: data.candidates,
    format: selected.format,
    codec: selected.codec,
    quality: selected.quality,
  };
};
