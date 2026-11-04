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

/**
 * 나주 「앙암바위」 게임 화면 촬영 — 게임 영상 갤러리 다섯 편.
 * 게임 화면을 가상 시계로 찍고 밤빛으로 편집했다. 카메라와 빛은 촬영 때만 바꾼 것이라 실제 플레이 화면과 다르다.
 */
export const GAMEPLAY_VIDEOS = {
  ferry: { src: "/naju-play-ferry-v2.mp4", poster: "/naju-play-ferry-v2.webp", title: "나주 · 꺼진 화톳불" },
  ritual: { src: "/naju-play-ritual-v2.mp4", poster: "/naju-play-ritual-v2.webp", title: "나주 · 기우제" },
  cave: { src: "/naju-play-cave-v2.mp4", poster: "/naju-play-cave-v2.webp", title: "나주 · 강 밑 물굴" },
  curtain: { src: "/naju-play-curtain-v2.mp4", poster: "/naju-play-curtain-v2.webp", title: "나주 · 바람 장막" },
  birds: { src: "/naju-play-birds-v2.mp4", poster: "/naju-play-birds-v2.webp", title: "나주 · 깨어난 돌새" },
} satisfies Record<string, Video>;

/** 게임 소개 탭마다 도는 영상. 조작법은 실제 튜토리얼 화면이고 나머지는 촬영·편집본이다. */
export const VIDEOS_FOR_ABOUT = {
  overview: { src: "/naju-film-v4.mp4", poster: "/naju-film-v4-poster.webp", title: "게임 소개 · 본부실에서 나주로" },
  controls: { src: "/about-controls.mp4", poster: "/about-controls.webp", title: "조작법 · 복도 튜토리얼" },
  story: { src: "/about-story.mp4", poster: "/about-story.webp", title: "스토리 & 세계관 · 나주 앙암바위" },
  updates: GAMEPLAY_VIDEOS.birds,
} satisfies Record<string, Video>;

/** 홈 배경 필름. 스크롤로 앞뒤로 넘기므로 키프레임을 촘촘히 구웠다(ffmpeg -g 2 -bf 0). */
export const RIVER_FILM = { src: "/river-film-v2.mp4" };

/**
 * 홈 링 안의 필름 — 본부실 사건 보드에서 나주의 밤으로 빨려 든다.
 * 게임 화면을 찍되 촬영할 때만 밤빛으로 바꾸고, 왜곡·색은 편집에서 입혔다(게임 자체의 낮 화면과 다르다).
 */
export const NAJU_FILM = { src: "/naju-film-v4.mp4", poster: "/naju-film-v4-poster.webp" } as const;

/** 게임 본편 public 에도 같은 파일이 있어야 넘어가는 순간 장면이 끊기지 않는다. */
export const OPENING_FILM = { src: "/opening-cinematic.mp4", poster: "/opening-cinematic-poster.jpg" } as const;
