// ═══════════════════════════════════════════════════════════════
//  공용.jsx — 여러 씬이 함께 쓰는 부품 모음
// ═══════════════════════════════════════════════════════════════
// [왜 파일을 나누나]
//   씬이 하나일 때는 App.jsx 한 장이 편하다. 그런데 '역'과 '기차 안'처럼
//   씬이 둘 이상이 되면, 두 씬이 똑같은 것을 써야 한다 —
//   셀셰이딩 그라디언트, 외곽선 규칙, Leva 값 저장 같은 것들.
//   같은 코드를 양쪽에 복사해 두면 한쪽만 고쳐서 화풍이 어긋난다.
//   그래서 '둘 다 쓰는 것'만 여기로 옮긴다. 나머지는 각자 씬 파일에 둔다.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useControls, folder } from "leva";
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
// 여러 지오메트리를 하나로 합치는 도구 — 드로우콜을 줄이는 핵심 부품
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ── 셀셰이딩용 그라디언트 맵 ─────────────────────────────
// 빛의 세기(0~1)를 몇 개의 '계단'으로 끊을지 정하는 작은 텍스처.
// steps=3 → 어두움·중간·밝음 3단계로 딱딱 끊긴다(손그림 느낌).
// 이 텍스처를 gradientMap으로 넘기면 meshToonMaterial이 그대로 따라 끊는다.
// 바닥 = 가장 어두운 칸의 밝기(0~255).
//   기본 0 이면 그늘진 면이 '완전 검정'이 된다. 평평한 물건은 괜찮은데
//   스탠드처럼 굴곡지고 면이 자잘한 물건은 새까만 얼룩이 크게 져 버린다.
//   그때 바닥을 올리면 그늘이 '어두운 회색'이 되어 얼룩이 눈에 덜 띈다.
function makeToonGradient(steps = 3, 바닥 = 0) {
  // 바닥 → 255 를 steps 등분한 회색 값. 예) 3단계·바닥 0 = [0, 127, 255]
  const colors = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    colors[i] = 바닥 + (255 - 바닥) * (i / (steps - 1));
  }
  // 가로 steps칸 × 세로 1칸짜리 텍스처(빨강 채널만 사용).
  const map = new THREE.DataTexture(colors, steps, 1, THREE.RedFormat);
  // ★ 핵심 — NearestFilter: "계단 사이를 부드럽게 섞지 말고 딱 끊어라".
  //   LinearFilter로 두면 도로 매끈해져서 셀셰이딩이 사라진다.
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true; // GPU에 올려라
  return map;
}

// 방 안 모든 toon 메시가 공유할 그라디언트 맵 — 딱 한 번만 만든다.
// (컴포넌트마다 새로 만들면 낭비고, prop으로 넘길 필요도 없다)
const TOON_GRADIENT = makeToonGradient(3);

// ── 윤곽선(abeto 만화 테두리) 공통 설정 ─────────────────
// 원리: 물체를 살짝 부풀린 '검은 껍데기'를 뒤집어 씌워, 원본에 가려지고 남는
//   실루엣 둘레만 검은 선으로 보이게 한다. drei의 <Outlines>가 이걸 대신 해준다.
// THICK  = 껍데기를 부풀리는 양 = 선 굵기. 이 값 하나만 바꾸면 전체 두께가 같이 바뀐다.
// COLOR  = 선 색. 완전 검정(#525a6e)보다 살짝 뜬 먹색이 abeto 톤에 부드럽게 어울린다.
const OUTLINE_THICK = 3;
const OUTLINE_COLOR = "#2E3440";

// ═══════════════════════════════════════════════════════════════
//  만화 선 공통 부품 — 외곽선 + 주름선
// ═══════════════════════════════════════════════════════════════
// 물건마다 Leva에서 선을 따로 조절할 수 있게 값 6개를 한 묶음으로 다룬다.
//   외곽선 = 실루엣 둘레. 면을 뒤집어 부풀리는 drei <Outlines>가 그린다.
//   주름선 = 면과 면이 꺾이는 자리(EdgesGeometry). '각도'보다 더 꺾인 모서리만 그린다
//            → 각도가 낮을수록 선이 많아지고, 높을수록 굵직한 접힘만 남는다.
// ※ 외곽선은 못 그리는 '안쪽 모서리'를 주름선이 채워 준다. 둘은 역할이 다르다.

// 선 조절칸 한 벌을 만들어 준다. Leva 폴더 스키마에 그대로 펼쳐 넣는다.
function 선스키마({
  굵기 = OUTLINE_THICK,
  색 = "#1A1614",
  주름 = false,
  각도 = 40,
  주름색 = "#000000",
} = {}) {
  return {
    외곽선: true,
    외곽선굵기: { value: 굵기, min: 0, max: 12, step: 0.5 },
    외곽선색: 색,
    주름선: 주름,
    주름선각도: { value: 각도, min: 10, max: 80, step: 1 },
    주름선색: 주름색,
  };
}

// EdgesGeometry 캐시 — 같은 지오메트리·같은 각도면 다시 만들지 않는다.
//   WeakMap이라 지오메트리가 버려지면 캐시도 같이 사라진다(메모리 누수 없음).
const 주름캐시 = new WeakMap();
function 주름지오(geo, 각도) {
  let m = 주름캐시.get(geo);
  if (!m) {
    m = new Map();
    주름캐시.set(geo, m);
  }
  if (!m.has(각도)) m.set(각도, new THREE.EdgesGeometry(geo, 각도));
  return m.get(각도);
}

