export enum LiveStatus {
  Offline = 0,
  Live = 1,
  Round = 2,
}

export interface LiveUrlInfo {
  host: string;
  extra: string;
}

export interface LiveCodec {
  codec_name: string;
  current_qn: number;
  base_url: string;
  url_info?: LiveUrlInfo[];
}

export interface LiveFormat {
  format_name: string;
  codec?: LiveCodec[];
}

export interface LiveStream {
  protocol_name: string;
  format?: LiveFormat[];
}

export interface LiveAudioCandidate {
  id: string;
  audioUrl: string;
  proxiedUrl?: string;
  format: string;
  codec: string;
  quality: number;
  host: string;
  priority: number;
  available?: boolean;
}

export interface LiveAudioPlayUrls {
  roomId: number;
  audioUrl: string;
  candidates: LiveAudioCandidate[];
}

export type LiveDanmakuLineType = "danmaku" | "super_chat";

export interface LiveDanmakuLine {
  id: string;
  type: LiveDanmakuLineType;
  username: string;
  text: string;
  price?: number;
  time: number;
  repeatCount?: number;
}

export interface LiveDanmakuHostInfo {
  host: string;
  wss_port?: number;
}

export interface LiveDanmakuCandidate {
  host: string;
  port: number;
  address: string;
}

export interface LiveDanmakuSettings {
  enabled: boolean;
  showUsername: boolean;
  showSuperChat: boolean;
  maxLines: number;
  maxPerSecond: number;
  duplicateWindowSeconds: number;
  blockedKeywords: string;
}

export const defaultLiveDanmakuSettings: LiveDanmakuSettings = {
  enabled: true,
  showUsername: false,
  showSuperChat: true,
  maxLines: 80,
  maxPerSecond: 8,
  duplicateWindowSeconds: 12,
  blockedKeywords: "",
};

const formatPriority = ["fmp4", "ts", "flv"];
const codecPriority = ["avc", "hevc"];

const rank = (list: string[], value: string) => {
  const index = list.indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const normalizeHost = (host: string) => host.replace(/\/$/, "");

export const createLiveCandidateId = ({
  format,
  codec,
  quality,
  host,
  baseUrl,
}: {
  format: string;
  codec: string;
  quality: number;
  host: string;
  baseUrl: string;
}) => `${format}:${codec}:${quality}:${normalizeHost(host)}:${baseUrl}`;

export const extractLiveAudioCandidates = (streams?: LiveStream[]): LiveAudioCandidate[] => {
  const candidates =
    streams
      ?.filter(stream => stream.protocol_name === "http_hls")
      .flatMap(stream =>
        stream.format?.flatMap(format =>
          format.codec?.flatMap(codec =>
            codec.url_info?.map(urlInfo => {
              const host = normalizeHost(urlInfo.host);
              const audioUrl = `${host}${codec.base_url}${urlInfo.extra || ""}`;
              return {
                id: createLiveCandidateId({
                  format: format.format_name,
                  codec: codec.codec_name,
                  quality: codec.current_qn,
                  host,
                  baseUrl: codec.base_url,
                }),
                audioUrl,
                format: format.format_name,
                codec: codec.codec_name,
                quality: codec.current_qn,
                host,
                priority: 0,
              };
            }),
          ),
        ),
      )
      .filter((candidate): candidate is LiveAudioCandidate => Boolean(candidate?.audioUrl)) ?? [];

  return sortLiveAudioCandidates(candidates).map((candidate, index) => ({
    ...candidate,
    priority: index,
  }));
};

export const sortLiveAudioCandidates = (candidates: LiveAudioCandidate[]) =>
  [...candidates].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;

    const formatDiff = rank(formatPriority, a.format) - rank(formatPriority, b.format);
    if (formatDiff !== 0) return formatDiff;

    const codecDiff = rank(codecPriority, a.codec) - rank(codecPriority, b.codec);
    if (codecDiff !== 0) return codecDiff;

    if (a.quality !== b.quality) return b.quality - a.quality;

    return a.host.localeCompare(b.host);
  });

export const getLiveStatusMessage = (status?: LiveStatus) => {
  if (status === LiveStatus.Offline) return "主播未开播";
  if (status === LiveStatus.Round) return "直播间正在轮播，暂不作为直播音频播放";
  return "直播间当前不可播放";
};

export const splitBlockedKeywords = (value?: string) =>
  (value || "")
    .split(/[\n,，]/)
    .map(item => item.trim())
    .filter(Boolean);

export const buildLiveDanmakuCandidates = (hostList?: LiveDanmakuHostInfo[]): LiveDanmakuCandidate[] => {
  const seen = new Set<string>();
  const candidates: LiveDanmakuCandidate[] = [];

  hostList?.forEach(({ host, wss_port: port }) => {
    if (!host || !port) return;

    const key = `${host}:${port}`;
    if (seen.has(key)) return;

    seen.add(key);
    candidates.push({
      host,
      port,
      address: `wss://${host}:${port}/sub`,
    });
  });

  return candidates;
};

export const mergeLiveDanmakuLine = (
  lines: LiveDanmakuLine[],
  incoming: LiveDanmakuLine,
  settings: Pick<LiveDanmakuSettings, "duplicateWindowSeconds" | "maxLines">,
) => {
  const duplicateWindowMs = Math.max(0, settings.duplicateWindowSeconds) * 1000;
  if (duplicateWindowMs > 0) {
    const duplicateIndex = lines.findLastIndex(
      line =>
        line.type === incoming.type && line.text === incoming.text && incoming.time - line.time <= duplicateWindowMs,
    );

    if (duplicateIndex !== -1) {
      const next = [...lines];
      const duplicate = next.splice(duplicateIndex, 1)[0];
      next.push({
        ...duplicate,
        id: incoming.id,
        time: incoming.time,
        repeatCount: (duplicate.repeatCount || 1) + 1,
      });
      return next.slice(-settings.maxLines);
    }
  }

  return [...lines, incoming].slice(-settings.maxLines);
};
