/**
 * 나주 엔딩 대본 · 그림 · 창 문구 — **초안**(이야기팀 승인 전, 미르가 화면 보고 정한다 · 11/11).
 * 흐름: 게임 안 끝 연출(자막 띠) → 전체화면 필름[지금까지의 조사(되짚기) → 전해지는 이야기(시나리오 엔딩 컷 E1~E4) → 마지막 물음]
 *       → 클리어 화면 + 현장 방문 창.
 *
 * 쓰는 기준
 *  - 되짚기는 게임 안에서 실제로 나온 말만 다시 쓴다(아비사 의뢰 · 인연, 어부 증언, 물굴 흔적, 함의 영상, 선바위 영상).
 *    아랑사의 죽음은 원전(F-07)대로 가해를 적는다 — 「발이 미끄러졌다」로만 쓰면 사고로 읽힌다(사실 계약서 NG-03, 11/11 정리).
 *  - 끝내 말하지 않는 것은 구렁이의 정체뿐이다(GF-02 · 03). 굴림(F-09)과 그 뒤의 일(F-10)은 원전대로 적는다(11/11 연출 · 대본 정리).
 *  - 그림: 10/27 시나리오 컷(naju01/cine-preview, FLUX.2 klein 4B 로컬 생성)을 public/naju-ending 으로 옮겼다.
 *    음성(macOS say)은 Apple 시스템 음성 약관상 배포할 수 없어 쓰지 않는다 — 대본은 자막으로.
 *  - 현장 방문: 황포돛배 선착장에서 방문 인증 → 추가 스토리 · 방문 보상(미르 11/11). 인증 기능은 아직 없어 창 끝에 「준비 중」
 *    한 줄만 둔다(보상 내용은 확정 전이라 이름만). 정해지면 VISIT_TEXT 만 고친다.
 */

import { DEATH_WORDING } from "../story/storyVariants.ts";

const ART = "/naju-ending/";

interface ShotBase {
  id: string;
  /** 큰 묶음 이름(지금까지의 조사 · 전해지는 이야기) — 그 묶음의 첫 장에만 */
  part?: string;
  /** 장 머리말(장소 · 무엇) */
  chapter?: string;
  /** 대본 — 한 번에 뜬다(한두 문장) */
  lines: readonly string[];
}

export type FilmShot =
  | (ShotBase & { kind: "image"; src: string; pan?: "left" | "right" | "in" })
  | (ShotBase & {
      kind: "film";
      /** 게임 속 영상 — box 함의 그림자극(ridge/shadowPlay) · moon 선바위 영상(cliff/moonPlay) */
      film: "box" | "moon";
      from: number;
      to: number;
      speed?: number;
    })
  | (ShotBase & { kind: "text"; tone: "title" | "closing" });