// 1×1×1 상자 하나를 모두가 돌려 쓴다.
//   scale로 늘려 쓰면 지오메트리가 하나뿐이라 가볍고,
//   주름선(EdgesGeometry)도 한 벌만 만들어져 캐시가 그대로 재사용된다.
//   ※ <Outlines>의 굵기는 '픽셀' 단위라(드레이 셰이더가 화면 좌표에서 밀어낸다)
//     상자를 아무리 납작하게 눌러도 선 굵기는 일정하다.
const 단위상자 = new THREE.BoxGeometry(1, 1, 1);
// 납작한 판(카드·표지)용 1×1 평면.
//   ★ <Outlines>는 '면을 법선 쪽으로 밀어내는' 방식이라 평면에는 안 통한다
//     (평면은 법선이 전부 화면 앞을 향해서 밀어낼 방향이 안 나온다).
//     그래서 평면짜리 물건은 '주름선'(EdgesGeometry)이 테두리 역할을 한다 —
//     1×1 평면의 모서리선은 정확히 네 변이다.
const 단위판 = new THREE.PlaneGeometry(1, 1);

// Leva 폴더 값에서 선 6개만 뽑아낸다(나머지 색·크기 값은 물건이 따로 받는다).
const 선뽑기 = (v) => ({
  외곽선: v.외곽선,
  외곽선굵기: v.외곽선굵기,
  외곽선색: v.외곽선색,
  주름선: v.주름선,
  주름선각도: v.주름선각도,
  주름선색: v.주름선색,
});

// <mesh>의 자식으로 넣으면 그 메시에 외곽선·주름선을 같이 입힌다.
//   주름선을 mesh 안에 두는 이유: 메시의 변환을 그대로 물려받아야
//   늘리거나 돌려도 선이 어긋나지 않기 때문이다.
function 만화선({ geo, 선 }) {
  if (!선) return null;
  return (
    <>
      {선.외곽선 && <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />}
      {선.주름선 && geo && (
        <lineSegments geometry={주름지오(geo, 선.주름선각도)}>
          {/* toneMapped=false — 어두운 방에서도 지정한 색 그대로 나온다 */}
          <lineBasicMaterial color={선.주름선색} toneMapped={false} />
        </lineSegments>
      )}
    </>
  );
}


// 같은 색을 조금씩 밝고 어둡게 — 물건이 전부 똑같은 회색이면 가짜처럼 보인다.
//   f 가 1보다 크면 밝아지고, 작으면 어두워진다. 깊이 감광에도 이걸 쓴다.
function 색밝기(hex, f) {
  return `#${new THREE.Color(hex).multiplyScalar(f).getHexString()}`;
}

function makeRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function 상자합치기(상자들) {
  if (!상자들.length) return null;
  const 조각 = 상자들.map((b) => {
    const g = new THREE.BoxGeometry(b.크기[0], b.크기[1], b.크기[2]);
    // ★ UV 아틀라스 — 텍스처 한 장을 uv칸수×uv칸수 격자로 나눠,
    //   상자마다 다른 칸(uv칸=[열,행])을 쓰게 한다.
    //   좌석 얼룩처럼 '같은 텍스처인데 물건마다 다른 무늬'가 필요할 때 쓴다.
    //   드로우콜은 안 늘고(한 장·한 메시), 무늬만 제각각이 된다.
    if (b.uv칸 && b.uv칸수) {
      const [c, r] = b.uv칸;
      const N = b.uv칸수;
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) / N + c / N, uv.getY(i) / N + r / N);
      }
      uv.needsUpdate = true;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (b.회전)
      q.setFromEuler(new THREE.Euler(b.회전[0], b.회전[1], b.회전[2]));
    m.compose(
      new THREE.Vector3(b.위치[0], b.위치[1], b.위치[2]),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    return g;
  });
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose()); // 원본은 이제 필요 없다(메모리 누수 방지)
  return 합본;
}

// ── Leva 값 자동 저장 ────────────────────────────────────────
// [문제] 강력 새로고침(Cmd+Shift+R)을 하면 Leva 패널이 코드 기본값으로 초기화된다.
//        → 조절해둔 값이 콘솔로 뽑아 코드에 박기 전이라면 그대로 날아간다.
// [해결] 값이 바뀔 때마다 브라우저(localStorage)에 저장하고,
//        다음에 켤 때 저장된 값을 기본값 자리에 끼워 넣는다.
//        이제 새로고침해도 조절한 값이 그대로 남는다.
const LEVA_KEY = "kgeseo.leva.v1";

function 저장읽기() {
  try {
    return JSON.parse(localStorage.getItem(LEVA_KEY) || "{}");
  } catch {
    return {};
  }
}

// 페이지를 켤 때 딱 한 번, 저장 상태를 콘솔에 알려준다(작동 확인용)
let _알림함 = false;
function 저장상태알림() {
  if (_알림함) return;
  _알림함 = true;
  const n = Object.keys(저장읽기()).length;
  if (n === 0)
    console.log(
      "%c[Leva 자동저장] 저장된 값 없음 — 지금부터 조절하는 값이 자동 저장됩니다.",
      "color:#e0a94e;font-weight:bold",
    );
  else
    console.log(
      `%c[Leva 자동저장] ✅ 저장된 폴더 ${n}개를 불러왔습니다. 새로고침해도 값이 유지됩니다.`,
      "color:#4AE27A;font-weight:bold",
    );
}
function 저장쓰기(전체) {
  try {
    localStorage.setItem(LEVA_KEY, JSON.stringify(전체));
  } catch {
    /* 저장 공간이 없거나 막혀 있으면 조용히 넘어간다 */
  }
}

