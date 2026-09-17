// 치비 캐릭터 외형 설정 — 선택지·기본값·저장값 보정.
// 파츠 번호는 GLB 노드 extras의 variant(0~3)와 같다. -1 = 없음(속옷·맨발·민머리).
import { 사이드킥모션목록 } from "./사이드킥옵션.js";

export const 치비선택지 = {
  hair: [[-1, "없음"], [0, "사이드 파트"], [1, "내추럴 숏"], [2, "턱선 단발"], [3, "묶은 머리"]],
  top: [[-1, "없음 · 속옷"], [0, "베이직 티셔츠"], [1, "폴로 셔츠"], [2, "후드 티셔츠"], [3, "재킷"]],
  bottom: [[-1, "속옷"], [0, "반바지"], [1, "테이퍼드 팬츠"], [2, "카고 팬츠"], [3, "조거 팬츠"]],
  shoes: [[-1, "맨발"], [0, "캔버스"], [1, "러닝화"], [2, "하이톱"], [3, "앵클 부츠"]],
};

export const 치비항목이름 = { hair: "헤어", top: "상의", bottom: "하의", shoes: "신발" };

// [키, 이름, 최소, 최대, step]
export const 치비슬라이더 = [
  ["heightScale", "키", 0.7, 1.3, 0.01],
  ["headScale", "머리", 0.8, 1.3, 0.01],
  ["skinny", "마름", 0, 1, 0.05],
  ["heavy", "통통", 0, 1, 0.05],
  ["buff", "근육", 0, 1, 0.05],
  ["pupilScale", "눈동자", 0.55, 1.45, 0.01],
];

export const 치비색상 = [
  ["skinColor", "피부"],
  ["eyeColor", "눈동자"],
  ["hairColor", "머리"],
  ["topColor", "상의"],
  ["bottomColor", "하의"],
  ["shoesColor", "신발"],
];

export const 기본치비설정 = {
  version: 1,
  motion: "자동",
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "masculine",
  hair: 0,
  top: 0,
  bottom: 0,
  shoes: 0,
  heightScale: 1,
  headScale: 1,
  skinny: 0,
  heavy: 0,
  buff: 0,
  pupilScale: 1,
  skinColor: "#f6d9c6",
  eyeColor: "#2b1a12",
  hairColor: "#2a1a12",
  topColor: "#f4f4f2",
  bottomColor: "#5a6f96",
  shoesColor: "#d9dadd",
};

const 모션값 = new Set(사이드킥모션목록.map(([value]) => value));
const 색형식 = /^#[0-9a-f]{6}$/i;

export function 치비설정보정(saved) {
  const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const result = { ...기본치비설정 };
  if (source.gender === "masculine" || source.gender === "feminine") result.gender = source.gender;
  Object.entries(치비선택지).forEach(([key, options]) => {
    const value = Number(source[key]);
    if (options.some(([option]) => option === value)) result[key] = value;
  });
  치비슬라이더.forEach(([key, , min, max]) => {
    const value = Number(source[key]);
    if (Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  });
  치비색상.forEach(([key]) => {
    if (typeof source[key] === "string" && 색형식.test(source[key])) result[key] = source[key];
  });
  ["walkMotion", "runMotion"].forEach((key) => {
    if (typeof source[key] === "string" && 모션값.has(source[key])) result[key] = source[key];
  });
  result.motion = "자동";
  return result;
}

export function 치비외형읽기(저장키) {
  try {
    const raw = localStorage.getItem(저장키);
    return 치비설정보정(raw ? JSON.parse(raw) : null);
  } catch {
    return 치비설정보정(null);
  }
}
