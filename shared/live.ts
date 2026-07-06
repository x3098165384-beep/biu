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

export interface LiveDanmakuSpeechSettings {
  enabled: boolean;
  provider: "windowsSystem" | "webSpeech" | "ttsServer";
  rate: number;
  volume: number;
  maxQueue: number;
  minIntervalSeconds: number;
  windowsTtsVoiceId: string;
  windowsTtsVoiceName: string;
  ttsServerBaseUrl: string;
  ttsServerEngine: string;
  ttsServerVoice: string;
  ttsServerLocale: string;
  pitch: number;
  timeoutMs: number;
  duckingEnabled: boolean;
  duckingVolume: number;
}

export interface LiveAudioLimitSettings {
  enabled: boolean;
  thresholdDb: number;
  ratio: number;
  attack: number;
  release: number;
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

export const defaultLiveDanmakuSpeechSettings: LiveDanmakuSpeechSettings = {
  enabled: false,
  provider: "windowsSystem",
  rate: 1,
  volume: 1,
  maxQueue: 20,
  minIntervalSeconds: 8,
  windowsTtsVoiceId: "",
  windowsTtsVoiceName: "",
  ttsServerBaseUrl: "http://127.0.0.1:1233",
  ttsServerEngine: "",
  ttsServerVoice: "",
  ttsServerLocale: "",
  pitch: 100,
  timeoutMs: 8000,
  duckingEnabled: true,
  duckingVolume: 0.35,
};

export const defaultLiveAudioLimitSettings: LiveAudioLimitSettings = {
  enabled: false,
  thresholdDb: -12,
  ratio: 12,
  attack: 0.003,
  release: 0.25,
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

const numberOrDefault = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const sanitizeLiveDanmakuSettings = (settings?: Partial<LiveDanmakuSettings>): LiveDanmakuSettings => ({
  ...defaultLiveDanmakuSettings,
  ...settings,
  maxLines: Math.min(200, Math.max(20, numberOrDefault(settings?.maxLines, defaultLiveDanmakuSettings.maxLines))),
  maxPerSecond: Math.min(
    30,
    Math.max(1, numberOrDefault(settings?.maxPerSecond, defaultLiveDanmakuSettings.maxPerSecond)),
  ),
  duplicateWindowSeconds: Math.min(
    60,
    Math.max(
      0,
      numberOrDefault(settings?.duplicateWindowSeconds, defaultLiveDanmakuSettings.duplicateWindowSeconds),
    ),
  ),
});

export const sanitizeLiveDanmakuSpeechSettings = (
  settings?: Partial<LiveDanmakuSpeechSettings>,
): LiveDanmakuSpeechSettings => ({
  ...defaultLiveDanmakuSpeechSettings,
  ...settings,
  provider:
    settings?.provider === "webSpeech" || settings?.provider === "ttsServer" ? settings.provider : "windowsSystem",
  rate: Math.min(2, Math.max(0.5, numberOrDefault(settings?.rate, defaultLiveDanmakuSpeechSettings.rate))),
  volume: Math.min(1, Math.max(0, numberOrDefault(settings?.volume, defaultLiveDanmakuSpeechSettings.volume))),
  maxQueue: Math.min(100, Math.max(1, numberOrDefault(settings?.maxQueue, defaultLiveDanmakuSpeechSettings.maxQueue))),
  minIntervalSeconds: Math.min(
    120,
    Math.max(0, numberOrDefault(settings?.minIntervalSeconds, defaultLiveDanmakuSpeechSettings.minIntervalSeconds)),
  ),
  windowsTtsVoiceId: settings?.windowsTtsVoiceId || "",
  windowsTtsVoiceName: settings?.windowsTtsVoiceName || "",
  ttsServerBaseUrl: (settings?.ttsServerBaseUrl || defaultLiveDanmakuSpeechSettings.ttsServerBaseUrl).replace(
    /\/$/,
    "",
  ),
  ttsServerEngine: settings?.ttsServerEngine || "",
  ttsServerVoice: settings?.ttsServerVoice || "",
  ttsServerLocale: settings?.ttsServerLocale || "",
  pitch: Math.min(200, Math.max(0, numberOrDefault(settings?.pitch, defaultLiveDanmakuSpeechSettings.pitch))),
  timeoutMs: Math.min(30000, Math.max(1000, numberOrDefault(settings?.timeoutMs, defaultLiveDanmakuSpeechSettings.timeoutMs))),
  duckingEnabled: settings?.duckingEnabled ?? defaultLiveDanmakuSpeechSettings.duckingEnabled,
  duckingVolume: Math.min(
    1,
    Math.max(0, numberOrDefault(settings?.duckingVolume, defaultLiveDanmakuSpeechSettings.duckingVolume)),
  ),
});

export const sanitizeLiveAudioLimitSettings = (settings?: Partial<LiveAudioLimitSettings>): LiveAudioLimitSettings => ({
  ...defaultLiveAudioLimitSettings,
  ...settings,
  thresholdDb: Math.min(0, Math.max(-60, numberOrDefault(settings?.thresholdDb, defaultLiveAudioLimitSettings.thresholdDb))),
  ratio: Math.min(20, Math.max(1, numberOrDefault(settings?.ratio, defaultLiveAudioLimitSettings.ratio))),
  attack: Math.min(1, Math.max(0, numberOrDefault(settings?.attack, defaultLiveAudioLimitSettings.attack))),
  release: Math.min(1, Math.max(0.01, numberOrDefault(settings?.release, defaultLiveAudioLimitSettings.release))),
});

export const isLiveDanmakuLineBlocked = (line: LiveDanmakuLine, blockedKeywords?: string) => {
  const keywords = splitBlockedKeywords(blockedKeywords);
  return keywords.some(keyword => line.text.includes(keyword) || line.username.includes(keyword));
};

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

export const appendLiveDanmakuLine = (
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
      const foldedLine = {
        ...duplicate,
        id: incoming.id,
        time: incoming.time,
        repeatCount: (duplicate.repeatCount || 1) + 1,
      };
      next.push(foldedLine);
      return {
        lines: next.slice(-settings.maxLines),
        line: foldedLine,
        isNew: false,
        folded: true,
      };
    }
  }

