import { useEffect, useMemo, useState } from "react";
import { button, folder, levaStore, useControls } from "leva";

import { exposeDevHook } from "@/debug/devHooks";
import { OUTLINE_THICKNESS, type OutlineValues } from "@/engine/toon";
import { readStorage, removeStorage, writeStorage } from "@/engine/storage";
import teamBaseline from "@/settings/teamBaseline.json";

// 강력 새로고침을 하면 Leva 패널이 코드 기본값으로 돌아간다. 값이 바뀔 때마다 저장하고,
// 다음에 켤 때 저장값을 기본값 자리에 끼워 넣는다. 저장 열쇠 = 폴더 이름 + 항목 이름.
const LEVA_STORAGE_KEY = "kgeseo.leva.v1";

// 팀 기준값: 기준이 되는 저장값 전체를 settings/teamBaseline.json 에 두고, 판 이름이 바뀔 때 한 번 팀원 저장값을 통째로 갈아 끼운다.
// 새 기준을 낼 때는 기준 브라우저 콘솔에서 copy(localStorage.getItem("kgeseo.leva.v1")) → JSON 에 붙이고 판 이름을 바꾼다.
const TEAM_BASELINE_VERSION = "2026-10-01-rang";
const TEAM_BASELINE_VERSION_KEY = "kgeseo.leva.teamBaselineVersion";
// 한글 열쇠의 판 이름이 남아 있으면 이미 받은 사람이다. 다시 덮으면 그 뒤에 각자 맞춘 값이 날아간다.
const LEGACY_TEAM_BASELINE_VERSION = "2026-10-01-랑";
const LEGACY_TEAM_BASELINE_VERSION_KEY = "kgeseo.leva.팀기준판";

/**
 * 저장값보다 코드 기본값이 이겨야 하는 항목. 폴더 이름 → 항목 label.
 * 저장 데이터 열쇠라 한글 그대로 — 스키마 열쇠가 아니라 label 로 맞춘다.
 */
