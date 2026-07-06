import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { addToast, Button, Switch } from "@heroui/react";
import { useShallow } from "zustand/shallow";

import { isHex } from "@/common/utils/color";
import ColorPicker from "@/components/color-picker";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import {
  fetchWindowsTtsVoices,
  fetchTtsServerEngines,
  fetchTtsServerVoices,
  getLocalNaturalVoiceLabel,
  getTtsServerEngineLabel,
  getTtsServerEngineValue,
  getTtsServerVoiceLabel,
  getTtsServerVoiceValue,
  getWindowsTtsVoiceLabel,
  installNaturalVoiceAdapter,
  parseNaturalVoicePackage,
  useLiveDanmakuSpeech,
} from "@/store/live-danmaku-speech";
import { usePlayList } from "@/store/play-list";
import {
  defaultLiveAudioLimitSettings,
  defaultLiveDanmakuSpeechSettings,
  sanitizeLiveAudioLimitSettings,
  sanitizeLiveDanmakuSpeechSettings,
} from "@shared/live";

const FullScreenPlayerSettingsPanel = ({ isUiVisible = true }: { isUiVisible?: boolean }) => {
  const { playId, list } = usePlayList(
    useShallow(state => ({
      playId: state.playId,
      list: state.list,
    })),
  );
  const playItem = list.find(item => item.id === playId);
  const isLocal = playItem?.source === "local";
  const {
    showLyrics,
    showSpectrum,
    showCover,
    showBlurredBackground,
    backgroundColor,
    spectrumColor,
    lyricsColor,
    liveDanmaku,
    liveDanmakuSpeech,
    liveAudioLimit,
    update,
  } = useFullScreenPlayerSettings(
    useShallow(s => ({
      showLyrics: s.showLyrics,
      showSpectrum: s.showSpectrum,
      showCover: s.showCover,
      showBlurredBackground: s.showBlurredBackground,
      backgroundColor: s.backgroundColor,
      spectrumColor: s.spectrumColor,
      lyricsColor: s.lyricsColor,
      liveDanmaku: s.liveDanmaku,
      liveDanmakuSpeech: s.liveDanmakuSpeech,
      liveAudioLimit: s.liveAudioLimit,
      update: s.update,
    })),
  );
  const isLive = playItem?.type === "live";
  const speechSettings = sanitizeLiveDanmakuSpeechSettings(liveDanmakuSpeech || defaultLiveDanmakuSpeechSettings);
  const audioLimitSettings = sanitizeLiveAudioLimitSettings(liveAudioLimit || defaultLiveAudioLimitSettings);
  const enqueueSpeech = useLiveDanmakuSpeech(s => s.enqueue);
  const updateLiveDanmaku = (patch: Partial<typeof liveDanmaku>) => {
    update({
      liveDanmaku: {
        ...liveDanmaku,
        ...patch,
      },
    });
  };
  const updateLiveDanmakuSpeech = (patch: Partial<typeof speechSettings>) => {
    update({
      liveDanmakuSpeech: {
        ...speechSettings,
        ...patch,
      },
    });
  };
  const updateLiveAudioLimit = (patch: Partial<typeof audioLimitSettings>) => {
    update({
      liveAudioLimit: {
        ...audioLimitSettings,
        ...patch,
      },
    });
  };

  const { control, setValue } = useForm({
    defaultValues: {
      showLyrics,
      showSpectrum,
      showCover,
      showBlurredBackground,
      backgroundColor,
      spectrumColor,
      lyricsColor,
    },
    mode: "onChange",
  });

  const [lyricsPickerOpen, setLyricsPickerOpen] = useState(false);
  const [spectrumPickerOpen, setSpectrumPickerOpen] = useState(false);
  const [backgroundPickerOpen, setBackgroundPickerOpen] = useState(false);
  const [ttsEngines, setTtsEngines] = useState<any[]>([]);
  const [ttsVoices, setTtsVoices] = useState<any[]>([]);
  const [windowsVoices, setWindowsVoices] = useState<WindowsTtsVoice[]>([]);
  const [localNaturalVoices, setLocalNaturalVoices] = useState<LocalNaturalVoice[]>([]);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [localVoiceLoading, setLocalVoiceLoading] = useState(false);
  const [showExternalTts, setShowExternalTts] = useState(speechSettings.provider === "ttsServer");

  useEffect(() => {
    if (!isUiVisible) {
      setLyricsPickerOpen(false);
      setSpectrumPickerOpen(false);
      setBackgroundPickerOpen(false);
    }
  }, [isUiVisible]);

  useEffect(() => {
    setValue("showLyrics", showLyrics);
    setValue("showSpectrum", showSpectrum);
    setValue("showCover", showCover);
    setValue("showBlurredBackground", showBlurredBackground);
    setValue("backgroundColor", backgroundColor);
    setValue("spectrumColor", spectrumColor);
    setValue("lyricsColor", lyricsColor);
  }, [
    setValue,
    showLyrics,
    showSpectrum,
    showCover,
    showBlurredBackground,
    backgroundColor,
    spectrumColor,
    lyricsColor,
  ]);

  const values = useWatch({ control });

  useEffect(() => {
    if (!values || typeof values !== "object") return;
    update({
      showLyrics: values.showLyrics,
      showSpectrum: values.showSpectrum,
      showCover: values.showCover,
      showBlurredBackground: values.showBlurredBackground,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values?.showLyrics, values?.showSpectrum, values?.showCover, values?.showBlurredBackground, update]);

  useEffect(() => {
    if (!values || typeof values !== "object") return;
    const sanitizeLyricsColor = (v?: string) => (isHex(v) ? v! : "#ffffff");
    const sanitizeSpectrumColor = (v?: string) => (v === "currentColor" || isHex(v) ? v! : "currentColor");
    const sanitizeBackgroundColor = (v?: string) => (isHex(v) ? v! : "#ffffff");
    const id = window.setTimeout(() => {
      update({
        spectrumColor: sanitizeSpectrumColor(values.spectrumColor),
        lyricsColor: sanitizeLyricsColor(values.lyricsColor),
        backgroundColor: sanitizeBackgroundColor(values.backgroundColor),
      });
    }, 200);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values?.spectrumColor, values?.lyricsColor, values?.backgroundColor, update]);

  const loadTtsServerOptions = async () => {
    setTtsLoading(true);
    try {
      const engines = await fetchTtsServerEngines(speechSettings.ttsServerBaseUrl);
      setTtsEngines(engines);
      const engine = speechSettings.ttsServerEngine || getTtsServerEngineValue(engines[0] || {});
      if (engine) {
        if (!speechSettings.ttsServerEngine) {
          updateLiveDanmakuSpeech({ ttsServerEngine: engine });
        }
        setTtsVoices(await fetchTtsServerVoices(speechSettings.ttsServerBaseUrl, engine));
      }
      addToast({ color: "success", title: "TTS 服务已连接" });
    } catch {
      addToast({ color: "danger", title: "TTS 服务连接失败" });
    } finally {
      setTtsLoading(false);
    }
  };

  const loadWindowsTtsVoices = async () => {
    setTtsLoading(true);
    try {
      const voices = await fetchWindowsTtsVoices();
      setWindowsVoices(voices);
      const voice = voices.find(item => item.id === speechSettings.windowsTtsVoiceId) || voices[0];
      if (voice && !speechSettings.windowsTtsVoiceId) {
        updateLiveDanmakuSpeech({ windowsTtsVoiceId: voice.id, windowsTtsVoiceName: voice.name });
      }
      addToast({ color: "success", title: "系统语音已刷新" });
    } catch {
      addToast({ color: "danger", title: "系统语音刷新失败" });
    } finally {
      setTtsLoading(false);
    }
  };

  const loadLocalNaturalVoices = async (dir = speechSettings.localVoicePackageDir) => {
    if (!dir) {
      addToast({ color: "warning", title: "请先选择语音包目录" });
      return;
    }
    setLocalVoiceLoading(true);
    try {
      const voices = await parseNaturalVoicePackage(dir);
      setLocalNaturalVoices(voices);
      const voice =
        voices.find(item => item.code === speechSettings.localVoiceCode) ||
        voices.find(item => item.installed) ||
        voices[0];
      if (voice && !speechSettings.localVoiceCode) {
        updateLiveDanmakuSpeech({
          localVoiceCode: voice.code,
          localVoiceName: voice.name,
          localVoiceSapiVoiceId: voice.sapiVoiceId || "",
        });
      }
      addToast({ color: "success", title: voices.length ? "本地语音包已识别" : "未找到可用语音" });
    } catch {
      addToast({ color: "danger", title: "本地语音包解析失败" });
    } finally {
      setLocalVoiceLoading(false);
    }
  };

  const selectLocalNaturalVoiceDir = async () => {
    const dir = await window.electron.selectDirectory("选择本地自然语音包目录");
    if (!dir) return;
    updateLiveDanmakuSpeech({ localVoicePackageDir: dir, localVoiceCode: "", localVoiceName: "", localVoiceSapiVoiceId: "" });
    await loadLocalNaturalVoices(dir);
  };

  const setupLocalNaturalVoice = async () => {
    if (!speechSettings.localVoicePackageDir) {
      addToast({ color: "warning", title: "请先选择语音包目录" });
      return;
    }
    setLocalVoiceLoading(true);
    try {
      await installNaturalVoiceAdapter(
        speechSettings.localVoicePackageDir,
        speechSettings.localVoiceCode ? [speechSettings.localVoiceCode] : undefined,
      );
      const voices = await parseNaturalVoicePackage(speechSettings.localVoicePackageDir);
      setLocalNaturalVoices(voices);
      const voice =
        voices.find(item => item.code === speechSettings.localVoiceCode && item.installed) ||
        voices.find(item => item.installed);
      if (voice) {
        updateLiveDanmakuSpeech({
          provider: "localNaturalVoice",
          localVoiceCode: voice.code,
          localVoiceName: voice.name,
          localVoiceSapiVoiceId: voice.sapiVoiceId || "",
        });
      }
      addToast({ color: voice ? "success" : "warning", title: voice ? "本地自然语音已安装" : "已安装，请刷新后选择语音" });
    } catch {
      addToast({ color: "danger", title: "本地自然语音安装失败" });
    } finally {
      setLocalVoiceLoading(false);
    }
  };

  useEffect(() => {
    if (isLive && speechSettings.provider === "windowsSystem" && !windowsVoices.length) {
      void loadWindowsTtsVoices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, speechSettings.provider]);

  useEffect(() => {
    if (
      isLive &&
      speechSettings.provider === "localNaturalVoice" &&
      speechSettings.localVoicePackageDir &&
      !localNaturalVoices.length
    ) {
      void loadLocalNaturalVoices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, speechSettings.provider, speechSettings.localVoicePackageDir]);

  const testSpeech = () => {
    if (speechSettings.provider === "localNaturalVoice" && !speechSettings.localVoiceSapiVoiceId) {
      addToast({ color: "warning", title: "请先安装并选择本地自然语音" });
      return;
    }
    if (speechSettings.provider === "ttsServer" && !speechSettings.ttsServerEngine) {
      addToast({ color: "warning", title: "请先刷新并选择 TTS 引擎" });
      return;
    }
    if (speechSettings.provider === "windowsSystem" && !speechSettings.windowsTtsVoiceId && !windowsVoices.length) {
      addToast({ color: "warning", title: "请先刷新系统语音" });
      return;
    }
    updateLiveDanmakuSpeech({ enabled: true });
    enqueueSpeech({
      id: `test-${Date.now()}`,
      type: "danmaku",
      username: "",
      text: "这是一条弹幕朗读测试",
      time: Date.now(),
    });
  };

  return (
    <div className="max-h-[min(72vh,560px)] min-w-[320px] space-y-4 overflow-y-auto pr-2">
      <div className="flex items-center justify-between">
        <div className="text-medium mr-6">显示歌词</div>
        <Controller
          control={control}
          name="showLyrics"
          render={({ field }) => <Switch isSelected={field.value} onValueChange={field.onChange} />}
        />
      </div>
      {values?.showLyrics && (
        <div className="flex items-center justify-between">
          <div className="text-medium mr-6">歌词字体颜色</div>
          <Controller
            control={control}
            name="lyricsColor"
            render={({ field }) => {
              const v = field.value;
              const pickerValue = isHex(v) ? v : "#ffffff";
              return (
                <ColorPicker
                  value={pickerValue}
                  onChange={hex => field.onChange(hex)}
                  isOpen={lyricsPickerOpen && isUiVisible}
                  onOpenChange={setLyricsPickerOpen}
                >
                  <div
                    className="border-default h-8 w-12 rounded-full border"
                    style={{ backgroundColor: field.value || undefined }}
                  />
                </ColorPicker>
              );
            }}
          />
        </div>
      )}
      {values?.showLyrics && isLive && (
        <div className="border-default/60 space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="text-medium mr-6">直播弹幕歌词</div>
            <Switch isSelected={liveDanmaku.enabled} onValueChange={enabled => updateLiveDanmaku({ enabled })} />
          </div>
          {liveDanmaku.enabled && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-medium mr-6">显示醒目留言</div>
                <Switch
                  isSelected={liveDanmaku.showSuperChat}
                  onValueChange={showSuperChat => updateLiveDanmaku({ showSuperChat })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">最多行数</div>
                <input
                  className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
                  min={20}
                  max={200}
                  type="number"
                  value={liveDanmaku.maxLines}
                  onChange={event => updateLiveDanmaku({ maxLines: Number(event.target.value) || 80 })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">每秒弹幕</div>
                <input
                  className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
                  min={1}
                  max={30}
                  type="number"
                  value={liveDanmaku.maxPerSecond}
                  onChange={event => updateLiveDanmaku({ maxPerSecond: Number(event.target.value) || 8 })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">重复折叠秒数</div>
                <input
                  className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
                  min={0}
                  max={60}
                  type="number"
                  value={liveDanmaku.duplicateWindowSeconds}
                  onChange={event => updateLiveDanmaku({ duplicateWindowSeconds: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <div className="text-medium">屏蔽词</div>
                <textarea
                  className="border-default bg-content1 min-h-20 w-full resize-none rounded border px-2 py-1 outline-none"
                  value={liveDanmaku.blockedKeywords}
                  onChange={event => updateLiveDanmaku({ blockedKeywords: event.target.value })}
                />
              </div>
            </>
          )}
        </div>
      )}

      {isLive && (
        <div className="border-default/60 space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="text-medium mr-6">弹幕朗读</div>
            <Switch
              isSelected={speechSettings.enabled}
              onValueChange={enabled => updateLiveDanmakuSpeech({ enabled })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-medium">朗读引擎</div>
            <select
              className="border-default bg-content1 w-40 rounded border px-2 py-1 outline-none"
              value={speechSettings.provider}
              onChange={event => updateLiveDanmakuSpeech({ provider: event.target.value as any })}
            >
              <option value="localNaturalVoice">本地自然语音</option>
              <option value="windowsSystem">Windows 系统语音</option>
              <option value="webSpeech">浏览器系统语音</option>
              {speechSettings.provider === "ttsServer" && <option value="ttsServer">外部 HTTP TTS</option>}
            </select>
          </div>
          {speechSettings.provider === "localNaturalVoice" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">语音包目录</div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="text-foreground-500 max-w-44 truncate text-small">
                    {speechSettings.localVoicePackageDir || "未选择"}
                  </div>
                  <Button size="sm" variant="flat" onPress={selectLocalNaturalVoiceDir}>
                    选择
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">语音</div>
                <div className="flex items-center gap-2">
                  <select
                    className="border-default bg-content1 w-48 rounded border px-2 py-1 outline-none"
                    value={speechSettings.localVoiceCode}
                    onChange={event => {
                      const voice = localNaturalVoices.find(item => item.code === event.target.value);
                      updateLiveDanmakuSpeech({
                        localVoiceCode: event.target.value,
                        localVoiceName: voice?.name || "",
                        localVoiceSapiVoiceId: voice?.sapiVoiceId || "",
                      });
                    }}
                  >
                    <option value="">选择语音</option>
                    {localNaturalVoices.map(voice => (
                      <option key={voice.code} value={voice.code}>
                        {getLocalNaturalVoiceLabel(voice)}
                        {voice.installed ? "" : "（未安装）"}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="flat" isLoading={localVoiceLoading} onPress={() => loadLocalNaturalVoices()}>
                    刷新
                  </Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" color="primary" variant="flat" isLoading={localVoiceLoading} onPress={setupLocalNaturalVoice}>
                  安装/配置
                </Button>
              </div>
              <div className="text-foreground-500 text-small">
                首次安装会下载 NaturalVoiceSAPIAdapter 并弹出 Windows 授权。
              </div>
            </div>
          )}
          {speechSettings.provider === "windowsSystem" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">语音</div>
                <div className="flex items-center gap-2">
                  <select
                    className="border-default bg-content1 w-48 rounded border px-2 py-1 outline-none"
                    value={speechSettings.windowsTtsVoiceId}
                    onChange={event => {
                      const voice = windowsVoices.find(item => item.id === event.target.value);
                      updateLiveDanmakuSpeech({
                        windowsTtsVoiceId: event.target.value,
                        windowsTtsVoiceName: voice?.name || "",
                      });
                    }}
                  >
                    <option value="">自动选择中文语音</option>
                    {windowsVoices.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {getWindowsTtsVoiceLabel(voice)}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="flat" isLoading={ttsLoading} onPress={loadWindowsTtsVoices}>
                    刷新
                  </Button>
                </div>
              </div>
              {!windowsVoices.length && (
                <div className="text-foreground-500 text-small">这里列出的是 Windows 已注册系统语音。</div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="light" onPress={() => setShowExternalTts(value => !value)}>
                {showExternalTts ? "收起高级" : "高级"}
              </Button>
            </div>
            {showExternalTts && (
              <div className="border-default/60 space-y-3 border-t pt-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-medium">外部 HTTP TTS</div>
                  <Button
                    size="sm"
                    variant={speechSettings.provider === "ttsServer" ? "solid" : "flat"}
                    color={speechSettings.provider === "ttsServer" ? "primary" : "default"}
                    onPress={() => updateLiveDanmakuSpeech({ provider: "ttsServer" })}
                  >
                    使用
                  </Button>
                </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">服务地址</div>
                <input
                  className="border-default bg-content1 w-48 rounded border px-2 py-1 outline-none"
                  value={speechSettings.ttsServerBaseUrl}
                  onChange={event => updateLiveDanmakuSpeech({ ttsServerBaseUrl: event.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">语音包</div>
                <div className="flex items-center gap-2">
                  <select
                    className="border-default bg-content1 w-32 rounded border px-2 py-1 outline-none"
                    value={speechSettings.ttsServerEngine}
                    onChange={async event => {
                      const engine = event.target.value;
                      updateLiveDanmakuSpeech({ ttsServerEngine: engine, ttsServerVoice: "" });
                      if (engine) {
                        setTtsVoices(await fetchTtsServerVoices(speechSettings.ttsServerBaseUrl, engine).catch(() => []));
                      }
                    }}
                  >
                    <option value="">选择引擎</option>
                    {ttsEngines.map(engine => {
                      const value = getTtsServerEngineValue(engine);
                      return (
                        <option key={value} value={value}>
                          {getTtsServerEngineLabel(engine)}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    className="border-default bg-content1 w-32 rounded border px-2 py-1 outline-none"
                    value={speechSettings.ttsServerVoice}
                    onChange={event => updateLiveDanmakuSpeech({ ttsServerVoice: event.target.value })}
                  >
                    <option value="">默认</option>
                    {ttsVoices.map(voice => {
                      const value = getTtsServerVoiceValue(voice);
                      return (
                        <option key={value} value={value}>
                          {getTtsServerVoiceLabel(voice)}
                        </option>
                      );
                    })}
                  </select>
                  <Button size="sm" variant="flat" isLoading={ttsLoading} onPress={loadTtsServerOptions}>
                    刷新
                  </Button>
                </div>
              </div>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <div className="text-medium">朗读音量</div>
              <div className="text-foreground-500 w-14 text-right text-small">{Math.round(speechSettings.volume * 100)}%</div>
            </div>
            <input
              className="w-full"
              min={0}
              max={3}
              step={0.05}
              type="range"
              value={speechSettings.volume}
              onChange={event => updateLiveDanmakuSpeech({ volume: Number(event.target.value) || 0 })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-medium">语速</div>
            <input
              className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
              min={0.5}
              max={2}
              step={0.1}
              type="number"
              value={speechSettings.rate}
              onChange={event => updateLiveDanmakuSpeech({ rate: Number(event.target.value) || 1 })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-medium">普通弹幕间隔</div>
            <input
              className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
              min={0}
              max={120}
              type="number"
              value={speechSettings.minIntervalSeconds}
              onChange={event => updateLiveDanmakuSpeech({ minIntervalSeconds: Number(event.target.value) || 0 })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-medium mr-6">朗读时降低直播声</div>
            <Switch
              isSelected={speechSettings.duckingEnabled}
              onValueChange={duckingEnabled => updateLiveDanmakuSpeech({ duckingEnabled })}
            />
          </div>
          {speechSettings.duckingEnabled && (
            <div className="flex items-center justify-between gap-4">
              <div className="text-medium">直播声保留</div>
              <input
                className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
                min={0}
                max={1}
                step={0.05}
                type="number"
                value={speechSettings.duckingVolume}
                onChange={event => updateLiveDanmakuSpeech({ duckingVolume: Number(event.target.value) || 0 })}
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="flat" onPress={testSpeech}>
              测试朗读
            </Button>
          </div>
        </div>
      )}

      {isLive && (
        <div className="border-default/60 space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="text-medium mr-6">喊叫限制</div>
            <Switch
              isSelected={audioLimitSettings.enabled}
              onValueChange={enabled => updateLiveAudioLimit({ enabled })}
            />
          </div>
          {audioLimitSettings.enabled && (
            <>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">阈值 dB</div>
                <input
                  className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
                  min={-60}
                  max={0}
                  type="number"
                  value={audioLimitSettings.thresholdDb}
                  onChange={event => updateLiveAudioLimit({ thresholdDb: Number(event.target.value) || -12 })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-medium">压缩比</div>
                <input
                  className="border-default bg-content1 w-20 rounded border px-2 py-1 text-right outline-none"
                  min={1}
                  max={20}
                  step={0.5}
                  type="number"
                  value={audioLimitSettings.ratio}
                  onChange={event => updateLiveAudioLimit({ ratio: Number(event.target.value) || 12 })}
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-medium mr-6">显示频谱图</div>
        <Controller
          control={control}
          name="showSpectrum"
          render={({ field }) => <Switch isSelected={field.value} onValueChange={field.onChange} />}
        />
      </div>
      {values?.showSpectrum && (
        <div className="flex items-center justify-between">
          <div className="text-medium mr-6">频谱图颜色</div>
          <Controller
            control={control}
            name="spectrumColor"
            render={({ field }) => {
              const v = field.value;
              const pickerValue = isHex(v) ? v : "#ffffff";
              return (
                <ColorPicker
                  value={pickerValue}
                  onChange={hex => field.onChange(hex)}
                  isOpen={spectrumPickerOpen && isUiVisible}
                  onOpenChange={setSpectrumPickerOpen}
                >
                  <div
                    className="border-default h-8 w-12 rounded-full border"
                    style={{ backgroundColor: isHex(v) ? v : undefined }}
                  />
                </ColorPicker>
              );
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-medium mr-6">显示封面</div>
        <Controller
          control={control}
          name="showCover"
          render={({ field }) => (
            <Switch isSelected={field.value} onValueChange={field.onChange} isDisabled={isLocal} />
          )}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-medium mr-6">显示虚化背景</div>
        <Controller
          control={control}
          name="showBlurredBackground"
          render={({ field }) => <Switch isSelected={field.value} onValueChange={field.onChange} />}
        />
      </div>
      {!values?.showBlurredBackground && (
        <div className="flex items-center justify-between">
          <div className="text-medium mr-6">背景颜色</div>
          <Controller
            control={control}
            name="backgroundColor"
            render={({ field }) => {
              return (
                <ColorPicker
                  value={field.value}
                  onChange={hex => field.onChange(hex)}
                  isOpen={backgroundPickerOpen && isUiVisible}
                  onOpenChange={setBackgroundPickerOpen}
                >
                  <div
                    className="border-default h-8 w-12 rounded-full border"
                    style={{ backgroundColor: field.value }}
                  />
                </ColorPicker>
              );
            }}
          />
        </div>
      )}
    </div>
  );
};

export default FullScreenPlayerSettingsPanel;
