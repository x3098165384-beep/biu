import { useEffect } from "react";

import { create } from "zustand";

import { connectLiveDanmaku, type LiveDanmakuConnection, type LiveDanmakuLine } from "@/service/live-danmaku";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import {
  appendLiveDanmakuLine,
  isLiveDanmakuLineBlocked,
  sanitizeLiveDanmakuSettings,
  type LiveDanmakuSettings,
} from "@shared/live";

export type LiveDanmakuStatus = "idle" | "connecting" | "connected" | "error";

export interface LiveDanmakuConsumerOptions {
  roomId: number;
  consumerId: string;
  enabled: boolean;
  onLine?: (line: LiveDanmakuLine, meta: { isNew: boolean; folded: boolean }) => void;
}

interface Consumer {
  roomId: number;
  onLine?: LiveDanmakuConsumerOptions["onLine"];
}

interface LiveDanmakuSharedState {
  roomId?: number;
  status: LiveDanmakuStatus;
  lines: LiveDanmakuLine[];
  subscribe: (options: LiveDanmakuConsumerOptions) => VoidFunction;
  clear: () => void;
}

const consumers = new Map<string, Consumer>();
let connection: LiveDanmakuConnection | null = null;
let rateLimit = { second: 0, count: 0 };
let activeRoomId: number | undefined;

const getSettings = () => sanitizeLiveDanmakuSettings(useFullScreenPlayerSettings.getState().liveDanmaku);

const resetRateLimit = () => {
  rateLimit = { second: 0, count: 0 };
};

const closeConnection = () => {
  connection?.close();
  connection = null;
  activeRoomId = undefined;
  resetRateLimit();
};

const notifyConsumers = (line: LiveDanmakuLine, meta: { isNew: boolean; folded: boolean }) => {
  consumers.forEach(consumer => {
    if (consumer.roomId === activeRoomId) {
      consumer.onLine?.(line, meta);
    }
  });
};

const shouldDropByRateLimit = (line: LiveDanmakuLine, settings: LiveDanmakuSettings) => {
  if (line.type === "super_chat") return false;

  const second = Math.floor(Date.now() / 1000);
  if (rateLimit.second !== second) {
    rateLimit = { second, count: 0 };
  }
  if (rateLimit.count >= settings.maxPerSecond) {
    return true;
  }
  rateLimit.count += 1;
  return false;
};

const handleIncomingLine = (line: LiveDanmakuLine) => {
  const settings = getSettings();
  if (isLiveDanmakuLineBlocked(line, settings.blockedKeywords)) return;
  if (shouldDropByRateLimit(line, settings)) return;

  const result = appendLiveDanmakuLine(useLiveDanmaku.getState().lines, line, settings);
  useLiveDanmaku.setState({ lines: result.lines });
  notifyConsumers(result.line, { isNew: result.isNew, folded: result.folded });
};

const ensureConnection = (roomId: number) => {
  if (activeRoomId === roomId) return;

  closeConnection();
  activeRoomId = roomId;
  useLiveDanmaku.setState({ roomId, status: "connecting", lines: [] });

  void connectLiveDanmaku(roomId, {
    onOpen: () => {
      if (activeRoomId === roomId) {
        useLiveDanmaku.setState({ status: "connected" });
      }
    },
    onMessage: line => {
      if (activeRoomId === roomId) {
        handleIncomingLine(line);
      }
    },
    onError: () => {
      if (activeRoomId === roomId) {
        useLiveDanmaku.setState({ status: "error" });
      }
    },
    onClose: () => {
      if (activeRoomId === roomId) {
        useLiveDanmaku.setState({ status: "error" });
      }
    },
  })
    .then(nextConnection => {
      if (activeRoomId !== roomId || !consumers.size) {
        nextConnection.close();
        return;
      }
      connection = nextConnection;
    })
    .catch(() => {
      if (activeRoomId === roomId) {
        useLiveDanmaku.setState({ status: "error" });
      }
    });
};

const reconcileConnection = () => {
  const nextConsumer = consumers.values().next().value as Consumer | undefined;
  if (!nextConsumer) {
    closeConnection();
    useLiveDanmaku.setState({ roomId: undefined, status: "idle", lines: [] });
    return;
  }

  ensureConnection(nextConsumer.roomId);
};

export const useLiveDanmaku = create<LiveDanmakuSharedState>(set => ({
  roomId: undefined,
  status: "idle",
  lines: [],
  subscribe: ({ roomId, consumerId, enabled, onLine }) => {
    if (!enabled) {
      consumers.delete(consumerId);
      reconcileConnection();
      return () => {};
    }

    consumers.set(consumerId, { roomId, onLine });
    if (activeRoomId !== undefined && activeRoomId !== roomId) {
      set({ lines: [] });
      resetRateLimit();
    }
    reconcileConnection();

    return () => {
      const consumer = consumers.get(consumerId);
      if (consumer?.roomId === roomId) {
        consumers.delete(consumerId);
        reconcileConnection();
      }
    };
  },
  clear: () => {
    closeConnection();
    consumers.clear();
    set({ roomId: undefined, status: "idle", lines: [] });
  },
}));

export const useLiveDanmakuConsumer = ({ roomId, consumerId, enabled, onLine }: LiveDanmakuConsumerOptions) => {
  useEffect(() => {
    return useLiveDanmaku.getState().subscribe({ roomId, consumerId, enabled, onLine });
  }, [consumerId, enabled, onLine, roomId]);
};
