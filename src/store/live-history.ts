import { create } from "zustand";
import { persist } from "zustand/middleware";

import { LiveStatus, type LiveRoomBaseInfo } from "@/service/live-room";

export interface LiveHistoryItem {
  roomId: number;
  shortId?: number;
  title: string;
  cover?: string;
  background?: string;
  ownerName: string;
  ownerMid: number;
  liveStatus: LiveStatus;
  areaName?: string;
  time: number;
}

export interface LiveHistoryState {
  items: LiveHistoryItem[];
}

export interface LiveHistoryAction {
  add: (room: LiveRoomBaseInfo) => void;
  delete: (roomId: number) => void;
  clear: () => void;
}

const LIVE_HISTORY_LIMIT = 20;

const toHistoryItem = (room: LiveRoomBaseInfo): LiveHistoryItem => ({
  roomId: room.room_id,
  shortId: room.short_id,
  title: room.title || `直播间 ${room.short_id || room.room_id}`,
  cover: room.cover,
  background: room.background,
  ownerName: room.uname,
  ownerMid: room.uid,
  liveStatus: room.live_status,
  areaName: room.area_name,
  time: Date.now(),
});

export const useLiveHistory = create<LiveHistoryState & LiveHistoryAction>()(
  persist(
    (set, get) => ({
      items: [],
      add: room => {
        const newItem = toHistoryItem(room);
        const rest = get().items.filter(item => item.roomId !== newItem.roomId);
        set({ items: [newItem, ...rest].slice(0, LIVE_HISTORY_LIMIT) });
      },
      delete: roomId => set(state => ({ items: state.items.filter(item => item.roomId !== roomId) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "live-history",
      partialize: state => ({ items: state.items }),
    },
  ),
);
