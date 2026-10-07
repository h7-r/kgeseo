// NAJU-01 공간 설계 통합본 v3 의 숫자만 모은 곳.
// 그림(지형 메시)과 판정(이동·충돌·고도)이 같은 숫자를 봐야 한다 — 양쪽에 따로 적으면 한쪽만 고쳐져 어긋난다.
//
// 좌표는 A-01 마스터 블록 평면과 1:1 이다. X 0→80 m(오른쪽 +X), Z 0→50 m(도면 아래쪽·강 쪽이 +Z), Y 는 고도(EL).
// 도면 범례는 "Z = 북(↑)" 이라 적었지만 눈금이 위 0 → 아래 50 이라 눈금을 따른다.
// 도면이 미터라 여기도 미터로 적고, 그리거나 판정할 때만 UNITS_PER_METER 를 곱한다(1 유닛 ≈ 0.3 m).

export type Range = [number, number];
export type ZoneCode = "Z1" | "Z2" | "Z3" | "Z4";
export type PathCode = "T1" | "T2" | "T3" | "T4";
export type Heading = "+X" | "-X" | "+Z" | "-Z";
export type SceneNumber = 1 | 2 | 3 | 4 | 5;

/** 미터 → 유닛 */
export const UNITS_PER_METER = 1 / 0.3;
/** 유닛 → 미터 */
export const METERS_PER_UNIT = 0.3;

/** Playable Core(§2) */
export const CORE: { x: Range; z: Range } = { x: [0, 80], z: [0, 50] };

/** 씬 다섯 개의 이름(§5) — 조사점 구슬 색과 짝이다. */
export const SCENE_TITLES: Record<SceneNumber, string> = {
  1: "돌아오지 않은 약속",
  2: "엇갈리는 증언", // P01
  3: "앙암바위의 죽음", // P02
  4: "지워진 기억", // P03
  5: "돌아온 이야기", // P04
};

export interface Zone {
  code: ZoneCode;
  name: string;
  story: string;
  x: Range;
  z: Range;
  elevation: number;
  /** 도면 표기(치수·고도) */
  dimensionsLabel: string;
  scenes: string;
  color: string;
}

/** 물리 구역 4(§2 표). 이름·치수·고도 모두 §2 표와 A-01 도면 값 그대로. */
export const ZONES: Zone[] = [
  {
    code: "Z1",
    name: "나루터 · 시작 테라스",
    story: "아랑사 = □□ 어부 F-01 · 강 건너 관계 F-02", // □□ 는 아직 못 살린 두 글자
    x: [8, 28],
    z: [30, 44],
    elevation: 0,
    dimensionsLabel: "20 × 14 m · EL ±0",
    scenes: "S1 · S4",
    color: "#6E7484",
  },
  {
    code: "Z2",
    name: "바위 아래 · 자갈밭",
    story: "아랑사 추락 F-07 · 아비사의 □□□ F-09", // □□□ 는 아직 못 살린 세 글자
    x: [34, 56],
    z: [30, 44],
    elevation: 0,
    dimensionsLabel: "22 × 14 m · EL ±0",
    scenes: "S1 · S3 · S4 · S5",
    color: "#6A7A86",
  },
  {
    code: "Z3",
    name: "바위 위 · 절벽 상단",
    story: "밤마다 만나는 곳 F-06 · 추락 시작점",
    x: [34, 58],
    z: [8, 26],
    elevation: 14,
    dimensionsLabel: "24 × 18 m · EL +14",
    scenes: "S3",
    color: "#7E7466",
  },
  {
    code: "Z4",
    name: "진부촌 방향 증언 능선",
    story: "아비사 = 진부촌 처녀 F-01 · 젊은이들 F-10",
    x: [62, 76],
    z: [8, 32],
    elevation: 8,
    dimensionsLabel: "14 × 24 m · EL +8",
    scenes: "S2",
    color: "#6E7C6E",
  },
];

export interface Cliff {
  name: string;
  x: Range;
  zTop: number;
  zBottom: number;
  height: number;
}

/** 절벽(§3 B-01). Z3 남쪽 가장자리(Z 26, EL +14)에서 Z2 바닥(Z 30, EL 0)으로 떨어진다. 실각 ≈ 74°. */
export const CLIFF: Cliff = { name: "앙암바위 절벽", x: [34, 56], zTop: 26, zBottom: 30, height: 14 };

export interface CliffProfile {
  /** 마루선 z — 남쪽으로 0~2.6 m 물러난다. 물러난 만큼 어깨(선반)가 생긴다. */
  crest: number;
  /** 발치선 z — 북쪽으로 0~1.5 m 당긴다. */
  toe: number;
  height: number;
}

