export const 사이드킥모션목록 = [
  ["자동", "자동 · 게임 상태"],
  ["A_TPose", "A/T 기본 포즈"],
  ["Idle_Loop", "대기"],
  ["Idle_Talking_Loop", "말하며 대기"],
  ["Idle_Torch_Loop", "횃불 대기"],
  ["Walk_Loop", "걷기"],
  ["Walk_Formal_Loop", "정중한 걷기"],
  ["Jog_Fwd_Loop", "조깅"],
  ["Sprint_Loop", "전력 질주"],
  ["Crouch_Idle_Loop", "앉은 대기"],
  ["Crouch_Fwd_Loop", "앉아 걷기"],
  ["Jump_Start", "점프 시작"],
  ["Jump_Loop", "점프 공중"],
  ["Jump_Land", "점프 착지"],
  ["Roll", "구르기"],
  ["Dance_Loop", "춤"],
  ["Interact", "상호작용"],
  ["PickUp_Table", "테이블 물건 줍기"],
  ["Push_Loop", "밀기"],
  ["Fixing_Kneeling", "무릎 꿇고 수리"],
  ["Sitting_Enter", "앉기 시작"],
  ["Sitting_Idle_Loop", "앉은 대기"],
  ["Sitting_Talking_Loop", "앉아서 말하기"],
  ["Sitting_Exit", "일어나기"],
  ["Swim_Idle_Loop", "제자리 수영"],
  ["Swim_Fwd_Loop", "전진 수영"],
  ["Hit_Chest", "가슴 피격"],
  ["Hit_Head", "머리 피격"],
  ["Death01", "사망"],
  ["Punch_Jab", "잽"],
  ["Punch_Cross", "크로스 펀치"],
  ["Spell_Simple_Enter", "마법 자세 시작"],
  ["Spell_Simple_Idle_Loop", "마법 대기"],
  ["Spell_Simple_Shoot", "마법 발사"],
  ["Spell_Simple_Exit", "마법 자세 해제"],
  ["Sword_Idle", "검 대기"],
  ["Sword_Attack", "검 공격"],
  ["Pistol_Idle_Loop", "권총 대기"],
  ["Pistol_Aim_Up", "권총 위 조준"],
  ["Pistol_Aim_Neutral", "권총 정면 조준"],
  ["Pistol_Aim_Down", "권총 아래 조준"],
  ["Pistol_Shoot", "권총 사격"],
  ["Pistol_Reload", "권총 재장전"],
  ["Driving_Loop", "운전"],
];

// 의상 번호는 GLB 메시 이름 `SKLIB__슬롯__번호__...`와 같다.
//   1      = 속옷 상태(기본 몸)
//   2 · 3  = Synty SF·기사 원본 세트. 라이선스 원본은 남기지만 선택지에서는 숨긴다.
//   4 ~ 7  = 남성 현대 캐주얼,  8 ~ 11 = 여성 현대 캐주얼 (build_sidekick_wardrobe.py)
export const 성별목록 = [
  ["masculine", "남성"],
  ["feminine", "여성"],
];

export const 성별의상선택지 = {
  masculine: {
    top: [
      [1, "없음 · 속옷"],
      [4, "크루넥 반팔 티"],
      [5, "루즈핏 반팔 티"],
      [6, "기본 긴팔 티"],
      [7, "맨투맨"],
    ],
    bottom: [
      [1, "속옷"],
      [4, "치노 반바지"],
      [5, "운동 반바지"],
      [6, "일자 긴바지"],
      [7, "청바지"],
    ],
  },
  feminine: {
    top: [
      [1, "속옷"],
      [8, "기본 반팔 티"],
      [9, "골지 라운드 반팔"],
      [10, "기본 긴팔 티"],
      [11, "모크넥 긴팔"],
    ],
    bottom: [
      [1, "속옷"],
      [8, "캐주얼 반바지"],
      [9, "기본 긴바지"],
      [10, "A라인 치마"],
      [11, "플리츠 치마"],
    ],
  },
};