// ── 폴더 이름이 바뀌었을 때 저장값 옮기기 ────────────────────
// Leva 저장 키 = 폴더 이름이라, 이름을 바꾸면 조절해 둔 값이 통째로 초기화된다.
//   외투를 빼면서 '외투(공통)' → '옷걸이(공통)' 로 바뀌었으므로 한 번만 옮겨 준다.
//   이제 안 쓰는 '의자외투1·2' 저장값도 같이 지운다.
(() => {
  try {
    const 전체 = 저장읽기();
    let 바뀜 = false;
    if (전체["외투(공통)"]) {
      if (!전체["옷걸이(공통)"]) 전체["옷걸이(공통)"] = 전체["외투(공통)"];
      delete 전체["외투(공통)"];
      바뀜 = true;
    }
    for (const k of ["의자외투1", "의자외투2", "모자2(책상)"])
      if (k in 전체) {
        delete 전체[k];
        바뀜 = true;
      }
    if (바뀜) 저장쓰기(전체);
  } catch {
    /* localStorage 를 못 쓰는 환경이면 그냥 넘어간다 */
  }
})();

// 저장된 값이 있으면 스키마의 '기본값 자리'에만 끼워 넣는다.
//   슬라이더 범위(min/max/step)는 코드 것을 그대로 쓰고 value만 갈아끼운다.
// ── 코드 기본값이 저장값을 이겨야 하는 항목 ────────────────────────
// [문제] useSavedControls 는 localStorage 값을 되살린다. 그래서 코드에서
//   기본값을 바꿔도, 이미 한 번 만져 본 슬라이더는 옛 값이 그대로 뜬다.
//   "코드는 고쳤는데 화면은 그대로"인 상황이 계속 나온 원인이 이것이다.
//   그동안은 키 이름을 바꿔서 피해 갔는데(간격→칸겹침 같은), 이름이 지저분해진다.
// [해결] 여기 적어 둔 항목만 저장값을 무시하고 코드 기본값을 쓴다.
//   그리고 저장소에서도 지워서, 다음부터는 다시 사용자가 만진 값이 살아난다.
//   즉 '딱 한 번만 강제로 되돌리기'다.
//   ※ 되돌리기가 끝나면 여기서 지워도 된다(안 지워도 해가 없다).
const 강제기본값 = {
  "커피 자판기": ["주름선", "주름선색", "주름선각도"],
  "음료 자판기": ["주름선", "주름선색", "주름선각도"],
  // 계기판 저장값이 true 로 남아 있어도 한 번 꺼진 상태로 되돌린다.
  //   (적용 후엔 다시 Leva 로 켜고 끌 수 있다)
  "성능(공통)": ["계기판"],
  // 기차 안이 너무 어두워 물건을 놓을 수가 없었다 → 밝은 기본값으로 한 번 되돌린다.
  //   (한 번 적용되고 나면 다시 사용자가 만진 값이 살아난다)
  // 스크린샷대로 맞춘 색/밝기 + 새로 조정한 바닥시드·깜빡주기·외곽선·안개색을
  //   딱 한 번 코드 기본값으로 되돌린다(그 뒤엔 다시 사용자가 만진 값이 살아난다).
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
  "천장등(공통)": ["천장번짐"], // 천장 동그라미 제거 — 셀 셰이딩과 화풍이 어긋남
  // 소화전 속 — 화면에서 맞춘 색·크기로 한 번 되돌린다(적용 뒤엔 이 목록에서 빼면 된다)
  "소화전 속": [
    "안색", "금속색", "호스색",
    "경종바깥색", "경종속색", "경종크기", "경종속크기",
    "경종높이", "경종속위아래",
    "발신기바깥색", "발신기속색", "발신기크기", "발신기속크기",
    "표시등색", "빛세기", "부품깊이", "외곽선", "외곽선굵기",
  
    "주름선",
    "주름선색",
    "주름선각도",
  ],
  // 배전반 속 — 스위치를 아래 6개만 남긴 값으로 한 번 되돌린다
  // 배전반 속 — 화면에서 맞춘 색·크기로 한 번 되돌린다(적용 뒤엔 이 목록에서 빼면 된다)
  "배전반 속": [
    "안색", "판색", "차단기색", "차단기면색", "표시창색", "표시창빛",
    "등테색", "등위치가로", "등위치높이", "등크기", "등간격",
    "빨간등색", "빨간알크기", "빨간등빛", "초록등색", "초록알크기", "초록등빛",
    "접지가로", "접지폭", "레버색", "동색", "금속색",
    "검은선색", "파란선색", "초록선색", "라벨색",
    "퍼즐빨강", "퍼즐파랑", "퍼즐노랑", "차단기줄",
    "스위치두께", "스위치가로", "스위치깊이", "스위치간격",
    "손잡이가로", "손잡이높이", "미는거리",
    "주차단기높이", "주차단기가로", "주차단기깊이", "주차단기위치",
    "접속함색", "접속함높이", "접속함가로", "접속함위치",
    "계기함가로", "계기함높이", "계기함위치", "표시창가로", "표시창높이",
    "전선굵기", "굵은선굵기", "외곽선굵기",
    // 주름선을 켜고 복도 회색(#808080)으로 — 저장값(꺼짐)이 이기면 안 보인다
    "주름선", "주름선색", "주름선각도",
  ],

  // 조명 3개에 곱하는 배율 — 수사본부실·복도를 함께 아주 살짝 올린 값으로 되돌린다
  "스탠드(공통)": ["전체어둡게"],
  // 수사본부(폐역) 조명을 밝게 조정한 값으로 한 번 되돌린다.
  "폐역 조명": ["기본광밝기", "기본광색", "주광밝기"],
  // 복도 길이 — 슬라이더 최대치까지 끌어놨던 값을 새 범위 기준으로 한 번 리셋
  // 화면에서 맞춘 값으로 한 번 되돌린다(적용 후에는 이 목록에서 빼면 된다)
  "비밀 복도": [
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
    // 바닥 잡동사니·부식 개수 — 너무 빽빽하던 것을 줄인 값으로 되돌린다
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
    "유도등테색",
    // 맞은편 소화전과 중심선을 맞춘 값으로 한 번 되돌린다
    "배전반바닥높이",
  
    "주름선",
    "주름선색",
    "주름선각도",
  ],
};

