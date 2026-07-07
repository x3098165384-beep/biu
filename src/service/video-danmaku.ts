import { parseBiliVideoDanmakuXml } from "@shared/live";

import { axiosInstance } from "./request";

export const fetchVideoDanmakuLines = async (cid: string | number) => {
  const raw = await axiosInstance.get<string>("https://api.bilibili.com/x/v1/dm/list.so", {
    params: { oid: cid },
    responseType: "text",
  });

  return parseBiliVideoDanmakuXml(raw);
};