// 성별을 바꿨는데 지금 입은 옷이 그 성별 목록에 없으면 이 옷으로 갈아입힌다.
export const 성별기본의상 = {
  masculine: { top: 4, bottom: 6 },
  feminine: { top: 8, bottom: 9 },
};

export const 외형설정버전 = 2;

export const 기본사이드킥설정 = {
  appearanceVersion: 외형설정버전,
  motion: "자동",
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "feminine",
  head: 1,
  hair: 4,
  brows: 1,
  ears: 1,
  facialHair: 0,
  nose: 1,
  teeth: 1,
  top: 성별기본의상.feminine.top,
  bottom: 성별기본의상.feminine.bottom,
  shoes: 1,
  headwear: 0,
  faceAccessory: 0,
  backAccessory: 0,
  hipFront: 0,
  hipBack: 0,
  hipSide: 0,
  shoulderAccessory: 0,
  elbowAccessory: 0,
  kneeAccessory: 0,
  feminine: 1,
  heavy: 0,
  buff: 0,
  skinny: 0.15,
  heightScale: 0.9,
  headScale: 1,
  shoulderWidth: 1,
  pupilScale: 1,
  skinColor: "#f0b789",
  eyeColor: "#26364a",
  hairColor: "#69a9c7",
  topColor: "#d7e8ef",
  bottomColor: "#333840",
  shoesColor: "#424850",
  accessoryColor: "#8aa7b7",
};

// [키, 이름, 최소, 최대, step]
export const 체형슬라이더 = [
  ["heightScale", "키", 0.6, 1.2, 0.01],
  ["headScale", "머리", 0.65, 1.6, 0.01],
  ["feminine", "여성형", 0, 1, 0.05],
  ["skinny", "마름", 0, 1, 0.05],
  ["buff", "근육", 0, 1, 0.05],
  ["heavy", "체격", 0, 1, 0.05],
  ["shoulderWidth", "어깨", 0.75, 1.25, 0.01],
  ["pupilScale", "눈동자", 0.55, 1.45, 0.01],
];

export const 색상항목 = [
  ["skinColor", "피부"],
  ["eyeColor", "눈동자"],
  ["hairColor", "머리"],
  ["topColor", "상의"],
  ["bottomColor", "하의"],
  ["shoesColor", "신발"],
  ["accessoryColor", "장비"],
];

export const 외형선택지 = {
  head: [[1, "둥근 얼굴"], [2, "각진 얼굴"]],
  hair: Array.from({ length: 11 }, (_, i) => [i + 1, `헤어 ${i + 1}`]),
  brows: Array.from({ length: 10 }, (_, i) => [i + 1, `눈썹 ${i + 1}`]),
  ears: Array.from({ length: 10 }, (_, i) => [i + 1, `귀 ${i + 1}`]),
  facialHair: [[0, "없음"], ...Array.from({ length: 10 }, (_, i) => [i + 1, `수염 ${i + 1}`])],
  nose: Array.from({ length: 11 }, (_, i) => [i + 1, `코 ${i + 1}`]),
  teeth: Array.from({ length: 10 }, (_, i) => [i + 1, `치아 ${i + 1}`]),
  shoes: [[1, "맨발"], [2, "SF 신발"], [3, "기사 신발"]],
  headwear: [[0, "없음"], [1, "SF 헬멧"], [2, "SF 헬멧 2"], [3, "기사 투구"], [4, "악당 투구"]],
  faceAccessory: [[0, "없음"], [1, "SF 얼굴 장비"], [2, "기사 얼굴 장비"]],
  backAccessory: [[0, "없음"], [1, "SF 등 장비"], [2, "기사 등 장비"]],
  hipFront: [[0, "없음"], [1, "SF 허리 앞"], [2, "기사 허리 앞"]],
  hipBack: [[0, "없음"], [1, "SF 허리 뒤"], [2, "SF 허리 뒤 2"], [3, "기사 허리 뒤"]],
  hipSide: [[0, "없음"], [1, "SF 허리 옆"], [2, "SF 허리 옆 2"], [3, "기사 허리 옆"]],
  shoulderAccessory: [[0, "없음"], [1, "SF 어깨 장비"], [2, "SF 어깨 장비 2"], [3, "기사 어깨 장비"]],
  elbowAccessory: [[0, "없음"], [1, "SF 팔꿈치 장비"], [2, "기사 팔꿈치 장비"]],
  kneeAccessory: [[0, "없음"], [1, "SF 무릎 장비"], [2, "기사 무릎 장비"]],
};

