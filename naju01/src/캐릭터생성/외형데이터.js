// 캐릭터 생성 화면이 다루는 **외형 초안**의 모양과, 렌더러 설정으로 옮기는 어댑터.
//
// [세 가지 표현을 구분한다]
//   1. 초안(draft)      — 화면이 들고 있고 바깥(onDraftChange/initialValue)과 주고받는 순수 데이터.
//                         아이템은 아이디, 몸 치수는 "기본 대비 비율"이다.
//   2. 렌더러 설정      — 치비게임아바타가 먹는 값(hair: 0, heavy: 0.4 …). 이 파일에서만 만든다.
//   3. 완료 payload     — onComplete 로 나가는 값. 초안 + 판 번호.
//
// [왜 비율인가]
//   모델의 실제 치수(cm)를 잰 적이 없다. 숫자에 cm 를 붙이면 없는 근거를 만드는 셈이라,
//   화면에는 기본값 대비 백분율로만 보여 준다. 1.00 = 100% = 기본.
import { 렌더러기본, 아이템찾기, 슬롯기본, 슬롯목록, 렌더러가아는번호 } from "./카탈로그.js";
import { 모델판 } from "../메시외형옵션.js";

export const 초안판 = 1;
export const 몸체에셋판 = String(모델판);

// ── 몸 치수 항목 ──────────────────────────────────────────────
// 기본값은 **렌더러의 보정된 기본값**을 그대로 쓴다. 어깨 1.2·팔 길이 0.88 을 1.00 으로
// 고쳐 적으면 초기화할 때마다 캐릭터가 달라진다(요구 5장).
//   묶음: 화면 오른쪽 패널에서 소제목으로 묶는 단위.
const 치수 = (key, 이름, min, max, step, 기본, 묶음, 설명) => ({ key, 이름, min, max, step, 기본, 묶음, 설명 });

export const 체형항목 = [
  치수("heightScale", "키", 0.7, 1.3, 0.01, 렌더러기본.heightScale, "필수", "몸 전체를 고르게 키운다"),
  치수("headScale", "머리 크기", 0.8, 1.3, 0.01, 렌더러기본.headScale, "필수"),
  치수("handScale", "손 크기", 0.7, 1.3, 0.01, 렌더러기본.handScale, "필수"),
  치수("footScale", "발 크기", 0.7, 1.3, 0.01, 렌더러기본.footScale, "필수", "신발도 함께 커지고 작아진다"),
  // 어깨 최소는 **1.00 이다(렌더러 범위 0.75 보다 좁다).** 실측: 0.75 로 좁히면 걸을 때 손가락이
  // 반바지 안으로 들어가고, 남성 팔짱 대기에서 아래팔이 가슴에 파묻힌다. 1.00 은 둘 다 깨끗했다.
  치수("shoulderWidth", "어깨 너비", 1.0, 1.25, 0.01, 렌더러기본.shoulderWidth, "비율", "더 좁히면 팔이 몸을 뚫어 막아 두었다"),
  치수("hipWidth", "골반 너비", 0.7, 1.3, 0.01, 렌더러기본.hipWidth, "비율"),
  치수("armLength", "팔 길이", 0.7, 1.15, 0.01, 렌더러기본.armLength, "비율"),
  치수("armThickness", "팔 두께", 0.7, 1.3, 0.01, 렌더러기본.armThickness, "비율"),
  치수("legThickness", "다리 두께", 0.7, 1.3, 0.01, 렌더러기본.legThickness, "비율"),
  // 통통(heavy)·마름(skinny) 모프를 **한 축**으로 묶는다. 둘을 따로 두면 동시에 최대로 겹쳐
  // 서로 싸우는 조합이 만들어진다(요구 5장). 음수는 마름, 양수는 통통으로 나눠 보낸다.
  치수("build", "체형", -1, 1, 0.05, 0, "체격", "마름 ↔ 기본 ↔ 통통"),
  // 라벨을 '근육' 이라고 하면 과장이다 — 실제로 움직이는 것은 몸통과 다리 전체 두께다(눈으로 확인).
  치수("buff", "골격", 0, 1, 0.05, 렌더러기본.buff, "체격", "몸통과 다리가 전체적으로 두꺼워진다"),
];

export const 체형묶음 = [
  ["필수", "기본 크기"],
  ["비율", "몸 비율"],
  ["체격", "체격"],
];

// 화면 표시용 — 값 자체가 아니라 "기본 대비 몇 %"다.
export function 비율표시(항목, 값) {
  if (항목.key === "build") return 값 === 0 ? "기본" : `${값 > 0 ? "통통" : "마름"} ${Math.round(Math.abs(값) * 100)}%`;
  if (항목.key === "buff") return `${Math.round(값 * 100)}%`;
  return `${Math.round((값 / 항목.기본) * 100)}%`;
}

