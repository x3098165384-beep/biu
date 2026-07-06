import { create } from "zustand";

import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import {
  defaultLiveDanmakuSpeechSettings,
  getLiveDanmakuSpeechText,
  sanitizeLiveDanmakuSpeechSettings,
  trimLiveDanmakuSpeechQueue,
  type LiveDanmakuLine,
  type LiveDanmakuSpeechQueueItem,
} from "@shared/live";

interface LiveDanmakuSpeechState {
  isSupported: boolean;
  queueLength: number;
  refreshSupport: () => void;
  toggle: () => void;
  stop: () => void;
  enqueue: (line: LiveDanmakuLine) => void;
}

let queue: LiveDanmakuSpeechQueueItem[] = [];
let speaking = false;
let selectedVoice: SpeechSynthesisVoice | null = null;

const getSpeechSynthesis = () => (typeof window === "undefined" ? undefined : window.speechSynthesis);

const getSettings = () =>
  sanitizeLiveDanmakuSpeechSettings(useFullScreenPlayerSettings.getState().liveDanmakuSpeech);

const updateQueueLength = () => {
  useLiveDanmakuSpeech.setState({ queueLength: queue.length });
};

const updateSpeechSettings = (patch: Partial<ReturnType<typeof getSettings>>) => {
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

const speakNext = () => {
  const synth = getSpeechSynthesis();
  const settings = getSettings();
  if (!synth || !settings.enabled || speaking) return;

  const next = queue.shift();
  updateQueueLength();
  if (!next) return;

  speaking = true;
  const utterance = new SpeechSynthesisUtterance(next.text);
  utterance.lang = "zh-CN";
  utterance.rate = settings.rate;
  utterance.volume = settings.volume;
  if (!selectedVoice) selectVoice();
  if (selectedVoice) utterance.voice = selectedVoice;

  const finish = () => {
    speaking = false;
    speakNext();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  synth.speak(utterance);
};

export const resetLiveDanmakuSpeechRuntime = () => {
  queue = [];
  speaking = false;
  getSpeechSynthesis()?.cancel?.();
  updateQueueLength();
};

export const useLiveDanmakuSpeech = create<LiveDanmakuSpeechState>(set => ({
  isSupported: typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
  queueLength: 0,
  refreshSupport: () => {
    const synth = getSpeechSynthesis();
    set({
      isSupported: Boolean(synth && "SpeechSynthesisUtterance" in window),
    });
    selectVoice();
  },
  toggle: () => {
    const isSupported = useLiveDanmakuSpeech.getState().isSupported;
    if (!isSupported) return;

    const enabled = !getSettings().enabled;
    if (!enabled) {
      useLiveDanmakuSpeech.getState().stop();
      return;
    }

    updateSpeechSettings({ ...defaultLiveDanmakuSpeechSettings, ...getSettings(), enabled });
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

    queue = trimLiveDanmakuSpeechQueue([...queue, { id: line.id, type: line.type, text }], settings.maxQueue);
    updateQueueLength();
    speakNext();
  },
}));

if (typeof window !== "undefined") {
  const synth = getSpeechSynthesis();
  synth?.addEventListener?.("voiceschanged", selectVoice);
}
