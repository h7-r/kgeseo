// 유튜브 IFrame Player API — 필요한 만큼만 타입을 적고, 스크립트는 처음 쓸 때 한 번만 불러온다.
// https://developers.google.com/youtube/iframe_api_reference

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  nextVideo(): void;
  setVolume(volume: number): void;
  getVolume(): number;
  isMuted(): boolean;
  destroy(): void;
  /** 공식 문서에 없는 함수 — 있는지 보고 쓴다 */
  getVideoData?(): { title?: string; video_id?: string } | undefined;
}

export interface YouTubeEvent<T = unknown> {
  target: YouTubePlayer;
  data: T;
}

export interface YouTubePlayerOptions {
  host?: string;
  videoId?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YouTubeEvent) => void;
    onStateChange?: (event: YouTubeEvent<number>) => void;
    onError?: (event: YouTubeEvent<number>) => void;
    onAutoplayBlocked?: (event: YouTubeEvent) => void;
  };
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** onStateChange 값 */
export const PLAYER_STATE = { ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

let loading: Promise<YouTubeNamespace> | null = null;

export function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube API 가 비어 있다"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("YouTube API 를 불러오지 못했다"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
