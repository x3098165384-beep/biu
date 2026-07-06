import { create } from "zustand";

import { resetLiveAudioDucking, setLiveAudioDucking } from "@/service/audio-graph";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import {
  buildTtsServerUrl,
  defaultLiveDanmakuSpeechSettings,
  getLiveDanmakuSpeechText,
  sanitizeLiveDanmakuSpeechSettings,
  trimLiveDanmakuSpeechQueue,
  type LiveDanmakuLine,
  type LiveDanmakuSpeechQueueItem,
  type LiveDanmakuSpeechSettings,
} from "@shared/live";

interface TtsServerEngine {
  code?: string;
  id?: string;
  name?: string;
  label?: string;
  packageName?: string;
  [key: string]: unknown;
}

interface TtsServerVoice {
  code?: string;
  id?: string;
  name?: string;
  desc?: string;
  locale?: string;
  localeName?: string;
  label?: string;
  param?: string;
  [key: string]: unknown;
}

interface LiveDanmakuSpeechState {
  isSupported: boolean;
  queueLength: number;
  refreshSupport: () => void;
  toggle: () => void;
  stop: () => void;
  enqueue: (line: LiveDanmakuLine) => void;
}

let highPriorityQueue: LiveDanmakuSpeechQueueItem[] = [];
let normalQueue: LiveDanmakuSpeechQueueItem[] = [];
let pendingNormal: LiveDanmakuSpeechQueueItem | null = null;
let cooldownTimer: number | null = null;
let speaking = false;
let selectedVoice: SpeechSynthesisVoice | null = null;
let httpAudio: HTMLAudioElement | null = null;
let httpAudioUrl: string | null = null;
let lastNormalSpokenAt = 0;

const getSpeechSynthesis = () => (typeof window === "undefined" ? undefined : window.speechSynthesis);

const getSettings = () =>
  sanitizeLiveDanmakuSpeechSettings(useFullScreenPlayerSettings.getState().liveDanmakuSpeech);

const isWebSpeechSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

const isTtsServerSupported = () => typeof window !== "undefined" && "fetch" in window && "Audio" in window;

const isWindowsSystemSupported = () =>
  typeof window !== "undefined" && window.electron?.getPlatform?.() === "windows" && "Audio" in window;

const isProviderSupported = (settings = getSettings()) =>
  settings.provider === "webSpeech"
    ? isWebSpeechSupported()
    : settings.provider === "ttsServer"
      ? isTtsServerSupported()
      : isWindowsSystemSupported();

const queueItems = () => [...highPriorityQueue, ...normalQueue];

const updateQueueLength = () => {
  useLiveDanmakuSpeech.setState({
    queueLength: highPriorityQueue.length + normalQueue.length + (pendingNormal ? 1 : 0),
  });
};

const updateSpeechSettings = (patch: Partial<LiveDanmakuSpeechSettings>) => {
  const current = getSettings();
  useFullScreenPlayerSettings.getState().update({
    liveDanmakuSpeech: {
      ...current,
      ...patch,
    },
  });
};

const selectVoice = () => {
  const synth = getSpeechSynthesis();
  const voices = synth?.getVoices?.() ?? [];
  selectedVoice =
    voices.find(voice => voice.lang.toLowerCase().startsWith("zh-cn")) ||
    voices.find(voice => voice.lang.toLowerCase().startsWith("zh")) ||
    voices[0] ||
    null;
};

const applyDucking = () => {
  const settings = getSettings();
  if (settings.duckingEnabled) {
    setLiveAudioDucking(settings.duckingVolume);
  }
};

const maybeResetDucking = () => {
  if (!speaking && !queueItems().length && !pendingNormal) {
    resetLiveAudioDucking();
  }
};

const finishCurrent = () => {
  speaking = false;
  speakNext();
  maybeResetDucking();
};