/**
 * x 자리의 절벽 마루·발치·높이. 도면의 직사각형 띠를 그대로 세우면 자로 그은 옹벽이 되어(사진과 가장 크게
 * 어긋난 점) 띠 안에서 흔든다. 판정(terrain)과 그림(cliff)이 같이 봐야 눈과 발이 안 어긋나므로 여기 둔다.
 * 마루는 남으로만, 발치는 북으로만 움직여 Z3·Z2 를 침범하지 않는다.
 */
export function CLIFF_OUTLINE(x: number): CliffProfile {
  const t = (x - CLIFF.x[0]) / (CLIFF.x[1] - CLIFF.x[0]);
  const wave = (a: number, b: number, c: number) => Math.sin(t * Math.PI * a + b) * c;
  // −1 ~ 1 남짓
  const s1 = wave(1.7, 0.6, 0.55) + wave(3.9, 2.1, 0.3) + wave(7.3, 4.4, 0.15);
  const s2 = wave(2.3, 1.9, 0.5) + wave(5.1, 0.4, 0.32) + wave(9.7, 3.2, 0.18);
  const s3 = wave(1.3, 2.7, 0.6) + wave(4.4, 5.0, 0.28);
  return {
    crest: CLIFF.zTop + (0.5 + s1 * 0.5) * 2.6,
    toe: CLIFF.zBottom - (0.5 + s2 * 0.5) * 1.5,
    // 0.8 ~ 1.0 배. 능선처럼 솟았다 내려앉는다.
    height: CLIFF.height * (0.9 + s3 * 0.1),
  };
}

export interface River {
  name: string;
  zStart: number;
  zEnd: number;
  /** 이쪽 물가에서 저편 물가까지(m) — 눈에 보이는 강폭 그대로 */
  farBankWidth: number;
}

/**
 * 영산강. zStart·zEnd 는 무대 안에 걸치는 물 띠다. 건너편 거리는 도면 값이 아니라 화면에서 정한 값이고
 * 여러 파일이 같이 써야 물과 뭍이 안 어긋나서 여기로 끌어올렸다.
 */
export const RIVER: River = { name: "영산강", zStart: 44.5, zEnd: 50, farBankWidth: 30 };

export interface PathDef {
  code: PathCode;
  name: string;
  route: string;
  /** 도면에서 읽은 중심선 꼭짓점 [X, Z] */
  points: [number, number][];
  width: number;
  startElevation: number;
  endElevation: number;
  plannedLength: number;
  plannedSlope: number;
  /** 길 양옆에 세우는 바위(걷는 폭 바깥에만) */
  crevasse?: { inner: number; outer: number; size: Range };
}

/**
 * 통로 4(§2 제원표). 고도는 호 길이에 비례해 올린다.
 * T3 의 도면 경사 15.5° 는 연장을 빗변으로 본 asin 값이라 atan 기준이면 14.9° 다. 좌표는 그대로 두고 계기판이 실제 값을 띄운다.
 */
export const PATHS: PathDef[] = [
  {
    code: "T1",
    name: "바위틈",
    route: "Z1 → Z2",
    points: [
      [28, 36.5],
      [31, 36.5],
      [31, 40],
      [34, 40],
    ],
    width: 3.0,
    startElevation: 0,
    endElevation: 0,
    plannedLength: 9.5,
    plannedSlope: 0,
    // 「바위틈」인데 평지 길이면 Scene 01 의 "바위틈으로 빠져나간다" 가 성립하지 않는다.
    crevasse: { inner: 1.7, outer: 4.2, size: [1.1, 3.0] },
  },
  {
    code: "T2",
    name: "강변 우회 비탈",
    route: "Z2 → Z4",
    points: [
      [56, 40],
      [61, 40],
      [64, 38],
      [66, 34.5],
      [66, 32],
    ],
    width: 3.0,
    startElevation: 0,
    endElevation: 8,
    plannedLength: 15.1,
    plannedSlope: 27.9,
  },
  {
    code: "T3",
    name: "북측 스위치백",
    route: "Z4 → Z3",
    points: [
      [63.5, 13],
      [63.5, 5],
      [52, 5],
      [52, 8],
    ],
    width: 2.5,
    startElevation: 8,
    endElevation: 14,
    plannedLength: 22.5,
    plannedSlope: 15.5,
    // 리본만 있으면 길로 안 읽혀 깎아 낸 길답게 양옆에 바위를 둔다(T1 보다 작고 낮게).
    crevasse: { inner: 1.3, outer: 2.8, size: [0.5, 1.6] },
  },
  {
    code: "T4",
    name: "서측 하강로",
    route: "Z3 → Z1",
    // 꼬리 세 점을 북쪽으로 돌렸다(A-01 과 다른 유일한 좌표). 원래 자리에선 흙둑이 나루터에서 T1 들머리로 가는
    // 선을 막았다. 길이 28.01 m·경사 26.6° 는 도면 표 그대로다.
    points: [
      [36, 24.5],
      [31, 23],
      [25, 25.5],
      [21.5, 29],
      [18.5, 31.5],
      [21, 33],
      [25.5, 33],
    ],
    width: 2.5,
    startElevation: 14,
    endElevation: 0,
    plannedLength: 28.0,
    plannedSlope: 26.6,
  },
];

