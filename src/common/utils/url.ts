export const getUrlParams = (url: string) => {
  const urlParams = new URLSearchParams(url.split("?")[1]);
  return Object.fromEntries(urlParams.entries());
};

export const formatUrlProtocol = (url?: string) => {
  if (url && !url.startsWith("http")) {
    return `https:${url}`;
  }

  return url;
};

const getBiliVideoLink = (data: {
  type: "mv" | "audio" | "live";
  bvid?: string;
  sid?: string | number;
  roomId?: string | number;
  shortId?: string | number;
  pageIndex?: number;
}) => {
  if (data.type === "live") {
    return `https://live.bilibili.com/${data.shortId || data.roomId}`;
  }

  return `https://www.bilibili.com/${data?.type === "mv" ? `video/${data?.bvid}${(data.pageIndex ?? 0) > 1 ? `?p=${data.pageIndex}` : ""}` : `audio/au${data?.sid}`}`;
};

export const openBiliVideoLink = (data: {
  type: "mv" | "audio" | "live";
  bvid?: string;
  sid?: string | number;
  roomId?: string | number;
  shortId?: string | number;
  pageIndex?: number;
}) => {
  window.electron.openExternal(getBiliVideoLink(data));
};