const FORCE_DEFAULT_LABELS: Record<string, readonly string[]> = {
  "작업등 퍼즐": [
    "A_z",
    "B_z",
    "C_z",
    "A_자국z",
    "B_자국z",
    "C_자국z",
    "차단기z",
    "차단기y",
    "차단기폭",
    "차단기높이",
    "차단기깊이",
    "자물쇠크기",
    "자물쇠깊이",
    "자물쇠높이",
    "자물쇠옆",
    "처음어둡게",
    "어둠경계z",
    "어둠계수",
    "반경계z",
    "통z일반",
    "통z플라",
    "통띄움",
    "쓰레기크기",
    "창정답",
    "그림z",
    "그림y",
    "그림폭",
    "시험반y",
    "시험반옆",
    "손세기",
    "손거리",
    "바닥세기",
    "바닥거리",
    "꽂힘세기",
    "꽂힘거리",
    "놓는거리",
    "함y",
    "등z시작",
    "등z끝",
    "켜질등수",
    "접속함z",
    "접속함y",
    "퓨즈10x",
    "퓨즈10z",
    "퓨즈15x",
    "퓨즈15z",
    "퓨즈경계z",
    // 이 퍼즐은 늘 보여야 한다. 잠깐 꺼 둔 사이 저장된 false 를 지운다.
    "보이기",
  ],
  "홀로그램 스크린": ["폭"],
  "걸쇠 문쪽": [
    "보이기",
    "쇠막대맞춤",
    "좌우",
    "위아래",
    "깊이",
    "회전x",
    "회전y",
    "회전z",
    "구멍",
    "판폭",
    "두께",
    "길이",
    "날개",
    "나사수",
    "나사날개",
    "나사크기",
    "나사색",
    "색",
  ],
  "걸쇠 테두리쪽": [
    "보이기",
    "쇠막대맞춤",
    "좌우",
    "위아래",
    "깊이",
    "회전x",
    "회전y",
    "회전z",
    "구멍",
    "판폭",
    "두께",
    "길이",
    "날개",
    "나사수",
    "나사날개",
    "나사크기",
    "나사색",
    "색",
  ],
  "소화전 자물쇠": [
    "보이기",
    "숨길때길보기",
    "자물쇠좌우",
    "자물쇠위아래",
    "자물쇠깊이",
    "크기",
    "폭",
    "높이",
    "깊이",
    "고리반지름",
    "고리굵기",
    "고리높이",
    "칸수",
    "다이얼띠",
    "x",
    "y",
    "z",
    "회전도",
    "맞춤1",
    "맞춤2",
    "맞춤3",
    "맞춤4",
    "맞춤5",
    "쇠색",
    "다이얼색",
    "글자색",
    "칸선",
    "칸선색",
    "칸선굵기",
    "칸선높이",
    "옆둥글기",
    "정답",
    "조작거리",
  ],
  // 저장된 자리(입구를 안 막는 9.2 · −3.2)가 이기면 「밀어서 여는」 퍼즐이 안 맞는다.
  "커피 자판기": ["주름선", "주름선색", "주름선각도", "위치z", "세로길이", "테색", "간판글자색", "배출부벽색"],
  "음료 자판기": ["주름선", "주름선색", "주름선각도", "위치z", "가로길이", "세로길이", "몸통색"],
  "자판기 비밀문": ["시간", "보는거리", "보는높이", "보는겨냥"],
  "성능(공통)": ["계기판"],
  "기차 내부": [
    "차체색",
    "아랫단색",
    "바닥색",
    "천장색",
    "좌석천색",
    "좌석천색2",
    "창틀색",
    "선반색",
    "문색",
    "밑빛",
    "등색",
    "꺼진등색",
    "깜빡주기",
    "바닥시드",
    "안개색",
    "외곽선굵기",
  ],
  "천장등(공통)": ["천장번짐"],
  "소화전 속": [
    "안색",
    "금속색",
    "호스색",
    "경종바깥색",
    "경종속색",
    "경종크기",
    "경종속크기",
    "경종높이",
    "경종속위아래",
    "발신기바깥색",
    "발신기속색",
    "발신기크기",
    "발신기속크기",
    "표시등색",
    "빛세기",
    "부품깊이",
    "외곽선",
    "외곽선굵기",
    "주름선",
    "주름선색",
    "주름선각도",
  ],
  "배전반 속": [
    "안색",
    "판색",
    "차단기색",
    "차단기면색",
    "표시창색",
    "표시창빛",
    "등테색",
    "등위치가로",
    "등위치높이",
    "등크기",
    "등간격",
    "빨간등색",
    "빨간알크기",
    "빨간등빛",
    "초록등색",
    "초록알크기",
    "초록등빛",
    "접지가로",
    "접지폭",
    "레버색",
    "동색",
    "금속색",
    "검은선색",
    "파란선색",
    "초록선색",
    "라벨색",
    "퍼즐빨강",
    "퍼즐파랑",
    "퍼즐노랑",
    "차단기줄",
    "스위치두께",
    "스위치가로",
    "스위치깊이",
    "스위치간격",
    "손잡이가로",
    "손잡이높이",
    "미는거리",
    "주차단기높이",
    "주차단기가로",
    "주차단기깊이",
    "주차단기위치",
    "접속함색",
    "접속함높이",
    "접속함가로",
    "접속함위치",
    "계기함가로",
    "계기함높이",
    "계기함위치",
    "표시창가로",
    "표시창높이",
    "전선굵기",
    "굵은선굵기",
    "외곽선굵기",
    "주름선",
    "주름선색",
    "주름선각도",
  ],
  "스탠드(공통)": ["전체어둡게"],
  "폐역 조명": ["기본광밝기", "기본광색", "주광밝기"],
  // 이 폴더는 만져 본 사람이 많아, 저장값이 이기면 눈높이를 고쳐도 화면이 그대로다.
  "시점(눈높이)": ["눈높이", "앉은높이"],
  "1인칭 손": ["앞", "아래", "피치따름", "품앞", "품아래"],
  // 저장된 자리는 커피 자판기 몸통 속이라 충돌 때문에 동전을 못 줍는다.
  동전: ["캔바닥x", "캔바닥z", "컵바닥x", "컵바닥z"],
  "비밀 복도": [
    "등개수",
    "벽색",
    "아랫단색",
    "최소밝기",
    "벽밝기",
    "측면문밝기",
    "측면문색",
    "등틀색",
    "등판색",
    "등때",
    "등발광",
    "빛각도",
    "빛퍼짐",
    "빛거리",
    "유도등테색",
    "끝문라인색",
    "문두께",
    "깊이어둠",
    "감쇠거리",
    "잡동사니밀도",
    "부식바닥수",
    "부식벽수",
    "끝문폭",
    "끝문높이",
    "끝문색",
    "끝문틀색",
    "끝문손잡이색",
    "끝문선두께",
    "끝문두께",
    "끝문밝기보정",
    "유도등높이",
    "배전반바닥높이",
    "주름선",
    "주름선색",
    "주름선각도",
  ],
};