export interface Shoulder {
  width: number;
  drop: number;
  /** 갓길폭의 몇 배까지 나가는가(그림의 가로 좌표 |u| ≤ 1 + reach) */
  reach: number;
}

/** 길바닥 바깥 어깨. 그림과 걷는 판정이 반드시 같은 숫자를 봐야 갓길을 밟아도 안 꺼진다. */
export const SHOULDER_DEFAULTS: Shoulder = { width: 0.9, drop: 0.35, reach: 0.6 };

/** 고리 1바퀴 = Z1 → Z2 → Z4 → Z3 → Z1 (§1 RESOLVED 02) */
export const LOOP: { order: ZoneCode[]; plannedLength: number } = {
  order: ["Z1", "Z2", "Z4", "Z3", "Z1"],
  plannedLength: 75.1,
};

export interface BlockerDef {
  code: string;
  name: string;
  role: string;
  x: Range;
  z: Range;
  /** 덩어리가 시작하는 고도 */
  foot: number;
  /** 그 위에 선 사람 기준 발밑 고도 */
  floor?: number;
  /** 이 구역의 고도 위에 선다 — 절벽 높이를 돌리면 같이 올라간다 */
  floorZone?: ZoneCode;
  height: number;
  /** 이 씬이 끝나면 치운다. lookAt 은 치우는 순간 카메라가 볼 자리 [x, z] */
  clearing?: { scene: SceneNumber; lookAt: [number, number]; message: string };
}

/**
 * 시야 차단물(§2 회색 블록). 높이는 도면에 없어 "선 채로 너머가 안 보이는" 최소치로 잡았다.
 * B2·수목대는 Z3 와 Z4 사이 빈 골(X 58~62)에 서 있어 발을 0 으로 두어 골을 메운다 — +14 로 두면 공중에 뜬 상자라
 * Z4 쪽에서 아무것도 못 가린다.
 * 도면 그림에만 있던 B1b「바위 능선(남)」은 뺐다. T1 길 위로 튀어나왔고 §4 가 요구한 차단도 아니었다.
 * 되살리려면 Z 를 39 아래로 당겨 길을 안 밟게: { code: "B1b", x: [28, 34], z: [41.6, 44], foot: 0, floor: 0, height: 3.5 }
 */
export const BLOCKERS: BlockerDef[] = [
  {
    code: "B1",
    name: "바위 능선",
    role: "V1에서 Z2 내부 조사점을 가림",
    x: [28, 34],
    z: [30, 34.6],
    foot: 0,
    floor: 0,
    height: 3.5,
  },
  {
    code: "B2",
    name: "북측 바위",
    role: "Z4 지점에서 Z3 북측을 가림",
    x: [58, 62],
    z: [8, 13.2],
    foot: 0,
    floorZone: "Z3",
    height: 4.0,
    // 씬 진행 장치가 아직 없어 개발용 손잡이와 window.__game.naju.endScene(번호) 로 부른다.
    clearing: { scene: 2, lookAt: [63.5, 11], message: "북측 바위가 무너져 길이 열렸다" },
  },
  {
    code: "수목대",
    name: "수목대",
    role: "V3 의 주 차단 장치",
    x: [58, 62],
    z: [15.8, 26],
    foot: 0,
    floorZone: "Z3",
    height: 5.0,
  },
  {
    code: "B3",
    name: "동측 바위",
    role: "T2 진입부에서 Z3 방향 시야를 끊음",
    x: [56, 62],
    z: [30, 33],
    foot: 0,
    floor: 0,
    height: 3.5,
  },
];

export interface Viewpoint {
  code: string;
  x: number;
  z: number;
  /** 도면에 찍힌 원래 z(설 수 없는 자리라 옮겼을 때만) */
  plannedZ?: number;
  zone: ZoneCode;
  heading: Heading;
  distance: number;
  color: string;
  shows: string;
  hides: string;
}

/**
 * 시점 3(§4 C-01). 개발용 1·2·3 키로 이 자리·방향에 선다.
 * V2 는 도면상 (45, 27.2) 인데 절벽 배터 띠 안이라 설 수 없어, Z3 남쪽 가장자리로 당겼다.
 */
