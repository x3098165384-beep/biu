import { useCallback, useEffect, useMemo, useRef } from "react";

import { RiSpeakFill, RiSpeakLine } from "@remixicon/react";
import clsx from "classnames";
import { useShallow } from "zustand/shallow";

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
import { usePlayProgress } from "@/store/play-progress";
import { useVideoDanmaku } from "@/store/video-danmaku";
import {
  buildVideoDanmakuCues,
  defaultLiveDanmakuSettings,
  defaultLiveDanmakuSpeechSettings,
  defaultVideoDanmakuSettings,
  sanitizeVideoDanmakuSettings,
  type LiveDanmakuLine,
} from "@shared/live";

const LiveDanmakuSpeechButton = () => {
  const playItem = usePlayList(s => s.getPlayItem());
  const { rawLiveDanmaku, rawLiveDanmakuSpeech, rawVideoDanmaku } = useFullScreenPlayerSettings(
    useShallow(s => ({
      rawLiveDanmaku: s.liveDanmaku,
      rawLiveDanmakuSpeech: s.liveDanmakuSpeech,
      rawVideoDanmaku: s.videoDanmaku,
    })),
  );
  const currentTime = usePlayProgress(s => s.currentTime);
  const videoDanmakuLines = useVideoDanmaku(s => s.lines);
  const loadVideoDanmaku = useVideoDanmaku(s => s.load);
  const isSupported = useLiveDanmakuSpeech(s => s.isSupported);
  const refreshSupport = useLiveDanmakuSpeech(s => s.refreshSupport);
  const toggle = useLiveDanmakuSpeech(s => s.toggle);
  const stop = useLiveDanmakuSpeech(s => s.stop);
  const enqueue = useLiveDanmakuSpeech(s => s.enqueue);
  const prevTargetKeyRef = useRef<string | undefined>(undefined);
  const prevVideoTimeMsRef = useRef<number | undefined>(undefined);

  const isLive = playItem?.type === "live" && Boolean(playItem.roomId);
  const isVideo = playItem?.type === "mv" && Boolean(playItem.bvid && playItem.cid);
  const isSpeechTarget = isLive || isVideo;
  const roomId = isLive ? playItem.roomId : undefined;
  const videoKey = isVideo ? `${playItem.bvid}-${playItem.cid}` : undefined;
  const liveDanmaku = rawLiveDanmaku || defaultLiveDanmakuSettings;
  const liveDanmakuSpeech = rawLiveDanmakuSpeech || defaultLiveDanmakuSpeechSettings;
  const videoDanmaku = useMemo(
    () => sanitizeVideoDanmakuSettings(rawVideoDanmaku || defaultVideoDanmakuSettings),
    [rawVideoDanmaku],
  );
  const enabled = Boolean(liveDanmakuSpeech.enabled);
  const videoCues = useMemo(
    () =>
      buildVideoDanmakuCues({
        lines: videoDanmakuLines,
        blockedKeywords: liveDanmaku.blockedKeywords,
      }),
    [liveDanmaku.blockedKeywords, videoDanmakuLines],
  );

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
    if (!isSpeechTarget) {
      prevTargetKeyRef.current = undefined;
      prevVideoTimeMsRef.current = undefined;
      if (enabled) stop();
      return;
    }

    const targetKey = isLive ? `live:${roomId}` : `video:${videoKey}`;
    if (prevTargetKeyRef.current !== undefined && prevTargetKeyRef.current !== targetKey) {
      resetLiveDanmakuSpeechRuntime();
      prevVideoTimeMsRef.current = undefined;
    }
    prevTargetKeyRef.current = targetKey;
  }, [enabled, isLive, isSpeechTarget, roomId, stop, videoKey]);

  useEffect(() => {
    if (!isVideo || !enabled || !videoDanmaku.enabled || !playItem?.bvid || !playItem.cid) return;
    void loadVideoDanmaku({ bvid: playItem.bvid, cid: playItem.cid });
  }, [enabled, isVideo, loadVideoDanmaku, playItem?.bvid, playItem?.cid, videoDanmaku.enabled]);

  useEffect(() => {
    if (!isVideo || !enabled || !videoDanmaku.enabled || !videoCues.length) {
      prevVideoTimeMsRef.current = undefined;
      return;
    }

    const currentMs = currentTime * 1000;
    const previousMs = prevVideoTimeMsRef.current;
    prevVideoTimeMsRef.current = currentMs;

    if (previousMs === undefined || currentMs <= previousMs || currentMs - previousMs > 10000) return;

    const cue = videoCues.findLast(item => item.time > previousMs && item.time <= currentMs);
    if (!cue) return;

    enqueue({
      id: cue.id,
      type: "danmaku",
      username: "",
      text: cue.text,
      time: cue.time,
    });
  }, [currentTime, enabled, enqueue, isVideo, videoCues, videoDanmaku.enabled]);

  if (!isSpeechTarget) return null;

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
