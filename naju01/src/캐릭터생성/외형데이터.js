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
const 치수 = (key, 이름, min, max, step, 기본, 묶음, 설명, 성별기본 = null) =>
  ({ key, 이름, min, max, step, 기본, 묶음, 설명, 성별기본 });

// 그 성별의 시작값. 성별마다 다른 항목만 성별기본에 적는다.
export function 항목기본(항목, 성별) {
  return 항목.성별기본?.[성별] ?? 항목.기본;
}

// 생성 화면의 **시작값**. 렌더러 기본값(어깨 1.2·팔 0.88)을 그대로 쓰되, 처음 만나는 모습이
// 더 나아 보이도록 몇 가지는 따로 잡았다(머리는 가장 작게, 팔·다리는 조금 가늘게, 살짝 마른 체형).
// 이 값이 곧 '초기화' 가 돌아갈 자리다.
export const 체형항목 = [
  치수("heightScale", "키", 0.7, 1.3, 0.01, 렌더러기본.heightScale, "필수", "몸 전체를 고르게 키운다"),
  치수("headScale", "머리 크기", 0.8, 1.3, 0.01, 0.8, "필수"),
  치수("handScale", "손 크기", 0.7, 1.3, 0.01, 렌더러기본.handScale, "필수"),
  치수("footScale", "발 크기", 0.7, 1.3, 0.01, 렌더러기본.footScale, "필수", "신발도 함께 커지고 작아진다"),
  // 어깨 최소는 **1.00 이다(렌더러 범위 0.75 보다 좁다).** 실측: 0.75 로 좁히면 걸을 때 손가락이
  // 반바지 안으로 들어가고, 벌린 대기 자세에서도 팔이 몸에 닿는다. 1.00 은 깨끗했다.
  치수("shoulderWidth", "어깨 너비", 1.0, 1.25, 0.01, 렌더러기본.shoulderWidth, "비율", "더 좁히면 팔이 몸을 뚫어 막아 두었다"),
  치수("hipWidth", "골반 너비", 0.7, 1.3, 0.01, 렌더러기본.hipWidth, "비율"),
  // 팔·다리 길이는 뼈를 통째로 줄이는 방식이라 살이 함께 줄고 늘어난다(팔꿈치·무릎이 끊기지 않는다).
  // 대신 길이를 줄이면 굵기도 같은 비율로 줄어든다 — 너무 줄이면 소매가 헐렁해 보여 하한을 두었다.
  치수("armLength", "팔 길이", 0.78, 1.15, 0.01, 렌더러기본.armLength, "비율"),
  치수("legLength", "다리 길이", 0.85, 1.2, 0.01, 렌더러기본.legLength, "비율"),
  치수("armThickness", "팔 두께", 0.7, 1.3, 0.01, 0.85, "비율"),
  // 남성은 같은 두께면 다리가 가늘어 보인다(어깨가 넓어 대비가 커진다). 남성만 기본을 굵게 둔다.
  치수("legThickness", "다리 두께", 0.7, 1.3, 0.01, 0.85, "비율", undefined, { masculine: 1.0 }),
  // 통통(heavy)·마름(skinny) 모프를 **한 축**으로 묶는다. 둘을 따로 두면 동시에 최대로 겹쳐
  // 서로 싸우는 조합이 만들어진다. 음수는 마름, 양수는 통통으로 나눠 보낸다.
  치수("build", "체형", -1, 1, 0.05, -0.2, "체격", "마름 ↔ 기본 ↔ 통통"),
  // 라벨을 '근육' 이라고 하면 과장이다 — 실제로 움직이는 것은 몸통과 다리 전체 두께다(눈으로 확인).
  // 골격 상한은 **0.75 다(렌더러 범위 1.0 보다 낮다).** 어깨 하한을 1.00 으로 막아 둔 것과 같은 이유다.
  //   실측: 체형(통통) 최대와 **함께** 1.0 까지 올리면 몸통이 커지면서 **위팔을 통째로 삼킨다** —
  //   팔과 몸의 경계가 사라지고 팔꿈치 아래만 소매 밖으로 나와 팔이 몸에서 자라난 것처럼 보인다.
  //   목도 사라져 머리가 어깨에 바로 얹힌다(남녀 모두). 0.75 에서는 통통 최대와 겹쳐도 팔이 읽힌다.
  //   각각 따로 최대로 올리는 것은 둘 다 괜찮았다 — 깨지는 것은 **겹칠 때**뿐이라 한쪽만 낮췄다.
  치수("buff", "골격", 0, 0.75, 0.05, 렌더러기본.buff, "체격", "몸통과 다리가 전체적으로 두꺼워진다"),
];

