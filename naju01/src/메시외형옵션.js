// Meshy 캐릭터 외형 설정 — 선택지·기본값·저장값 보정.
// 파츠 번호는 GLB 노드 extras의 variant와 같다. -1 = 없음(속옷·민머리·맨발).
import { 사이드킥모션목록 } from "./사이드킥옵션.js";

export const 모델판 = 5;

export const 메시선택지 = {
  hair: {
    masculine: [[-1, "민머리"], [0, "짧은 머리"], [1, "긴 머리"]],
    feminine: [[-1, "민머리"], [0, "단발"], [1, "긴 머리"]],
  },
  top: { masculine: [[-1, "없음 · 속옷"], [0, "티셔츠"]], feminine: [[-1, "없음 · 속옷"], [0, "티셔츠"]] },
  bottom: { masculine: [[-1, "속옷"], [0, "반바지"]], feminine: [[-1, "속옷"], [0, "반바지"]] },
};

export const 메시항목이름 = { hair: "헤어", top: "상의", bottom: "하의" };

// 옷은 파츠를 얹지 않고 그 옷을 입은 전신 모델을 통째로 바꿔 끼운다.
// (Meshy가 만든 착장 그대로라 옷이 뜨거나 속살이 비치지 않는다.)
export function 메시모델파일(설정) {
  const 조합 = 설정.top >= 0 && 설정.bottom >= 0 ? "both"
    : 설정.top >= 0 ? "top"
    : 설정.bottom >= 0 ? "bottom" : "base";
  // ?v — 파일 이름이 그대로라 브라우저가 옛 모델을 계속 쓴다. 모델을 다시 구우면 올린다.
  return `/models/meshy-${조합}-${설정.gender === "feminine" ? "female" : "male"}.glb?v=${모델판}`;
}

// [키, 이름, 최소, 최대, step]
export const 메시슬라이더 = [
  ["heightScale", "키", 0.7, 1.3, 0.01],
  ["headScale", "머리", 0.8, 1.3, 0.01],
  ["shoulderWidth", "어깨", 0.75, 1.25, 0.01],
  ["hipWidth", "골반", 0.7, 1.3, 0.01],
  ["buff", "골격", 0, 1, 0.05],
  ["armThickness", "팔 두께", 0.7, 1.3, 0.01],
  ["legThickness", "다리 두께", 0.7, 1.3, 0.01],
  ["heavy", "통통", 0, 1, 0.05],
  ["skinny", "마름", 0, 1, 0.05],
  ["handScale", "손 크기", 0.7, 1.3, 0.01],
  ["footScale", "발 크기", 0.7, 1.3, 0.01],
  ["fistHands", "주먹 쥐기", 0, 1, 0.05],
];

// 텍스처 위에 곱해지는 색. 흰색이면 Meshy 원본 색 그대로다.
export const 메시색상 = [
  ["skinColor", "피부"],
  ["hairColor", "머리"],
  ["clothColor", "의상"],
];

export const 기본메시설정 = {
  version: 1,
  motion: "자동",
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "masculine",
  hair: 0,
  top: 0,
  bottom: 0,
  heightScale: 1,
  headScale: 1,
  shoulderWidth: 1,
  hipWidth: 1,
  buff: 0,
  armThickness: 1,
  legThickness: 1,
  heavy: 0,
  skinny: 0,
  handScale: 1,
  footScale: 1,
  fistHands: 0.6,
  skinColor: "#ffffff",
  hairColor: "#ffffff",
  clothColor: "#ffffff",
};

const 모션값 = new Set(사이드킥모션목록.map(([value]) => value));
const 색형식 = /^#[0-9a-f]{6}$/i;

export function 메시설정보정(saved) {
  const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const result = { ...기본메시설정 };
  if (source.gender === "masculine" || source.gender === "feminine") result.gender = source.gender;
  Object.entries(메시선택지).forEach(([key, per성별]) => {
    const value = Number(source[key]);
    if (per성별[result.gender].some(([option]) => option === value)) result[key] = value;
  });
  메시슬라이더.forEach(([key, , min, max]) => {
    const value = Number(source[key]);
    if (Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  });
  메시색상.forEach(([key]) => {
    if (typeof source[key] === "string" && 색형식.test(source[key])) result[key] = source[key];
  });
  ["walkMotion", "runMotion"].forEach((key) => {
    if (typeof source[key] === "string" && 모션값.has(source[key])) result[key] = source[key];
  });
  result.motion = "자동";
  return result;
}

export function 메시외형읽기(저장키) {
  try {
    const raw = localStorage.getItem(저장키);
    return 메시설정보정(raw ? JSON.parse(raw) : null);
  } catch {
    return 메시설정보정(null);
  }
}
