import { beforeEach, describe, expect, test, vi } from "vitest";

import { LiveStatus, type LiveRoomBaseInfo } from "@/service/live-room";
import { useLiveHistory } from "@/store/live-history";

const createRoom = (roomId: number, title = `room-${roomId}`): LiveRoomBaseInfo => ({
  room_id: roomId,
  short_id: roomId + 1000,
  uid: roomId,
  title,
  cover: `https://cover.test/${roomId}.png`,
  background: "",
  uname: `anchor-${roomId}`,
  live_status: LiveStatus.Live,
  area_name: "area",
});

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  useLiveHistory.setState({ items: [] });
});

describe("live history store", () => {
  test("adds a room", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);

    useLiveHistory.getState().add(createRoom(1, "first"));

    expect(useLiveHistory.getState().items).toMatchObject([
      {
        roomId: 1,
        shortId: 1001,
        title: "first",
        ownerName: "anchor-1",
        liveStatus: LiveStatus.Live,
        time: 100,
      },
    ]);
  });

  test("deduplicates by room id and moves replayed room to top", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValueOnce(300);

    useLiveHistory.getState().add(createRoom(1, "old"));
    useLiveHistory.getState().add(createRoom(2, "second"));
    useLiveHistory.getState().add(createRoom(1, "new"));

    const items = useLiveHistory.getState().items;
    expect(items.map(item => item.roomId)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ title: "new", time: 300 });
  });

  test("keeps at most 20 rooms", () => {
    for (let i = 1; i <= 21; i += 1) {
      vi.spyOn(Date, "now").mockReturnValue(i);
      useLiveHistory.getState().add(createRoom(i));
    }

    const items = useLiveHistory.getState().items;
    expect(items).toHaveLength(20);
    expect(items[0].roomId).toBe(21);
    expect(items.at(-1)?.roomId).toBe(2);
  });

  test("deletes one room", () => {
    useLiveHistory.getState().add(createRoom(1));
    useLiveHistory.getState().add(createRoom(2));

    useLiveHistory.getState().delete(1);

    expect(useLiveHistory.getState().items.map(item => item.roomId)).toEqual([2]);
  });

  test("clears rooms", () => {
    useLiveHistory.getState().add(createRoom(1));
    useLiveHistory.getState().add(createRoom(2));

    useLiveHistory.getState().clear();

    expect(useLiveHistory.getState().items).toEqual([]);
  });
});