export const 체형묶음 = [
  ["필수", "기본 크기"],
  ["비율", "몸 비율"],
  ["체격", "체격"],
];

// 화면 표시용 — 값 자체가 아니라 "기본 대비 몇 %"다.
//   ※ 화면은 이제 눈금(아래 `눈금들`)으로 고른다. 이 함수는 숫자로 봐야 할 때
//     (검사·디버깅) 쓰려고 남겨 둔다.
export function 비율표시(항목, 값, 성별 = "masculine") {
  if (항목.key === "build") return 값 === 0 ? "기본" : `${값 > 0 ? "통통" : "마름"} ${Math.round(Math.abs(값) * 100)}%`;
  if (항목.key === "buff") return `${Math.round(값 * 100)}%`;
  return `${Math.round((값 / 항목기본(항목, 성별)) * 100)}%`;
}

// ── 눈금 — 퍼센트 대신 **기준점 다섯 개**로 딱딱 끊어 고른다 ────────────────
// [왜 바꿨나]
//   슬라이더가 0.01 단위 연속값이라 화면에 "103%" 같은 숫자가 떴다. 모델의 실제
//   치수를 잰 적이 없어 그 숫자는 뜻이 없고, 이용자는 몇 %가 맞는지 판단할 길이
//   없다. 기준점 몇 개로 끊으면 고르기 쉽고 결과도 예측된다.
// [어떻게 나누나]
//   가운데가 **언제나 기본값**이다. 기본에서 양 끝까지를 반으로 갈라 다섯 칸:
//     min · (min+기본)/2 · 기본 · (기본+max)/2 · max
//   기본이 한쪽 끝인 항목(머리 크기·골격)은 그쪽으로 갈 자리가 없으므로 기본에서
//   반대쪽 끝까지를 넷으로 고르게 나눈다.
// ★ **범위와 기본값은 그대로다.** 인수인계 문서의 실측 근거(어깨 하한 1.00 ·
//   팔 0.78 …)를 건드리지 않고 '고르는 방법'만 바꾼 것이다. 바깥으로 나가는
//   초안·완료 데이터도 예전과 같은 실수 값이라 렌더러도 그대로다.
const 눈금말 = {
  heightScale: ["작게", "크게"],
  headScale: ["작게", "크게"],
  handScale: ["작게", "크게"],
  footScale: ["작게", "크게"],
  shoulderWidth: ["좁게", "넓게"],
  hipWidth: ["좁게", "넓게"],
  armLength: ["짧게", "길게"],
  legLength: ["짧게", "길게"],
  armThickness: ["가늘게", "굵게"],
  legThickness: ["가늘게", "굵게"],
  build: ["마르게", "통통하게"],
  buff: ["가늘게", "다부지게"],
};

export const 눈금수 = 5;

