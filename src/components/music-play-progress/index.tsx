import { memo, useState } from "react";

import { Slider } from "@heroui/react";
import { twMerge } from "tailwind-merge";

import { formatDuration } from "@/common/utils/time";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

interface Props {
  isDisabled?: boolean;
  className?: string;
  trackClassName?: string;
}

const MusicPlayProgress = memo(({ isDisabled, className, trackClassName }: Props) => {
  const [hovered, setHovered] = useState(false);
  const currentTime = usePlayProgress(s => s.currentTime);
  const duration = usePlayList(s => s.duration);
  const seek = usePlayList(s => s.seek);
  const playItem = usePlayList(s => s.getPlayItem());
  const isLive = playItem?.type === "live";

  const shouldDisable = isDisabled || isLive;
  const showThumb = !shouldDisable && hovered;

  return (
    <div className={twMerge("flex w-3/4 items-center space-x-2", className)}>
      <div className="flex justify-center text-sm whitespace-nowrap opacity-70">
        {isLive ? "直播中" : currentTime ? formatDuration(currentTime) : "-:--"}
      </div>
      <Slider
        aria-label="播放进度"
        hideThumb={!showThumb}
        minValue={0}
        maxValue={duration || 0}
        value={isLive ? 0 : currentTime}
        onChange={v => seek(v as number)}
        isDisabled={shouldDisable}
        size="sm"
        color={showThumb ? "primary" : "foreground"}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex-1"
        classNames={{
          track: twMerge("h-[4px] cursor-pointer", trackClassName),
          thumb: "w-4 h-4 bg-primary after:hidden",
        }}
      />
      <span className="flex justify-center text-sm whitespace-nowrap opacity-70">
        {isLive ? "LIVE" : duration ? formatDuration(duration) : "-:--"}
      </span>
    </div>
  );
});

export default MusicPlayProgress;
