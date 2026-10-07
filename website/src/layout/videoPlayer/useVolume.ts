import { useCallback, useState, type RefObject } from "react";

import type { IconName } from "./PlayerIcon";

// 소리 설정은 모달을 닫았다 열어도 이 탭이 열려 있는 동안 기억한다.
export const rememberedAudio = { volume: 0.8, muted: false };

interface VolumeOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  showToast: (icon: IconName, text: string) => void;
  wakeControls: () => void;
}

export function useVolume({ videoRef, showToast, wakeControls }: VolumeOptions) {
  const [muted, setMuted] = useState(rememberedAudio.muted);
  const [volume, setVolume] = useState(rememberedAudio.volume);

  const changeVolume = useCallback(
    (value: number, shouldToast = true) => {
      const element = videoRef.current;
      if (!element) return;
      const next = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
      element.volume = next;
      element.muted = next === 0;
      rememberedAudio.volume = next || rememberedAudio.volume;
      rememberedAudio.muted = element.muted;
      setVolume(next);
      setMuted(element.muted);
      if (shouldToast) showToast(next === 0 ? "mute" : "volume", `${Math.round(next * 100)}%`);
      wakeControls();
    },
    [videoRef, showToast, wakeControls],
  );

  const toggleMute = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.muted || element.volume === 0) {
      const restored = rememberedAudio.volume > 0 ? rememberedAudio.volume : 0.6;
      element.muted = false;
      element.volume = restored;
      setVolume(restored);
      setMuted(false);
      rememberedAudio.muted = false;
      showToast("volume", `${Math.round(restored * 100)}%`);
    } else {
      element.muted = true;
      setMuted(true);
      rememberedAudio.muted = true;
      showToast("mute", "음소거");
    }
    wakeControls();
  }, [videoRef, showToast, wakeControls]);

  return { volumeLevel: muted ? 0 : volume, setMuted, changeVolume, toggleMute };
}