function 스키마에적용(폴더, 스키마) {
  const 전체 = 저장읽기();
  const 저장 = 전체[폴더];
  if (!저장) return 스키마;

  // 강제 항목은 저장값을 통째로 버린다. 저장소에서도 지워야
  //   바로 뒤 useEffect 가 '새 기본값'으로 다시 써 준다(자가 치유).
  const 강제 = 강제기본값[폴더];
  if (강제) {
    let 지움 = false;
    for (const k of 강제) {
      if (k in 저장) {
        delete 저장[k];
        지움 = true;
      }
    }
    if (지움) {
      저장쓰기(전체);
      console.log(
        `%c[Leva] "${폴더}" 의 ${강제.join(", ")} 를 코드 기본값으로 되돌렸습니다.`,
        "color:#e0a94e",
      );
    }
  }

  const out = {};
  for (const [k, v] of Object.entries(스키마)) {
    if (!(k in 저장)) {
      out[k] = v; // 새로 생긴 슬라이더는 코드 기본값 사용
      continue;
    }
    out[k] =
      v && typeof v === "object" && "value" in v
        ? { ...v, value: 저장[k] }
        : 저장[k];
  }
  return out;
}

// useControls 대신 쓰는 래퍼. 사용법은 똑같고, 값 저장만 자동으로 붙는다.
// ※ 이름이 원래 use저장Controls 였는데 useSavedControls 로 바꿨다.
//   eslint의 react-hooks 규칙은 훅 이름을 /^use[A-Z]/ 로 판별해서,
//   'use' 뒤에 한글이 오면 훅으로 인식하지 못하고 "훅을 컴포넌트가 아닌 곳에서
//   호출했다"는 오류를 낸다. 동작은 완전히 동일하다.
function useSavedControls(폴더, 스키마) {
  // 첫 렌더에만 계산한다. 매번 다시 만들면 Leva가 값을 되돌려버린다.
  const 초기 = useMemo(() => {
    저장상태알림();
    return 스키마에적용(폴더, 스키마);
  }, []); // eslint-disable-line

  // ★ 폴더를 '접힌 채' 시작하게 만든다.
  //   폴더가 66개나 되다 보니 전부 펼쳐진 채로는 패널이 수천 픽셀이 되고,
  //   그러면 Leva 가 폴더 높이를 잘못 재서 줄이 서로 겹쳐 보인다.
  //   useControls("폴더이름", 스키마) 형태로는 접힘 옵션을 못 주고,
  //   { 폴더이름: folder(스키마, { collapsed: true }) } 형태로 감싸야 준다.
  //   반환값은 두 형태 모두 '납작한 값 객체'라 쓰는 쪽 코드는 그대로다.
  const 감싼 = useMemo(
    () => ({ [폴더]: folder(초기, { collapsed: true }) }),
    [폴더, 초기],
  );
  const 값 = useControls(감싼);
  // 객체는 렌더마다 새로 생기므로 문자열로 바꿔 '진짜 바뀌었을 때만' 저장한다
  const json = JSON.stringify(값);
  useEffect(() => {
    const 전체 = 저장읽기();
    전체[폴더] = JSON.parse(json);
    저장쓰기(전체);
  }, [폴더, json]);
  return 값;
}



// ═══════════════════════════════════════════════════════════════
//  1인칭 이동 — 씬이 달라도 조작감은 같아야 한다
// ═══════════════════════════════════════════════════════════════
// [왜 공용인가]
//   역과 기차 안은 공간이 다르지만 '걷고·뛰고·앉고·점프하는 느낌'은 같아야 한다.
//   같은 코드를 씬마다 복사하면 한쪽만 고쳐서 조작감이 어긋난다.
//
// [씬마다 다른 것은 함수로 받는다]
//   경계(p) → { xmin, xmax, zmin, zmax }   그 프레임에 갈 수 있는 사각 범위
//   막힘(x, z) → true/false                가구 같은 장애물
//   근처(p) → "" | "이름"                  상호작용 지점(없으면 생략)
//   이렇게 하면 역은 '문 앞에서만 복도로' 같은 복잡한 규칙을 넣을 수 있고,
//   기차 안은 그냥 사각 상자 하나를 돌려주면 된다.

// 눈높이 — 1 유닛 ≈ 0.30m 기준(사람 1.65m ≈ 5.5 유닛)
const EYE = 6.5, // 서 있을 때
  CROUCH_EYE = 3.0; // 앉았을 때 ≈ 0.9m
const WALK = 6,
  RUN = 1.7,
  CROUCH = 0.55;
const GRAVITY = -30,
  JUMP = 10.5;
const AIR_CONTROL = 0.18;
const R = 0.6;
const NEAR = 5;

