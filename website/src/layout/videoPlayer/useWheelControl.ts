import { useEffect, type RefObject } from "react";

// 트랙패드는 아주 잘게 여러 번 오므로 이만큼 쌓일 때마다 한 칸으로 센다.
const WHEEL_STEP = 60;

interface WheelControlOptions {
  boxRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  seekBy: (delta: number) => void;
  changeVolume: (value: number) => void;
}

// 휠: 영상 위 = 장면 옮기기, 소리 칸 위 = 소리 조절. 막으려면 passive: false 로 직접 달아야 한다.
export function useWheelControl({ boxRef, videoRef, seekBy, changeVolume }: WheelControlOptions) {
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    let accumulated = 0;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      accumulated += event.deltaY;
      if (Math.abs(accumulated) < WHEEL_STEP) return;
      const direction = Math.sign(accumulated);
      accumulated = 0;
      if (event.target instanceof Element && event.target.closest(".player__volume")) {
        const current = videoRef.current;
        const level = current?.muted ? 0 : (current?.volume ?? 0);
        changeVolume(level - direction * 0.05); // 위로 굴리면 크게
      } else {
        seekBy(direction * 2); // 아래로 굴리면 앞으로
      }
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [boxRef, videoRef, seekBy, changeVolume]);
}