export function 눈금들(항목, 성별 = "masculine") {
  const 기본 = 항목기본(항목, 성별);
  const { min, max, step } = 항목;
  const 맞춤 = (v) =>
    Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(4))));
  const [작은말, 큰말] = 눈금말[항목.key] ?? ["작게", "크게"];
  // 기본이 최소쪽 끝 — 한 방향으로만 늘어난다
  if (기본 - min < step) {
    const d = (max - 기본) / 4;
    return ["기본", `조금 ${큰말}`, 큰말, `많이 ${큰말}`, `아주 ${큰말}`]
      .map((이름, i) => ({ 값: 맞춤(기본 + d * i), 이름 }));
  }
  // 기본이 최대쪽 끝 — 한 방향으로만 줄어든다
  if (max - 기본 < step) {
    const d = (기본 - min) / 4;
    return [`아주 ${작은말}`, `많이 ${작은말}`, 작은말, `조금 ${작은말}`, "기본"]
      .map((이름, i) => ({ 값: 맞춤(기본 - d * (4 - i)), 이름 }));
  }
  return [
    { 값: 맞춤(min), 이름: `아주 ${작은말}` },
    { 값: 맞춤((min + 기본) / 2), 이름: 작은말 },
    { 값: 맞춤(기본), 이름: "기본" },
    { 값: 맞춤((기본 + max) / 2), 이름: 큰말 },
    { 값: 맞춤(max), 이름: `아주 ${큰말}` },
  ];
}

// 지금 값이 어느 칸인가. 저장된 초안이 눈금 사이 값일 수 있어(예전 저장본이거나
//   부모가 준 값) **가장 가까운 칸**을 고른다 — 값 자체를 함부로 바꾸지는 않는다.
export function 가까운눈금(눈금, 값) {
  let 칸 = 0;
  let 가장 = Infinity;
  눈금.forEach((v, i) => {
    const d = Math.abs(v.값 - 값);
    if (d < 가장) {
      가장 = d;
      칸 = i;
    }
  });
  return 칸;
}

// ── 초안 ─────────────────────────────────────────────────────
export function 기본몸치수(성별 = "masculine") {
  return Object.fromEntries(체형항목.map((항목) => [항목.key, 항목기본(항목, 성별)]));
}

export function 기본외형(성별, 카탈로그) {
  return {
    gender: 성별,
    bodyParameters: 기본몸치수(성별),
    hairId: 슬롯기본(카탈로그, "hair", 성별)?.id ?? null,
    equipmentIds: {
      top: 슬롯기본(카탈로그, "top", 성별)?.id ?? null,
      bottom: 슬롯기본(카탈로그, "bottom", 성별)?.id ?? null,
      shoes: 슬롯기본(카탈로그, "shoes", 성별)?.id ?? null,
    },
    colors: { skin: "#ffffff", hair: "#ffffff", cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" },
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
  let 들어온색 = 원본.colors && typeof 원본.colors === "object" ? 원본.colors : {};
  // 예전 초안(상·하의 한 색)에는 bottom 이 없다 — 상의 색을 그대로 이어받는다
  if (들어온색.bottom === undefined && typeof 들어온색.cloth === "string") 들어온색 = { ...들어온색, bottom: 들어온색.cloth };
  Object.keys(색).forEach((키) => {
    const v = 들어온색[키];
    // 색은 팔레트에 없어도 받는다(직접 고를 수 있다). 형식만 본다.
    if (typeof v === "string" && 색형식.test(v)) 색[키] = v;
    else if (typeof v === "string") 알림.push(`${키} 색 형식이 잘못돼 기본값으로 바꿨습니다.`);
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
//   legLength                  : 같은 이름으로 그대로 간다(허벅지 뼈 배율).
//   fistHands                  : 편집 중에는 0(주먹을 펴야 손 크기가 보인다). 외형 데이터가 아니다.
export function 렌더러설정(외형, 카탈로그, { 속옷보기 = false, 모션 = "Idle_Loop" } = {}) {
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
    legLength: 몸.legLength,
    handScale: 몸.handScale,
    footScale: 몸.footScale,
    heavy: Math.max(0, build),
    skinny: Math.max(0, -build),
    buff: 몸.buff ?? 0,
    fistHands: 0,
    skinColor: 외형.colors.skin,
    hairColor: 외형.colors.hair,
    clothColor: 외형.colors.cloth,
    bottomColor: 외형.colors.bottom ?? 외형.colors.cloth,
    shoesColor: 외형.colors.shoes ?? "#ffffff",
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