const speakWithWebSpeech = (item: LiveDanmakuSpeechQueueItem, settings: LiveDanmakuSpeechSettings) => {
  const synth = getSpeechSynthesis();
  if (!synth) {
    finishCurrent();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = "zh-CN";
  utterance.rate = settings.rate;
  utterance.volume = settings.volume;
  if (!selectedVoice) selectVoice();
  if (selectedVoice) utterance.voice = selectedVoice;

  utterance.onend = () => finishCurrent();
  utterance.onerror = () => finishCurrent();
  synth.speak(utterance);
};

const speakWithTtsServer = async (item: LiveDanmakuSpeechQueueItem, settings: LiveDanmakuSpeechSettings) => {
  if (!settings.ttsServerEngine) {
    finishCurrent();
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), settings.timeoutMs);

  try {
    const url = buildTtsServerUrl({
      baseUrl: settings.ttsServerBaseUrl,
      text: item.text,
      engine: settings.ttsServerEngine,
      voice: settings.ttsServerVoice,
      locale: settings.ttsServerLocale,
      rate: settings.rate,
      pitch: settings.pitch,
    });
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error(await response.text());

    const blobUrl = URL.createObjectURL(await response.blob());
    httpAudioUrl = blobUrl;
    httpAudio = new Audio(blobUrl);
    httpAudio.volume = settings.volume;
    httpAudio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      httpAudioUrl = null;
      finishCurrent();
    };
    httpAudio.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      httpAudioUrl = null;
      finishCurrent();
    };
    await httpAudio.play();
  } catch {
    finishCurrent();
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const playAudioBase64 = async ({ audioBase64, mimeType }: WindowsTtsAudio, volume: number) => {
  const bytes = Uint8Array.from(atob(audioBase64), char => char.charCodeAt(0));
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/wav" }));
  httpAudioUrl = blobUrl;
  httpAudio = new Audio(blobUrl);
  httpAudio.volume = volume;
  httpAudio.onended = () => {
    URL.revokeObjectURL(blobUrl);
    httpAudioUrl = null;
    finishCurrent();
  };
  httpAudio.onerror = () => {
    URL.revokeObjectURL(blobUrl);
    httpAudioUrl = null;
    finishCurrent();
  };
  await httpAudio.play();
};

const speakWithWindowsSystem = async (item: LiveDanmakuSpeechQueueItem, settings: LiveDanmakuSpeechSettings) => {
  try {
    const audio = await window.electron.synthesizeWindowsTts({
      text: item.text,
      voiceId: settings.windowsTtsVoiceId,
      rate: settings.rate,
      volume: settings.volume,
      pitch: Math.min(2, Math.max(0.5, settings.pitch / 100)),
    });
    await playAudioBase64(audio, settings.volume);
  } catch {
    finishCurrent();
  }
};

function speakNext() {
  const settings = getSettings();
  if (!settings.enabled || speaking || !isProviderSupported(settings)) return;

  const item = highPriorityQueue.shift() || normalQueue.shift();
  updateQueueLength();
  if (!item) return;

  speaking = true;
  if (item.type === "danmaku") {
    lastNormalSpokenAt = Date.now();
  }
  applyDucking();

  if (settings.provider === "webSpeech") {
    speakWithWebSpeech(item, settings);
    return;
  }
  if (settings.provider === "windowsSystem") {
    void speakWithWindowsSystem(item, settings);
    return;
  }

  void speakWithTtsServer(item, settings);
}

const schedulePendingNormal = () => {
  if (cooldownTimer !== null) return;

  const settings = getSettings();
  const delay = Math.max(0, settings.minIntervalSeconds * 1000 - (Date.now() - lastNormalSpokenAt));
  cooldownTimer = window.setTimeout(() => {
    cooldownTimer = null;
    if (pendingNormal) {
      normalQueue.push(pendingNormal);
      pendingNormal = null;
      trimQueues();
      updateQueueLength();
      speakNext();
    }
  }, delay);
};

const trimQueues = () => {
  const trimmed = trimLiveDanmakuSpeechQueue(queueItems(), getSettings().maxQueue);
  highPriorityQueue = trimmed.filter(item => item.type === "super_chat");
  normalQueue = trimmed.filter(item => item.type === "danmaku");
};

export const resetLiveDanmakuSpeechRuntime = () => {
  highPriorityQueue = [];
  normalQueue = [];
  pendingNormal = null;
  speaking = false;
  lastNormalSpokenAt = 0;
  if (cooldownTimer !== null) {
    window.clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  httpAudio?.pause();
  httpAudio = null;
  if (httpAudioUrl) {
    URL.revokeObjectURL(httpAudioUrl);
    httpAudioUrl = null;
  }
  getSpeechSynthesis()?.cancel?.();
  resetLiveAudioDucking();
  updateQueueLength();
};

export const fetchWindowsTtsVoices = async () => window.electron.listWindowsTtsVoices();

export const fetchTtsServerEngines = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/engines`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as TtsServerEngine[];
};

export const fetchTtsServerVoices = async (baseUrl: string, engine: string) => {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/voices`);
  url.searchParams.set("engine", engine);
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as TtsServerVoice[];
};

