/**
 * 나주 엔딩 대본 · 그림 · 창 문구 — **초안**(이야기팀 승인 전, 미르가 화면 보고 정한다 · 11/11).
 * 흐름: 게임 안 끝 연출(자막 띠) → 전체화면 필름[지금까지의 조사(되짚기) → 전해지는 이야기(시나리오 엔딩 컷 E1~E4) → 마지막 물음]
 *       → 클리어 화면 + 현장 방문 창.
 *
 * 쓰는 기준
 *  - 되짚기는 게임 안에서 실제로 나온 말만 다시 쓴다(아비사 의뢰 · 인연, 어부 증언, 물굴 흔적, 함의 영상, 선바위 영상).
 *    10/27 시나리오의 「젊은이들 손에 죽었다」보다 약하게 — 게임은 「숨어 있던 셋이 보는 앞에서 발이 미끄러졌다」까지만 말한다.
 *  - 끝내 말하지 않는 것(구렁이의 정체 · 아비사의 최후 · 횃불 든 사내들이 한 일)은 열어 둔다.
 *  - 그림: 10/27 시나리오 컷(naju01/cine-preview, FLUX.2 klein 4B 로컬 생성)을 public/naju-ending 으로 옮겼다.
 *    음성(macOS say)은 Apple 시스템 음성 약관상 배포할 수 없어 쓰지 않는다 — 대본은 자막으로.
 *  - 현장 방문: 황포돛배 선착장에서 방문 인증 → 추가 스토리 · 방문 보상(미르 11/11). 인증 기능은 아직 없어 창 끝에 「준비 중」
 *    한 줄만 둔다(보상 내용은 확정 전이라 이름만). 정해지면 VISIT_TEXT 만 고친다.
 */

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
      "그날 밤 꺼진 화톳불에 불씨를 되살리자, 아비사가 두 사람의 처음을 들려주었다.",
      "병드신 아버지께 드릴 물고기를 못 구해 울던 날, 아랑사가 제가 잡은 물고기를 건넸다고.",
    ],
  },
  {
    id: "witness",
    kind: "image",
    src: `${ART}witness.jpg`,
    pan: "right",
    chapter: "바위 아래 · 엇갈린 증언",
    lines: [
      "바위 아래 어부들의 말은 엇갈렸다.",
      "그날 해 질 녘, 마을 젊은이들이 몰려 바위로 오르던 길 — 그 틈에서 누가 「아랑사」를 불렀다고 했다.",
    ],
  },
  {
    id: "cave",
    kind: "image",
    src: `${ART}river.jpg`,
    pan: "in",
    chapter: "강 밑 물굴 · 기다린 흔적",
    lines: [
      "기우제를 올리자 강이 갈라졌다. 강 밑 석실에는 아주 오래 기다린 불과,",
      "아랑사가 남긴 푸른 눈물, 그리고 잠긴 함이 있었다.",
    ],
  },
  {
    id: "box",
    kind: "film",
    film: "box",
    from: 0.3,
    to: 10.2,
    chapter: "증언 능선 · 아랑사의 함",
    lines: [
      "함 속 빛이 그 밤을 보여 주었다.",
      "초롱을 들고 바위에 오른 아랑사 — 숨어 있던 셋이 보는 앞에서, 벼랑 끝에서 발이 미끄러졌다.",
    ],
  },
  {
    id: "moon",
    kind: "film",
    film: "moon",
    from: 0,
    to: 15.2,
    chapter: "바위 위 · 그 뒤의 밤들",
    lines: [
      "아비사는 그 뒤로도 밤마다 바위에 올라 물 세 그릇을 떠 놓았다.",
      "떨어진 그 틈에서 구렁이가 올라와 곁에 누웠고 — 횃불 든 사내들이 바위에 올라왔다.",
    ],
  },
  {
    id: "rings",
    kind: "image",
    src: `${ART}ending-4.jpg`,
    pan: "left",
    chapter: "굿판 · 건네지 못한 가락지",
    lines: [
      "그 밤 건네려던 조가비 가락지 한 쌍. 다섯 횃불을 그 밤의 차례대로 밝히자,",
      "건네지 못한 것이 이제야 강을 건너갔다.",
    ],
  },
  {
    id: "rite",
    kind: "image",
    src: `${ART}ending-1.jpg`,
    pan: "in",
    part: "전해지는 이야기",
    lines: ["노인들이 뜻을 모으자 무당들이 음력 8월에 씻김굿을 했다.", "그들의 넋을 위로하기 위한 굿이었다."],
  },
  {
    id: "spared",
    kind: "image",
    src: `${ART}ending-2.jpg`,
    pan: "right",
    lines: [
      "그 뒤부터 진부촌은 화를 면했다고 전한다.",
      "구렁이가 무엇이었는지, 아비사가 어찌 되었는지는 이야기가 끝내 말해 주지 않는다.",
    ],
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
    lines: ["아랑사와 아비사의 이야기는 지금도", "가슴 아픈 이야기로 전해진다."],
  },
  {
    id: "question",
    kind: "text",
    tone: "closing",
    lines: ["강 건너편에서 들려오는 소리를 들은 적이 있다면 —", "어떤 소리였습니까?"],
  },
];

/** 장 길이(초) — 영상은 그 대목 길이, 글은 읽는 시간(글자 수) */
export function shotSeconds(shot: FilmShot): number {
  if (shot.kind === "film") return (shot.to - shot.from) / (shot.speed ?? 1);
  const chars = shot.lines.join("").length;
  if (shot.kind === "text") return shot.tone === "title" ? 4 : Math.max(6, 2.5 + chars * 0.09);
  return Math.min(12, Math.max(7, 2.8 + chars * 0.075));
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
  rewards: ["앙암바위 이야기의 추가 스토리", "방문 보상"],
  note: "방문 인증은 준비 중입니다. 열리면 이 창과 웹사이트에서 안내합니다.",
};
