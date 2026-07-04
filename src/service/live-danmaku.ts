import { BilibiliApiClient, LiveWS, parseLiveConfig, type MessageData } from "bilibili-live-danmaku";

export type LiveDanmakuLineType = "danmaku" | "super_chat";

export interface LiveDanmakuLine {
  id: string;
  type: LiveDanmakuLineType;
  username: string;
  text: string;
  price?: number;
  time: number;
}

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
  const client = new BilibiliApiClient();
  const res = await client.xliveGetDanmuInfo({ id: roomId });
  const config = parseLiveConfig(res.data);
  const live = new LiveWS(roomId, config);

  const handleOpen = () => onOpen?.();
  const handleError = (event: Event) => onError?.(event);
  const handleClose = () => onClose?.();
  const handleDanmaku = ({ data }: { data: MessageData.DANMU_MSG }) => {
    const line = normalizeDanmakuMessage(data);
    if (line) onMessage?.(line);
  };
  const handleSuperChat = ({ data }: { data: MessageData.SUPER_CHAT_MESSAGE }) => {
    const line = normalizeSuperChatMessage(data);
    if (line) onMessage?.(line);
  };

  live.addEventListener("CONNECT_SUCCESS", handleOpen);
  live.addEventListener("DANMU_MSG", handleDanmaku);
  live.addEventListener("SUPER_CHAT_MESSAGE", handleSuperChat);
  live.addEventListener("error", handleError);
  live.addEventListener("close", handleClose);

  return {
    close: () => {
      live.removeEventListener("CONNECT_SUCCESS", handleOpen);
      live.removeEventListener("DANMU_MSG", handleDanmaku);
      live.removeEventListener("SUPER_CHAT_MESSAGE", handleSuperChat);
      live.removeEventListener("error", handleError);
      live.removeEventListener("close", handleClose);
      live.close();
    },
  };
};