const firstString = (...values: unknown[]) => {
  const value = values.find(item => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : "";
};

export const getTtsServerEngineValue = (engine: TtsServerEngine) =>
  firstString(engine.code, engine.id, engine.name, engine.packageName);

export const getTtsServerEngineLabel = (engine: TtsServerEngine) =>
  firstString(engine.label, engine.name, engine.code, engine.id, engine.packageName) || "未命名引擎";

export const getTtsServerVoiceValue = (voice: TtsServerVoice) => firstString(voice.code, voice.id, voice.name, voice.label);

export const getTtsServerVoiceLabel = (voice: TtsServerVoice) => {
  const label = firstString(voice.label, voice.name, voice.code, voice.id);
  const detail = firstString(voice.desc, voice.localeName, voice.locale, voice.param);
  if (!label) return detail || "默认语音";
  if (!detail || detail === label) return label;
  return `${label} (${detail})`;
};

export const getWindowsTtsVoiceLabel = (voice: WindowsTtsVoice) => {
  if (!voice.language) return voice.name;
  return `${voice.name} (${voice.language})`;
};

export const useLiveDanmakuSpeech = create<LiveDanmakuSpeechState>(set => ({
  isSupported: isProviderSupported(),
  queueLength: 0,
  refreshSupport: () => {
    set({ isSupported: isProviderSupported() });
    selectVoice();
  },
  toggle: () => {
    const settings = getSettings();
    if (!isProviderSupported(settings)) return;

    const enabled = !settings.enabled;
    if (!enabled) {
      useLiveDanmakuSpeech.getState().stop();
      return;
    }

    updateSpeechSettings({ ...defaultLiveDanmakuSpeechSettings, ...settings, enabled });
    selectVoice();
  },
  stop: () => {
    resetLiveDanmakuSpeechRuntime();
    updateSpeechSettings({ enabled: false });
  },
  enqueue: line => {
    const state = useLiveDanmakuSpeech.getState();
    const settings = getSettings();
    if (!state.isSupported || !settings.enabled) return;

    const text = getLiveDanmakuSpeechText(line).trim();
    if (!text) return;

    const item = { id: line.id, type: line.type, text };
    if (item.type === "super_chat") {
      highPriorityQueue.push(item);
      trimQueues();
      updateQueueLength();
      speakNext();
      return;
    }

    if (Date.now() - lastNormalSpokenAt >= settings.minIntervalSeconds * 1000) {
      normalQueue.push(item);
      trimQueues();
      updateQueueLength();
      speakNext();
      return;
    }

    pendingNormal = item;
    updateQueueLength();
    schedulePendingNormal();
  },
}));

if (typeof window !== "undefined") {
  const synth = getSpeechSynthesis();
  synth?.addEventListener?.("voiceschanged", selectVoice);
}