export const 외형항목이름 = {
  head: "얼굴",
  hair: "헤어",
  brows: "눈썹",
  ears: "귀",
  facialHair: "수염",
  nose: "코",
  teeth: "치아",
  top: "상의",
  bottom: "하의",
  shoes: "신발",
  headwear: "머리 장비",
  faceAccessory: "얼굴 장비",
  backAccessory: "등 장비",
  hipFront: "허리 앞",
  hipBack: "허리 뒤",
  hipSide: "허리 옆",
  shoulderAccessory: "어깨 장비",
  elbowAccessory: "팔꿈치 장비",
  kneeAccessory: "무릎 장비",
};

const 모션값 = new Set(사이드킥모션목록.map(([value]) => value));
const 색형식 = /^#[0-9a-f]{6}$/i;

function 성별판정(값) {
  return 값 === "masculine" || 값 === "feminine" ? 값 : null;
}

function 선택지에있음(options, value) {
  return options.some(([option]) => option === value);
}

// 성별 전환 — 체형 morph도 함께 끝값으로 옮기고, 입을 수 없는 옷은 기본 옷으로 바꾼다.
export function 성별적용(설정, gender) {
  const 목록 = 성별의상선택지[gender];
  const next = { ...설정, gender, feminine: gender === "feminine" ? 1 : 0 };
  if (!선택지에있음(목록.top, next.top)) next.top = 성별기본의상[gender].top;
  if (!선택지에있음(목록.bottom, next.bottom)) next.bottom = 성별기본의상[gender].bottom;
  return next;
}

// 저장 데이터 보정. 구버전(v1: 성별 없음, SF/기사 의상 번호)이나 손상된 값이 와도
// 예외 없이 현재 기본값으로 채운다.
export function 외형설정보정(saved) {
  const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const result = { ...기본사이드킥설정 };

  Object.entries(외형선택지).forEach(([key, options]) => {
    const value = Number(source[key]);
    if (선택지에있음(options, value)) result[key] = value;
  });
  체형슬라이더.forEach(([key, , min, max]) => {
    const value = Number(source[key]);
    if (Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  });
  색상항목.forEach(([key]) => {
    if (typeof source[key] === "string" && 색형식.test(source[key])) result[key] = source[key];
  });
  ["walkMotion", "runMotion"].forEach((key) => {
    if (typeof source[key] === "string" && 모션값.has(source[key])) result[key] = source[key];
  });

  const gender =
    성별판정(source.gender) ??
    (Number.isFinite(Number(source.feminine)) && Number(source.feminine) < 0.5 ? "masculine" : "feminine");
  result.gender = gender;
  const 목록 = 성별의상선택지[gender];
  const top = Number(source.top);
  const bottom = Number(source.bottom);
  result.top = 선택지에있음(목록.top, top) ? top : 성별기본의상[gender].top;
  result.bottom = 선택지에있음(목록.bottom, bottom) ? bottom : 성별기본의상[gender].bottom;
  result.motion = "자동";
  result.appearanceVersion = 외형설정버전;
  return result;
}

// localStorage 저장값 읽기. v2 키가 없으면 이전 키를 읽어 보정한다.
export function 사이드킥외형읽기(저장키, 이전저장키) {
  try {
    const raw = localStorage.getItem(저장키) ?? (이전저장키 ? localStorage.getItem(이전저장키) : null);
    return 외형설정보정(raw ? JSON.parse(raw) : null);
  } catch {
    return 외형설정보정(null);
  }
}