// ★ 앉기는 C 하나로 통일한다 (누를 때마다 앉기/서기 전환).
//   예전에는 Ctrl 로 '누르고 있는 동안 앉기'를 했는데, 그게 윈도우에서 사고를 냈다.
//   맥은 브라우저 단축키가 ⌘ 라서 Ctrl 이 비어 있지만,
//   윈도우는 Ctrl 자체가 단축키 모디파이어다.
//     Ctrl+W = 탭 닫기 · Ctrl+T = 새 탭 · Ctrl+R = 새로고침 · Ctrl+Tab = 탭 전환
//   조작이 Ctrl(앉기) + W(앞으로) 였으니, 앉은 채 걸으면 게임 탭이 그냥 닫혔다.
//   preventDefault() 로도 못 막는다 — 브라우저가 페이지에 아예 넘겨주지 않는
//   '예약 단축키'라서다. 그래서 웹 게임은 Ctrl·Alt 를 조작키로 쓰면 안 된다.

// 게임이 처리하는 키(브라우저 기본 동작을 막을 대상)
const HANDLED = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "KeyC",
  "Space",
]);


function use이동(
  active,
  { 눈높이 = EYE, 앉은높이 = CROUCH_EYE, 경계, 막힘, 근처, 시작, 바라봄 } = {},
) {
  const { camera } = useThree();
  const eyeRef = useRef(눈높이);
  const crouchEyeRef = useRef(앉은높이);
  eyeRef.current = 눈높이;
  crouchEyeRef.current = 앉은높이;

  const keys = useRef({
    f: false, b: false, l: false, r: false,
    run: false, crouchToggle: false, // 앉기는 C 토글 하나뿐이다
  });
  const vel = useRef(new THREE.Vector3());
  const vy = useRef(0);
  const grounded = useRef(true);
  const lastNear = useRef("");
  const 첫프레임 = useRef(true);

  useEffect(() => {
    const set = (code, v) => {
      const k = keys.current;
      if (code === "KeyW" || code === "ArrowUp") k.f = v;
      else if (code === "KeyS" || code === "ArrowDown") k.b = v;
      else if (code === "KeyA" || code === "ArrowLeft") k.l = v;
      else if (code === "KeyD" || code === "ArrowRight") k.r = v;
      else if (code === "ShiftLeft" || code === "ShiftRight") k.run = v;
    };
    const down = (e) => {
      if (HANDLED.has(e.code)) e.preventDefault();
      if (e.code === "Space" && grounded.current) {
        vy.current = JUMP;
        grounded.current = false;
      }
      if (e.code === "KeyC" && !e.repeat)
        keys.current.crouchToggle = !keys.current.crouchToggle;
      set(e.code, true);
    };
    const up = (e) => set(e.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, dt) => {
    const p = camera.position;

    // 씬에 들어온 첫 프레임에 시작 위치로 옮긴다.
    //   (라우터로 씬을 바꿔도 카메라는 하나라, 이전 씬 좌표가 그대로 남아 있다)
    if (첫프레임.current) {
      첫프레임.current = false;
      if (시작) {
        p.set(시작[0], 시작[1] ?? eyeRef.current, 시작[2]);
        vel.current.set(0, 0, 0);
        vy.current = 0;
      }
      // ★ 바라볼 방향(yaw). 위치만 옮기면 '어디를 보고 서 있는지'는 그대로다.
      //   three.js 카메라의 기본 시선은 **−z 방향**이다. 그래서 씬의 긴 축이
      //   x 라면, 들어오자마자 **옆벽을 코앞에서 마주보고** 서게 된다.
      //   (기차 안이 캄캄해 보였던 원인이 정확히 이것이었다 — 조명이 아니라 시선)
      //
      //   각도 기준 (y축 회전, 라디안):
      //     0        → −z 를 본다 (기본값)
      //     +π/2     → −x 를 본다
      //     −π/2     → +x 를 본다
      //     π        → +z 를 본다
      //   rotation.set(x, y, z) 에서 x(위아래)·z(기울기)는 0으로 둔다.
      //   서 있는 사람은 고개를 갸웃하지 않으니까.
      if (바라봄 !== undefined) camera.rotation.set(0, 바라봄, 0);
    }

    if (근처) {
      const n = 근처(p) || "";
      if (n !== lastNear.current) lastNear.current = n;
    }
    if (!active) return;

    const k = keys.current;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const wish = new THREE.Vector3();
    if (k.f) wish.add(fwd);
    if (k.b) wish.sub(fwd);
    if (k.r) wish.add(right);
    if (k.l) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();
    const crouching = k.crouchToggle;
    const speed = WALK * (crouching ? CROUCH : k.run ? RUN : 1);
    const target = wish.multiplyScalar(speed);

    if (grounded.current) {
      vel.current.x = target.x;
      vel.current.z = target.z;
    } else {
      vel.current.x += (target.x - vel.current.x) * AIR_CONTROL;
      vel.current.z += (target.z - vel.current.z) * AIR_CONTROL;
    }

    const b = 경계 ? 경계(p) : { xmin: -1e4, xmax: 1e4, zmin: -1e4, zmax: 1e4 };
    const 막 = 막힘 || (() => false);
    // 이미 무언가 '안'에 있으면 양쪽이 다 막혀 영영 못 움직인다 → 빠져나가게 허용
    const 갇힘 = 막(p.x, p.z);

    const nx = THREE.MathUtils.clamp(p.x + vel.current.x * dt, b.xmin, b.xmax);
    if (갇힘 || !막(nx, p.z)) p.x = nx;
    else vel.current.x = 0;

    const nz = THREE.MathUtils.clamp(p.z + vel.current.z * dt, b.zmin, b.zmax);
    if (갇힘 || !막(p.x, nz)) p.z = nz;
    else vel.current.z = 0;

    const floorY = crouching ? crouchEyeRef.current : eyeRef.current;
    vy.current += GRAVITY * dt;
    let ny = p.y + vy.current * dt;
    if (ny <= floorY) {
      ny = floorY;
      vy.current = 0;
      grounded.current = true;
    } else grounded.current = false;
    if (grounded.current)
      ny = THREE.MathUtils.lerp(p.y, floorY, 1 - Math.pow(0.0001, dt));
    p.y = ny;
  });

  return lastNear;
}


// ═══════════════════════════════════════════════════════════════
//  캔버스 질감 — 벽 · 바닥 · 천장  (App.jsx 에서 옮겨 옴)
// ═══════════════════════════════════════════════════════════════
// [왜 여기로 옮겼나]
//   역(수사본부)의 '낡은 느낌'은 전부 이 코드에서 나온다. 콘크리트 블록,
//   벗겨진 페인트, 물자국, 아래에서 올라온 때 — 색만 칠한 상자와 이것의
//   차이가 곧 퀄리티 차이다.
//   그런데 이게 App.jsx 안에만 있어서 기차 안은 민무늬 상자로 남아 있었다.
//   두 씬이 **같은 질감**을 써야 한 세계로 보이므로 공용으로 옮긴다.
//   ※ 코드는 한 글자도 안 바꿨다. 역의 결과물은 그대로다.

// 저사양 모드(?q=low) — App.jsx 와 같은 규칙으로 주소에서 직접 읽는다.
//   텍스처 해상도를 절반으로 떨어뜨려 내장 GPU의 메모리를 아낀다.
const 저사양 = (() => {
  try {
    return new URLSearchParams(location.search).get("q") === "low";
  } catch {
    return false; // 브라우저가 아닌 환경(빌드 중 등)에서는 일반 모드
  }
})();

const 텍스처배율 = 저사양 ? 0.5 : 1;

function makeCanvasTexture(size, draw) {
  const c = document.createElement("canvas");
  // 너무 작아지면 무늬가 뭉개지므로 128px 아래로는 안 내려간다
  const 실제 = Math.max(128, Math.round(size * 텍스처배율));
  c.width = c.height = 실제;
  draw(c.getContext("2d", { willReadFrequently: true }), 실제);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ===== 캔버스 질감 =====
// 코드로 그린 텍스처는 색이 너무 고르게 깔려 '인쇄물' 처럼 보인다.
//   → 넓고 옅은 얼룩(손때·물자국) + 미세한 점(종이 결)을 덧칠해 낡은 느낌을 준다.
//   세기 0이면 아무것도 하지 않는다. 정사각형이 아니어도 되고, 이어붙지 않는다.
function 질감얹기(g, w, h, seed, 세기 = 1) {
  if (세기 <= 0) return;
  const rnd = makeRandom((seed | 0) * 977 + 13);
  const R = Math.max(w, h);

  // ① 넓고 옅은 얼룩 — 손때·물자국. 진하게 하면 지저분해지니 아주 옅게.
  const n = 5 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w,
      y = rnd() * h,
      r = R * (0.12 + rnd() * 0.3);
    const 어둡게 = rnd() < 0.72;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const a = (어둡게 ? 0.06 : 0.05) * 세기;
    grd.addColorStop(
      0,
      어둡게 ? `rgba(90,80,66,${a})` : `rgba(255,255,255,${a})`,
    );
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }

  // ② 미세한 점 — 종이 섬유. 흰 점·검은 점을 섞어야 '결'로 보인다.
  const 점수 = ((w * h) / 170) | 0;
  g.globalAlpha = 0.05 * 세기;
  for (let i = 0; i < 점수; i++) {
    g.fillStyle = rnd() < 0.5 ? "#000" : "#fff";
    g.fillRect((rnd() * w) | 0, (rnd() * h) | 0, 1, 1);
  }
  g.globalAlpha = 1;
}

// ===== 콘크리트 벽·바닥 (전부 코드로 그린다) =====
// 참고: 작은 블록을 반 장씩 어긋나게 쌓은 벽 + 큰 판으로 나뉜 민바닥 콘크리트.
// ★ 텍스처에는 '밝기 무늬'만 그린다(대략 0.78~1.0).
//   실제 색은 재질의 color가 정하고 명암은 실시간 조명이 만든다.
//   그래서 참고 사진처럼 밝게 그려도 방 분위기는 지금 그대로 어둡게 남는다.

const 블록W = 0.66, // 블록 한 장 ≈ 20cm (1유닛 ≈ 30cm)
  블록H = 0.33; // ≈ 10cm
const 벽칸_가로 = 8, // 텍스처 한 장에 들어가는 블록 수
  벽칸_세로 = 16;
const WALL_TEX_W = 블록W * 벽칸_가로; // 텍스처 한 장이 덮는 실제 가로(5.28)
const WALL_TEX_H = 블록H * 벽칸_세로; // 〃 세로(5.28 — 캔버스가 정사각이라 같게 맞췄다)
const FLOOR_TEX = 6; // 바닥 판 한 칸 = 6유닛(≈1.8m)

const 회 = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

// 원형 얼룩 하나. 텍스처가 이어 붙어도 티가 안 나도록 상하좌우로 감아 가며 찍는다.
function 둥근얼룩(g, S, x, y, r, rgb, a) {
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) {
      const cx = x + dx,
        cy = y + dy;
      if (cx < -r || cx > S + r || cy < -r || cy > S + r) continue;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, `rgba(${rgb},${a})`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, 6.2832);
      g.fill();
    }
}