export const FILM_SHOTS: readonly FilmShot[] = [
  { id: "title", kind: "text", tone: "title", lines: ["나주 · 앙암바위", "돌아오지 않은 약속"] },
  {
    id: "dock",
    kind: "image",
    src: `${ART}dock-request.jpg`,
    pan: "in",
    part: "지금까지의 조사",
    chapter: "나루터 · 아비사의 부탁",
    lines: [
      "나루터에서 만난 아비사는 사람을 찾아 달라고 했다.",
      "강 건너 택촌의 어부 아랑사. 밤마다 앙암바위에서 만나던 그이가, 만나기로 한 그날 오지 않았다.",
    ],
  },
  {
    id: "bond",
    kind: "image",
    src: `${ART}bond.jpg`,
    pan: "left",
    chapter: "나루터 · 꺼진 화톳불",
    lines: [
      "꺼진 화톳불에 불씨를 되살리자, 아비사가 두 사람의 처음을 들려주었다.",
      "병드신 아버지께 드릴 물고기를 못 구해 울던 날, 아랑사가 제가 잡은 물고기를 건넸다고.",
    ],
  },
  {
    // 되짚기는 줄인다(미르 11/11 — 복기보다 아직 못 전한 사실을) — 엇갈린 증언과 강 밑의 흔적을 한 장으로
    id: "witness",
    kind: "image",
    src: `${ART}witness.jpg`,
    pan: "right",
    chapter: "바위 아래 · 강 밑",
    lines: [
      "바위 아래 어부들의 말은 엇갈렸다. 강 밑 석실에는 아주 오래 기다린 불과, 잠긴 함이 있었다.",
      "함 속 빛이 그 밤을 보여 주었다.",
    ],
  },
  {
    id: "box",
    kind: "film",
    film: "box",
    from: 0.3,
    to: 10.2,
    chapter: "증언 능선 · 아랑사의 함",
    // 원전 F-07 「시기해 속였고, 떨어뜨려 죽였다」 — 가해를 글에서 지우지 않는다(사실 계약서 NG-03). 수위는 storyVariants
    lines:
      DEATH_WORDING === "soft"
        ? ["진부촌 젊은이들은 두 사람의 사랑을 시기했다.", "아랑사는 그들에게 속아, 벼랑 아래로 떨어졌다."]
        : ["진부촌 젊은이들은 두 사람의 사랑을 시기했다.", "아랑사를 속여 바위 아래로 떨어뜨려 죽였다."],
  },
  {
    id: "moon",
    kind: "film",
    film: "moon",
    from: 0,
    to: 15.2,
    chapter: "바위 위 · 그 뒤의 밤들",
    // 원전 F-08 · F-09 — 굴림을 「아무도 말하지 않는다」로 두지 않는다
    lines: [
      "아비사는 그 뒤로도 바위를 찾았고, 강에서 올라온 구렁이를 사랑했다.",
      "마을 젊은이들은 이를 나쁜 징조라 여겨, 아비사와 구렁이를 함께 바위 아래로 굴려 버렸다.",
    ],
  },
  {
    id: "rings",
    kind: "image",
    src: `${ART}ending-4.jpg`,
    pan: "left",
    chapter: "굿판 · 건네지 못한 가락지",
    lines: [
      "그 밤 건네려던 조가비 가락지 한 쌍. 다섯 횃불을 일이 일어난 차례대로 밝히자,",
      "건네지 못한 것이 이제야 강을 건너갔다.",
    ],
  },
  {
    // 원전 F-10 — 굴림 뒤 · 씻김굿 앞. 「구렁이가 복수했다」는 인과는 말하지 않는다
    id: "aftermath",
    kind: "image",
    src: `${ART}river.jpg`,
    pan: "in",
    part: "전해지는 이야기",
    lines: [
      "그 뒤 진부촌 젊은이들이 시름시름 앓다가 잇달아 죽었다고 한다.",
      "밤마다 서로 얽힌 구렁이 두 마리가 진부촌에 나타났다고 한다.",
    ],
  },
  {
    id: "rite",
    kind: "image",
    src: `${ART}ending-1.jpg`,
    pan: "in",
    lines: ["노인들이 뜻을 모으자 무당들이 음력 8월에 씻김굿을 했다.", "그들의 넋을 위로하기 위한 굿이었다."],
  },
  {
    id: "spared",
    kind: "image",
    src: `${ART}ending-2.jpg`,
    pan: "right",
    lines: ["씻김굿 뒤 마을은 화를 면했다고 한다.", "구렁이들의 정체는 분명히 밝혀져 있지 않다."],
  },
  {
    id: "villages",
    kind: "image",
    src: `${ART}ending-3.jpg`,
    pan: "left",
    lines: [
      "벼랑 허리쯤에는 진부촌이, 강 건너에는 택촌이 있다.",
      "해가 기우는 앙암바위 아래로, 영산강은 두 마을 사이를 지나 흐른다.",
    ],
  },
  {
    id: "told",
    kind: "text",
    tone: "closing",
    lines: ["아랑사와 아비사의 이야기는 지금도", "앙암바위에 전해진다."],
  },
];

