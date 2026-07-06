import { defaultLiveAudioLimitSettings, sanitizeLiveAudioLimitSettings, type LiveAudioLimitSettings } from "@shared/live";

interface AudioGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  compressor: DynamicsCompressorNode;
  duckingGain: GainNode;
  analyser: AnalyserNode;
}

let graph: AudioGraph | null = null;
let currentDuckingGain = 1;

const getAudioContextCtor = () =>
  typeof window === "undefined" ? undefined : window.AudioContext || (window as any).webkitAudioContext;

const setParam = (param: AudioParam, value: number, duration = 0.08) => {
  const context = graph?.context;
  if (!context) {
    param.value = value;
    return;
  }
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, duration);
};

export const ensureAudioGraph = (audio: HTMLAudioElement) => {
  if (graph) return graph;

  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  const source = context.createMediaElementSource(audio);
  const compressor = context.createDynamicsCompressor();
  const duckingGain = context.createGain();
  const analyser = context.createAnalyser();

  analyser.fftSize = 512;
  source.connect(compressor);
  compressor.connect(duckingGain);
  duckingGain.connect(analyser);
  analyser.connect(context.destination);

  graph = { context, source, compressor, duckingGain, analyser };
  applyLiveAudioLimit(defaultLiveAudioLimitSettings);
  return graph;
};

export const resumeAudioGraph = () => {
  if (graph?.context.state === "suspended") {
    void graph.context.resume();
  }
};

export const getAudioAnalyser = () => graph?.analyser ?? null;

export const applyLiveAudioLimit = (settings?: Partial<LiveAudioLimitSettings>) => {
  if (!graph) return;

  const next = sanitizeLiveAudioLimitSettings(settings);
  const { compressor } = graph;
  if (!next.enabled) {
    compressor.threshold.value = 0;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    return;
  }

  compressor.threshold.value = next.thresholdDb;
  compressor.knee.value = 2;
  compressor.ratio.value = next.ratio;
  compressor.attack.value = next.attack;
  compressor.release.value = next.release;
};

export const setLiveAudioDucking = (targetGain: number) => {
  if (!graph) return;
  currentDuckingGain = Math.min(1, Math.max(0, targetGain));
  setParam(graph.duckingGain.gain, currentDuckingGain);
};

export const resetLiveAudioDucking = () => setLiveAudioDucking(1);

export const getLiveAudioDuckingGain = () => currentDuckingGain;
