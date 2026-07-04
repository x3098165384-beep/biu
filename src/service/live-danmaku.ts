import { type MessageData } from "bilibili-live-danmaku";

import type { LiveDanmakuLine, LiveDanmakuLineType } from "@shared/live";

export type { LiveDanmakuLine };

export interface LiveDanmakuHandlers {
  onOpen?: () => void;
  onMessage?: (line: LiveDanmakuLine) => void;
  onError?: (error: Event) => void;
  onClose?: () => void;
}

export interface LiveDanmakuConnection {
  close: () => void;
}

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

export const connectLiveDanmaku = async (
  roomId: number,
  { onOpen, onMessage, onError, onClose }: LiveDanmakuHandlers,
): Promise<LiveDanmakuConnection> => {
  const removeMessageListener = window.electron.onLiveDanmakuMessage(onMessage || (() => {}));
  const removeStatusListener = window.electron.onLiveDanmakuStatus(payload => {
    if (payload.status === "connected") {
      onOpen?.();
      return;
    }
    if (payload.status === "error") {
      onError?.(new Event("error"));
      return;
    }
    onClose?.();
  });

  await window.electron.subscribeLiveDanmaku(roomId);

  return {
    close: () => {
      removeMessageListener();
      removeStatusListener();
      void window.electron.closeLiveDanmaku();
    },
  };
};
