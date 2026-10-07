import type { CSSVars } from "@/lib/style";

import PlayerIcon, { type IconName } from "./PlayerIcon";

interface VolumeControlProps {
  volumeLevel: number;
  onToggleMute: () => void;
  onChange: (value: number, shouldToast: boolean) => void;
}

/** 단추 = 음소거, 막대 = 크기. 이 칸 위에서 휠을 굴려도 크기가 바뀐다(useWheelControl). */
export default function VolumeControl({ volumeLevel, onToggleMute, onChange }: VolumeControlProps) {
  const icon: IconName = volumeLevel === 0 ? "mute" : volumeLevel < 0.5 ? "volumeLow" : "volume";
  const muteLabel = volumeLevel === 0 ? "소리 켜기 (M)" : "음소거 (M)";
  const volumeStyle: CSSVars = { "--volume": volumeLevel };
  return (
    <div className="player__volume">
      <button type="button" className="player__btn" onClick={onToggleMute} aria-label={muteLabel} title={muteLabel}>
        <PlayerIcon name={icon} />
      </button>
      <input
        type="range"
        className="player__volume-slider"
        min={0}
        max={1}
        step={0.01}
        value={volumeLevel}
        onChange={(event) => onChange(Number(event.target.value), false)}
        aria-label="소리 크기"
        style={volumeStyle}
      />
    </div>
  );
}
