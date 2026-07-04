import { RiDeleteBinLine, RiExternalLinkLine, RiFileMusicLine, RiFileVideoLine, RiStarLine } from "@remixicon/react";

export const getMenus = ({ isLogin, isLocal, isLive }: { isLogin: boolean; isLocal: boolean; isLive?: boolean }) =>
  [
    {
      key: "favorite",
      label: "收藏",
      icon: <RiStarLine size={18} />,
      hidden: isLocal || isLive || !isLogin,
    },
    {
      key: "download-audio",
      label: "下载音频",
      icon: <RiFileMusicLine size={18} />,
      hidden: isLocal || isLive,
    },
    {
      icon: <RiFileVideoLine size={18} />,
      key: "download-video",
      label: "下载视频",
      hidden: isLocal || isLive,
    },
    {
      key: "bililink",
      label: "在 B 站打开",
      icon: <RiExternalLinkLine size={18} />,
      hidden: isLocal,
    },
    {
      key: "del",
      color: "danger" as const,
      label: "从列表删除",
      icon: <RiDeleteBinLine size={18} />,
    },
  ].filter(item => !item.hidden);
