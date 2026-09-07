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
  "천장등(공통)": ["천장번짐"], // 천장 동그라미 제거 — 셀 셰이딩과 화풍이 어긋남
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
  { 눈높이 = EYE, 앉은높이 = CROUCH_EYE, 경계, 막힘, 근처, 시작 } = {},
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

export {
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
