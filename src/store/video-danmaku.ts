import { create } from "zustand";

import { fetchVideoDanmakuLines } from "@/service/video-danmaku";
import type { VideoDanmakuLine } from "@shared/live";

type VideoDanmakuStatus = "idle" | "loading" | "ready" | "error";

interface VideoDanmakuState {
  key?: string;
  status: VideoDanmakuStatus;
  lines: VideoDanmakuLine[];
  load: (params: { bvid?: string; cid?: string | number }) => Promise<void>;
  clear: () => void;
}

const cache = new Map<string, VideoDanmakuLine[]>();
let requestId = 0;

const buildKey = ({ bvid, cid }: { bvid?: string; cid?: string | number }) =>
  bvid && cid !== undefined ? `${bvid}-${cid}` : undefined;

export const useVideoDanmaku = create<VideoDanmakuState>((set, get) => ({
  key: undefined,
  status: "idle",
  lines: [],
  load: async params => {
    const key = buildKey(params);
    if (!key || params.cid === undefined) {
      set({ key: undefined, status: "idle", lines: [] });
      return;
    }

    if (get().key === key && get().status === "ready") return;

    const cached = cache.get(key);
    if (cached) {
      set({ key, status: "ready", lines: cached });
      return;
    }

    const currentRequestId = ++requestId;
    set({ key, status: "loading", lines: [] });

    try {
      const lines = await fetchVideoDanmakuLines(params.cid);
      if (currentRequestId !== requestId) return;
      cache.set(key, lines);
      set({ key, status: "ready", lines });
    } catch {
      if (currentRequestId !== requestId) return;
      set({ key, status: "error", lines: [] });
    }
  },
  clear: () => {
    requestId += 1;
    set({ key: undefined, status: "idle", lines: [] });
  },
}));