// ── 초안 ─────────────────────────────────────────────────────
export function 기본몸치수() {
  return Object.fromEntries(체형항목.map((항목) => [항목.key, 항목.기본]));
}

export function 기본외형(성별, 카탈로그) {
  return {
    gender: 성별,
    bodyParameters: 기본몸치수(),
    hairId: 슬롯기본(카탈로그, "hair", 성별)?.id ?? null,
    equipmentIds: {
      top: 슬롯기본(카탈로그, "top", 성별)?.id ?? null,
      bottom: 슬롯기본(카탈로그, "bottom", 성별)?.id ?? null,
      shoes: 슬롯기본(카탈로그, "shoes", 성별)?.id ?? null,
    },
    colors: { skin: "#ffffff", hair: "#ffffff", cloth: "#ffffff" },
  };
}

export function 기본초안(카탈로그, 성별 = "masculine") {
  return { schemaVersion: 초안판, displayName: "", appearance: 기본외형(성별, 카탈로그) };
}

const 색형식 = /^#[0-9a-f]{6}$/i;
const 사이 = (값, min, max) => Math.min(max, Math.max(min, 값));

// 바깥에서 받은 값은 믿지 않는다. 범위를 벗어난 수·없어진 아이디는 기본값으로 되돌리고,
// 무엇을 고쳤는지 함께 돌려준다(화면이 짧게 안내할 수 있게).
export function 외형보정(값, 카탈로그) {
  const 알림 = [];
  const 원본 = 값 && typeof 값 === "object" ? 값 : {};
  const 성별 = 원본.gender === "feminine" ? "feminine" : "masculine";
  const 기본 = 기본외형(성별, 카탈로그);

  const 몸 = { ...기본.bodyParameters };
  const 들어온몸 = 원본.bodyParameters && typeof 원본.bodyParameters === "object" ? 원본.bodyParameters : {};
  체형항목.forEach((항목) => {
    const v = Number(들어온몸[항목.key]);
    if (Number.isFinite(v)) 몸[항목.key] = 사이(v, 항목.min, 항목.max);
  });

  const 고르기 = (슬롯, id) => {
    const 찾음 = 아이템찾기(카탈로그, id);
    if (찾음 && 찾음.슬롯 === 슬롯 && 찾음.성별.includes(성별) && 렌더러가아는번호(슬롯, 성별, 찾음.변형)) return 찾음.id;
    if (id) 알림.push(`${슬롯}: 쓸 수 없는 항목이라 기본값으로 바꿨습니다.`);
    return 슬롯기본(카탈로그, 슬롯, 성별)?.id ?? null;
  };

  const 색 = { ...기본.colors };
  const 들어온색 = 원본.colors && typeof 원본.colors === "object" ? 원본.colors : {};
  Object.keys(색).forEach((키) => {
    const v = 들어온색[키];
    if (typeof v === "string" && 색형식.test(v) && (카탈로그.색상[키] ?? []).some(([코드]) => 코드.toLowerCase() === v.toLowerCase())) 색[키] = v;
    else if (typeof v === "string") 알림.push(`${키} 색이 목록에 없어 기본값으로 바꿨습니다.`);
  });

  const 장비 = 원본.equipmentIds && typeof 원본.equipmentIds === "object" ? 원본.equipmentIds : {};
  return {
    외형: {
      gender: 성별,
      bodyParameters: 몸,
      hairId: 고르기("hair", 원본.hairId),
      equipmentIds: {
        top: 고르기("top", 장비.top),
        bottom: 고르기("bottom", 장비.bottom),
        shoes: 고르기("shoes", 장비.shoes),
      },
      colors: 색,
    },
    알림,
  };
}

export function 초안보정(값, 카탈로그) {
  const 원본 = 값 && typeof 값 === "object" ? 값 : {};
  const { 외형, 알림 } = 외형보정(원본.appearance, 카탈로그);
  const 이름 = typeof 원본.displayName === "string" ? 원본.displayName : "";
  return { 초안: { schemaVersion: 초안판, displayName: 이름, appearance: 외형 }, 알림 };
}

// 성별을 바꿀 때 — 그 성별이 못 쓰는 헤어·의상은 호환되는 기본값으로 바꾸고 무엇을 바꿨는지 알린다.
export function 성별맞추기(외형, 성별, 카탈로그) {
  const 바뀜 = [];
  const 고르기 = (슬롯, id) => {
    const 찾음 = 아이템찾기(카탈로그, id);
    if (찾음 && 찾음.성별.includes(성별)) return 찾음.id;
    const 대체 = 슬롯기본(카탈로그, 슬롯, 성별);
    if (찾음 && 대체) 바뀜.push(`${찾음.이름} → ${대체.이름}`);
    return 대체?.id ?? null;
  };
  return {
    외형: {
      ...외형,
      gender: 성별,
      hairId: 고르기("hair", 외형.hairId),
      equipmentIds: {
        top: 고르기("top", 외형.equipmentIds.top),
        bottom: 고르기("bottom", 외형.equipmentIds.bottom),
        shoes: 고르기("shoes", 외형.equipmentIds.shoes),
      },
    },
    바뀜,
  };
}