  const nextLine = { ...incoming };
  return {
    lines: [...lines, nextLine].slice(-settings.maxLines),
    line: nextLine,
    isNew: true,
    folded: false,
  };
};

export const getLiveDanmakuSpeechText = (line: LiveDanmakuLine) =>
  line.type === "super_chat" ? `SC，${line.text}` : line.text;

export interface LiveDanmakuSpeechQueueItem {
  id: string;
  type: LiveDanmakuLineType;
  text: string;
}

export interface TtsServerParams {
  baseUrl: string;
  text: string;
  engine: string;
  voice?: string;
  locale?: string;
  rate: number;
  pitch: number;
}

export const mapSpeechRateToTtsServerSpeed = (rate: number) =>
  Math.min(100, Math.max(0, Math.round(numberOrDefault(rate, defaultLiveDanmakuSpeechSettings.rate) * 50)));

export const buildTtsServerUrl = ({ baseUrl, text, engine, voice, locale, rate, pitch }: TtsServerParams) => {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/tts`);
  url.searchParams.set("text", text);
  url.searchParams.set("engine", engine);
  url.searchParams.set("rate", String(mapSpeechRateToTtsServerSpeed(rate)));
  url.searchParams.set("pitch", String(Math.round(numberOrDefault(pitch, defaultLiveDanmakuSpeechSettings.pitch))));
  if (voice) url.searchParams.set("voice", voice);
  if (locale) url.searchParams.set("locale", locale);
  return url.toString();
};

export const shouldSpeakLiveDanmakuLine = ({
  line,
  lastSpokenAt,
  now,
  minIntervalSeconds,
}: {
  line: LiveDanmakuLine;
  lastSpokenAt: number;
  now: number;
  minIntervalSeconds: number;
}) => line.type === "super_chat" || now - lastSpokenAt >= Math.max(0, minIntervalSeconds) * 1000;

export const trimLiveDanmakuSpeechQueue = (
  queue: LiveDanmakuSpeechQueueItem[],
  maxQueue = defaultLiveDanmakuSpeechSettings.maxQueue,
) => {
  const limit = Math.max(1, maxQueue);
  const next = [...queue];

  while (next.length > limit) {
    const normalIndex = next.findIndex(item => item.type === "danmaku");
    next.splice(normalIndex === -1 ? 0 : normalIndex, 1);
  }

  return next;
};
