import { useCallback, useEffect, useRef } from "react";

import { RiSpeakFill, RiSpeakLine } from "@remixicon/react";
import clsx from "classnames";

import IconButton from "@/components/icon-button";
import MusicDownloadButton from "@/components/music-download-button";
import MusicPlayMode from "@/components/music-play-mode";
import MusicRate from "@/components/music-rate";
import MusicVolume from "@/components/music-volume";
import OpenPlaylistDrawerButton from "@/components/open-playlist-drawer-button";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import { useLiveDanmakuConsumer } from "@/store/live-danmaku";
import { resetLiveDanmakuSpeechRuntime, useLiveDanmakuSpeech } from "@/store/live-danmaku-speech";
import { usePlayList } from "@/store/play-list";
import { defaultLiveDanmakuSpeechSettings, type LiveDanmakuLine } from "@shared/live";

const LiveDanmakuSpeechButton = () => {
  const playItem = usePlayList(s => s.getPlayItem());
  const liveDanmakuSpeech = useFullScreenPlayerSettings(
    s => s.liveDanmakuSpeech || defaultLiveDanmakuSpeechSettings,
  );
  const isSupported = useLiveDanmakuSpeech(s => s.isSupported);
  const refreshSupport = useLiveDanmakuSpeech(s => s.refreshSupport);
  const toggle = useLiveDanmakuSpeech(s => s.toggle);
  const stop = useLiveDanmakuSpeech(s => s.stop);
  const enqueue = useLiveDanmakuSpeech(s => s.enqueue);
  const prevRoomIdRef = useRef<number | undefined>(undefined);

  const isLive = playItem?.type === "live" && Boolean(playItem.roomId);
  const roomId = isLive ? playItem.roomId : undefined;
  const enabled = Boolean(liveDanmakuSpeech.enabled);

  const handleLine = useCallback(
    (line: LiveDanmakuLine, meta: { isNew: boolean; folded: boolean }) => {
      if (!meta.isNew || meta.folded) return;
      enqueue(line);
    },
    [enqueue],
  );

  useLiveDanmakuConsumer({
    roomId: roomId || 0,
    consumerId: "speech",
    enabled: Boolean(isLive && enabled && roomId),
    onLine: handleLine,
  });

  useEffect(() => {
    refreshSupport();
  }, [liveDanmakuSpeech.provider, refreshSupport]);

  useEffect(() => {
    if (!isLive) {
      prevRoomIdRef.current = undefined;
      if (enabled) stop();
      return;
    }

    if (prevRoomIdRef.current !== undefined && prevRoomIdRef.current !== roomId) {
      resetLiveDanmakuSpeechRuntime();
    }
    prevRoomIdRef.current = roomId;
  }, [enabled, isLive, roomId, stop]);

  if (!isLive) return null;

  const tooltip = !isSupported ? "当前环境不支持语音朗读" : enabled ? "关闭弹幕朗读" : "朗读弹幕";
  const Icon = enabled ? RiSpeakFill : RiSpeakLine;

  return (
    <IconButton
      aria-label={tooltip}
      tooltip={tooltip}
      isDisabled={!isSupported}
      onPress={toggle}
      className={clsx("flex-none", enabled && "text-primary")}
    >
      <Icon size={18} />
    </IconButton>
  );
};

const RightControl = () => {
  const playId = usePlayList(s => s.playId);
  const getPlayItem = usePlayList(s => s.getPlayItem);

  return (
    <div className="flex h-full items-center justify-end space-x-2">
      <MusicPlayMode />
      {Boolean(playId) && getPlayItem()?.source !== "local" && <MusicDownloadButton />}
      <OpenPlaylistDrawerButton />
      <LiveDanmakuSpeechButton />
      <MusicVolume />
      <MusicRate />
    </div>
  );
};

export default RightControl;