type SavedFolder = Record<string, unknown>;
type SavedControls = Record<string, SavedFolder>;

/** leva 가 받는 스키마. 항목마다 label 에 한글 이름을 주면 그 이름으로 저장된 값도 찾아온다. */
export type LevaSchema = Parameters<typeof folder>[0];
type Widen<V> = V extends number ? number : V extends string ? string : V extends boolean ? boolean : V;
type EntryValue<E> = E extends { value: infer V } ? Widen<V> : Widen<E>;
// button() 은 값이 없다.
type ValueKeys<S> = { [K in keyof S]: S[K] extends ReturnType<typeof button> ? never : K }[keyof S];
/** 스키마에서 나오는 값 객체. leva 의 추론 타입은 폴더로 감싸면 너무 깊어져 직접 펼친다. */
export type ControlValues<S extends LevaSchema> = { [K in ValueKeys<S>]: EntryValue<S[K]> };

function readAll(): SavedControls {
  try {
    return JSON.parse(localStorage.getItem(LEVA_STORAGE_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

function writeAll(data: unknown) {
  writeStorage(LEVA_STORAGE_KEY, JSON.stringify(data));
}

/** Leva 「★ 전체값 출력 › 저장값초기화」 가 쓴다. */
export function clearSavedControls() {
  removeStorage(LEVA_STORAGE_KEY);
}

// 한글 판 열쇠는 지우지 않는다. 같은 주소에서 이전 빌드를 다시 띄웠을 때 그 코드가
// 판이 없다고 보고 팀 기준값으로 각자 맞춘 값을 덮어쓰는 일을 막는다.
function seedTeamBaseline() {
  if (readStorage(TEAM_BASELINE_VERSION_KEY) === TEAM_BASELINE_VERSION) return;
  if (readStorage(LEGACY_TEAM_BASELINE_VERSION_KEY) !== LEGACY_TEAM_BASELINE_VERSION) {
    writeAll(teamBaseline);
    writeStorage(LEGACY_TEAM_BASELINE_VERSION_KEY, LEGACY_TEAM_BASELINE_VERSION);
  }
  writeStorage(TEAM_BASELINE_VERSION_KEY, TEAM_BASELINE_VERSION);
}

/** 폴더 이름을 바꾸면 저장값이 통째로 끊긴다. 바뀐 이름으로 옮기고 안 쓰는 폴더는 지운다. */
function migrateRenamedFolders() {
  const all = readAll();
  let changed = false;
  if (all["외투(공통)"]) {
    if (!all["옷걸이(공통)"]) all["옷걸이(공통)"] = all["외투(공통)"];
    delete all["외투(공통)"];
    changed = true;
  }
  for (const name of ["의자외투1", "의자외투2", "모자2(책상)"]) {
    if (name in all) {
      delete all[name];
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

let isStoragePrepared = false;
function prepareStorage() {
  if (isStoragePrepared) return;
  isStoragePrepared = true;
  seedTeamBaseline();
  migrateRenamedFolders();
}

let isAnnounced = false;
function announceSavedState() {
  if (isAnnounced) return;
  isAnnounced = true;
  const count = Object.keys(readAll()).length;
  if (count === 0)
    console.log(
      "%c[Leva 자동저장] 저장된 값 없음 — 지금부터 조절하는 값이 자동 저장됩니다.",
      "color:#e0a94e;font-weight:bold",
    );
  else
    console.log(
      `%c[Leva 자동저장] ✅ 저장된 폴더 ${count}개를 불러왔습니다. 새로고침해도 값이 유지됩니다.`,
      "color:#4AE27A;font-weight:bold",
    );
}

function entryLabel(key: string, entry: unknown): string {
  if (typeof entry === "object" && entry !== null && "label" in entry && typeof entry.label === "string")
    return entry.label;
  return key;
}

/** 저장값을 스키마의 value 자리에만 끼워 넣는다(범위·눈금은 코드 것). 열쇠로 못 찾으면 label(한글 이름)로 찾는다. */
function applySaved<S extends LevaSchema>(folderName: string, schema: S): S {
  const all = readAll();
  const saved = all[folderName];
  if (!saved) return schema;

  // 강제 항목은 저장소에서도 지워 둔다. 바로 뒤 저장 effect 가 새 기본값으로 다시 쓴다.
  const forced = FORCE_DEFAULT_LABELS[folderName];
  if (forced) {
    const keyByLabel = new Map(Object.entries(schema).map(([key, entry]) => [entryLabel(key, entry), key]));
    let removed = false;
    for (const label of forced) {
      for (const key of [label, keyByLabel.get(label)]) {
        if (key !== undefined && key in saved) {
          delete saved[key];
          removed = true;
        }
      }
    }
    if (removed) {
      writeAll(all);
      console.log(`%c[Leva] "${folderName}" 의 ${forced.join(", ")} 를 코드 기본값으로 되돌렸습니다.`, "color:#e0a94e");
    }
  }

  const applied = Object.entries(schema).map(([key, entry]) => {
    const label = entryLabel(key, entry);
    const savedKey = key in saved ? key : label in saved ? label : null;
    // 새로 생긴 항목은 코드 기본값
    if (savedKey === null) return [key, entry];
    const value = saved[savedKey];
    return [key, typeof entry === "object" && entry !== null && "value" in entry ? { ...entry, value } : value];
  });
  // 열쇠와 항목 모양은 그대로고 value 만 바뀌었다.
  return Object.fromEntries(applied) as S;
}

/**
 * useControls 대신 쓴다. 폴더를 접힌 채 만들고, 값이 바뀌면 폴더 단위로 저장한다.
 * 저장할 때 폴더를 통째로 다시 쓰므로 한글 열쇠로 저장된 값은 자연히 영어 열쇠로 바뀐다.
 */
export function useSavedControls<S extends LevaSchema>(folderName: string, schema: S): ControlValues<S> {
  // 첫 렌더에만 계산한다. 다시 만들면 Leva 가 값을 되돌린다.
  const [initial] = useState(() => {
    prepareStorage();
    announceSavedState();
    return applySaved(folderName, schema);
  });

  // 폴더가 백 개 가까이라 펼친 채면 패널 높이를 잘못 재 줄이 겹친다. 접힘은 folder() 로만 줄 수 있다.
  const wrapped = useMemo<LevaSchema>(
    () => ({ [folderName]: folder(initial, { collapsed: true }) }),
    [folderName, initial],
  );
  // 폴더 이름이 문자열 변수라 leva 의 타입 추론이 펼친 값을 못 따라온다. 값 모양은 스키마 그대로다.
  const values = useControls(wrapped) as ControlValues<S>;

  // leva 는 값이 그대로면 같은 객체를 돌려준다 — 참조가 바뀔 때만 직렬화한다.
  const json = useMemo(() => JSON.stringify(values), [values]);
  useEffect(() => {
    const all = readAll();
    all[folderName] = JSON.parse(json);
    writeAll(all);
  }, [folderName, json]);
  return values;
}

interface OutlineDefaults {
  width?: number;
  color?: string;
  crease?: boolean;
  creaseAngle?: number;
  creaseColor?: string;
}

/** 선 조절칸 6개. Leva 폴더 스키마에 펼쳐 넣는다. */
export function outlineSchema({
  width = OUTLINE_THICKNESS,
  color = "#1A1614",
  crease = false,
  creaseAngle = 40,
  creaseColor = "#000000",
}: OutlineDefaults = {}) {
  return {
    outline: { value: true, label: "외곽선" },
    outlineWidth: { value: width, min: 0, max: 12, step: 0.5, label: "외곽선굵기" },
    outlineColor: { value: color, label: "외곽선색" },
    crease: { value: crease, label: "주름선" },
    creaseAngle: { value: creaseAngle, min: 10, max: 80, step: 1, label: "주름선각도" },
    creaseColor: { value: creaseColor, label: "주름선색" },
  };
}

/** Leva 폴더 값에서 선 6개만 꺼낸다(매번 새 객체). */
export function pickOutline(values: OutlineValues): OutlineValues {
  return {
    outline: values.outline,
    outlineWidth: values.outlineWidth,
    outlineColor: values.outlineColor,
    crease: values.crease,
    creaseAngle: values.creaseAngle,
    creaseColor: values.creaseColor,
  };
}

// 콘솔·도구용 — __game.leva.setValueAtPath("1인칭 손.forward", 0.9, true)
exposeDevHook("leva", levaStore);
