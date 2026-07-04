import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Switch } from "@heroui/react";
import { useShallow } from "zustand/shallow";

import { isHex } from "@/common/utils/color";
import ColorPicker from "@/components/color-picker";
import { useFullScreenPlayerSettings } from "@/store/full-screen-player-settings";
import { usePlayList } from "@/store/play-list";

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
      update: s.update,
    })),
  );
  const isLive = playItem?.type === "live";
  const updateLiveDanmaku = (patch: Partial<typeof liveDanmaku>) => {
    update({
      liveDanmaku: {
        ...liveDanmaku,
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

  return (
    <div className="min-w-[320px] space-y-4">
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
