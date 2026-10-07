/**
 * 사이트 곳곳(경주 원 · 시나리오 카드)에 들어가는 영상. 같은 영상을 작은 자리와 모달 두 곳에서 쓴다.
 *
 * 파일은 ffmpeg 로 2배속을 구워 넣었다(playbackRate 대신) — 용량이 반이고, 어디서 틀어도 같은 속도이고,
 * atempo 는 음높이를 바꾸지 않는다. 새 영상도 같은 명령으로 뽑는다:
 *   ffmpeg -i 원본.mov -filter_complex "[0:v]setpts=0.5*PTS,fps=30[v];[0:a]atempo=2.0[a]" \
 *     -map "[v]" -map "[a]" -c:v libx264 -crf 24 -pix_fmt yuv420p -movflags +faststart -c:a aac 이름.mp4
 */
export interface Video {
  /** public 기준 영상 주소 */
  src: string;
  /** 영상이 뜨기 전에 보여 줄 첫 장면 */
  poster: string;
  /** 모달 왼쪽 위에 뜨는 이름 */
  title: string;
}

export const VIDEOS = {
  gyeongju: {
    src: "/gyeongju-film.mp4",
    poster: "/gyeongju-film-poster.webp",
    title: "경주 (Gyeongju) · 신라의 비밀",
  },
  mokpo: {
    src: "/mokpo-film.mp4",
    poster: "/mokpo-film-poster.webp",
    title: "목포 (Mokpo) · 갓바위의 전설",
  },
  yeosu: {
    src: "/yeosu-film.mp4",
    poster: "/yeosu-film-poster.webp",
    title: "여수 (Yeosu) · 거북선의 비밀",
  },
  suncheon: {
    src: "/suncheon-film.mp4",
    poster: "/suncheon-film-poster.webp",
    title: "순천 (Suncheon) · 순천만의 비밀",
  },
} satisfies Record<string, Video>;

/** 게임 본편 public 에도 같은 파일이 있어야 넘어가는 순간 장면이 끊기지 않는다. */
export const OPENING_FILM = { src: "/opening-cinematic.mp4", poster: "/opening-cinematic-poster.jpg" } as const;
