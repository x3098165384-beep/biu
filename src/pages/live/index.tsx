import { useState } from "react";

import { addToast, Button, Chip, Input } from "@heroui/react";
import { RiExternalLinkLine, RiLiveLine, RiPlayFill } from "@remixicon/react";

import Image from "@/components/image";
import ScrollContainer from "@/components/scroll-container";
import { getLiveRoomInfo, LiveStatus, parseLiveRoomInput, type LiveRoomBaseInfo } from "@/service/live-room";
import { usePlayList } from "@/store/play-list";

const getStatusText = (status?: LiveStatus) => {
  if (status === LiveStatus.Live) return "直播中";
  if (status === LiveStatus.Round) return "轮播中";
  return "未开播";
};

const LivePage = () => {
  const [input, setInput] = useState("");
  const [roomInfo, setRoomInfo] = useState<LiveRoomBaseInfo>();
  const [loading, setLoading] = useState(false);

  const playRoom = async () => {
    const roomId = parseLiveRoomInput(input);
    if (!roomId) {
      addToast({ title: "请输入有效的直播间链接或房间号", color: "warning" });
      return;
    }

    setLoading(true);
    try {
      const room = await getLiveRoomInfo(roomId);
      setRoomInfo(room);

      if (room.live_status !== LiveStatus.Live) {
        addToast({ title: getStatusText(room.live_status), color: "warning" });
        return;
      }

      await usePlayList.getState().play({
        type: "live",
        roomId: room.room_id,
        shortId: room.short_id,
        liveStatus: room.live_status,
        areaName: room.area_name,
        title: room.title,
        cover: room.cover || room.background,
        ownerName: room.uname,
        ownerMid: room.uid,
      });

      addToast({ title: "已开始收听直播", color: "success" });
    } catch (error) {
      addToast({
        title: error instanceof Error ? error.message : "获取直播间失败",
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  const openRoom = () => {
    const roomId = roomInfo?.short_id || roomInfo?.room_id || parseLiveRoomInput(input);
    if (roomId) {
      window.electron.openExternal(`https://live.bilibili.com/${roomId}`);
    }
  };

  return (
    <ScrollContainer enableBackToTop className="h-full w-full px-4 pb-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2">
          <RiLiveLine size={22} />
          直播收听
        </h1>
      </div>

      <div className="mb-6 flex max-w-3xl items-end gap-2">
        <Input
          label="直播间"
          placeholder="https://live.bilibili.com/7777"
          value={input}
          onValueChange={setInput}
          onKeyDown={event => {
            if (event.key === "Enter") {
              void playRoom();
            }
          }}
        />
        <Button
          color="primary"
          className="dark:text-black"
          isLoading={loading}
          startContent={!loading && <RiPlayFill size={18} />}
          onPress={playRoom}
        >
          播放
        </Button>
      </div>

      {roomInfo && (
        <div className="border-default-200 flex max-w-3xl items-center gap-4 rounded-md border p-3">
          <Image
            src={roomInfo.cover || roomInfo.background}
            width={96}
            height={60}
            className="bg-default-100 h-[60px] w-24 shrink-0 rounded-md object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <Chip color={roomInfo.live_status === LiveStatus.Live ? "danger" : "default"} size="sm" variant="flat">
                {getStatusText(roomInfo.live_status)}
              </Chip>
              {roomInfo.area_name && <span className="text-foreground-500 text-xs">{roomInfo.area_name}</span>}
            </div>
            <div className="truncate text-sm font-medium">{roomInfo.title}</div>
            <div className="text-foreground-500 mt-1 truncate text-xs">{roomInfo.uname}</div>
          </div>
          <Button isIconOnly size="sm" variant="light" onPress={openRoom}>
            <RiExternalLinkLine size={18} />
          </Button>
        </div>
      )}
    </ScrollContainer>
  );
};

export default LivePage;