export const VIEWPOINTS: Viewpoint[] = [
  {
    code: "V1",
    x: 11,
    z: 38.5,
    zone: "Z1",
    heading: "+X",
    distance: 12,
    color: "#2F6F5E",
    shows: "영산강 · 건너편 뱃길 · 앙암바위 절벽 윤곽",
    hides: "Z2 내부 조사점 · Z4 증언 구역",
  },
  {
    code: "V2",
    x: 45,
    z: 25.4,
    plannedZ: 27.2,
    zone: "Z3",
    heading: "+Z",
    distance: 13,
    color: "#D97B29",
    shows: "Z2 자갈밭 전체 · 추락 지점 · 강",
    hides: "— 사건 이해를 위해 의도적으로 열어 둔 유일한 지점",
  },
  {
    code: "V3",
    x: 65,
    z: 19,
    zone: "Z4",
    heading: "-X",
    distance: 6.5,
    color: "#7A6A9E",
    shows: "진부촌 방향 원경 · 증언 요소",
    hides: "Z3 · Z2 사건 현장",
  },
];

export interface InvestigationSlot {
  scene: SceneNumber;
  color: string;
  points: [number, number][];
}

/** 조사점 후보 슬롯. 실제 instance_id·정답은 정하지 않고 "설 수 있나 / 보이나" 만 본다. */
export const INVESTIGATION_POINTS: InvestigationSlot[] = [
  {
    scene: 1,
    color: "#23263B",
    points: [
      [13, 43],
      [24, 42.5],
      [38, 41],
    ],
  },
  {
    scene: 2,
    color: "#3D7EA6",
    points: [
      [66, 11],
      [73, 20],
      [10.5, 32],
    ],
  },
  {
    scene: 3,
    color: "#D97B29",
    points: [
      [39, 11],
      [51, 22],
      [52, 32],
    ],
  },
  {
    scene: 4,
    color: "#7A6A9E",
    points: [
      [18, 42.5],
      [54, 42.5],
    ],
  },
  { scene: 5, color: "#2F6F5E", points: [[45, 37]] },
];

/** §163 「시작 지점·아비사」 대화가 여기서 열린다. */
export const NPC: { name: string; zone: ZoneCode; x: number; z: number; color: string } = {
  name: "아비사",
  zone: "Z1",
  x: 22,
  z: 38.5,
  color: "#B4544C",
};

export interface Section {
  code: string;
  axis: "X" | "Z";
  value: number;
  description: string;
}

/** 단면선(§3 · §7) */
export const SECTIONS: Section[] = [
  { code: "A–A′", axis: "X", value: 48, description: "종단면 · Z3 → 절벽 → Z2 → 영산강" },
  { code: "B–B′", axis: "Z", value: 34, description: "횡단면 · Z1 → T1 → Z2 → T2" },
];

/** 시점·조작 기준값(§9). 걷기 속도는 본편 engine 의 WALK 가 정한다. */
export const BASELINE = {
  eyeHeight: 1.6, // m — §9
  crouchEyeHeight: 0.9, // m — §6
  fov: 60, // ° — §9
  minPathWidth: 2.5, // m — T3·T4 폭
  maxSlope: 30, // ° — 0단계 규칙
};

export interface TunableRange {
  /** null 이면 부르는 쪽 기본값(걷기 속도는 본편 WALK) */
  value: number | null;
  min: number;
  max: number;
  step: number;
  unit: string;
  basis: string;
}

/**
 * Leva 손잡이의 범위(§9 「가정」·「검증용」 값). Leva 로 돌린 값은 내 브라우저에만 남으니
 * 확정하려면 여기 기본값을 고쳐야 팀에 전달된다. 절벽 높이는 곧 Z3 고도라 T3·T4 경사가 같이 움직인다.
 */
export const TUNABLE_RANGES = {
  cliffHeight: { value: CLIFF.height, min: 6, max: 22, step: 0.5, unit: "m", basis: "§3 · §9" },
  blockerHeight: { value: 1, min: 0.4, max: 2.5, step: 0.05, unit: "배", basis: "§4 — 도면에 없음" },
  eyeHeight: { value: BASELINE.eyeHeight, min: 1.2, max: 2.2, step: 0.05, unit: "m", basis: "§9 · 본편 1.95" },
  fov: { value: BASELINE.fov, min: 45, max: 90, step: 1, unit: "°", basis: "§9" },
  walkSpeed: { value: null, min: 0.4, max: 3.5, step: 0.1, unit: "m/s", basis: "§9 가정 2.5" },
} satisfies Record<string, TunableRange>;

export type TunableKey = keyof typeof TUNABLE_RANGES;

/** Leva 항목 하나({ value, min, max, step }). 범위·기본값은 TUNABLE_RANGES 한 곳에서만 온다. */
export function tunable(key: TunableKey, fallback = 0) {
  const range: TunableRange = TUNABLE_RANGES[key];
  return { value: range.value ?? fallback, min: range.min, max: range.max, step: range.step };
}