// ── 렌더러 어댑터 ─────────────────────────────────────────────
// 외형 초안 → 치비게임아바타 `설정`. **대응표는 여기 한 곳뿐이다.**
//   키·머리·어깨·골반·팔·손·발 : 같은 이름으로 그대로 간다.
//   build                      : 양수면 heavy, 음수면 skinny(반대쪽은 0).
//   hairId·equipmentIds        : 카탈로그의 변형 번호로 바꾼다(-1 = 없음).
//   colors                     : 텍스처에 곱하는 색. 상·하의는 clothColor 하나를 함께 쓴다.
//   fistHands                  : 편집 중에는 0(주먹을 펴야 손 크기가 보인다). 외형 데이터가 아니다.
export function 렌더러설정(외형, 카탈로그, { 속옷보기 = false, 모션 = "A_TPose" } = {}) {
  const 몸 = 외형.bodyParameters;
  const 번호 = (id, 슬롯) => {
    const it = 아이템찾기(카탈로그, id);
    if (it && it.슬롯 === 슬롯 && 렌더러가아는번호(슬롯, 외형.gender, it.변형)) return it.변형;
    return -1;
  };
  const build = 몸.build ?? 0;
  return {
    ...렌더러기본,
    gender: 외형.gender,
    motion: 모션,
    motionSource: "tripo",
    hair: 번호(외형.hairId, "hair"),
    // 속옷 보기는 **일시적인 미리보기**다. 골라 둔 옷은 초안에 그대로 남는다(요구 4장).
    top: 속옷보기 ? -1 : 번호(외형.equipmentIds.top, "top"),
    bottom: 속옷보기 ? -1 : 번호(외형.equipmentIds.bottom, "bottom"),
    shoes: 속옷보기 ? -1 : 번호(외형.equipmentIds.shoes, "shoes"),
    heightScale: 몸.heightScale,
    headScale: 몸.headScale,
    shoulderWidth: 몸.shoulderWidth,
    hipWidth: 몸.hipWidth,
    armLength: 몸.armLength,
    armThickness: 몸.armThickness,
    legThickness: 몸.legThickness,
    handScale: 몸.handScale,
    footScale: 몸.footScale,
    heavy: Math.max(0, build),
    skinny: Math.max(0, -build),
    buff: 몸.buff ?? 0,
    fistHands: 0,
    skinColor: 외형.colors.skin,
    hairColor: 외형.colors.hair,
    clothColor: 외형.colors.cloth,
  };
}

// 완료 시 바깥으로 나가는 데이터. 순수 데이터만 담는다(three 객체·함수·모델 금지).
export function 완료데이터(초안, 카탈로그) {
  const 외형 = 초안.appearance;
  return {
    schemaVersion: 초안판,
    displayName: 초안.displayName,
    appearance: {
      catalogVersion: 카탈로그.판,
      bodyAssetVersion: 몸체에셋판,
      gender: 외형.gender,
      bodyParameters: { ...외형.bodyParameters },
      hairId: 외형.hairId,
      equipmentIds: { ...외형.equipmentIds },
      supportedColorValues: { ...외형.colors },
    },
  };
}

// 미리보기가 읽어야 할 GLB 경로 — 새 모델이 다 받아진 뒤에 갈아 끼우려고 미리 뽑는다.
export function 필요한모델(외형, 카탈로그, 속옷보기 = false) {
  return 렌더러설정(외형, 카탈로그, { 속옷보기 });
}

export function 성별목록() {
  return [["masculine", "남성"], ["feminine", "여성"]];
}

export function 착장요약(외형, 카탈로그) {
  const 이름 = (id) => 아이템찾기(카탈로그, id)?.이름 ?? "없음";
  return [
    ["성별", 외형.gender === "feminine" ? "여성" : "남성"],
    ["헤어", 이름(외형.hairId)],
    ["상의", 이름(외형.equipmentIds.top)],
    ["하의", 이름(외형.equipmentIds.bottom)],
    ["신발", 이름(외형.equipmentIds.shoes)],
  ];
}

export function 슬롯선택지(카탈로그, 슬롯, 성별) {
  return 슬롯목록(카탈로그, 슬롯, 성별).filter((it) => 렌더러가아는번호(슬롯, 성별, it.변형));
}