// ── 콘크리트 블록 벽 ─────────────────────────────────────────
const 벽텍캐시 = new Map();
// 옵션을 주면 천장에도 그대로 쓸 수 있게 일반화했다.
//   기본값은 지금 벽과 완전히 같다 — 벽 결과는 하나도 안 바뀐다.
//   칸가로·칸세로 = 텍스처 한 장에 들어가는 블록 수
//   엇갈림 = 한 줄씩 어긋나는 정도(0.5=막쌓기 / 0=격자로 반듯하게)
//   흘러내림 = 물자국을 세로로 흘릴지(벽) 둥글게 번지게 할지(천장)
//   아래때 = 아래쪽이 더 더러워지는 그라디언트(천장에는 위아래가 없다)
function 벽텍스처(seed, 낡음 = 0.7, opt = {}) {
  const {
    칸가로 = 벽칸_가로,
    칸세로 = 벽칸_세로,
    엇갈림 = 0.5,
    흘러내림 = true,
    아래때 = true,
  } = opt;
  const 캐시키 = `${seed}|${낡음}|${칸가로}|${칸세로}|${엇갈림}|${흘러내림}|${아래때}`;
  if (벽텍캐시.has(캐시키)) return 벽텍캐시.get(캐시키);
  const t = makeCanvasTexture(1024, (g, S) => {
    const rnd = makeRandom(seed);
    const bw = S / 칸가로,
      bh = S / 칸세로;
    const J = 4; // 줄눈(모르타르) 두께 px ≈ 1cm

    g.fillStyle = 회(196); // 줄눈 바탕 — 블록보다 어둡다
    g.fillRect(0, 0, S, S);

    for (let r = 0; r < 칸세로; r++) {
      const off = (r % 2) * bw * 엇갈림; // 한 줄씩 어긋나게(막쌓기)
      for (let c = -1; c < 칸가로; c++) {
        let v = 240 + (rnd() - 0.5) * 11; // 블록마다 톤이 조금씩 다르다(16→11로 완화)
        const 뽑기 = rnd();
        if (뽑기 < 0.07)
          v -= 11; // 가끔 유난히 때 탄 블록(16→11)
        else if (뽑기 > 0.93) v += 8; // 가끔 유난히 밝은 블록
        g.fillStyle = 회(v);
        const x = c * bw + off;
        // 캔버스 밖으로 나가는 블록은 반대쪽에도 그려야 이어진다
        for (const dx of [0, S])
          g.fillRect(x + dx + J / 2, r * bh + J / 2, bw - J, bh - J);
      }
    }

    // 넓고 옅은 얼룩 — 콘크리트 특유의 얼룩덜룩함
    for (let i = 0; i < 24; i++)
      둥근얼룩(
        g,
        S,
        rnd() * S,
        rnd() * S,
        50 + rnd() * 150,
        rnd() < 0.62 ? "58,58,58" : "255,255,255",
        0.03 + rnd() * 0.05,
      );

    // 물 자국 — 벽은 아래로 흘러내리고, 천장은 둥글게 번진다
    if (흘러내림) {
      for (let i = 0; i < 7; i++) {
        const x = rnd() * S,
          w = 6 + rnd() * 26;
        const y0 = rnd() * S * 0.45,
          len = S * (0.25 + rnd() * 0.6);
        const grd = g.createLinearGradient(0, y0, 0, y0 + len);
        grd.addColorStop(0, "rgba(64,62,58,0)");
        grd.addColorStop(0.3, `rgba(64,62,58,${0.05 + rnd() * 0.08})`);
        grd.addColorStop(1, "rgba(64,62,58,0)");
        g.fillStyle = grd;
        for (const dx of [-S, 0]) g.fillRect(x + dx, y0, w, len);
      }
    } else {
      // 스며들어 번진 자국 — 가운데는 옅고 가장자리에 테두리가 진하게 남는다
      for (let i = 0; i < 6; i++) {
        const x = rnd() * S,
          y = rnd() * S,
          R = 45 + rnd() * 130;
        for (const dx of [-S, 0, S])
          for (const dy of [-S, 0, S]) {
            const grd = g.createRadialGradient(
              x + dx,
              y + dy,
              R * 0.2,
              x + dx,
              y + dy,
              R,
            );
            grd.addColorStop(0, "rgba(70,66,58,0.09)");
            grd.addColorStop(0.75, "rgba(70,66,58,0.05)");
            grd.addColorStop(1, "rgba(70,66,58,0)");
            g.fillStyle = grd;
            g.beginPath();
            g.arc(x + dx, y + dy, R, 0, 6.2832);
            g.fill();
            g.strokeStyle = "rgba(66,62,54,0.1)";
            g.lineWidth = 2.5;
            g.beginPath();
            g.arc(x + dx, y + dy, R * (0.72 + rnd() * 0.2), 0, 6.2832);
            g.stroke();
          }
      }
    }

    // ── 낡음 레이어 ──────────────────────────────────────────
    // 위 얼룩·물자국은 '더러움'이고, 아래 셋은 '세월'이다. 종류가 다르다.
    if (낡음 > 0) {
      const a = 낡음;

      // (1) 페인트 벗겨짐 — 가장자리가 너덜너덜한 조각. 속은 더 어두운 바탕이 드러난다.
      for (let i = 0; i < Math.round(9 * a); i++) {
        const cx0 = rnd() * S,
          cy0 = rnd() * S;
        const R = 18 + rnd() * 46;
        for (const dx of [-S, 0, S]) {
          g.beginPath();
          const n = 12;
          for (let k = 0; k <= n; k++) {
            const th = (k / n) * Math.PI * 2;
            // 반지름을 크게 흔들어 매끈한 원이 아니라 '뜯어진' 모양으로
            const rr = R * (0.55 + rnd() * 0.75);
            const px = cx0 + dx + Math.cos(th) * rr,
              py = cy0 + Math.sin(th) * rr * 0.8;
            k ? g.lineTo(px, py) : g.moveTo(px, py);
          }
          g.closePath();
          g.fillStyle = `rgba(120,114,104,${0.16 + rnd() * 0.14})`;
          g.fill();
        }
      }

      // (2) 실금 — 한 번에 곧게 가지 않고 마디마다 꺾이며 내려간다
      for (let i = 0; i < Math.round(7 * a); i++) {
        let px = rnd() * S,
          py = rnd() * S;
        const 방향 = (rnd() - 0.5) * 1.1 + Math.PI / 2; // 대체로 아래로
        g.strokeStyle = `rgba(74,70,64,${0.22 + rnd() * 0.2})`;
        g.lineWidth = 1 + rnd() * 1.2;
        for (const dx of [-S, 0, S]) {
          g.beginPath();
          g.moveTo(px + dx, py);
          let qx = px + dx,
            qy = py;
          const 마디 = 5 + ((rnd() * 5) | 0);
          for (let k = 0; k < 마디; k++) {
            const L = 14 + rnd() * 40;
            const th = 방향 + (rnd() - 0.5) * 0.9;
            qx += Math.cos(th) * L;
            qy += Math.sin(th) * L;
            g.lineTo(qx, qy);
          }
          g.stroke();
        }
      }

      // (3) 바닥에서 올라온 때 — 아래로 갈수록 짙어진다(습기가 아래부터 먹는다)
      if (아래때) {
        const 아래 = g.createLinearGradient(0, S * 0.55, 0, S);
        아래.addColorStop(0, "rgba(58,54,48,0)");
        아래.addColorStop(1, `rgba(58,54,48,${0.1 * a})`);
        g.fillStyle = 아래;
        g.fillRect(0, S * 0.55, S, S * 0.45);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  벽텍캐시.set(캐시키, t);
  return t;
}

// ── 민바닥 콘크리트 ──────────────────────────────────────────
const 바닥텍캐시 = new Map();
function 바닥텍스처(seed) {
  if (바닥텍캐시.has(seed)) return 바닥텍캐시.get(seed);
  const t = makeCanvasTexture(1024, (g, S) => {
    const rnd = makeRandom(seed + 5100);
    g.fillStyle = 회(242);
    g.fillRect(0, 0, S, S);

    // 미장 자국 — 크고 옅은 얼룩을 겹쳐 얼룩덜룩하게
    for (let i = 0; i < 64; i++)
      둥근얼룩(
        g,
        S,
        rnd() * S,
        rnd() * S,
        40 + rnd() * 210,
        rnd() < 0.55 ? "70,68,64" : "255,255,255",
        0.02 + rnd() * 0.045,
      );

    // 자잘한 기포·찍힌 자국
    g.fillStyle = "rgba(96,94,90,0.30)";
    for (let i = 0; i < 290; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        r = 0.8 + rnd() * 2.2;
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.fill();
    }
    // 조금 더 큰 자국
    for (let i = 0; i < 44; i++)
      둥근얼룩(g, S, rnd() * S, rnd() * S, 4 + rnd() * 8, "80,78,74", 0.14);

    // 판 경계 줄눈 — 텍스처 테두리에 그으면 텍스처 한 장이 곧 '판 한 칸'이 된다
    둥근얼룩(g, S, 0, S / 2, 26, "90,88,84", 0.06); // 줄눈 옆 살짝 어두운 띠
    둥근얼룩(g, S, S / 2, 0, 26, "90,88,84", 0.06);
    g.strokeStyle = "rgba(126,124,120,0.55)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 1.5);
    g.lineTo(S, 1.5);
    g.moveTo(1.5, 0);
    g.lineTo(1.5, S);
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  바닥텍캐시.set(seed, t);
  return t;
}

// ===== 천장 — 벽과 같은 블록 텍스처를 크고 반듯하게 =====
// 벽과 완전히 같은 그리기 코드를 쓴다(얼룩·페인트 벗겨짐·실금까지).
//   다만 천장은 ① 칸이 크고 ② 줄이 어긋나지 않고(격자) ③ 물자국이 번지고
//   ④ '아래로 갈수록 때' 가 없다. 그래서 벽과 한 몸처럼 보이면서도 천장으로 읽힌다.
const CEIL_TEX = 8; // 텍스처 한 장이 덮는 실제 크기(유닛) → 칸 하나 2유닛 ≈ 0.6m
function 천장텍스처(seed, 낡음 = 0.7) {
  return 벽텍스처(seed + 4400, 낡음, {
    칸가로: 4,
    칸세로: 4,
    엇갈림: 0,
    흘러내림: false,
    아래때: false,
  });
}

export {
  텍스처배율,
  makeCanvasTexture,
  질감얹기,
  블록W,
  블록H,
  벽칸_가로,
  벽칸_세로,
  WALL_TEX_W,
  WALL_TEX_H,
  FLOOR_TEX,
  회,
  둥근얼룩,
  벽텍스처,
  바닥텍스처,
  CEIL_TEX,
  천장텍스처,
  makeToonGradient,
  TOON_GRADIENT,
  OUTLINE_THICK,
  OUTLINE_COLOR,
  선스키마,
  주름지오,
  단위상자,
  단위판,
  선뽑기,
  만화선,
  색밝기,
  makeRandom,
  상자합치기,
  저장읽기,
  저장쓰기,
  강제기본값,
  스키마에적용,
  useSavedControls,
  use이동,
  EYE,
  CROUCH_EYE,
  WALK,
  RUN,
  CROUCH,
  GRAVITY,
  JUMP,
  AIR_CONTROL,
  R,
  NEAR,
  HANDLED,
};