/**
 * 아비사의 작별 — 굿 끝 연출에서 현장으로 본다(gut/abisaFarewell). 그 장면을 못 본 채 필름이 열릴 때만
 * (도중에 나갔다 이어 하기 · 「엔딩 다시 보기」) 맺음 앞에 글로 넣는다 — 물은 사람이 답을 듣는 대목이 빠지지 않게(Codex 리뷰)
 */
const FAREWELL_SHOT: FilmShot = {
  id: "farewell",
  kind: "text",
  tone: "closing",
  lines: ["「이제 기억나요. 그날 바위에서… 저도 돌아오지 못했어요.」", "— 아비사"],
};

/** 이번에 틀 장들 */
export function filmShots(hasSeenFarewell: boolean): readonly FilmShot[] {
  if (hasSeenFarewell) return FILM_SHOTS;
  const at = FILM_SHOTS.findIndex((shot) => shot.id === "told");
  return [...FILM_SHOTS.slice(0, at), FAREWELL_SHOT, ...FILM_SHOTS.slice(at)];
}

/** 장 길이(초) — 영상은 그 대목 길이, 글은 읽는 시간(글자 수) */
export function shotSeconds(shot: FilmShot): number {
  if (shot.kind === "film") return (shot.to - shot.from) / (shot.speed ?? 1);
  const chars = shot.lines.join("").length;
  if (shot.kind === "text") return shot.tone === "title" ? 4 : Math.max(6, 2.5 + chars * 0.09);
  return Math.min(10, Math.max(6, 2.4 + chars * 0.07));
}

/** 엔딩 음악 — 로딩 영상과 같은 곡 묶음(public/bgm) */
export const ENDING_MUSIC = { url: "/bgm/final-chord.mp3", gain: 0.9 };

export const CLEAR_TEXT = {
  eyebrow: "나주 · 앙암바위의 전설",
  title: "게임을 클리어하셨습니다",
  line: "건네지 못한 마음이, 이제야 강을 건넜습니다.",
  train: "다른 지역으로 이동하기",
  trainNote: "기차에서 다음 목적지를 고릅니다",
  lobby: "로비로 나가기",
  restart: "처음부터 다시하기",
  restartQuestion: "나주의 진행을 지우고 처음부터 다시 할까요?",
  restartNote: "퍼즐 진행 · 소지품 · 조사 시간이 지워지고, 되돌릴 수 없어요.",
  restartNoteGuest: "로그인하지 않아 저장된 진행은 없어요. 이 판을 처음부터 새로 시작해요.",
  restartConfirm: "지우고 처음부터",
};

/**
 * 현장 방문 창 — 황포돛배 선착장에서 방문 인증 → 추가 스토리 · 방문 보상(미르 11/11 「황포돛배 선착장에 가서 방문 인증을 하고
 * 추가 스토리랑 방문 보상을 획득하라는 메시지가 보여야」). 인증 기능이 아직 없어 끝에 한 줄로만 알린다 — 열리면 note 를 지운다
 */
export const VISIT_TEXT = {
  badge: "현장 방문 미션",
  title: "황포돛배 선착장에서 이야기를 이어 가세요",
  lead: "나주 영산포 황포돛배 선착장에 가서 방문 인증을 하면, 게임에서 다 말하지 못한 추가 스토리와 방문 보상을 받을 수 있습니다.",
  place: "전남 나주 · 영산포 황포돛배 선착장",
  spot: "앙암바위와 같은 영산강 물길의 나루",
  how: "선착장에서 방문 인증하기",
  // 첫 줄 — 게임이 남겨 둔 물음을 짚는다. 함 영상은 「그들이 꾸민 계략」이라고만 말하고 무엇을 꾸몄는지는 보여 주지 않는다
  // (미르 11/11 「계략의 실체는 현장 방문 때 추가 스토리를 열어 주면서 알려 준다」). 그 내용은 아직 안 썼다 — 원문에 없는 대목이라 미르가 정한다
  rewards: ["추가 스토리 — 그 밤, 그들이 꾸민 계략", "방문 보상"],
  note: "방문 인증은 준비 중입니다. 열리면 이 창과 웹사이트에서 안내합니다.",
};
