// App.jsx — 1인칭 3D 로비 · "성간 환승 터미널" 아트디렉션
//
// ★★★★ 현재 셀셰이딩 룩 정리:
//   ① 재질 toon(계단 명암 3단계) + 조명 대비(ambient 0.75)로 손그림 명암을 만든다.
//   ② 굵직한 입체 구조물에만 실선 윤곽선(Outlines)을 둘렀다 —
//      기둥·문·모서리/부축기둥·채광창 테두리·천장 대들보/교차보.
//   ③ 규칙적으로 과하게 깔렸던 실선(유리 격자·몰딩·연석)은 제거해 깔끔하게.
//   ※ '끊긴 연필 선'은 3D 막대로는 점선처럼 인공적으로만 나와서 접었다.
//      진짜 연필 질감은 GLB 소품 + 손그림 텍스처 단계에서 제대로 넣는다.
//
// ───────── 이전 작업 기록 ─────────
//   ① 경계 구조물에 윤곽선을 더 둘렀다 — 몰딩 3종·유리 격자(천장/바닥)·채광창
//      테두리 프레임·유리 연석·천장 격자보/교차보. 방 곳곳의 면 경계가 선으로 잡힌다.
//   ② 기둥에 '끊긴 링'을 추가했다(COLUMN_BANDS). 완전한 원이 아니라 짧은 원호
//      조각을 띄엄띄엄 둘러, 연필로 대충 그은 듯 중간중간 끊긴 선을 낸다.
//   ※ 전광판·벽/천장/바닥 평면은 제외(평면은 윤곽선이 사각 테두리로만 나와 어색).
//   ※ 선이 너무 굵으면 OUTLINE_THICK 하나만 낮추면 전부 같이 얇아진다.
//
// ★★ 이전 변경(셀셰이딩 3단계 — 윤곽선):
//   큰 입체 구조물에 drei <Outlines>로 검은 만화 테두리를 둘렀다(abeto 그림체 완성).
//   대상: 원기둥 4개 / 모서리 기둥 / 부축기둥 / 게이트 문틀·문짝.
//   두께·색은 상단 OUTLINE_THICK / OUTLINE_COLOR 한 곳에서 관리한다(전체 일괄 조절).
//   ※ 벽·천장·바닥은 '평면(planeGeometry)'이라 윤곽선을 넣으면 물체 실루엣이 아니라
//     사각형 테두리 4줄만 생겨 어색하다 → 일부러 제외했다. 실루엣이 있는 입체물에만 둘렀다.
//   ※ 조명은 이전 단계에서 맞춘 값(ambient 0.65 / hemisphere 0.85)을 그대로 반영했다.
//
// ★ 이전 변경(셀셰이딩 1단계 — 재질만 교체, 색·조명·구조·이동 전부 그대로):
//   불투명 구조물의 meshStandardMaterial → meshToonMaterial 로 바꿨다.
//   toon은 빛을 부드럽게 흘리지 않고 gradientMap(3단계)을 따라 '계단'처럼 끊는다.
//   → 벽·기둥·바닥타일·천장 등에 손그림 같은 명암 층이 생긴다(abeto 톤의 뼈대).
//   ※ 제외한 것: 반투명 유리 2장(glassTop/glassFloor)·발광 골드 바·우주 이미지 평면.
//     (유리는 반투명 처리가, 우주는 meshBasic이라 라이팅이 애초에 toon 대상이 아니다)
//   ※ toon에는 roughness/metalness 개념이 없어 그 두 속성은 빼고 gradientMap을 넣었다.
//
// 지난 변경(겉모습만 수정, 이동·충돌·구조는 그대로 유지):
//   ① 우주 = 어두운 베이스 + 얕은 오로라(짙은 남색 밤하늘) → 별·행성이 살아난다.
//   ② 창문 = 튀어나온 액자(틀·헤일로·반사) 삭제, 벽에 박힌 통유리 + 테두리만.
//   ③ 바닥·천장 유리 = 안쪽 분할선(가운데 선) 삭제, 가장자리 테두리만(B).
//   ④ 기둥 = 밖으로 튀어나온 유리관 삭제 → 기둥 표면의 평평한 '물 채널 + 기포'로.
//   그 외(문 색·전광판·유리 바닥 위치·후처리 등)는 손대지 않았다.
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  Suspense,
  lazy,
} from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { 사이드킥외형읽기 } from "../naju01/src/사이드킥옵션.js";
import { 메시외형읽기 } from "../naju01/src/메시외형옵션.js";
import { 기본툰 } from "../naju01/src/툰재질.js";
import { 기본외곽선 } from "../naju01/src/툰외곽선.js";
// ※ drei의 SoftShadows는 three 0.185의 그림자 셰이더 청크와 호환되지 않아
//   씬 전체 머티리얼이 컴파일에 실패한다(WebGL: useProgram: program not valid).
//   → 사용 금지. 그림자는 Canvas의 shadows="percentage"(PCF)로 처리한다.
//   (PCFSoftShadowMap은 0.185에서 deprecated라 어차피 PCF로 폴백된다)
import {
  PointerLockControls,
  OrbitControls, // 개발용: 위에서 내려다보며 배치 맞추기
  Outlines, // ← 윤곽선(abeto 만화 테두리). 물체 메시 안에 넣으면 그 물체에 검은 선이 둘러진다
  useGLTF, // ← GLB 3D 모델 로더(책상·컴퓨터·노트북·의자 등 소품을 불러온다)
  Preload, // ← 씬 전체의 셰이더를 '미리' 컴파일해 둔다 (아래 설명)
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Leva, useControls, button, folder } from "leva"; // 패널 + 슬라이더 + 버튼 + 폴더
import * as THREE from "three";
// 여러 개의 지오메트리를 '하나'로 합치는 도구.
//   드로우콜은 '메시 개수'에 비례하므로, 재질이 같은 것끼리 합치면 그만큼 줄어든다.
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";



// 여러 씬이 함께 쓰는 부품 — 자세한 설명은 공용.jsx 참고
import {
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
  R,
  NEAR,
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
} from "./공용.jsx";
import { useLocation, useNavigate } from "react-router-dom";
// 기차 내부 씬 — 파일이 나뉘어 있지만 같은 번들에 들어가므로 전환은 즉시다.
import 기차내부 from "./scenes/기차내부.jsx";
// 복도 소품 — 자판기 2대(캔 · 커피). 상자와 판이라 GLB 없이 코드로 짰다.
import { 캔자판기, 커피자판기 } from "./소품/자판기.jsx";
// 복도 바닥 잡동사니 — 캔·종이·각목·물웅덩이. 전부 한 덩어리로 합쳐 그린다.
import { 복도잡동사니, 복도부식 } from "./소품/복도잡동사니.jsx";
import { 소화전내부 } from "./소품/소화전내부.jsx";
import { 배전반내부 } from "./소품/배전반내부.jsx";
import { 열렸나, 여닫기 } from "./소품/여닫이.js";
// ── 화면 위에 뜨는 창들 ─────────────────────────────────────
//   화면층 = 「한 번에 하나의 모달」 규칙(GRD-11 · CMN-035)을 지키는 관리자.
//   앞으로 수첩(N) · 힌트(H) · 일시정지(ESC)가 여기에 줄줄이 붙는다.
import 소지품UI from "./게임/소지품UI.jsx";
import { 소지품 } from "./게임/소지품.js";
import { 화면층, 층, use열린층 } from "./게임/화면층.js";
// ★ 로비 물건 상호작용 (CT-007 / S4-009) — 겨냥 판정과 물건 상태는 App 밖 상자에 둔다.
import 겨냥판정, { 상호대상, 손에든것 } from "./로비/겨냥판정.jsx";
import { use자판기 } from "./소품/자판기상태.js";
import { 강조 } from "./로비/강조.jsx";
import { 잰다, 놓을자리계산, 놓기유령 } from "./로비/배치.jsx";
import {
  월드박스공급,
  최근자리값,
  걸이등록,
  걸이해제,
  옮겨진것갱신,
  위에얹힌것,
  표면등록,
  표면해제,
} from "./로비/배치.js";
import {
  겨냥,
  실행 as 상호실행,
  use로비상태,
  서랍움직이기,
  램프토글,
  끄는의자,
  의자잡기,
  의자놓기,
  집기,
  놓기,
  제자리로,
} from "./로비/상호작용.js";

// ★★ 개발용_소지품씨앗 — 서버가 붙으면 이 상수와 쓰는 곳을 함께 지운다. ★★
//   지금은 소지품 창을 눈으로 확인할 방법이 이것뿐이라 표본을 넣어 둔다.
//   모양은 계약(v0.3.1)의 Clue 와 맞춰 두었다 → 서버 응답을 그대로 꽂을 수 있다.
const 개발용_소지품씨앗 = [
  {
    id: "DEV_KEY_01",
    이름: "낡은 열쇠",
    분류: "열쇠",
    설명: "손잡이에 긁힌 자국이 많다. 어디 것인지는 아직 모른다.",
  },
  {
    id: "DEV_NOTE_01",
    이름: "구겨진 쪽지",
    분류: "기록",
    설명: "날짜만 남고 이름 자리는 뜯겨 나갔다.",
  },
  {
    id: "DEV_NOTE_02",
    이름: "압수 목록",
    분류: "기록",
    설명: "품목 다섯 줄 중 세 번째만 줄이 그어져 있다.",
  },
];
// ===== 실행 모드 =====
// ★ 이 값들은 파일 맨 위에 있어야 한다.
//   아래쪽 코드가 모듈이 읽히는 시점에 곧바로 쓰기 때문에(예: 텍스처배율),
//   선언이 뒤에 있으면 'Cannot access before initialization' 로 앱이 통째로 죽는다.
// [설계 원칙] 기본 동작은 지금과 100% 같게 두고, 주소 뒤에 붙는 값으로만 바꾼다.
//   조건이 URL 파라미터라 '내 화면이 저절로 달라질' 여지가 구조적으로 없다.
//
//   https://kgeseo.vercel.app          → 지금 그대로 (개발자용)
//   https://kgeseo.vercel.app/?q=low   → 저사양 모드 (팀원 배포용)
//   https://kgeseo.vercel.app/?leva=1  → 배포본에서도 Leva 열기
const 쿼리 =
  typeof location !== "undefined"
    ? new URLSearchParams(location.search)
    : new URLSearchParams();

// 로비 원본 실행은 그대로 두고 테스트 주소에서만 Sidekick을 지연 로드한다.
//   /?avatar=sidekick → 로비 1·3인칭 캐릭터 검증
// 일반 주소에서는 GLB와 모션 파일조차 내려받지 않는다.
// ?avatar=chibi → 치비 몸체 시제품(1단계 검토). 이동·시점·펀치 연결은 Sidekick 테스트와 같다.
// ?avatar=meshy → Meshy 민머리 기본 모델(같은 런타임·패널, 몸체 파일만 다름)
const 로비치비몸체 = 쿼리.get("avatar") === "meshy" ? "meshy" : "chibi";
const 로비치비테스트 = 쿼리.get("avatar") === "chibi" || 로비치비몸체 === "meshy";
const 로비아바타테스트 = 쿼리.get("avatar") === "sidekick" || 로비치비테스트;
// 로비 캐릭터 화면 연출 — 게임공간과 같은 스위치. ?toon=off · ?outline=off
const 로비툰끄기 = 쿼리.get("toon") === "off";
const 로비외곽선끄기 = 쿼리.get("outline") === "off";
const LobbySidekick = lazy(() =>
  import("../naju01/src/사이드킥게임아바타.jsx"),
);
// 캐릭터 꾸미기 패널도 테스트 주소에서만 불러온다. 로비 외형은 로비 출처(5173)의
// 브라우저 저장소에 따로 저장한다(naju01 5174와는 저장소가 나뉜다).
const LobbySidekickPanel = lazy(() =>
  import("../naju01/src/사이드킥꾸미기패널.jsx"),
);
const 로비외형저장키 = "kgeseo.lobby.sidekick.appearance.v2";
const LobbyChibi = lazy(() => import("../naju01/src/치비게임아바타.jsx"));
const LobbyChibiPanel = lazy(() => import("../naju01/src/치비테스트패널.jsx"));
const 로비메시저장키 = "kgeseo.lobby.meshy.appearance.v1";

// 저사양 모드 — 내장 GPU 노트북에서 화면이 검게 죽는 걸 막는다.
//   원인은 대부분 '그릴 픽셀 수'다. 아래 세 가지가 픽셀·메모리를 가장 많이 먹는다.
const 저사양 = 쿼리.get("q") === "low";

// Leva 패널 — 개발 서버(내 맥)에서는 항상 보이고, 배포본에서는 숨긴다.
//   import.meta.env.DEV 는 Vite가 넣어주는 값으로, npm run dev 일 때만 true다.
const LEVA보임 = import.meta.env.DEV || 쿼리.has("leva");

// ── 원인 격리용 스위치 (문제 생겼을 때만 쓴다) ──────────────
//   ?fx=off   후처리(Bloom·Vignette)를 통째로 끈다
//   ?zone=off 구역 컬링을 끈다(전부 항상 그린다)
//   기본값은 둘 다 켜짐이므로 평소 동작은 조금도 달라지지 않는다.
const 후처리끄기 = 쿼리.get("fx") === "off";
const 구역끄기 = 쿼리.get("zone") === "off";
//   ?fx=hi    후처리를 예전 고품질 설정(MSAA 8배 · 16비트)으로 되돌린다. 화질 비교용.
const 후처리고품질 = 쿼리.get("fx") === "hi";

// GLB 모델을 '메시 조각'으로 분해한다.
//   <primitive object={...}> 는 자식 JSX를 못 받아 외곽선을 붙일 수 없다.
//   → 조각마다 <mesh>로 다시 그리면 붙일 수 있다.
//     루트 기준 변환(위치·회전·크기)을 그대로 물려주므로 모양은 원본과 같다.
function GLB조각(root) {
  root.updateMatrixWorld(true);
  const 조각 = [];
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.matrixWorld.decompose(p, q, v);
    조각.push({
      name: o.name,
      geo: o.geometry,
      mat: o.material,
      p: p.toArray(),
      q: q.toArray(),
      s: v.toArray(),
    });
  });
  return 조각;
}

// 선제외   = 선을 두르지 않을 메시 이름들(전구처럼 스스로 빛나는 부품).
// 그림자받기 = false 면 이 물체 표면에 그림자를 안 받는다.
//   작고 굴곡진 물체는 그림자맵 해상도가 모자라 제 표면에 얼룩덜룩한
//   검은 조각(섀도 아크네)이 생긴다. 램프처럼 자잘한 물건은 꺼두는 게 깨끗하다.
function 조각그리기({ 조각, 선, 선제외, 그림자받기 = true }) {
  return 조각.map((c, i) => (
    <mesh
      key={i}
      geometry={c.geo}
      material={c.mat}
      position={c.p}
      quaternion={c.q}
      scale={c.s}
      castShadow
      receiveShadow={그림자받기}
    >
      <만화선 geo={c.geo} 선={선제외?.includes(c.name) ? null : 선} />
    </mesh>
  ));
}

// ===== 튜닝 값 (조작감 — 변경 없음) =====
// ── 배치 맞추기용 개발 시점 ─────────────────────────────
// true면 위에서 내려다보는 시점 + 마우스 드래그로 배치를 평면도처럼 확인.
//   배치 다 맞추면 false로 돌려 1인칭(T 시작)으로 복귀.
const TOP_VIEW = false;

// 눈높이(카메라 y). 아래 Leva "시점(눈높이)" 폴더에서 실시간으로 조절되며,
// 여기 값은 '시작값 + 슬라이더 기본값' 역할을 한다.
//   [이 씬의 축척] 책상 윗면이 y=2.44 이고 실제 책상 높이는 약 0.73m
//   → 1 유닛 ≈ 0.30m, 즉 1m ≈ 3.34 유닛.
//   그래서 사람 눈높이 1.65m ≈ 5.5 유닛. (기존 7은 키 2.1m에 해당해서 높았다)
// (이동 상수·눈높이는 공용.jsx 로 옮겼다 — 씬이 달라도 조작감은 같아야 한다)

// ===== 방 치수 (폐역 개조 — 가로·세로 축소) =====
const ROOM_W = 36, // x 폭 (40 → 36) — 줄인 4는 전부 '기차 쪽(+x)'에서만 뺀다
  ROOM_D = 26, // z 깊이 (28 → 26) — 줄인 2는 전부 '캐비닛 쪽(+z)'에서만 뺀다
  ROOM_H = 12; // 천장 높이

// ★ 방을 '한쪽에서만' 줄이기 위한 방 중심 보정값.
//   방 껍데기(바닥·천장·벽·몰딩)는 원점 대칭으로 그려져 있으므로,
//   그대로 두고 방 전체를 살짝 옮겨서 원하는 쪽 벽만 안으로 들어오게 한다.
//     왼쪽 벽  x = -20 (그대로) / 기차 쪽 열린 변 x = +20 → +16
//     앞쪽 벽  z = -14 (그대로) / 캐비닛 쪽 뒷벽    z = +14 → +12
const ROOM_CX = -20 + ROOM_W / 2; // = -2
const ROOM_CZ = -14 + ROOM_D / 2; // = -1
// 방 경계(플레이어가 넘어갈 수 없는 실제 벽 좌표)
const MIN_X = ROOM_CX - ROOM_W / 2,
  MAX_X = ROOM_CX + ROOM_W / 2,
  MIN_Z = ROOM_CZ - ROOM_D / 2,
  MAX_Z = ROOM_CZ + ROOM_D / 2;
// 컨셉: 버려진 기차역 + 숨겨진 수사본부.
//   전체는 칙칙하고 어두운 회청색(차가움·세월감), 장비/조명 쪽만 따뜻한 골드 포인트.
//   그림체(toon+외곽선)는 그대로 두고 '색과 명암'만 폐역 톤으로 눌렀다.
const P = {
  wall: "#5A626E", // 벽 — 칙칙한 회청색(빛바랜 콘크리트 느낌)
  wallLow: "#4C535E", // 벽 아랫단: 한 톤 더 어둡게(때 탄 아랫부분)
  struct: "#3E444E", // 구조 기둥 / 문틀 — 짙은 먹회색
  structDark: "#31363E", // 몰딩·걸레받이: 가장 어두운 먹색(모서리 선)
  ceiling: "#3A404A", // 천장 — 어둡고 낡은 평천장
  tile: "#6B6E73", // 바닥 타일 — 때 탄 회색
  tileAlt: "#63666B", // 타일 체커 반대 칸(미세한 얼룩 차이)
  tileLine: "#44474C", // 타일 줄눈 — 어둡게(먼지 낀 줄눈)
  ceilingFrame: "#464C56", // 천장 프레임(대들보) — 천장보다 살짝 밝게
  ceilingPanel: "#3A404A", // (구 채광창 잔여 참조용)
  door: "#5F5A54", // 문 — 낡은 베이지그레이
  gold: "#E0A94E", // 포인트 — 따뜻한 앰버(장비·조명 불빛)
  goldWarm: "#FFB35C", // 빛웅덩이용 진한 앰버
  glassTop: "#E4EDF8", // (유리 제거됨, 참조용 잔여)
  glassFloor: "#BFD2EC", // (유리 제거됨, 참조용 잔여)
  panel: "#4A505A", // 안내 패널 바탕 — 어두운 회청색
};
// 폐역 톤: 전체를 어둡게 눌러 세월감을 주되, 면끼리는 여전히 명도 차로 구분:
//   구조(가장 어두움) < 벽 굽 < 벽 < 바닥 타일 < 천장 프레임. 골드만 따뜻한 포인트.

// ===== 비밀 통로 상태 =====
// 왼쪽 벽(x = MIN_X) 한 칸이 밀려 열리면 그 뒤 복도로 나갈 수 있다.
// 이동 처리는 매 프레임 도는 useFrame 안에서 일어나므로, React state 로 두면
//   렌더가 계속 돌아 무겁다. → 모듈 바깥에 상자를 하나 두고 값만 갈아끼운다.
//   (Leva 값이 바뀔 때만 세팅을 호출한다)
const 통로 = (() => {
  let 값 = {
    열림: 0, // 0 = 닫힘, 1 = 완전히 열림
    문z: -4, // 밀리는 벽 칸의 중심 z
    문폭: 4.4,
    복도x0: -26.5, // 복도 바깥벽
    복도z0: -12,
    복도z1: 10,
    // 개발용 — 켜면 문 판정을 건너뛰고 방·복도를 자유롭게 오간다.
    //   퍼즐이 완성되면 끄고 '문 앞에서만 통과' 규칙으로 되돌린다.
    자유이동: false,
  };
  return {
    값: () => 값,
    세팅: (부분) => {
      값 = { ...값, ...부분 };
    },
  };
})();

// 통과 못 하는 구조물(xz). 벽은 clamp.
// 모서리 기둥 배치값 — 충돌 박스와 실제 메시가 어긋나지 않도록 한 곳에서 관리한다.
// (RoomShell의 모서리 기둥도 이 값을 그대로 쓴다)
const CORNER_INSET = 0.455; // 벽면에서 기둥 중심까지
const CORNER_SIZE = 0.8; // 기둥 한 변
const CORNER_BOXES = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
].map(([sx, sz]) => {
  const cx = ROOM_CX + sx * (ROOM_W / 2 - CORNER_INSET);
  const cz = ROOM_CZ + sz * (ROOM_D / 2 - CORNER_INSET);
  const h = CORNER_SIZE / 2;
  return { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
});

// ★ 충돌 박스는 '눈에 보이는 물체'에만 둔다.
//   메시 없이 박스만 남으면 로비 한가운데가 이유 없이 막힌다.
//   나중에 GLB 소품을 놓을 때 아래 값을 다시 넣으면 된다:
//     벤치          : { minX: 8.5,  maxX: 12.5, minZ: 5.4,   maxZ: 6.6  }
const COLLIDERS = [
  // 구조 기둥 1개 — Column x=8 z=0
  { minX: 7.2, maxX: 8.8, minZ: -0.8, maxZ: 0.8 },
  // 방 네 모서리 기둥
  ...CORNER_BOXES,
];
// ── 기차 문 판정 거리 ────────────────────────────────────────
//   세 개를 나눠 두는 이유:
//     열림 : 이만큼 다가오면 문이 스르륵 열리기 시작한다(연출)
//     진입 : 이 안이면 '문 안으로 들어섰다'고 보고 씬을 바꾼다
//     해제 : 기차에서 내린 뒤 이만큼 멀어져야 다시 들어갈 수 있다
//   ★ 해제 > 진입 이어야 한다. 같으면 문 앞에 내린 순간 다시 빨려 들어간다.
const 문열림거리 = 6.5;
const 문진입거리 = 2.0;
const 문잠금해제거리 = 3.4;
// ===== 동적 충돌 박스 =====
// [문제] COLLIDERS 는 기둥만 들어 있는 '고정 목록'이라, 의자·책상처럼
//   Leva 로 위치를 옮기는 물건은 충돌이 없었다. 그래서 물건 안으로 걸어 들어갔다.
//
// [왜 그게 위험한가]
//   카메라가 물체 '안'에 들어가면 외곽선(Outlines)이 문제가 된다.
//   외곽선은 원본을 살짝 부풀려 뒤집어 그린 껍데기(인버티드 헐)라서,
//   그 안에 들어가면 껍데기가 화면을 통째로 덮는다.
//   의자는 부위별로 쪼개져 있어 조각 수만큼 화면이 겹쳐 칠해진다(오버드로우 폭발).
//   → 한 프레임이 몇 초로 늘어나고, 윈도우는 2초를 넘기면 그래픽 드라이버를
//     강제 리셋한다(TDR) → 탭이 죽는다.
//   앉기(C)를 누르면 카메라가 딱 좌석 높이로 내려가 정확히 안으로 들어간다.
//
// [해결] 물건이 자기 충돌 박스를 스스로 등록하게 한다.
//   Leva 로 위치를 옮기면 박스도 같이 따라온다.
const 동적콜라이더 = new Map(); // 이름 -> {minX,maxX,minZ,maxZ}

// 중심 좌표와 반경으로 정사각 박스를 만든다.
//   회전하는 물건은 정확한 모서리 대신 '가장 긴 쪽 반지름'을 쓰면 충분하다.
function 원형박스(x, z, 반경, 높이) {
  return {
    minX: x - 반경,
    maxX: x + 반경,
    minZ: z - 반경,
    maxZ: z + 반경,
    // 높이를 안 주면 '천장까지 막힌 것'으로 본다(벽·기둥이 그렇다).
    ...(높이 === undefined ? {} : { minY: 0, maxY: 높이 }),
  };
}

// 컴포넌트가 살아 있는 동안만 박스를 등록한다.
function use충돌박스(이름, 박스, 켬 = true) {
  useEffect(() => {
    if (!켬 || !박스) return;
    동적콜라이더.set(이름, 박스);
    return () => {
      동적콜라이더.delete(이름);
    };
    // 박스 값이 바뀌면(=Leva로 옮기면) 다시 등록한다
  }, [이름, 켬, 박스 && 박스.minX, 박스 && 박스.maxX, 박스 && 박스.minZ, 박스 && 박스.maxZ]);
}

// ★ 배치(놓기·들기) 계산은 이 목록을 봐야 겹침·관통을 막을 수 있다.
//   배치.js 가 App.jsx 를 import 하면 서로 물고 물리므로, 반대로 여기서 넣어 준다.
월드박스공급(function* () {
  yield* COLLIDERS;
  yield* 동적콜라이더.values();
});

// 벽함 문의 겨냥 위치를 물어볼 때 돌려 쓰는 그릇
const _벽함점 = new THREE.Vector3();

const 상자안 = (c, x, z) =>
  x > c.minX - R && x < c.maxX + R && z > c.minZ - R && z < c.maxZ + R;

const hit = (x, z) => {
  for (const c of COLLIDERS) if (상자안(c, x, z)) return true;
  for (const c of 동적콜라이더.values()) if (상자안(c, x, z)) return true;
  return false;
};

// ── 반지름을 정해서 막힘을 묻는다 (끌고 가는 물건용) ────────────
// [왜 hit() 을 그대로 못 쓰나]
//   hit() 이 더해 주는 여유는 **플레이어 반지름 R(0.6)** 로 고정돼 있다.
//   의자는 반지름이 1.0 남짓이라, 중심이 성한 자리에 있어도 몸통은 이미
//   벽·책상 안에 들어가 있다. 그래서 '무엇이 지나가나'에 맞는 반지름을 받는다.
// [제외]
//   끌고 가는 자기 자신의 박스는 빼야 한다. 안 빼면 자기 박스에 자기가 막혀
//   첫 프레임에 굳는다.
const 막힘반경 = (x, z, r, 제외 = null) => {
  for (const c of COLLIDERS)
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r)
      return true;
  for (const [이름, c] of 동적콜라이더) {
    if (이름 === 제외) continue;
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r)
      return true;
  }
  return false;
};

// 벽에서 이만큼 안쪽까지는 걸레받이(두께 0.35)가 튀어나와 있다.
//   벽 자체는 충돌 박스가 아니라 '경계 사각형'으로 막으므로(usePlayer 의 경계),
//   벽 쪽은 박스 검사가 아니라 이 값으로 직접 가둬야 한다.
const 벽몰딩 = 0.36;

// ===== 자동 충돌체 =====
// [왜 자동으로 재는가]
//   물건마다 크기를 손으로 적어 넣으면, Leva 로 위치·크기를 바꿀 때마다 어긋난다.
//   그래서 화면에 그려진 실제 물체의 크기를 three 에게 직접 물어본다(Box3).
//   → 옮기든 키우든 충돌 박스가 알아서 따라온다.
//
// [쓰는 법] 막고 싶은 물건을 이걸로 감싸기만 하면 된다.
//   <충돌체 이름="desk0" 다시재기={`${x},${z},${회전}`}>  <Desk .../>  </충돌체>
//
// 이름은 물건마다 달라야 한다(같으면 서로 덮어쓴다).
function 충돌체({
  이름,
  켬 = true,
  여유 = 0.9,       // 실제 크기의 몇 %로 막을지. 1이면 딱 맞고, 낮출수록 헐렁하다
  최소높이 = 0.8,   // 이보다 낮은 물건은 막지 않는다(발끝에 걸리는 느낌이 나서)
  다시재기,          // 이 값이 바뀌면 크기를 다시 잰다(Leva 값들을 넣어준다)
  children,
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!켬) return;
    let 타이머 = null;
    let 남은시도 = 30; // 0.5초 간격으로 최대 15초까지 재시도

    // ★ 한 번만 재면 안 된다.
    //   GLB 모델은 파일을 내려받은 뒤에야 자식으로 붙는다. 그 전에 재면 크기가 0이다.
    //   또 three는 '화면을 그릴 때' 각 물체의 최종 위치(월드 행렬)를 계산하므로,
    //   그리기 전에 재면 위치가 원점(0,0,0)으로 나온다.
    //   → 직접 행렬을 갱신하고, 제대로 된 크기가 나올 때까지 다시 잰다.
    const 재기 = () => {
      const g = ref.current;
      if (!g) return false;
      g.updateWorldMatrix(true, true); // 나와 자식 전부의 최종 위치를 지금 계산
      const b = new THREE.Box3().setFromObject(g);
      if (b.isEmpty() || !isFinite(b.min.x)) return false;
      const 높이 = b.max.y - b.min.y;
      const 폭 = b.max.x - b.min.x;
      const 깊이 = b.max.z - b.min.z;
      if (폭 < 0.05 || 깊이 < 0.05) return false; // 아직 모델이 안 붙었다
      if (높이 < 최소높이) return true; // 납작한 물건 — 안 막고 끝낸다
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      동적콜라이더.set(이름, {
        minX: cx - (폭 / 2) * 여유,
        maxX: cx + (폭 / 2) * 여유,
        minZ: cz - (깊이 / 2) * 여유,
        maxZ: cz + (깊이 / 2) * 여유,
        // ★ 높이도 같이 남긴다.
        //   걸어다니는 판정(hit)은 예전처럼 x·z 만 보지만, **손에 든 물건**은
        //   책상 위를 지나갈 수 있어야 한다. 높이가 없으면 책상이 천장까지
        //   솟은 벽이 되어 컵을 들고 책상 앞에 서기만 해도 막힌다.
        minY: b.min.y,
        maxY: b.max.y,
      });
      return true;
    };

    const 시도 = () => {
      if (재기() || --남은시도 <= 0) return;
      타이머 = setTimeout(시도, 500);
    };
    // 첫 그리기가 끝난 뒤에 시작한다
    타이머 = setTimeout(시도, 100);

    return () => {
      clearTimeout(타이머);
      동적콜라이더.delete(이름);
    };
  }, [이름, 켬, 여유, 최소높이, 다시재기]);

  // 위치를 건드리지 않는 빈 group 이라 화면에는 아무 변화가 없다
  return <group ref={ref}>{children}</group>;
}

// 게임이 처리하는 키(브라우저 기본 동작을 막을 대상)
// (HANDLED 도 공용.jsx 로)

// ===== 1인칭 이동(관성 점프·앉기·충돌) — 변경 없음 =====
// 앉기: Ctrl = 누르고 있는 동안(FPS 표준) / C = 토글. 둘 중 하나라도 켜지면 앉는다.
// 역(승강장·복도) 전용 이동 규칙.
//   걷기·점프·앉기 같은 '조작감'은 공용.jsx 의 use이동 이 담당하고,
//   여기서는 이 씬에서만 통하는 규칙 세 가지만 넘겨 준다.
//     경계 — 방과 복도는 '문 앞'에서만 이어진다
//     막힘 — 기둥·가구 충돌 박스
//     근처 — 기차 문 같은 상호작용 지점
function usePlayer(
  active,
  onNear,
  eye = EYE,
  crouchEye = CROUCH_EYE,
  복귀,
  삼인칭 = false,
  플레이어참조 = null,
) {
  const onNearRef = useRef(onNear);
  onNearRef.current = onNear;

  const 경계 = useCallback((p) => {
    const 통 = 통로.값();
    // 통과 창 = 구멍 폭의 절반. 자유이동이면 '문 앞'인 척해 전부 풀린다.
    const 문안 =
      통.자유이동 || (통.열림 > 0.8 && Math.abs(p.z - 통.문z) < 통.문폭 / 2);
    const 복도안 = p.x < MIN_X;
    let xmin = MIN_X + R;
    let xmax = MAX_X - R;
    if (복도안 || 문안) xmin = 통.복도x0 + R;
    if (복도안 && !문안) xmax = MIN_X - R;

    const zmin =
      (통.자유이동 ? Math.min(MIN_Z, 통.복도z0) : 복도안 ? 통.복도z0 : MIN_Z) + R;
    const zmax =
      (통.자유이동 ? Math.max(MAX_Z, 통.복도z1) : 복도안 ? 통.복도z1 : MAX_Z) - R;
    return { xmin, xmax, zmin, zmax };
  }, []);

  const 근처 = useCallback((p) => {
    let n = "";
    // ★ 기차는 문이 여러 개다. 고정 좌표 하나로 판정하면 칸을 늘리거나
    //   기차를 옮겼을 때 어긋난다 → 실제로 그려진 문 목록에서 가장 가까운 것을 찾는다.
    //   어느 문이든 들어가는 곳은 같은 객차 안이다(들어간 칸만 기억해 둔다).
    const 문 = 기차문.가까운문상세(p.x, p.z);
    // 연출용 — 문짝이 이 값을 보고 열리고 닫힌다
    문상태.칸 = 문 ? 문.칸 : null;
    문상태.거리 = 문 ? 문.거리 : Infinity;
    // 충분히 멀어졌으면 재진입 잠금을 푼다
    if (!문 || 문.거리 > 문잠금해제거리) 진입잠금.켬 = false;

    if (문 && 문.거리 < 문진입거리 && !진입잠금.켬) {
      // 문 안으로 들어섰다 → 키를 누르지 않아도 넘어간다
      들어간문.칸 = 문.칸;
      들어간문.위치 = { x: 문.x, z: 문.z };
      n = "train진입";
    } else if (문 && 문.거리 < NEAR) {
      // 아직 문 앞. [E] 로도 탈 수 있게 예전 방식을 남겨 둔다
      들어간문.칸 = 문.칸;
      들어간문.위치 = { x: 문.x, z: 문.z };
      n = "train";
    }
    onNearRef.current(n);
    return n;
  }, []);

  use이동(active, {
    눈높이: eye,
    앉은높이: crouchEye,
    경계,
    막힘: hit,
    근처,
    // 복귀가 있을 때만 자리를 옮긴다. 평소(처음 접속)에는 건드리지 않는다.
    시작: 복귀?.시작,
    바라봄: 복귀?.바라봄,
    삼인칭,
    플레이어참조,
    삼인칭거리: 2.8,
  });
}

// ===== 텍스처 유틸 =====
// 이미지 파일 없이 코드로 텍스처를 만든다.
// ★ 여기서 그림자/음영을 절대 그리지 않는다. 명암은 전부 실시간 조명에서만 나온다.
// ★ 저사양 모드에서만 캔버스 해상도를 절반으로 떨어뜨린다.
//   텍스처 1장이 GPU 메모리에서 차지하는 크기 = 가로 × 세로 × 4바이트 × 1.33(밉맵).
//     1024×1024 → 5.32 MB
//      512× 512 → 1.33 MB      ← 가로세로가 반이면 넓이는 1/4, 메모리도 1/4
//   내장 GPU 노트북은 이 메모리를 시스템 램에서 빌려 쓰기 때문에,
//   여기가 크면 로딩이 길어지고 화면 전환 때 컨텍스트가 날아가 검게 변한다.
//
//   그리는 코드는 전부 S(= 실제 캔버스 크기)를 기준으로 좌표를 잡으므로,
//   size 하나만 줄이면 그림 자체는 똑같이 그려지고 해상도만 낮아진다.
//   ⚠ 일반 모드(랑의 화면)는 배율 1 — 1px도 안 바뀐다.
// ★ 벽·바닥·천장 캔버스 질감은 공용.jsx 로 옮겼다.
//   기차 안도 같은 질감을 써야 한 세계로 보이기 때문이다.
//   (코드는 그대로 옮겼을 뿐이라 역의 결과물은 하나도 안 바뀐다)

// ── 반복을 흐트러뜨리는 큰 얼룩 (정점 색) ────────────────────
// 텍스처는 몇 유닛마다 되풀이되므로 그것만 쓰면 무늬가 눈에 띈다.
//   여기서 만드는 얼룩은 벽/바닥 한 장에 딱 한 번만 생겨 반복을 깨 준다.
//   (캐비닛의 얼룩입히기와 같은 방식 — UV가 없어도 되고 toon 색에 그대로 곱해진다)
function 면얼룩(
  geo,
  seed,
  { 개수 = 16, 세기 = 0.5, 세로늘림 = 1, 아래때 = 0, 높이기준 = 0 } = {},
) {
  const rnd = makeRandom(seed + 777);
  const pos = geo.attributes.position;
  const n = pos.count;
  const dark = new Float32Array(n);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const W = bb.max.x - bb.min.x,
    H = bb.max.y - bb.min.y;

  for (let k = 0; k < 개수; k++) {
    const cx = bb.min.x + rnd() * W;
    const cy = bb.min.y + rnd() * H;
    const R = W * (0.03 + rnd() * 0.1);
    const 세 = 0.3 + rnd() * 0.8;
    for (let i = 0; i < n; i++) {
      const dx = pos.getX(i) - cx;
      const dy = (pos.getY(i) - cy) / 세로늘림; // 세로로 늘리면 흘러내린 자국이 된다
      const d = Math.hypot(dx, dy);
      if (d >= R) continue;
      const t = 1 - d / R;
      dark[i] += t * t * 세;
    }
  }

  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // 바닥에 가까울수록 때가 탄다(벽에서만 쓴다)
    if (아래때) {
      const wy = pos.getY(i) + 높이기준;
      dark[i] += Math.max(0, 1 - wy / 아래때) * 1.1;
    }
    const f = 1 - Math.min(0.4, dark[i] * 세기);
    col[i * 3] = f;
    col[i * 3 + 1] = f * 0.995;
    col[i * 3 + 2] = f * 0.985; // 얼룩은 아주 살짝 누렇게
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

// 벽 한 장 — 블록 텍스처 + 반복 안 되는 정점 얼룩
//   y0 = 이 벽 조각의 '아랫변' 높이. UV를 그만큼 밀어 위·아래 조각의 블록 줄을 잇는다.
function WallPanel({
  w,
  h,
  y0,
  color,
  seed,
  얼룩 = 0.5,
  낡음 = 0.7,
  xOff = 0,
}) {
  const tex = 벽텍스처(seed, 낡음);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      w,
      h,
      Math.max(2, Math.round(w / 1.2)),
      Math.max(2, Math.round(h / 1.2)),
    );
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      // ★ UV 도 xOff 만큼 민다. 벽을 여러 조각으로 쪼개도 벽돌 무늬가 이어진다.
      //   (안 밀면 조각마다 무늬가 처음부터 다시 시작해 이음매가 티 난다)
      uv.setX(i, uv.getX(i) * (w / WALL_TEX_W) + (xOff - w / 2) / WALL_TEX_W);
      uv.setY(i, uv.getY(i) * (h / WALL_TEX_H) + y0 / WALL_TEX_H);
    }
    면얼룩(g, seed + Math.round(w * 10) + y0, {
      개수: 18,
      세기: 얼룩,
      세로늘림: 2.6, // 벽 얼룩은 세로로 흘러내린 모양
      아래때: 3.2,
      높이기준: y0 + h / 2,
    });
    return g;
  }, [w, h, y0, seed, 얼룩, xOff]);
  useEffect(() => () => geo.dispose(), [geo]);

  return (
    <mesh position={[xOff, y0 + h / 2, 0]} geometry={geo} receiveShadow>
      <meshToonMaterial
        color={color}
        map={tex}
        gradientMap={TOON_GRADIENT}
        vertexColors
      />
    </mesh>
  );
}

// ===== 방 껍데기(구조 인지용) =====
// 벽을 한 바퀴 도는 띠(걸레받이/허리몰딩/코니스). 면과 면 사이에 '선'을 만든다.
// ★ 규칙: 서로 겹쳐 놓이는 입체는 '같은 평면을 공유하는 면'이 하나도 없어야 한다.
//   같은 위치의 면 두 장이 겹치면 GPU가 앞뒤를 못 정해 체커보드 무늬(z-fighting)가 난다.
//   아래 값들은 몰딩 3종 / 부축기둥 / 모서리 기둥의 앞·뒤·윗면이 전부 어긋나도록 잡았다.
//
// WALL_GAP: 벽면에서 살짝 띄우는 간격.
// 0이면 장식의 뒷면이 벽 평면과 정확히 같은 위치가 된다. 본 렌더에서는 뒷면이 컬링돼
// 안 보이지만 그림자 맵에는 그대로 들어가서, 벽 위쪽 경계에 지글거리는 줄이 생긴다.
const WALL_GAP = 0.03;
// 문 자리에서 몰딩(걸레받이·허리선)을 끊기 위한 헬퍼.
//   벽에 구멍을 뚫어도 그 앞을 몰딩이 가로지르면 '문 위에 막대가 걸친' 꼴이 된다.
//   그래서 몰딩 막대 하나를 '구멍 왼쪽 토막 + 오른쪽 토막' 두 개로 쪼갠다.
//   반환값: [{ 중심, 길이 }, ...]  (막대 방향 축 기준)
function 막대쪼개기(전체길이, 구멍중심, 구멍폭) {
  const 반 = 전체길이 / 2;
  if (구멍폭 <= 0) return [{ 중심: 0, 길이: 전체길이 }];
  const a0 = 구멍중심 - 구멍폭 / 2; // 구멍 시작
  const a1 = 구멍중심 + 구멍폭 / 2; // 구멍 끝
  const out = [];
  if (a0 > -반 + 0.05) out.push({ 중심: (-반 + a0) / 2, 길이: a0 - -반 });
  if (a1 < 반 - 0.05) out.push({ 중심: (a1 + 반) / 2, 길이: 반 - a1 });
  return out;
}

function Rail({ y, h, d, color = P.structDark, 선, 구멍 }) {
  const long = [-1, 1].map((s) => [0, y, s * (ROOM_D / 2 - d / 2 - WALL_GAP)]);
  // 폐역 개조: 오른쪽(+x)은 기차 자리라 벽이 없으므로 왼쪽(-1) 몰딩만 둔다
  const short = [-1].map((s) => [s * (ROOM_W / 2 - d / 2 - WALL_GAP), y, 0]);
  // 왼쪽 벽 몰딩은 z 방향으로 길다 → 구멍도 z 좌표로 잘라낸다.
  const 짧은길이 = ROOM_D - 2 * d;
  const 토막 = 구멍
    ? 막대쪼개기(짧은길이, 구멍.z, 구멍.폭)
    : [{ 중심: 0, 길이: 짧은길이 }];
  return (
    <group>
      {long.map((p, i) => (
        <mesh key={`l${i}`} position={p} castShadow receiveShadow>
          <boxGeometry args={[ROOM_W, h, d]} />
          <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
          {선?.몰딩선 && (
            <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
          )}
        </mesh>
      ))}
      {short.map((p, i) =>
        토막.map((t, j) => (
          <mesh
            key={`s${i}-${j}`}
            position={[p[0], p[1], t.중심]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[d, h, t.길이]} />
            <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
            {선?.몰딩선 && (
              <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
            )}
          </mesh>
        )),
      )}
    </group>
  );
}

function RoomShell({ 선, 문 }) {
  // 문 구멍(월드 z) → RoomShell 그룹의 로컬 z 로 변환.
  //   이 그룹은 z 축으로 ROOM_CZ 만큼 밀려 있으므로 그만큼 빼준다.
  //   여유 0.3 을 더해 몰딩이 문설주에 딱 붙지 않게 한다.
  const 구멍 = 문 ? { z: 문.z - ROOM_CZ, 폭: 문.폭 + 0.3 } : null;
  // 몰딩 높이가 문 높이보다 낮을 때만 끊는다(천장선은 문 위라 그대로 둔다).
  const 끊기 = (y) => (문 && y < 문.높이 ? 구멍 : null);
  return (
    // 방을 한쪽에서만 줄이기 위한 이동(ROOM_CX/ROOM_CZ 주석 참고)
    <group position={[ROOM_CX, 0, ROOM_CZ]}>
      {/* 바닥선 / 허리선 / 천장선 */}
      <Rail y={0.35} h={0.7} d={0.35} 선={선} 구멍={끊기(0.35)} />
      <Rail y={4} h={0.3} d={0.25} 선={선} 구멍={끊기(4)} />
      <Rail
        y={11.7}
        h={0.55}
        d={0.4}
        color={P.ceilingFrame}
        선={선}
        구멍={끊기(11.7)}
      />

      {/* 모서리 기둥 — 폐역 개조: 오른쪽은 기차 자리라 왼쪽 2개만 */}
      {[
        [-1, -1],
        [-1, 1],
      ].map(([sx, sz], i) => (
        <mesh
          key={i}
          /* 뒷면이 몰딩 뒷면(15.97 / 23.97)과 겹치지 않도록 0.44로 밀고,
             윗면도 천장 평면(y=12)에서 떼어낸다. */
          position={[
            sx * (ROOM_W / 2 - CORNER_INSET),
            (ROOM_H - 0.06) / 2,
            sz * (ROOM_D / 2 - CORNER_INSET),
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[CORNER_SIZE, ROOM_H - 0.06, CORNER_SIZE]} />
          <meshToonMaterial color={P.struct} gradientMap={TOON_GRADIENT} />
          {선?.외곽선 !== false && (
            <Outlines
              thickness={선?.외곽선굵기 ?? OUTLINE_THICK}
              color={선?.외곽선색 ?? OUTLINE_COLOR}
            />
          )}
        </mesh>
      ))}

      {/* 앞/뒤 벽 부축기둥 — 폐역 개조: 방 폭(40)에 맞추고, 오른쪽 끝(기차 자리)은 뺀다 */}
      {[-16, -8, 0].flatMap((x) =>
        [-1, 1].map((s) => (
          <mesh
            key={`${x}:${s}`}
            /* 코니스 몰딩(두께 0.4, 앞면 15.57)과 앞면이 정확히 겹쳐 체커보드가
               생겼다. 기둥이 몰딩보다 더 튀어나오도록 두껍게(0.55) 만들어 앞면을
               15.435로 밀고, 뒷면도 15.985로 몰딩(15.97)과 어긋나게 뒀다.
               높이도 11.94로 줄여 윗면이 천장 평면(y=12)과 겹치지 않게 한다. */
            position={[
              x,
              (ROOM_H - 0.06) / 2,
              s * (ROOM_D / 2 - 0.275 - 0.015),
            ]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1.4, ROOM_H - 0.06, 0.55]} />
            <meshToonMaterial color={P.struct} gradientMap={TOON_GRADIENT} />
            {선?.외곽선 !== false && (
              <Outlines
                thickness={선?.외곽선굵기 ?? OUTLINE_THICK}
                color={선?.외곽선색 ?? OUTLINE_COLOR}
              />
            )}
          </mesh>
        )),
      )}
    </group>
  );
}

// ===== 구조 기둥 =====
function Column({ x, z, 선 }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.7, 0.8, 12, 20]} />
        <meshToonMaterial color={P.struct} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 !== false && (
          <Outlines
            thickness={선?.외곽선굵기 ?? OUTLINE_THICK}
            color={선?.외곽선색 ?? OUTLINE_COLOR}
          />
        )}
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 0.6, 20]} />
        <meshToonMaterial color={P.structDark} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 !== false && (
          <Outlines
            thickness={선?.외곽선굵기 ?? OUTLINE_THICK}
            color={선?.외곽선색 ?? OUTLINE_COLOR}
          />
        )}
      </mesh>
      <mesh position={[0, 11.8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 0.9, 0.5, 20]} />
        <meshToonMaterial color={P.structDark} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 !== false && (
          <Outlines
            thickness={선?.외곽선굵기 ?? OUTLINE_THICK}
            color={선?.외곽선색 ?? OUTLINE_COLOR}
          />
        )}
      </mesh>
    </group>
  );
}

// ===== 철제 사무 책상 (Meshy GLB, 최적화) =====
// 원본: 폭 1.89 · 높이 1.24 · 깊이 0.91 (min_y=-0.62)
// 바닥(min_y)을 방 바닥 y=0에 맞추려면 y를 (0.62 × scale)만큼 올린다.
useGLTF.preload("/models/desk.glb");
useGLTF.preload("/models/pc_monitor.glb"); // 모니터만 (키보드·마우스 잘라냄)
useGLTF.preload("/models/keyboard.glb"); // 따로 뽑은 키보드
useGLTF.preload("/models/mouse.glb"); // 따로 뽑은 마우스

// 책상 위 컴퓨터 — 원래 pc.glb 는 [모니터 + 키보드 + 마우스]가 한 덩어리였다.
//   그래서 키보드·마우스 쪽에 폴리곤이 모자라 뭉개져 보였다.
//   → pc.glb 를 z=0.1 에서 잘라 '모니터만' 남긴 것이 pc_monitor.glb.
//     자를 때 좌표계를 손대지 않았으므로 기존에 맞춰 둔 위치·크기·회전 값이 그대로 산다.
//   키보드·마우스는 Meshy 로 따로 뽑아 정규화했다.
//     keyboard.glb : 가로폭 = 1.0 · 밑면 = y 0 · 좌우앞뒤 중앙 · 낮은 앞턱이 +Z
//     mouse.glb    : 길이   = 1.0 · 밑면 = y 0 · 좌우앞뒤 중앙 · 휠·케이블 쪽이 +Z
//   ※ '1.0 으로 정규화' = 모델의 한 변을 정확히 1 유닛으로 맞춰 둔다는 뜻.
//      그러면 Leva 의 크기 슬라이더 값이 곧 '월드 유닛 길이'가 되어 감이 잡힌다.
//      이 씬은 1 유닛 ≈ 0.30m 이므로 실제 키보드 44cm ≈ 1.45, 마우스 11cm ≈ 0.37.
const PC_SCALE = 1.6; // 책상 위에 적당한 크기

// GLB 하나를 '툰 재질로 칠한 조각 목록'으로 바꿔 주는 공용 훅.
//   같은 일(clone → 재질 교체 → GLB조각)을 모니터·키보드·마우스에서 세 번 하므로
//   훅으로 묶었다. useMemo 덕분에 색이 안 바뀌면 다시 만들지 않는다.
function useToon조각(경로, color) {
  const { scene } = useGLTF(경로);
  const model = useMemo(() => {
    const cloned = scene.clone(true); // 원본을 공유하면 색이 서로 물든다 → 복제
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = new THREE.MeshToonMaterial({
          color,
          gradientMap: TOON_GRADIENT, // 3단 셀 셰이딩 계단 텍스처
        });
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return cloned;
    // color가 바뀌면 다시 칠한다(의존성에서 빠지면 색이 안 먹는다)
  }, [scene, color]);
  // 모델을 조각으로 나눠 그린다 — 그래야 조각마다 외곽선·주름선을 붙일 수 있다.
  return useMemo(() => GLB조각(model), [model]);
}

// 책상 한 자리 = 모니터 + 키보드 + 마우스 한 세트.
//   바깥 group 하나로 세 물건을 '같이' 회전시키고,
//   안쪽에서 물건마다 따로 위치·회전·크기를 준다.
//   → 책상을 돌려도 키보드·마우스가 모니터를 따라 같이 돈다.
// sizeMul = 세트마다 따로 주는 크기 배수(모니터에만 적용).
//   모니터 최종 크기 = PC_SCALE(1.6) × 공통크기 × 개별크기
//   → 공통 슬라이더로 둘 다 한꺼번에, 개별 슬라이더로 하나만 조절할 수 있다.
function PcSet({
  pos = [0, 0],
  rot = 0,
  scale = 1,
  y = 2.0,
  sizeMul = 1,
  color = "#3a3d42", // Leva "컴퓨터(공통·색) → 색"에서 넘어온다
  선,
}) {
  const [x, z] = pos;
  const 모니터조각 = useToon조각("/models/pc_monitor.glb", color);

  return (
    // 이 group 은 크기를 건드리지 않는다(scale 없음).
    //   회전축이 [x, 0, z] 든 [x, y, z] 든 Y축 회전에서는 결과가 같으므로
    //   예전 배치 값(x·z·회전)이 그대로 유효하다.
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* ── 모니터 — 예전 값 그대로 (건드리면 맞춰 둔 배치가 틀어진다) ── */}
      <group position={[0, y, 0]} scale={PC_SCALE * scale * sizeMul}>
        <조각그리기 조각={모니터조각} 선={선} />
      </group>

      {/* 키보드·마우스는 여기 없다 — 아래 <키보드>·<마우스> 로 떼어냈다.
          들어서 옮길 수 있으려면 자기 자리를 스스로 가져야 하는데,
          여기 있으면 좌표가 '모니터 기준 상대값'이라 책상 저쪽에 내려놓는 순간
          기준이 사라진다. */}
    </group>
  );
}

// ===== 키보드 · 마우스 (독립 물건) =====
// [왜 PcSet 에서 떼어냈나]
//   들었다 놓을 수 있게 하려면 **월드 좌표를 스스로 가져야** 한다.
//   PcSet 안에서는 좌표가 모니터 기준 상대값이라, 옮긴 뒤에는 기준이 없어진다.
//   제자리는 아래 붙인자리() 가 예전과 똑같이 계산해 넘기므로 배치는 안 바뀐다.
function 키보드({ pos = [0, 0], y = 0, rot = 0, KB, 선 }) {
  const [x, z] = pos;
  const 조각 = useToon조각("/models/keyboard.glb", KB?.색 ?? "#2c2f34");
  const k = KB?.크기 ?? 1.55;
  return (
    <group
      position={[x, y, z]}
      rotation={[0, rot, 0]}
      // 축마다 다른 배율 — PcSet 안에 있을 때와 같은 값이라야 모양이 안 바뀐다
      scale={[k, k * (KB?.두께 ?? 0.5), k * (KB?.깊이 ?? 0.83)]}
    >
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

function 마우스({ pos = [0, 0], y = 0, rot = 0, MS, 선 }) {
  const [x, z] = pos;
  const 조각 = useToon조각("/models/mouse.glb", MS?.색 ?? "#2c2f34");
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={MS?.크기 ?? 0.37}>
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

// 모니터 기준 상대 좌표(좌우·앞뒤·높이·회전)를 월드 좌표로 편다.
//   PcSet 의 그룹 구조 — 바깥 [x,0,z]·rot → 안쪽 [좌우, 높이+오프셋, 앞뒤]·회전 —
//   과 **같은 결과**가 나와야 한다. Y축 회전 하나뿐이라 식으로 정확히 풀린다.
//   (three 의 Y 회전: (lx,lz) → (lx·cos+lz·sin, −lx·sin+lz·cos))
const 붙인자리 = (p, o) => ({
  x: p.x + o.좌우 * Math.cos(p.회전) + o.앞뒤 * Math.sin(p.회전),
  z: p.z - o.좌우 * Math.sin(p.회전) + o.앞뒤 * Math.cos(p.회전),
  높이: p.높이 + o.높이,
  회전: p.회전 + o.회전,
});

// ===== 사무용 의자 (chair.glb) =====
// 부위 5개(base/column/seat/arms/back), 전부 단위행렬 루트.
// 모델 실측: 폭 1.27 · 높이 1.90 · 깊이 1.30, 밑면이 이미 y=0 → 바닥에 그대로 놓인다.
//   책상 윗면이 약 2.0이라 등받이가 그보다 조금 높게 오도록 1.6배로 잡았다
//   (1.90 × 1.6 ≈ 3.05). 미세 조정은 Leva '의자(공통)' 크기로.
useGLTF.preload("/models/chair.glb");
const CHAIR_SCALE = 1.6;

function Chair({
  pos = [0, 0],
  rot = 0,
  y = 0,
  scale = 1,
  sizeMul = 1,
  color = "#43474e",
  선,
  이름 = "chair",
  충돌 = true,
}) {
  const [x, z] = pos;

  // ── 충돌 박스 ────────────────────────────────────────────
  //   모델 실측 폭 1.27 · 깊이 1.30 → 가장 긴 쪽의 절반이 0.65.
  //   여기에 실제 배율(CHAIR_SCALE × 공통크기 × 개별크기)을 곱한다.
  //   0.85 를 더 곱해 살짝 줄였다 — 딱 맞추면 의자 옆을 지날 때 걸리는 느낌이 난다.
  //   플레이어 반지름 R(0.6)은 hit() 안에서 따로 더해진다.
  const 반경 = 0.65 * CHAIR_SCALE * scale * sizeMul * 0.85;
  // 모델 실측 높이 1.90 에 실제 배율을 곱한 것 — 등받이 꼭대기까지다.
  const 의자높이 = 1.9 * CHAIR_SCALE * scale * sizeMul;
  const 박스 = useMemo(
    () => 원형박스(x, z, 반경, 의자높이),
    [x, z, 반경, 의자높이],
  );
  use충돌박스(이름, 박스, 충돌);

  const { scene } = useGLTF("/models/chair.glb");
  const model = useMemo(() => {
    // 원본을 직접 고치면 useGLTF 캐시가 오염돼 5개가 같이 바뀐다 → 복제 후 칠한다
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = new THREE.MeshToonMaterial({
          color,
          gradientMap: TOON_GRADIENT,
        });
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return cloned;
  }, [scene, color]);
  // 모델을 조각으로 나눠 그린다 — 그래야 조각마다 외곽선·주름선을 붙일 수 있다.
  const 조각 = useMemo(() => GLB조각(model), [model]);
  return (
    <group
      position={[x, y, z]}
      rotation={[0, rot, 0]}
      scale={CHAIR_SCALE * scale * sizeMul}
    >
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

// ===== 화이트보드 손글씨 폰트 =====
// 폰트 '등록'은 src/fonts.css 의 @font-face 가 한다(main.jsx에서 import).
//   public/fonts/eonggeongkwi.woff2  →  font-family "엉겅퀴" (나눔손글씨 엉겅퀴체)
//
// ★ 폴백을 반드시 붙인다.
//   엉겅퀴체에는 「」 · … — 같은 기호 글리프가 없다. 폰트 폴백은 '글자 하나 단위'로
//   동작하므로, 없는 기호만 뒤쪽 시스템 폰트로 그려져 두부(□)를 피할 수 있다.
//   보드 제목이 「왜곡」합동수사본부 라서 이게 없으면 바로 깨진다.
const BOARD_FONT_FAMILY =
  '"엉겅퀴","Apple SD Gothic Neo","Malgun Gothic",sans-serif';

let boardFontReady = null;
function loadBoardFont() {
  if (!boardFontReady) {
    // canvas의 fillText는 '이미 다운로드가 끝난' 폰트만 쓴다.
    // @font-face는 선언만 해두는 것이라, 여기서 실제 로드를 시켜야 한다.
    boardFontReady = document.fonts
      .load('400 60px "엉겅퀴"')
      .then(() => document.fonts.ready)
      .catch(() => false); // 실패해도 폴백 폰트로 그려지게 둔다
  }
  return boardFontReady;
}

// 손으로 쓴 느낌용 흔들림 — 고정 시드라 새로고침해도 같은 모양이 나온다.
function handRng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296 - 0.5; // -0.5 ~ 0.5
  };
}

// ===== 수사 화이트보드 (코드로 생성 — GLB 없음) =====
// 「왜곡」합동수사본부 브리핑 보드. 판 앞면 그림은 캔버스에 직접 그려 텍스처로 쓴다.
//   · 다리 달린 이동식 보드 형태(세로 기둥 2 + 가로대 + 발).
//   · 레퍼런스에 있던 '분필'과 '물방울(원 2개)'은 요청대로 넣지 않았다.
//   · 글씨는 브라우저 시스템 한글 폰트로 그린다(별도 폰트 파일 불필요).
const BOARD_W = 5.0; // 판 가로(유닛) ≈ 1.8m
const BOARD_H = 3.0; // 판 세로 ≈ 1.1m
const BOARD_LIFT = 1.7; // 판 아랫변 높이(다리 길이)

// 보드 그림 — 캔버스에 직접 그린다. 가로세로 비율은 판과 같게(5:3).
// 판 그림을 캔버스에 그린다. 폰트가 준비되기 전/후 두 번 호출된다.
function drawBoard(c) {
  const W = c.width,
    H = c.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  // 폰트가 아직 안 왔으면 폴백(시스템 고딕)으로 그려지고, 로드 후 다시 그려진다
  const KR = BOARD_FONT_FAMILY;
  const ink = "#2B3038";
  const navy = "#3C4A63";
  const red = "#C0392B";
  const blue = "#3D5A9E";
  const green = "#7BAE5B";

  const rnd = handRng(20260827); // 흔들림용 — 매번 같은 결과
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#F3F1EA";
  g.fillRect(0, 0, W, H);
  g.lineJoin = "round";
  g.lineCap = "round";

  // 글씨 — 한 덩어리씩 아주 살짝 기울이고 흔들어 '손으로 쓴' 티를 낸다.
  //   손글씨 폰트는 글자가 작게 나와서 크기를 1.25배 키운다.
  const text = (t, x, y, size, color = ink, weight = "400", align = "left") => {
    g.save();
    g.translate(x + rnd() * 3, y + rnd() * 3);
    g.rotate(rnd() * 0.016); // ±0.5°
    g.font = `${weight} ${Math.round(size * 1.25)}px ${KR}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = "alphabetic";
    g.fillText(t, 0, 0);
    g.restore();
  };

  // 선 — 자로 대고 그은 듯한 직선 대신 살짝 휘게 그린다.
  const line = (x1, y1, x2, y2, color, w = 2) => {
    const dx = x2 - x1,
      dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len,
      ny = dx / len; // 선에 수직인 방향
    const seg = Math.max(2, Math.min(9, Math.round(len / 90)));
    const amp = Math.min(3.5, 1 + len / 260); // 길수록 조금 더 흔들림
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const off = i === 0 || i === seg ? 0 : rnd() * amp * 2;
      const px = x1 + dx * t + nx * off;
      const py = y1 + dy * t + ny * off;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
  };

  // 사각형 — 네 변을 손으로 그은 선으로
  const rect = (x, y, w, h, color, lw = 3) => {
    line(x, y, x + w, y, color, lw);
    line(x + w, y, x + w, y + h, color, lw);
    line(x + w, y + h, x, y + h, color, lw);
    line(x, y + h, x, y, color, lw);
  };

  // 원 — 반지름을 미세하게 흔들어 완벽한 원이 아니게
  const circle = (cx0, cy0, r, color, lw = 3, from = 0, to = Math.PI * 2) => {
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.beginPath();
    const steps = 44;
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      // 양쪽으로 흔든다(한쪽으로만 흔들면 원이 커지기만 하고 삐뚤어지진 않는다)
      const rr = r + (rnd() - 0.5) * (r * 0.075);
      const px = cx0 + Math.cos(a) * rr,
        py = cy0 + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
  };
  const dot = (x, y, r, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  // ── 헤더 ──────────────────────────────────────────────
  text("「왜곡」합동수사본부", 46, 88, 64, ink, "700");
  line(46, 112, 720, 112, ink, 6);
  g.fillStyle = navy;
  g.fillRect(770, 26, W - 770 - 40, 80);
  text(
    "Case 01 나주 브리핑 : 완사천 전승 왜곡 사건",
    800,
    82,
    40,
    "#F3F1EA",
    "600",
  );

  line(470, 140, 470, H - 46, "#C9C6BD", 3);
  line(1478, 140, 1478, H - 46, "#C9C6BD", 3);

  // ── 왼쪽 칼럼 ─────────────────────────────────────────
  text("수사 개시 : 2026.08.25", 46, 180, 36, ink, "600");
  line(46, 196, 430, 196, ink, 3);

  text("나주 미니 왜곡 지도", 60, 268, 34, ink, "600");
  rect(46, 292, 400, 300, ink, 3);
  const mcx = 220,
    mcy = 448;
  [
    [80, 340],
    [410, 350],
    [95, 545],
    [415, 535],
    [270, 315],
    [320, 570],
  ].forEach(([x, y], i) => {
    line(mcx, mcy, x, y, i % 2 ? blue : red, 2);
    dot(x, y, 5, ink);
  });
  line(62, 390, 432, 500, green, 9);
  circle(mcx, mcy, 38, red, 4);
  text("나주통상", 110, 336, 20, ink);
  text("나주통장", 54, 540, 20, ink);
  text("1:2,500", 356, 580, 20, "#7A7770");

  text("수사 가설 타임라인", 46, 690, 36, ink, "600");
  line(46, 706, 430, 706, ink, 3);
  [
    "의도적인 정보 은폐?",
    "시간에 의한 정보 소실?",
    "우연한 기록 오류?",
    "전승 간의 모순?",
  ].forEach((t, i) => {
    const y = 782 + i * 84;
    dot(70, y - 11, 21, navy);
    text(String(i + 1), 70, y - 2, 26, "#F3F1EA", "700", "center");
    text(t, 104, y, 30, ink);
  });
  text("(예: A, B판본 vs. C판본)", 104, 1148, 24, "#7A7770");

  // ── 가운데 지도 ───────────────────────────────────────
  text("사건 발생 : 20XX년 X월 X일", 520, 180, 36, ink, "600");
  text("(추정 왜곡 시점)", 906, 178, 24, "#7A7770");
  const cx = 960,
    cy = 560;
  g.strokeStyle = "#B9CBDA";
  g.lineWidth = 44;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(560, 250);
  g.quadraticCurveTo(900, 470, 1120, 560);
  g.quadraticCurveTo(1290, 630, 1400, 790);
  g.stroke();

  g.strokeStyle = green;
  g.globalAlpha = 0.5;
  line(640, 690, 1330, 330, green, 16);
  line(690, 320, 1350, 700, green, 16);
  g.globalAlpha = 1;

  const nodes = [
    [690, 270, "나주문장", blue],
    [1090, 232, "나주통상", green],
    [1300, 288, "공사산", red],
    [1372, 462, "영산산", green],
    [1338, 742, "명산통", blue],
    [634, 500, "나주문장", red],
    [830, 806, "", blue],
    [1170, 838, "", red],
  ];
  nodes.forEach(([x, y, label, col]) => {
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo((cx + x) / 2 + 34, (cy + y) / 2 - 34, x, y);
    g.stroke();
    dot(x, y, 9, "#4A4F58");
    if (label) text(label, x + 16, y + 8, 24, ink, "600");
  });

  // 손으로 친 동그라미 하나. 한 바퀴보다 조금 더 돌려 시작·끝이 겹치게 한다
  //   — 실제로 펜으로 원을 그리면 정확히 안 닫히고 끝이 살짝 지나친다.
  circle(cx, cy, 104, red, 8, -0.22, Math.PI * 2 + 0.4);
  dot(cx, cy, 11, ink);
  text("완사천", cx + 26, cy + 11, 32, ink, "700");

  text("나주 동문다리의", 690, 186, 24, ink);
  text("귀신 시간 해곡", 690, 218, 24, ink);
  text("도물 묵은 강감찬", 1206, 186, 24, ink);
  text("실존 인물 부회담", 1206, 218, 24, ink);
  text("도물 묵은 강감찬", 1206, 420, 24, ink);
  text("실존 인물 부회담", 1206, 452, 24, ink);
  text("Domeul meogeun Kang Gam-chan", 596, 962, 26, ink, "600");
  text("실존 인물 부회담", 668, 998, 24, ink);
  text("정보 간극 발생", 1130, 962, 28, red, "700");
  text("정보 간극 발생 지점", 540, 1090, 28, ink, "600");
  text("(information gap)", 540, 1126, 24, "#7A7770");

  // ── 오른쪽 체크리스트 ─────────────────────────────────
  text("미스터리 조사 체크리스트", 1512, 180, 36, ink, "600");
  line(1512, 196, W - 46, 196, ink, 3);
  const items = [
    ["완사천의 실제 위치 확인", "check"],
    ["거리 간 정보 모순 해결", "empty"],
    ["전승 출처의 진위 파악", "empty"],
    ["안내판 문구 불일치 원인", "cross"],
    ["기록 보드 정보 정밀 분석", "empty"],
    ["주민 증언의 신뢰도 평가", "cross"],
  ];
  items.forEach(([t, kind], i) => {
    const y = 268 + i * 82;
    rect(1516, y - 28, 32, 32, ink, 3);
    if (kind === "check") {
      g.strokeStyle = green;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(1522, y - 13);
      g.lineTo(1531, y - 2);
      g.lineTo(1546, y - 24);
      g.stroke();
    } else if (kind === "cross") {
      g.strokeStyle = red;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(1520, y - 24);
      g.lineTo(1544, y);
      g.moveTo(1544, y - 24);
      g.lineTo(1520, y);
      g.stroke();
    }
    text(t, 1566, y, 30, ink);
  });
  line(1512, 812, W - 46, 812, "#C9C6BD", 3);
  text("모든 정보가 모순적이다.", 1512, 880, 31, ink, "600");
  text("진실은 왜곡된 기억 속에 있다.", 1512, 926, 31, ink, "600");
  text("흐려진 지역의 진실을 복원해", 1512, 1082, 28, ink);
  text("사람과 장소를 되찾는다.", 1512, 1124, 28, ink);

  // ── 마무리: 판 질감 ───────────────────────────────────
  //   ① 지우개로 쓸고 간 흐릿한 띠 — 화이트보드에서 제일 눈에 띄는 흔적이다.
  const 쓸림 = handRng(7788);
  g.save();
  for (let i = 0; i < 9; i++) {
    const x = 쓸림() * W,
      y = 쓸림() * H;
    const w2 = W * (0.08 + 쓸림() * 0.16),
      h2 = 18 + 쓸림() * 40;
    const grd = g.createLinearGradient(x, y, x + w2, y);
    grd.addColorStop(0, "rgba(180,178,168,0)");
    grd.addColorStop(0.5, `rgba(176,174,164,${0.1 + 쓸림() * 0.1})`);
    grd.addColorStop(1, "rgba(180,178,168,0)");
    g.fillStyle = grd;
    g.save();
    g.translate(x, y);
    g.rotate((쓸림() - 0.5) * 0.28);
    g.fillRect(0, 0, w2, h2);
    g.restore();
  }
  g.restore();
  //   ② 넓은 얼룩 + 미세한 결
  질감얹기(g, W, H, 20260828, 0.75);
}

// 캔버스 텍스처를 만들고, 손글씨 폰트가 준비되면 한 번 더 그려서 갈아끼운다.
function useBoardTexture() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    // 저사양 모드에서만 절반(2048→1024). 그리는 코드는 c.width 기준이라 자동으로 맞춰진다.
    const 기준 = Math.round(2048 * 텍스처배율);
    c.width = 기준;
    c.height = Math.round((기준 * BOARD_H) / BOARD_W);
    drawBoard(c); // 1차: 폰트 없이라도 일단 그린다
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);

  useEffect(() => {
    let alive = true;
    loadBoardFont().then(() => {
      if (!alive) return;
      drawBoard(tex.image); // 2차: 손글씨로 다시 그린다
      tex.needsUpdate = true; // GPU에 올라간 이미지 갱신
    });
    return () => {
      alive = false;
    };
  }, [tex]);

  return tex;
}

function Whiteboard({
  pos = [0, 0],
  rot = 0,
  y = 0,
  scale = 1,
  cFrame = "#8A9099", // 알루미늄 테두리·다리
  선,
}) {
  const [x, z] = pos;
  const tex = useBoardTexture();
  const FR = 0.12; // 테두리 두께
  const bh = BOARD_H,
    bw = BOARD_W;
  const cy = BOARD_LIFT + bh / 2; // 판 중심 높이
  const frame = [
    [0, cy + bh / 2 + FR / 2, bw + FR * 2, FR], // 위
    [0, cy - bh / 2 - FR / 2, bw + FR * 2, FR], // 아래
    [-bw / 2 - FR / 2, cy, FR, bh], // 좌
    [bw / 2 + FR / 2, cy, FR, bh], // 우
  ];
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* 판 뒷면(두께) */}
      <mesh position={[0, cy, -0.03]} castShadow receiveShadow>
        <boxGeometry args={[bw, bh, 0.06]} />
        <meshToonMaterial color="#D9D6CE" gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {/* 판 앞면 그림 — 조명에 눌리지 않게 basic으로(글씨 가독성 확보) */}
      <mesh position={[0, cy, 0.001]}>
        <planeGeometry args={[bw, bh]} />
        {/* 폐역 톤에 맞춰 color로 살짝 눌러 준다(흰 판이 혼자 튀지 않게).
            글씨 대비는 그대로라 가독성은 유지된다. */}
        <meshBasicMaterial map={tex} color="#B9B7B0" toneMapped={false} />
      </mesh>
      {/* 알루미늄 테두리 */}
      {frame.map(([fx, fy, fw, fh], i) => (
        <mesh key={i} position={[fx, fy, 0]} castShadow>
          <boxGeometry args={[fw, fh, 0.14]} />
          <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
          {선?.외곽선 && (
            <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
          )}
        </mesh>
      ))}
      {/* 펜 받침 */}
      <mesh position={[0, cy - bh / 2 - FR, 0.1]} castShadow>
        <boxGeometry args={[bw * 0.8, 0.08, 0.22]} />
        <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {/* 다리 — 세로 기둥 2 + 가로대 + 발 */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * (bw / 2 - 0.3), BOARD_LIFT / 2, 0]} castShadow>
            <boxGeometry args={[0.12, BOARD_LIFT + 0.2, 0.12]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {선?.외곽선 && (
              <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
            )}
          </mesh>
          <mesh position={[sx * (bw / 2 - 0.3), 0.06, 0]} castShadow>
            <boxGeometry args={[0.18, 0.12, 1.5]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {선?.외곽선 && (
              <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
            )}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[bw - 0.6, 0.1, 0.1]} />
        <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
    </group>
  );
}

// ===== 증거 핀보드 + 붉은 실 (코드로 생성) =====
// ★ 화이트보드의 빨간 선과는 다른 것이다.
//   화이트보드 = 판 위에 '그려진' 2D 선(텍스처 안).
//   여기 = 사진에 꽂힌 핀과 핀 사이를 잇는 '실제 3D 줄'. 중력으로 아래로 처지고
//         그림자도 진다. 좌표를 아는 코드라야 만들 수 있어서 GLB로는 안 된다.
const PIN_W = 3.6; // 코르크판 가로
const PIN_H = 2.4; // 세로
const PIN_LIFT = 1.7; // 판 아랫변 높이(화이트보드와 같은 다리 높이)

// 코르크판 바탕 — 갈색에 자잘한 얼룩
function makeCorkTexture() {
  // 저사양 모드에서만 절반(1024→512). 아래 그리기 코드는 전부 W/H 를 기준으로 하므로
  // 두 숫자만 줄이면 그림 비율은 그대로 유지된다.
  const W = Math.round(1024 * 텍스처배율),
    H = Math.round((W * PIN_H) / PIN_W);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#A87B4E";
  g.fillRect(0, 0, W, H);
  const rnd = handRng(4242);
  for (let i = 0; i < 5200; i++) {
    const x = (rnd() + 0.5) * W,
      y = (rnd() + 0.5) * H;
    const v = rnd(); // -0.5~0.5
    g.fillStyle =
      v > 0
        ? `rgba(120,80,44,${0.1 + v * 0.5})`
        : `rgba(212,170,120,${0.1 - v * 0.5})`;
    g.beginPath();
    g.arc(x, y, 1 + (rnd() + 0.5) * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 핀에 꽂힌 카드 한 장(사진 / 메모)을 그린다.
// 핀에 꽂힌 카드 한 장. kind로 '무엇을 찍은 증거인지'가 달라진다.
//   추상적인 얼룩이 아니라 완사천·안내판·동문다리처럼 시나리오에 나오는
//   실제 대상의 실루엣을 그려서, 작게 보여도 무엇인지 읽히게 한다.
function makeCardTexture(kind, seed) {
  const 메모종류 = ["거리", "출처", "증언", "문구불일치"];
  const isNote = 메모종류.includes(kind);
  const W = 320,
    H = isNote ? 300 : 250;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = handRng(seed);
  const KR = BOARD_FONT_FAMILY;

  // ── 메모지 ────────────────────────────────────────────
  if (isNote) {
    const 문구 = {
      거리: ["거리 불일치", "A판본 二里", "C판본 五里", "→ 어느 쪽?"],
      출처: ["출처 미상", "구전만 존재", "문헌 기록 X"],
      증언: ["증언 상충", "노인회 ≠", "시청 자료"],
      문구불일치: ["안내판 문구", "'샘' vs '내'", "표기 상이"],
    }[kind];
    g.fillStyle = "#F3E9C6";
    g.fillRect(0, 0, W, H);
    g.font = `400 34px ${KR}`;
    g.fillStyle = "#2B3038";
    문구.forEach((t, i) => {
      g.save();
      g.translate(24, 66 + i * 54);
      g.rotate(rnd() * 0.03);
      g.fillText(t, 0, 0);
      g.restore();
    });
    const t0 = new THREE.CanvasTexture(c);
    t0.colorSpace = THREE.SRGBColorSpace;
    t0.anisotropy = 8;
    return t0;
  }

  // ── 사진(폴라로이드) ──────────────────────────────────
  g.fillStyle = "#F6F4EE";
  g.fillRect(0, 0, W, H);
  const m = 16,
    pw = W - m * 2,
    ph = H - m * 2 - 44;
  g.save();
  g.beginPath();
  g.rect(m, m, pw, ph);
  g.clip();

  const 캡션 = {
    완사천: "완사천 현장",
    안내판: "안내판 A · 문구",
    동문다리: "나주 동문다리",
    문헌: "고문헌 사본",
    지적도: "지적도 조각",
  }[kind];

  if (kind === "완사천") {
    // 샘 — 어두운 숲 아래 물줄기와 돌
    g.fillStyle = "#3E4A3C";
    g.fillRect(m, m, pw, ph * 0.5);
    g.fillStyle = "#55613F";
    g.fillRect(m, m + ph * 0.42, pw, ph * 0.22);
    g.fillStyle = "#7E9BAE";
    g.beginPath();
    g.moveTo(m, m + ph * 0.68);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.58, m + pw, m + ph * 0.74);
    g.lineTo(m + pw, m + ph);
    g.lineTo(m, m + ph);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(240,248,255,0.55)"; // 물결
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = m + ph * (0.76 + i * 0.05);
      g.beginPath();
      g.moveTo(m + 14, y);
      g.lineTo(m + pw - 14, y + rnd() * 6);
      g.stroke();
    }
    g.fillStyle = "#8C8B84"; // 돌
    [
      [0.24, 0.7, 20],
      [0.52, 0.76, 14],
      [0.74, 0.68, 17],
    ].forEach(([fx, fy, r]) => {
      g.beginPath();
      g.ellipse(m + pw * fx, m + ph * fy, r, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
    });
  } else if (kind === "안내판") {
    // 관광 안내판 — 문구 줄 + 빨간 동그라미(불일치 지점)
    g.fillStyle = "#5E6A5A";
    g.fillRect(m, m, pw, ph);
    g.fillStyle = "#6B6257"; // 기둥
    g.fillRect(m + pw * 0.28, m + ph * 0.46, 10, ph * 0.5);
    g.fillRect(m + pw * 0.68, m + ph * 0.46, 10, ph * 0.5);
    g.fillStyle = "#E7E1CE"; // 판
    g.fillRect(m + pw * 0.16, m + ph * 0.12, pw * 0.68, ph * 0.4);
    g.fillStyle = "#3A3F47";
    for (let i = 0; i < 4; i++) {
      const y = m + ph * (0.2 + i * 0.08);
      g.fillRect(m + pw * 0.21, y, pw * (0.3 + (rnd() + 0.5) * 0.26), 5);
    }
    g.strokeStyle = "#C0392B"; // 표시
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(m + pw * 0.45, m + ph * 0.37, 40, 17, 0, 0, Math.PI * 2);
    g.stroke();
  } else if (kind === "동문다리") {
    // 아치 다리 — 하늘/물 사이에 걸린 실루엣
    g.fillStyle = "#6E7C8A";
    g.fillRect(m, m, pw, ph * 0.62);
    g.fillStyle = "#4C5C68";
    g.fillRect(m, m + ph * 0.62, pw, ph * 0.38);
    g.strokeStyle = "#2F343B";
    g.lineWidth = 12;
    g.beginPath(); // 아치
    g.moveTo(m + 12, m + ph * 0.66);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.24, m + pw - 12, m + ph * 0.66);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath(); // 난간
    g.moveTo(m + 12, m + ph * 0.5);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.12, m + pw - 12, m + ph * 0.5);
    g.stroke();
    g.lineWidth = 3;
    for (let i = 1; i < 7; i++) {
      const fx = i / 7;
      const x0 = m + 12 + (pw - 24) * fx;
      const ya = m + ph * (0.5 - 0.38 * Math.sin(Math.PI * fx));
      const yb = m + ph * (0.66 - 0.42 * Math.sin(Math.PI * fx));
      g.beginPath();
      g.moveTo(x0, ya);
      g.lineTo(x0, yb);
      g.stroke();
    }
  } else if (kind === "문헌") {
    // 고문헌 — 누런 종이에 세로 글줄 + 붉은 낙관
    g.fillStyle = "#D9CDA8";
    g.fillRect(m, m, pw, ph);
    g.strokeStyle = "rgba(60,50,34,0.35)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const x0 = m + pw * (0.1 + i * 0.12);
      g.beginPath();
      g.moveTo(x0, m + ph * 0.12);
      g.lineTo(x0, m + ph * 0.88);
      g.stroke();
    }
    g.fillStyle = "#3B3427";
    for (let i = 0; i < 7; i++) {
      const x0 = m + pw * (0.1 + i * 0.12) - 4;
      const n = 5 + Math.floor((rnd() + 0.5) * 4);
      for (let j = 0; j < n; j++)
        g.fillRect(x0, m + ph * (0.16 + j * 0.1), 9, 9 + (rnd() + 0.5) * 6);
    }
    g.fillStyle = "rgba(176,48,36,0.85)"; // 낙관
    g.fillRect(m + pw * 0.76, m + ph * 0.72, 30, 30);
  } else {
    // 지적도 조각 — 등고선과 붉은 X
    g.fillStyle = "#E4DFCD";
    g.fillRect(m, m, pw, ph);
    g.strokeStyle = "rgba(80,90,70,0.6)";
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(
        m + pw * 0.46,
        m + ph * 0.52,
        26 + i * 22,
        16 + i * 14,
        0.3,
        0,
        Math.PI * 2,
      );
      g.stroke();
    }
    g.strokeStyle = "rgba(70,90,120,0.75)"; // 물길
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(m + 8, m + ph * 0.24);
    g.quadraticCurveTo(m + pw * 0.5, m + ph * 0.6, m + pw - 8, m + ph * 0.42);
    g.stroke();
    g.strokeStyle = "#C0392B"; // X 표시
    g.lineWidth = 6;
    const xc = m + pw * 0.46,
      yc = m + ph * 0.52;
    g.beginPath();
    g.moveTo(xc - 16, yc - 16);
    g.lineTo(xc + 16, yc + 16);
    g.moveTo(xc + 16, yc - 16);
    g.lineTo(xc - 16, yc + 16);
    g.stroke();
  }

  g.restore();
  // 오래된 사진 느낌 — 살짝 바랜 톤과 테두리
  g.fillStyle = "rgba(226,214,184,0.16)";
  g.fillRect(m, m, pw, ph);
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = 2;
  g.strokeRect(m, m, pw, ph);

  g.font = `400 30px ${KR}`;
  g.fillStyle = "#2B3038";
  g.textAlign = "center";
  g.fillText(캡션, W / 2, H - 14);

  질감얹기(g, W, H, seed * 17 + 5, 1.0); // 오래 붙어 있던 사진의 손때·바램

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 카드 배치 — [x, y(판 로컬), 회전(도), 종류, 시드]
//   종류: 완사천 / 안내판 / 동문다리 / 문헌 / 지적도 / 거리 / 출처 / 증언 / 문구불일치
const PIN_CARDS = [
  [-1.24, 0.62, -4, "완사천", 11],
  [-0.24, 0.74, 3, "문구불일치", 23],
  [0.86, 0.58, -6, "안내판", 37],
  [-1.3, -0.34, 5, "거리", 51],
  [-0.2, -0.16, -3, "동문다리", 67],
  [0.98, -0.28, 4, "출처", 83],
  [0.24, -0.86, -5, "지적도", 97],
];
const PIN_LINKS = [
  [0, 1],
  [1, 2],
  [0, 4],
  [4, 2],
  [3, 4],
  [4, 5],
  [3, 6],
  [6, 5],
  [1, 6],
];

function PinBoard({
  pos = [0, 0],
  rot = 0,
  y = 0,
  scale = 1,
  cFrame = "#3c4045",
  선,
}) {
  const [x, z] = pos;
  const cork = useMemo(() => makeCorkTexture(), []);
  const cards = useMemo(
    () =>
      PIN_CARDS.map(([cx, cy, deg, kind, seed]) => {
        const 메모 = ["거리", "출처", "증언", "문구불일치"].includes(kind);
        const h = 메모 ? 0.56 : 0.5;
        const w = 메모 ? 0.6 : 0.64;
        return {
          tex: makeCardTexture(kind, seed),
          cx,
          cy,
          rot: (deg * Math.PI) / 180,
          w,
          h,
          // 핀은 카드 위쪽 가운데 — 실이 여기서 출발한다
          pin: new THREE.Vector3(cx, cy + h / 2 - 0.06, 0.045),
        };
      }),
    [],
  );

  // 붉은 실 — 두 핀을 잇되 가운데를 아래로 늘어뜨린다(줄이 처지는 느낌)
  const strings = useMemo(
    () =>
      PIN_LINKS.map(([a, b]) => {
        const p1 = cards[a].pin,
          p2 = cards[b].pin;
        const sag = 0.05 + p1.distanceTo(p2) * 0.1; // 길수록 더 처진다
        const mid = new THREE.Vector3()
          .addVectors(p1, p2)
          .multiplyScalar(0.5)
          .add(new THREE.Vector3(0, -sag, 0.03));
        const curve = new THREE.CatmullRomCurve3([p1, mid, p2]);
        return new THREE.TubeGeometry(curve, 20, 0.008, 6, false);
      }),
    [cards],
  );

  const cyc = PIN_LIFT + PIN_H / 2; // 판 중심 높이
  const FR = 0.1;
  const frame = [
    [0, PIN_H / 2 + FR / 2, PIN_W + FR * 2, FR],
    [0, -PIN_H / 2 - FR / 2, PIN_W + FR * 2, FR],
    [-PIN_W / 2 - FR / 2, 0, FR, PIN_H],
    [PIN_W / 2 + FR / 2, 0, FR, PIN_H],
  ];

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      <group position={[0, cyc, 0]}>
        {/* 코르크판 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[PIN_W, PIN_H, 0.08]} />
          <meshToonMaterial map={cork} gradientMap={TOON_GRADIENT} />
          {선?.외곽선 && (
            <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
          )}
        </mesh>
        {/* 나무 테두리 */}
        {frame.map(([fx, fy, fw, fh], i) => (
          <mesh key={i} position={[fx, fy, 0]} castShadow>
            <boxGeometry args={[fw, fh, 0.12]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {선?.외곽선 && (
              <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
            )}
          </mesh>
        ))}
        {/* 사진·메모 카드 — 판에서 살짝 띄워 그림자가 지게 */}
        {cards.map((c, i) => (
          <mesh
            key={`c${i}`}
            geometry={단위판}
            position={[c.cx, c.cy, 0.045]}
            rotation={[0, 0, c.rot]}
            scale={[c.w, c.h, 1]}
            castShadow
          >
            <meshToonMaterial map={c.tex} gradientMap={TOON_GRADIENT} />
            {/* 카드 둘레 선 — 판에 붙은 종이의 경계를 또렷하게 */}
            <만화선 geo={단위판} 선={선} />
          </mesh>
        ))}
        {/* 압정 — 카드 위쪽에 박힌 붉은 머리 */}
        {cards.map((c, i) => (
          <mesh key={`p${i}`} position={c.pin} castShadow>
            <sphereGeometry args={[0.032, 10, 8]} />
            <meshToonMaterial color="#C0392B" gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
        {/* ★ 붉은 실 — 핀과 핀을 잇는 진짜 3D 줄 */}
        {strings.map((geo, i) => (
          <mesh key={`s${i}`} geometry={geo} castShadow>
            <meshToonMaterial color="#B03024" gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
      </group>
      {/* 다리 — 화이트보드와 같은 모양으로 맞춘다 */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * (PIN_W / 2 - 0.3), PIN_LIFT / 2, 0]} castShadow>
            <boxGeometry args={[0.12, PIN_LIFT + 0.2, 0.12]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {선?.외곽선 && (
              <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
            )}
          </mesh>
          <mesh position={[sx * (PIN_W / 2 - 0.3), 0.06, 0]} castShadow>
            <boxGeometry args={[0.18, 0.12, 1.4]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {선?.외곽선 && (
              <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
            )}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[PIN_W - 0.6, 0.1, 0.1]} />
        <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
    </group>
  );
}

// ===== 커피 머그컵 (mug.glb) =====
// 부위 3개(body / handle / coffee), 전부 단위행렬 루트.
// 실측: 폭 1.90(손잡이 포함) · 높이 1.54 · 깊이 1.38, 밑면이 이미 y=0
//   → group의 y에 '책상 윗면 높이'를 그대로 주면 책상 위에 딱 올라간다.
//
// 크기 기준: 이 씬은 의자 등받이 3.05유닛 ≈ 1.1m 이므로 1유닛 ≈ 0.36m.
//   머그컵 9cm를 맞추려면 0.09/0.36 = 0.25유닛 → 1.54 × 0.16 ≈ 0.25.
//   조금 크게 보이는 게 눈에 잘 띄어 0.18로 잡았다(≈10cm). 조절은 Leva에서.
useGLTF.preload("/models/mug.glb");
const MUG_SCALE = 0.18;

function Mug({
  pos = [0, 0],
  rot = 0,
  y = 2.0, // 책상 윗면
  scale = 1,
  sizeMul = 1,
  cCup = "#e8e6e2", // 컵(몸통+손잡이) — 도자기 흰색
  cCoffee = "#3b2417", // 담긴 커피
  선,
}) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/mug.glb");
  const model = useMemo(() => {
    // 원본을 고치면 useGLTF 캐시가 오염돼 3개가 같이 바뀐다 → 복제 후 칠한다
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if (!obj.isMesh) return;
      const 커피 = (obj.name || "").toLowerCase().includes("coffee");
      obj.material = new THREE.MeshToonMaterial({
        color: 커피 ? cCoffee : cCup,
        gradientMap: TOON_GRADIENT,
      });
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    return cloned;
  }, [scene, cCup, cCoffee]);
  // 모델을 조각으로 나눠 그린다 — 그래야 조각마다 외곽선·주름선을 붙일 수 있다.
  const 조각 = useMemo(() => GLB조각(model), [model]);
  return (
    <group
      position={[x, y, z]}
      rotation={[0, rot, 0]}
      scale={MUG_SCALE * scale * sizeMul}
    >
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

// ===== 노트북 (laptop.glb) =====
// Meshy 원본 299,454면 → 5,819면(98.1% 감소)으로 줄이고 5개 부위로 잘라둔 모델.
//   부위 이름: screen(화면유리) / bezel(화면테두리·뒷판) / keys(키보드) / trackpad / body(본체)
//   → 통짜 모델과 달리 부위마다 다른 색을 입힐 수 있다.
// 모델 기준점: 바닥이 y=0, 가로·세로는 중앙이 원점
//   → group의 y에 '책상 윗면 높이'를 그대로 주면 책상 위에 딱 올라간다.
useGLTF.preload("/models/laptop.glb");

// 메시 이름으로 부위를 찾기 위한 목록(GLB 안의 실제 이름과 같다)
const LAPTOP_PARTS = ["screen", "bezel", "keys", "trackpad", "body"];

function Laptop({
  pos = [0, 0], // [x, z] 바닥 평면 위치
  rot = 0, // y축 회전(라디안)
  y = 2.43, // 높이 — 책상 윗면
  scale = 0.68, // 크기(공통 × 개별)
  cScreen = "#10131a", // 화면 유리 색(꺼졌을 때)
  cBezel = "#3a3f47", // 화면 테두리·뒷판
  cKeys = "#24262c", // 키보드
  cTrackpad = "#5a606a", // 트랙패드
  cBody = "#787e8a", // 본체
  screenOn = true, // 화면을 켤지 — 켜면 스스로 빛난다
  screenColor = "#4f8fd6", // 켜졌을 때 화면 빛 색
  선,
}) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/laptop.glb");

  const model = useMemo(() => {
    // 원본을 직접 고치면 useGLTF 캐시가 오염돼 두 대가 같이 바뀐다 → 반드시 복제해서 쓴다
    const cloned = scene.clone(true);

    // 부위 이름 → 칠할 색 짝짓기 표
    const 색표 = {
      screen: cScreen,
      bezel: cBezel,
      keys: cKeys,
      trackpad: cTrackpad,
      body: cBody,
    };

    cloned.traverse((obj) => {
      if (!obj.isMesh) return; // 실제 형상(mesh)만 대상, 빈 그룹은 건너뜀
      // 메시 이름을 소문자로 만들어 어느 부위인지 판별(못 찾으면 본체 취급)
      const 이름 = (obj.name || "").toLowerCase();
      const 부위 = LAPTOP_PARTS.find((k) => 이름.includes(k)) ?? "body";

      if (부위 === "screen" && screenOn) {
        // 화면만 '스스로 빛나는' 재질 — 조명을 안 받으므로 어둠 속에서도 밝게 보인다.
        // toneMapped=false → 밝기가 눌리지 않아 Bloom(후처리 번짐)이 확실히 걸린다.
        obj.material = new THREE.MeshBasicMaterial({
          color: screenColor,
          toneMapped: false,
        });
      } else {
        // 나머지는 씬 전체와 같은 셀셰이딩(만화 톤) 재질로 통일
        obj.material = new THREE.MeshToonMaterial({
          color: 색표[부위],
          gradientMap: TOON_GRADIENT,
        });
      }
      obj.castShadow = true; // 그림자를 드리움
      obj.receiveShadow = true; // 그림자를 받음
    });
    return cloned;
    // 의존성이 전부 문자열·불리언(원시값)이라 값이 실제로 바뀔 때만 다시 만든다
  }, [scene, cScreen, cBezel, cKeys, cTrackpad, cBody, screenOn, screenColor]);
  const 조각 = useMemo(() => GLB조각(model), [model]);

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

const DESK_RAW_MINY = 0.6225; // 원본 바닥까지 거리(중심→바닥)

// 책상 실측(scale 2.2): 가로 4.14 / 깊이 1.99.
//   나란히 딱 붙이려면 중심 간격 = 붙는 방향의 책상 두께.
//   · 2,3(90°회전 세로책상): x방향 두께 = 깊이 1.99 → x 간격 1.99
//   · 4,5(가로책상, 1.5배): x방향 두께 = 가로 4.14×1.5=6.21 → x 간격 6.21
// [배치 확인용] 책상마다 다른 색 — 위에서 볼 때 어느 게 어느 책상인지 구분.
//   배치 확정되면 DESK_DEBUG를 false로 바꿔 전부 원래 철제색(P.struct)으로.
const DESK_DEBUG = false;
const DESK_COLORS = [
  "#E24A4A", // 0: 1번 빨강
  "#4AA0E2", // 1: 2번 파랑
  "#4AE27A", // 2: 3번 초록
  "#E2C84A", // 3: 4번 노랑
  "#B04AE2", // 4: 5번 보라
];

const DESK_SPOTS = [
  // [x, z, 회전, 가로길이, 세로길이, 높이] — Leva로 맞춘 값 고정
  [-11, -7.3, 0.0, 2.2, 1, 1], // 빨강
  [-12, -2.5, 1.57, 1.7, 1, 1], // 파랑
  [-9.4, -2.5, 1.57, 1.7, 1, 1], // 초록
  [2.7, -2.6, 0.0, 1.5, 1, 1], // 노랑
  [7.1, -4.3, -1.57, 1.5, 1, 1], // 보라
];

function Desk({
  pos = [0, 0],
  rot = 0,
  scale = 1,
  lift = 0,
  stretch = 1,
  zStretch = 1,
  yStretch = 1,
  color = P.struct,
  선,
}) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/desk.glb");
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = new THREE.MeshToonMaterial({
          color,
          gradientMap: TOON_GRADIENT,
        });
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return cloned;
  }, [scene, color]);
  // 모델을 조각으로 나눠 그린다 — 그래야 조각마다 외곽선·주름선을 붙일 수 있다.
  const 조각 = useMemo(() => GLB조각(model), [model]);

  // 바닥에 딱 세우기: min_y가 0에 오도록 (0.62×scale)만큼 올림 + Leva 미세조정(lift)
  //   높이늘림(yStretch)을 쓰면 그만큼 바닥 오프셋도 커진다.
  const y = DESK_RAW_MINY * scale * yStretch + lift;

  // 축별 scale: 가로(x)=stretch, 높이(y)=yStretch, 세로(z)=zStretch
  return (
    <group
      position={[x, y, z]}
      rotation={[0, rot, 0]}
      scale={[scale * stretch, scale * yStretch, scale * zStretch]}
    >
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

// ===== 서류 더미 (GLB 없이 코드로 생성) =====
// [왜 코드로 만드나]
//   Meshy 같은 AI 3D 생성기는 물체를 '하나로 이어진 껍데기'로만 만든다.
//   낱장 종이 여러 장을 요청하면 전부 녹아붙어 한 덩어리가 되고,
//   종이의 본질인 '완벽한 평면 + 직각 + A4 비율'도 울퉁불퉁해진다.
//   반면 종이 한 장 = 납작한 상자(box) = 삼각형 12개라 코드가 압도적으로 유리하다.

// A4 비율(210×297mm)을 이 씬의 축척으로 환산.
//   책상 윗면 2.44 = 실제 0.73m → 1m ≈ 3.34 유닛.
const PAPER_W = 0.21 * 3.34; // 가로 ≈ 0.70
const PAPER_D = 0.297 * 3.34; // 세로 ≈ 0.99

// 상자 하나를 만들어 모든 종이가 '같이 쓴다'.
//   장마다 새 geometry를 만들면 낭비 → 1×1×1 상자를 scale로 늘려 쓴다.
const PAPER_GEO = new THREE.BoxGeometry(1, 1, 1);

// 포스트잇 색 — 고정값. 너무 진하지 않은 파스텔 4종을 돌아가며 쓴다.
const STICKY_COLORS = [
  "#F0E5A2", // 연노랑
  "#F2C9CF", // 연분홍
  "#C8E3BE", // 연초록
  "#BFD5EC", // 연하늘
];
// 포스트잇에 적힌 짧은 메모 — 이 방의 수사 내용과 이어지는 문구.
//   바탕을 흰색으로 그리고 재질 color 에 파스텔을 주면
//   '텍스처 × 색' 이 되어 색종이에 쓴 글씨가 된다(인쇄 종이와 같은 방식).
const STICKY_TEXTS = [
  ["완사천", "재확인"],
  ["187 → 190", "낙장?"],
  ["출처", "확인 요"],
  ["8/25", "재봉인"],
  ["지적도", "대조"],
];
const 스티커캐시 = new Map();
function 스티커그리기(c, i) {
  const g = c.getContext("2d", { willReadFrequently: true }),
    W = c.width,
    H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, W, H);
  const 줄들 = STICKY_TEXTS[i % STICKY_TEXTS.length];
  g.fillStyle = "#3E434D";
  g.textAlign = "center";
  g.textBaseline = "middle";
  줄들.forEach((t, k) => {
    // 줄마다 크기·기울기를 조금씩 달리해 '손으로 갈겨 쓴' 티를 낸다
    g.font = `400 ${Math.round(H * (k === 0 ? 0.21 : 0.18))}px ${BOARD_FONT_FAMILY}`;
    g.save();
    g.translate(W / 2, H * (0.38 + k * 0.26));
    g.rotate(-0.04 + k * 0.05);
    g.fillText(t, 0, 0);
    g.restore();
  });
  질감얹기(g, W, H, 300 + i, 0.5);
}
function 스티커텍스처(i) {
  if (!스티커캐시.has(i)) {
    const c = document.createElement("canvas");
    c.width = c.height = 192;
    스티커그리기(c, i); // 1차: 폰트 없이라도 일단 그린다
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    스티커캐시.set(i, t);
    loadBoardFont().then(() => {
      스티커그리기(c, i); // 2차: 손글씨 폰트로 다시 그린다
      t.needsUpdate = true;
    });
  }
  return 스티커캐시.get(i);
}
// 상자 6면 중 윗면(2번)만 글씨 텍스처. 색×글 조합마다 한 벌씩만 만든다.
const 스티커재질캐시 = new Map();
function 스티커재질(색i, 글i) {
  const k = `${색i}-${글i}`;
  if (!스티커재질캐시.has(k)) {
    const c = STICKY_COLORS[색i];
    const 옆 = new THREE.MeshToonMaterial({
      color: c,
      gradientMap: TOON_GRADIENT,
    });
    const 위 = new THREE.MeshToonMaterial({
      color: c,
      gradientMap: TOON_GRADIENT,
      map: 스티커텍스처(글i),
    });
    스티커재질캐시.set(k, [옆, 옆, 위, 옆, 옆, 옆]);
  }
  return 스티커재질캐시.get(k);
}

const CLIP_DARK = "#22252A"; // 집게 몸통(검정)
const CLIP_METAL = "#C9CDD4"; // 집게 손잡이(은색)

// 씨드 난수(mulberry32) — 같은 씨드면 항상 같은 더미가 나온다.
//   Math.random()을 그대로 쓰면 화면이 다시 그려질 때마다 모양이 바뀌어 떨린다.

// ── 'A4에 글이 적혀 있는' 텍스처를 코드로 그린다 ──────────────
//   진짜 글자를 쓰지 않고 '글줄처럼 보이는 회색 막대'를 그린다.
//   게임 거리에서는 이게 실제 글자보다 자연스럽고, 언어 선택 문제도 없다.
//   (방탈출 단서용 진짜 문서는 나중에 이미지 파일을 map으로 얹으면 된다)
//
//   스타일 5종: 0=섞기 / 1=보고서 / 2=표·서식 / 3=손글씨메모 / 4=체크리스트
const PAPER_STYLES = ["섞기", "보고서", "표·서식", "손글씨메모", "체크리스트"];

function makePaperTexture(seed = 1, style = 0) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 362; // A4 비율(1 : 1.414)
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = makeRandom(seed * 131 + style * 7 + 1);

  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, c.width, c.height);

  const m = 26; // 여백
  const W = c.width - m * 2;
  // '섞기'면 씨드로 스타일을 하나 뽑는다
  const st = style === 0 ? 1 + ((rnd() * 4) | 0) : style;

  // 공통 머리말(손글씨 메모는 제외 — 메모지엔 제목이 없다)
  let y = 30;
  if (st !== 3) {
    g.fillStyle = "#6B7280";
    g.fillRect(m, y, W * (0.4 + rnd() * 0.25), 9);
    g.fillStyle = "#B9BEC7";
    g.fillRect(m, y + 18, W * (0.24 + rnd() * 0.2), 5);
    g.fillStyle = "#9AA0AA";
    g.fillRect(m, y + 32, W, 1);
    y += 46;
  } else {
    y = 42;
  }

  // 글줄 하나 그리기(문서용 반듯한 줄)
  //   ★ 예전보다 연하고 성기게 — 멀리서 보면 '글이 빽빽한 인쇄물'이라 시끄러웠다.
  const 줄 = (yy, w, dark) => {
    g.fillStyle = dark ? "#A9AEB8" : "#D6DAE1";
    g.fillRect(m, yy, w, 3);
  };
  // 표 하나 그리기
  const 표 = (yy, 행, 행높이) => {
    g.strokeStyle = "#C6CBD3";
    g.lineWidth = 1;
    g.strokeStyle = "#D8DCE3";
    for (let r = 0; r <= 행; r++) {
      g.beginPath();
      g.moveTo(m, yy + r * 행높이);
      g.lineTo(m + W, yy + r * 행높이);
      g.stroke();
    }
    [0, 0.32, 0.6, 0.8, 1].forEach((f) => {
      g.beginPath();
      g.moveTo(m + W * f, yy);
      g.lineTo(m + W * f, yy + 행 * 행높이);
      g.stroke();
    });
    for (let r = 0; r < 행; r++)
      [0.03, 0.35, 0.63, 0.83].forEach((f) => {
        g.fillStyle = r === 0 ? "#A9AEB8" : "#CDD2D9";
        g.fillRect(
          m + W * f,
          yy + r * 행높이 + 4,
          W * (0.07 + rnd() * 0.13),
          3,
        );
      });
    return yy + 행 * 행높이;
  };

  if (st === 1) {
    // ── 보고서: 문단 위주, 가끔 작은 표 ──────────────────
    if (rnd() < 0.22) y = 표(y, 3, 15) + 22;
    while (y < c.height - m) {
      if (rnd() < 0.2) {
        y += 16; // 문단 사이 빈 줄 — 자주 비워 시원하게
        continue;
      }
      줄(y, W * (0.4 + rnd() * 0.55), rnd() < 0.1);
      y += 15;
    }
  } else if (st === 2) {
    // ── 표·서식: 페이지 대부분이 표 ─────────────────────
    while (y < c.height - m - 20) {
      y = 표(y, 3 + ((rnd() * 3) | 0), 16) + 26;
      if (rnd() < 0.35) {
        줄(y, W * 0.35, true);
        y += 16;
      }
    }
  } else if (st === 3) {
    // ── 손글씨 메모: 삐뚤빼뚤한 곡선 + 푸른 잉크 ─────────
    g.lineCap = "round";
    while (y < c.height - m) {
      const 길이 = W * (0.35 + rnd() * 0.6);
      const 들쭉 = m + rnd() * 10; // 왼쪽 여백이 줄마다 다르다 = 손글씨 티
      g.strokeStyle = rnd() < 0.25 ? "#8492AD" : "#A9B3C6";
      g.lineWidth = 1.6 + rnd() * 0.9;
      g.beginPath();
      g.moveTo(들쭉, y);
      // 물결치는 곡선 = 흘려 쓴 글씨
      for (let x2 = 들쭉; x2 < 들쭉 + 길이; x2 += 12)
        g.quadraticCurveTo(x2 + 6, y + (rnd() - 0.5) * 7, x2 + 12, y);
      g.stroke();
      // 가끔 줄을 죽 그어 지운다
      if (rnd() < 0.12) {
        g.strokeStyle = "#6B7A96";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(들쭉, y - 1);
        g.lineTo(들쭉 + 길이 * 0.7, y - 1);
        g.stroke();
      }
      y += 19 + rnd() * 7;
    }
    // 가끔 동그라미 표시
    if (rnd() < 0.6) {
      g.strokeStyle = "#5A6B8C";
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(
        m + W * (0.25 + rnd() * 0.5),
        60 + rnd() * (c.height - 140),
        26 + rnd() * 14,
        14 + rnd() * 8,
        (rnd() - 0.5) * 0.5,
        0,
        Math.PI * 2,
      );
      g.stroke();
    }
  } else {
    // ── 체크리스트: 네모칸 + 항목 줄, 일부는 체크됨 ──────
    while (y < c.height - m) {
      g.strokeStyle = "#9AA0AA";
      g.lineWidth = 1.5;
      g.strokeRect(m, y - 6, 9, 9);
      if (rnd() < 0.45) {
        // 체크 표시(X)
        g.strokeStyle = "#66707F";
        g.beginPath();
        g.moveTo(m + 1.5, y - 4.5);
        g.lineTo(m + 7.5, y + 1.5);
        g.moveTo(m + 7.5, y - 4.5);
        g.lineTo(m + 1.5, y + 1.5);
        g.stroke();
      }
      g.fillStyle = rnd() < 0.2 ? "#A9AEB8" : "#D6DAE1";
      g.fillRect(m + 16, y - 3, (W - 16) * (0.3 + rnd() * 0.6), 3);
      y += 21;
    }
  }

  // 종이 결 — 아주 연하게만(0.55). 진하면 '더러운 종이'가 된다.
  질감얹기(g, c.width, c.height, seed * 131 + style * 7 + 3, 0.55);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 텍스처는 만드는 데 비용이 드니 (스타일, 씨드)별로 한 번만 만들어 캐시에 보관
const PAPER_TEX_CACHE = new Map();
function getPaperTexture(seed, style) {
  const k = `${style}-${seed % 8}`; // 스타일당 8종이면 충분히 다양해 보인다
  if (!PAPER_TEX_CACHE.has(k))
    PAPER_TEX_CACHE.set(k, makePaperTexture((seed % 8) + 1, style));
  return PAPER_TEX_CACHE.get(k);
}

function PaperStack({
  pos = [0, 0], // [x, z] 바닥 평면 위치
  y = 2.44, // 높이 — 책상 윗면
  rot = 0, // 더미 전체 회전
  scale = 1, // 크기
  sheets = 20, // 낱장 수
  spread = 0.3, // 흐트러짐(각도)
  slide = 0.18, // 흐트러짐(밀림)
  thick = 0.022, // 한 장 두께
  lean = 0.5, // 무너짐(위로 갈수록 쏠림)
  seed = 1, // 모양 씨드
  paperColor = "#EFEDE4", // 흰 종이 색
  folderColor = "#D6C49B", // 누런 서류봉투 색
  clipCount = 1, // 집게 개수
  stickyCount = 0, // 포스트잇 개수
  printed = false, // 흰 종이에 글이 적혀 있는지
  printedFolder = false, // 누런 봉투에도 글을 넣을지(끄면 그냥 봉투)
  textStyle = "섞기", // 글씨 종류 — PAPER_STYLES 중 하나
  선,
}) {
  // Leva에서 온 이름("보고서")을 그리기 함수가 쓰는 번호로 바꾼다
  const styleIdx = Math.max(0, PAPER_STYLES.indexOf(textStyle));
  const [x, z] = pos;

  // ── 낱장 하나하나의 위치·각도·색을 미리 계산 ────────────────
  const 낱장들 = useMemo(() => {
    const rnd = makeRandom(seed);
    const out = [];
    const leanDir = rnd() * Math.PI * 2; // 무너지는 방향
    const lx = Math.cos(leanDir) * lean;
    const lz = Math.sin(leanDir) * lean;

    // ★ 낱장이 서로 파고들지 않게 하는 두 가지 장치
    //  ① 기울기를 '조금씩 흘려' 준다.
    //     장마다 완전 무작위로 기울이면 아래위 종이가 X자로 엇갈려 모서리가 서로를
    //     뚫고 나온다. 실제 종이 더미는 아래 더미 모양을 따라가므로,
    //     이웃한 장끼리는 기울기가 거의 같아야 자연스럽고 안 뚫린다.
    //  ② 그래도 남는 차이만큼 '필요한 만큼만' 띄운다(아래 필요간격).
    let rx = (rnd() - 0.5) * 0.05,
      rz = (rnd() - 0.5) * 0.05;
    let 이전y = 0,
      이전h = 0,
      이전rx = rx,
      이전rz = rz;

    for (let i = 0; i < sheets; i++) {
      const t = i / Math.max(1, sheets - 1); // 0(맨 아래) ~ 1(맨 위)
      const 뽑기 = rnd();
      const isFolder = 뽑기 < 0.12; // 12%는 누런 서류봉투
      const w = PAPER_W * (isFolder ? 1.06 : 1);
      const d = PAPER_D * (isFolder ? 1.04 : 1);

      if (i > 0) {
        rx = Math.max(-0.05, Math.min(0.05, rx + (rnd() - 0.5) * 0.014));
        rz = Math.max(-0.05, Math.min(0.05, rz + (rnd() - 0.5) * 0.014));
      }
      // 두 장의 기울기 차이 때문에 모서리가 들리는 높이(가장 나쁜 경우)
      const 들림 =
        0.5 * Math.max(w, d) * (Math.abs(rx - 이전rx) + Math.abs(rz - 이전rz));
      const 틈 = thick * 0.06; // 면이 딱 붙어 지글거리지 않게 하는 최소 틈
      // 종이를 먼저 얇게 해서 흡수하고, 그래도 모자라면 위로 더 띄운다.
      const h = Math.max(
        thick * 0.25,
        Math.min(thick * 0.9, thick - 들림 - 틈),
      );
      const 필요간격 = 이전h / 2 + h / 2 + 들림 + 틈;
      const py = i === 0 ? h / 2 + 틈 : 이전y + Math.max(thick, 필요간격);
      이전y = py;
      이전h = h;
      이전rx = rx;
      이전rz = rz;

      out.push({
        px: (rnd() - 0.5) * slide * 2 + lx * t,
        pz: (rnd() - 0.5) * slide * 2 + lz * t,
        py,
        ry: (rnd() - 0.5) * spread * 2, // 돌아간 정도
        rx,
        rz,
        w,
        d,
        h,
        folder: isFolder,
        // 인쇄된 글은 '위쪽 절반'에만 (아래는 어차피 안 보인다)
        //   흰 종이는 글자표시, 누런 봉투는 봉투글자 스위치를 따로 본다
        printed: t > 0.45 && (isFolder ? printedFolder : printed),
        texSeed: (rnd() * 8) | 0,
      });
    }
    return out;
  }, [sheets, spread, slide, thick, lean, seed, printed, printedFolder]);

  const 맨위 = 낱장들[낱장들.length - 1];

  // ── 재질: 색 종류만큼만 만들어 돌려쓴다 ─────────────────────
  const 재질 = useMemo(() => {
    const mk = (c) =>
      new THREE.MeshToonMaterial({ color: c, gradientMap: TOON_GRADIENT });
    return {
      paper: mk(paperColor),
      folder: mk(folderColor),
      clipDark: mk(CLIP_DARK),
      clipMetal: mk(CLIP_METAL),
      sticky: STICKY_COLORS.map(mk),
      // 인쇄면: 윗면(+Y)에만 글줄 텍스처를 얹는다.
      //   BoxGeometry의 면 순서는 [+X, -X, +Y, -Y, +Z, -Z] → 2번이 윗면.
      //   텍스처 바탕이 흰색이라 '텍스처 × 종이색'이 되어,
      //   봉투색을 주면 '누런 종이에 글씨' 가 그대로 나온다.
      printedTop: (s, isFolder) =>
        new THREE.MeshToonMaterial({
          color: isFolder ? folderColor : paperColor,
          gradientMap: TOON_GRADIENT,
          map: getPaperTexture(s, styleIdx),
        }),
    };
  }, [paperColor, folderColor, styleIdx]);

  // 인쇄면 재질도 (씨드, 흰종이/봉투)별로 한 번만 만든다
  const 인쇄재질 = useMemo(() => {
    const m = new Map();
    낱장들.forEach((s) => {
      if (!s.printed) return;
      const k = `${s.texSeed}-${s.folder ? "f" : "p"}`;
      if (!m.has(k)) m.set(k, 재질.printedTop(s.texSeed, s.folder));
    });
    return m;
  }, [낱장들, 재질]);

  // ── 집게 — 종이 '모서리를 물고 있게' 배치 ───────────────────
  const 집게들 = useMemo(() => {
    if (clipCount <= 0 || 낱장들.length < 2) return [];
    const rnd = makeRandom(seed + 777);
    return Array.from({ length: clipCount }, () => {
      // 위쪽 종이 중 하나를 골라 그 종이의 한쪽 모서리 중앙에 문다
      const s = 낱장들[((0.6 + rnd() * 0.39) * 낱장들.length) | 0];
      const 앞뒤 = rnd() < 0.5 ? 1 : -1; // 위쪽 모서리 / 아래쪽 모서리
      const 치우침 = (rnd() - 0.5) * 0.5; // 모서리 중앙에서 좌우로 치우친 정도
      // 종이가 ry만큼 돌아가 있으므로 모서리 위치도 같이 돌린다
      const lx = 치우침 * s.w;
      const lz = 앞뒤 * s.d * 0.5;
      return {
        px: s.px + lx * Math.cos(s.ry) + lz * Math.sin(s.ry),
        pz: s.pz - lx * Math.sin(s.ry) + lz * Math.cos(s.ry),
        py: s.py,
        ry: s.ry,
      };
    });
  }, [낱장들, clipCount, seed]);

  // ── 포스트잇 — 맨 위 종이에 붙는다 ──────────────────────────
  const 포스트잇들 = useMemo(() => {
    if (stickyCount <= 0 || !맨위) return [];
    const rnd = makeRandom(seed + 314);
    return Array.from({ length: stickyCount }, (_, i) => {
      const 크기 = PAPER_W * (0.3 + rnd() * 0.12);
      // 종이 안쪽 어딘가에, 가끔은 모서리 밖으로 반쯤 삐져나오게
      const lx = (rnd() - 0.5) * 맨위.w * 0.9;
      const lz = (rnd() - 0.5) * 맨위.d * 0.95;
      return {
        px: 맨위.px + lx * Math.cos(맨위.ry) + lz * Math.sin(맨위.ry),
        pz: 맨위.pz - lx * Math.sin(맨위.ry) + lz * Math.cos(맨위.ry),
        // 맨 위 종이의 '윗면' 위에 얹는다.
        //   전에는 종이 두께의 25%만큼 파묻혀 있어 면이 겹쳤다.
        //   맨위.py(중심) + 종이 반두께 + 포스트잇 반두께 + 아주 작은 틈
        py: 맨위.py + 맨위.h / 2 + thick * 0.35 + thick * 0.1,
        ry: 맨위.ry + (rnd() - 0.5) * 0.5,
        w: 크기,
        d: 크기 * (0.85 + rnd() * 0.3),
        color: i % STICKY_COLORS.length, // 색은 순서대로 고정
        글: (rnd() * STICKY_TEXTS.length) | 0, // 적힌 문구
      };
    });
  }, [맨위, stickyCount, seed, thick]);

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* 낱장들 */}
      {낱장들.map((s, i) => {
        const 기본 = s.folder ? 재질.folder : 재질.paper;
        // 인쇄된 종이는 윗면만 글줄 텍스처, 나머지 5면은 민무늬
        const 인쇄 = s.printed
          ? 인쇄재질.get(`${s.texSeed}-${s.folder ? "f" : "p"}`)
          : null;
        const mat = 인쇄 ? [기본, 기본, 인쇄, 기본, 기본, 기본] : 기본;
        return (
          <mesh
            key={i}
            geometry={PAPER_GEO} /* 상자 하나를 모두가 공유 */
            material={mat}
            position={[s.px, s.py, s.pz]}
            rotation={[s.rx, s.ry, s.rz]}
            scale={[s.w, s.h, s.d]} /* 1×1×1 상자를 종이 크기로 늘린다 */
            castShadow
            /* ★ receiveShadow 를 뺐다.
               종이는 두께가 0.02밖에 안 되는 판이 수십 장 겹쳐 있어서,
               그림자맵 한 칸(텍셀)보다 훨씬 얇다 → 자기 그림자가 자기 위에 찍혀
               새까만 사각형이 얼룩덜룩 생긴다(섀도 아크네).
               책상·바닥에 지는 더미 그림자(castShadow)는 그대로 남는다. */
          >
            <만화선 geo={PAPER_GEO} 선={선} />
          </mesh>
        );
      })}

      {/* 집게 — 몸통(검정 상자) + 은색 손잡이 2개 */}
      {집게들.map((c, i) => (
        <group
          key={`clip${i}`}
          position={[c.px, c.py, c.pz]}
          rotation={[0, c.ry, 0]}
        >
          {/* 몸통 — 종이 모서리를 위아래로 물고 있게 */}
          <mesh
            geometry={PAPER_GEO}
            material={재질.clipDark}
            scale={[0.17, 0.1, 0.055]}
            castShadow
          >
            <만화선 geo={PAPER_GEO} 선={선} />
          </mesh>
          {/* 은색 손잡이 2개 — 위로 뻗은 얇은 막대 */}
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              geometry={PAPER_GEO}
              material={재질.clipMetal}
              position={[s * 0.05, 0.075, 0]}
              rotation={[0, 0, s * 0.35]}
              scale={[0.018, 0.1, 0.018]}
              castShadow
            />
          ))}
        </group>
      ))}

      {/* 포스트잇 — 고정 파스텔 4색을 순서대로 */}
      {포스트잇들.map((s, i) => (
        <mesh
          key={`sticky${i}`}
          geometry={PAPER_GEO}
          material={스티커재질(s.color, s.글)}
          position={[s.px, s.py, s.pz]}
          rotation={[0, s.ry, 0]}
          scale={[s.w, thick * 0.7, s.d]}
          castShadow
          /* 낱장과 같은 이유로 receiveShadow 제외 — 포스트잇도 종이만큼 얇다 */
        >
          <만화선 geo={PAPER_GEO} 선={선} />
        </mesh>
      ))}
    </group>
  );
}

// ===== 잔해용 '깨진 돌' 지오메트리 =====
// 상자(BoxGeometry)를 그대로 쓰면 면이 매끈해서 '레고 블록'처럼 보인다.
// → 상자를 2×2×2로 잘게 나눈 뒤 정점을 무작위로 밀어 울퉁불퉁하게 만든다.
//
// [주의] 상자는 정점을 면끼리 공유한다. 같은 자리 정점을 서로 다르게 밀면
//        모서리가 벌어져 틈이 생긴다 → 좌표를 키로 이동량을 캐시해 똑같이 민다.
// [flatShading] 과 짝을 이루라고 toNonIndexed() 로 면마다 법선을 끊어 놓는다.
//        그래야 각진 돌 느낌이 나고, 부드럽게 뭉개지지 않는다.
const 돌캐시 = new Map();
function 돌지오(씨, 거칠기 = 0.3) {
  const 키 = `${씨}|${거칠기}`;
  const 있음 = 돌캐시.get(키);
  if (있음) return 있음;

  const base = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  const p = base.attributes.position;
  const rnd = makeRandom(씨);
  const 이동 = new Map(); // "x,y,z" → [dx,dy,dz]
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = 이동.get(k);
    if (!d) {
      d = [
        (rnd() - 0.5) * 거칠기,
        (rnd() - 0.5) * 거칠기,
        (rnd() - 0.5) * 거칠기,
      ];
      이동.set(k, d);
    }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  const g = base.toNonIndexed();
  g.computeVertexNormals();
  base.dispose();
  돌캐시.set(키, g);
  return g;
}

// (색밝기 는 공용.jsx 로 옮겼다 — 여러 씬이 함께 쓰는 부품)

// ===== 기차 저편 배경 =====
// 방 오른쪽은 벽이 없어서, 3D 물체가 없는 자리는 캔버스 바탕색(#22262E)이
// 그대로 보인다. 그게 '푸른 여백'의 정체다 → 어두운 판을 세워 막는다.
//   MeshBasicMaterial + fog={false} : 조명도 안개도 안 받는다.
//   안개색이 밝은 회청색(#cfd9eb)이라, 안개를 받게 두면 멀리서 다시 파래진다.
function 기차배경({
  x = 34, // 판을 세울 거리
  z = -1,
  y = 14,
  폭 = 160,
  높이 = 80,
  색 = "#15181D",
  바닥색 = "#101318",
  바닥y = -2.2,
}) {
  return (
    <>
      {/* 뒤판 — planeGeometry는 기본이 +Z를 보므로 -90° 돌려 -X를 보게 한다 */}
      <mesh position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[폭, 높이]} />
        <meshBasicMaterial color={색} toneMapped={false} fog={false} />
      </mesh>
      {/* 선로 저편 바닥 — 아래쪽으로 새는 여백도 막는다 */}
      <mesh
        position={[(16 + x) / 2 + 6, 바닥y, z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[x - 16 + 24, 폭]} />
        <meshBasicMaterial color={바닥색} toneMapped={false} fog={false} />
      </mesh>
    </>
  );
}

// ===== 기차 선로 (도상 + 침목 + 레일) =====
// 방 바닥(planeGeometry)은 x = +16 에서 끝난다. 그 바깥은 아무것도 없어서
// 기차가 허공에 떠 있는 것처럼 보였다 → 선로 바닥을 따로 깔아 채운다.
//
// [실제 치수] 표준궤 궤간(레일 안쪽 간격) 1,435mm.
//   이 씬은 1유닛 ≈ 0.30m → 1.435 / 0.30 ≈ 4.8유닛.
//   기차 폭(0.686 × 크기 11.5 ≈ 7.9유닛)보다 좁은 게 맞다 — 차체가 궤간보다 넓다.
function 기차선로({
  pos = [18, -1],
  // [왜 이렇게 낮나] 도상 윗면을 -0.62 로 두면 레일 꼭대기가 y=-0.09 가 된다.
  //   방 바닥판은 y=0 이므로, 방 안쪽(x<16)에 걸치는 부분은 바닥에 가려 안 보인다.
  //   예전 -0.35 는 레일이 바닥 위로 솟아 사무실 한복판을 가로질렀다.
  y = -0.62,
  // 기차와 달리 선로는 '반듯하게' 둔다. 기차만 살짝 틀어져 있으면
  //   '레일 위에 비스듬히 멈춰 선(밀려난)' 그림이 되어 오히려 사연이 생긴다.
  rot = Math.PI / 2,
  길이 = 90,
  폭 = 8,
  궤간 = 4.8,
  도상색 = "#2B2E33",
  침목색 = "#241F1B",
  레일색 = "#666D77",
  자갈 = true,
  seed = 7,
  선,
}) {
  const [x, z] = pos;

  // 침목·자갈은 개수가 많아 매 렌더마다 새로 만들면 무겁다 → useMemo 로 한 번만.
  //   makeRandom(씨드) = 같은 씨드면 항상 같은 배치가 나오는 난수.
  //   Math.random() 을 쓰면 새로고침할 때마다 자갈이 춤춘다.
  // ★ 길이 방향 = 로컬 X 다. 기차 모델도 X축으로 길기 때문에,
  //   기차와 같은 회전값을 주면 레일이 기차 밑에 나란히 깔린다.
  //   (예전엔 선로만 Z축으로 길게 짜 놔서 같은 각도인데 90° 어긋나 있었다)
  // ★★ 침목·자갈은 **한 덩어리로 합쳐서** 그린다. ★★
  //   예전에는 <mesh> 를 침목 52개 + 자갈 260개, 총 312개 만들었다.
  //   그런데 삼각형은 다 합쳐야 3천 개 남짓이다. 즉 **그릴 게 적은데
  //   그리라는 명령만 312번** 나가고 있었다(침목은 외곽선까지 붙어 두 배).
  //   드로우콜은 개수 자체가 비용이라, 작은 상자가 많을수록 손해가 크다.
  //   상자합치기 는 위치·회전을 정점 좌표에 미리 반영해 하나로 이어 붙인다.
  //   → 화면은 똑같고 드로우콜만 312 → 2 로 줄어든다.
  const 침목지오 = useMemo(() => {
    const rnd = makeRandom(seed + 11);
    const 간 = 2.4; // 침목 간격
    const n = Math.floor(길이 / 간);
    return 상자합치기(
      Array.from({ length: n }, (_, i) => {
        const z = (rnd() - 0.5) * 0.5; // 살짝 틀어진 침목 — 관리 안 된 폐선 느낌
        const r = (rnd() - 0.5) * 0.06;
        const sc = 0.9 + rnd() * 0.2;
        return {
          크기: [0.95, 0.24, (궤간 + 2.2) * sc],
          위치: [-길이 / 2 + i * 간 + 간 / 2, 0.12, z],
          회전: [0, r, 0],
        };
      }),
    );
  }, [길이, 궤간, seed]);

  const 자갈지오 = useMemo(() => {
    if (!자갈) return null;
    const rnd = makeRandom(seed + 29);
    return 상자합치기(
      Array.from({ length: 260 }, () => {
        const x = (rnd() - 0.5) * 길이;
        const z = (rnd() - 0.5) * 폭 * 0.98;
        const sc = 0.16 + rnd() * 0.3;
        const r = rnd() * Math.PI;
        const t = rnd() * 0.5;
        return {
          크기: [sc, sc * 0.7, sc],
          위치: [x, 0.02 + t * 0.1, z],
          회전: [t, r, t * 0.7],
        };
      }),
    );
  }, [폭, 길이, 자갈, seed]);

  // 합친 지오메트리는 우리가 만든 것이라 우리가 치운다(안 치우면 GPU 메모리에 쌓인다)
  useEffect(
    () => () => {
      침목지오?.dispose();
      자갈지오?.dispose();
    },
    [침목지오, 자갈지오],
  );

  const 툰 = (색) => (
    <meshToonMaterial color={색} gradientMap={TOON_GRADIENT} />
  );
  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      {/* 도상 — 자갈이 깔린 바닥판. 선로 전체가 올라앉는 받침이다 */}
      <mesh position={[0, -0.45, 0]} receiveShadow>
        <boxGeometry args={[길이, 0.9, 폭]} />
        {툰(도상색)}
      </mesh>

      {/* 침목 — 레일을 가로질러 받치는 나무 토막 (길이 방향에 직각).
             52개가 한 메시다. 외곽선도 하나만 붙으므로 선은 예전과 똑같이
             토막마다 그어진다(합쳐도 각 상자의 면은 그대로 남아 있다). */}
      {침목지오 && (
        <mesh geometry={침목지오} receiveShadow castShadow>
          {툰(침목색)}
          {선긋기}
        </mesh>
      )}

      {/* 레일 2줄 — 침목 위에 얹혀 길이 방향으로 뻗는다 */}
      {[-1, 1].map((sz) => (
        <mesh
          key={`rail${sz}`}
          position={[0, 0.38, (sz * 궤간) / 2]}
          castShadow
        >
          <boxGeometry args={[길이, 0.3, 0.26]} />
          {툰(레일색)}
          {선긋기}
        </mesh>
      ))}

      {/* 흩어진 자갈 — 도상 위에 무작위로. 260개가 한 메시다(선은 원래 안 두른다) */}
      {자갈지오 && (
        <mesh geometry={자갈지오}>{툰(도상색)}</mesh>
      )}
    </group>
  );
}

// ===== 벽 조각 =====
// 기존 벽(WallPanel)과 '같은 벽돌 무늬가 이어지는' 작은 판.
//   [핵심] UV에 월드 좌표만큼 오프셋을 준다. 그래야 조각마다 무늬가 처음부터
//   다시 시작하지 않고, 옆 벽에서 흘러나온 것처럼 이어진다.
//   (벽텍스처는 RepeatWrapping 이라 1을 넘는 UV도 잘 물린다)
// 밝기양끝 = [왼쪽 끝 밝기, 오른쪽 끝 밝기] (없으면 균일).
//   판이 가로 1칸짜리 사각형이라 정점이 네 개뿐이고, 좌우 두 값만 정해 주면
//   GPU가 그 사이를 자동으로 이어(보간) 부드러운 그라데이션이 된다.
//   빛을 하나 더 켜는 것보다 훨씬 싸고, 셀 셰이딩 단계도 안 깨진다.
function 벽조각({
  w,
  h,
  x,
  y,
  색,
  seed,
  낡음 = 0.7,
  flipU = false,
  밝기양끝 = null,
  // ★ 분할 = 가로로 몇 칸으로 쪼갤지. 정점이 늘어나는 것뿐이라 드로우콜은 그대로 1이다.
  //   밝기목록 = 왼쪽 끝부터 오른쪽 끝까지의 밝기 값 배열(분할+1개면 딱 맞는다).
  //   판 하나로 여러 단계의 그라데이션을 표현할 수 있어, 벽을 여러 조각으로
  //   쪼갤 필요가 없어진다. (조각 24개 → 판 1개)
  분할 = 1,
  밝기목록 = null,
}) {
  const tex = 벽텍스처(seed, 낡음);
  const 목록 = 밝기목록 || 밝기양끝 || null;
  const 밝기키 = 목록 ? 목록.join(",") : "";
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(w, h, Math.max(1, 분할), 1);
    const uv = g.attributes.uv;
    const u0 = (x - w / 2) / WALL_TEX_W;
    const v0 = (y - h / 2) / WALL_TEX_H;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i) * (w / WALL_TEX_W) + (flipU ? -u0 : u0);
      uv.setX(i, u);
      uv.setY(i, uv.getY(i) * (h / WALL_TEX_H) + v0);
    }
    if (목록 && 목록.length >= 2) {
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const 끝 = 목록.length - 1;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getX(i) + w / 2) / w; // 0(왼쪽 끝) ~ 1(오른쪽 끝)
        // 목록 사이를 선형 보간 — 값이 2개면 직선, 25개면 꺾은선이 된다
        const f = Math.max(0, Math.min(끝, t * 끝));
        const i0 = Math.floor(f);
        const i1 = Math.min(끝, i0 + 1);
        const v = 목록[i0] + (목록[i1] - 목록[i0]) * (f - i0);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    return g;
  }, [w, h, x, y, flipU, 분할, 밝기키]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh position={[x, y, 0]} geometry={geo} receiveShadow>
      <meshToonMaterial
        color={색}
        map={tex}
        gradientMap={TOON_GRADIENT}
        vertexColors={!!목록}
      />
    </mesh>
  );
}

// ===== 기차가 뚫고 지나간 벽의 부서진 끝 =====
// [1·2차 시도의 실패] 처음엔 매끈한 상자를 층층이 쌓아 '계단'이 됐고,
//   두 번째엔 울퉁불퉁한 돌덩이를 붙였더니 '벽 옆에 놓인 바위'로 보였다.
//   → 문제는 재질이었다. 부서진 자리는 '따로 놓인 물체'가 아니라
//     벽 그 자체여야 한다. 그래서 벽돌 무늬가 이어지는 판(벽조각)을
//     층마다 길이만 다르게 잘라 붙여 '찢어진 단면'을 만든다.
//   돌덩이는 발치에 조금만 남긴다 — 많으면 오히려 가짜가 된다.
function 부서진벽끝({
  z = -14, // 어느 벽인가
  뒤집기 = false, // 뒷벽(+z)이면 판을 180° 돌린다
  끝x = 15, // 단단한 벽이 끝나는 x
  한계x = 21, // 부서진 조각이 뻗을 수 있는 한계 x
  가운데파임 = 0.5, // 기차 높이 언저리를 얼마나 더 파먹을지 (0=고르게, 1=푹 파임)
  seed = 3,
  높이 = 12,
  층 = 16,
  들쭉 = 2.4, // 층마다 끝이 들쭉날쭉한 정도(유닛)
  벽색 = "#525b69",
  아랫단색 = "#4e5462",
  낡음 = 0.7,
  잔해색 = "#3B4048",
  거칠기 = 0.34,
  선,
}) {
  const 데이터 = useMemo(() => {
    const rnd = makeRandom(seed + 101);
    const h = 높이 / 층;
    // 층마다 끝을 얼마나 더 이어 붙일지(항상 0 이상).
    //   벽 자체는 이미 '벽후퇴'만큼 짧게 잘려 있다. 여기서 층마다 다른 길이로
    //   조금씩 되살려 붙이면 반듯하게 잘린 단면이 찢어진 단면이 된다.
    //   기차가 지나간 높이(t≈0.45)에서 가장 짧게 — 거기가 제일 크게 헐렸으니까.
    const 밴드 = Array.from({ length: 층 }, (_, i) => {
      const t = (i + 0.5) / 층; // 0(바닥) ~ 1(천장)
      const 중앙쏠림 = Math.max(0, 1 - Math.abs(t - 0.45) * 1.6);
      // ★ 가운데파임 0 이면 층 구분 없이 고르게 뻗는다 → 벽이 기차까지 확실히 닿는다.
      //   1 이면 기차 높이에서 거의 안 뻗는다(예전 동작 = 아무리 당겨도 안 닿던 원인).
      const d = 들쭉 * (1 - 중앙쏠림 * 가운데파임) * (0.25 + rnd() * 0.75);
      // 한계x 가 끝x 보다 앞이면 되살릴 게 없다 → 0 으로 눌러 음수 폭을 막는다
      return { y: (i + 0.5) * h, h, d: Math.max(0, Math.min(d, 한계x - 끝x)) };
    });
    // 발치 잔해 — 6개만.
    const 잔해 = Array.from({ length: 6 }, (_, i) => {
      const 거리 = rnd();
      return {
        x: 끝x - 0.8 - 거리 * 4.5,
        z: z + (rnd() - 0.5) * 3.5,
        y: 0.18 + rnd() * 0.25,
        s: (0.5 + rnd() * 1.0) * (1 - 거리 * 0.5),
        r: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
        b: 0.8 + rnd() * 0.4,
        k: seed * 71 + i,
      };
    });
    return { 밴드, 잔해 };
  }, [seed, 높이, 층, 들쭉, 끝x, 한계x, 가운데파임, z]);

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    <>
      {/* 찢어진 단면 — 층마다 길이가 다른 벽조각.
          d>0 이면 기존 벽보다 더 나온 부분, d<0 이면 파먹힌 부분이다.
          파먹힌 층은 그리지 않는다(기존 벽이 이미 거기 있으니 겹치면 안 된다). */}
      <group position={[0, 0, z]} rotation={[0, 뒤집기 ? Math.PI : 0, 0]}>
        {데이터.밴드.map((b, i) =>
          b.d > 0.05 ? (
            <벽조각
              key={`band${i}`}
              w={b.d}
              h={b.h * 0.98}
              x={(뒤집기 ? -1 : 1) * (끝x + b.d / 2)}
              y={b.y}
              색={b.y < 4 ? 아랫단색 : 벽색}
              seed={seed}
              낡음={낡음}
              flipU={뒤집기}
            />
          ) : null,
        )}
      </group>

      {/* 발치 잔해 */}
      {데이터.잔해.map((c, i) => (
        <mesh
          key={`rub${i}`}
          geometry={돌지오(c.k, 거칠기)}
          position={[c.x, c.y, c.z]}
          rotation={c.r}
          scale={[c.s, c.s * 0.6, c.s * 0.85]}
          castShadow
          receiveShadow
        >
          <meshToonMaterial
            color={색밝기(잔해색, c.b)}
            gradientMap={TOON_GRADIENT}
            flatShading
          />
          {선긋기}
        </mesh>
      ))}
    </>
  );
}

// ===== 승강장 확장 (기차 저편을 '같은 공간'으로 잇는다) =====
// 방 오른쪽은 벽이 없어서 그 너머가 캔버스 바탕색(푸른 여백)으로 비쳤다.
// 어두운 판으로 가리는 대신, 아예 벽·천장을 기차 저편까지 이어 붙여
// '기차가 들어와 선 큰 홀' 한 공간으로 만든다.
function 승강장확장({
  시작x = 16, // 기존 방이 끝나는 곳
  끝x = 27, // 새로 세울 먼 벽
  z0 = -14,
  z1 = 12,
  높이 = 12,
  먼벽 = true,
  천장 = true,
  바닥 = true,
  바닥y = -0.72, // 선로 도상 언저리
  바닥색 = "#3A3D42",
  바닥시드 = 340,
  바닥얼룩 = 0.9,
  벽색 = "#525b69",
  아랫단색 = "#4e5462",
  천장색 = "#5a5f69",
  천장시드 = 12,
  천장낡음 = 0.7,
  천장얼룩 = 0.7,
  // ── 부서진 천장 ──────────────────────────────────────
  타일 = 2.5, // 천장 마감판 한 장 크기
  무너짐 = 0.22, // 아예 떨어져 나간 판의 비율
  처짐 = 0.14, // 떨어지기 직전 처진 판의 비율
  골조 = true, // 뚫린 자리로 보이는 철골 격자
  골조간격 = 1.6,
  골조굵기 = 0.13,
  골조색 = "#171b21",
  늘어진판 = true, // 구멍 가장자리에 매달린 마감판
  // ── 천장 설비 (환기 덕트 + 배관 다발) ────────────────
  설비 = true,
  덕트가로 = 1.6, // 덕트 단면 가로
  덕트세로 = 1.05, // 덕트 단면 세로
  덕트자리 = 0.32, // 시작x~끝x 사이 어디에 걸지 (0=방쪽, 1=먼벽쪽)
  덕트내림 = 0.95, // 천장에서 얼마나 내려 달지
  이음간격 = 6, // 덕트 이음매(테) 간격
  배관수 = 4,
  배관자리 = 0.62,
  배관내림 = 0.75,
  배관굵기 = 0.2,
  배관간격 = 0.55,
  행거간격 = 5, // 천장에 매다는 가는 봉 간격
  덕트색 = "#242931",
  배관색 = "#1b1f25",
  단열색 = "#4a4536", // 벗겨진 단열재 — 누렇게 삭은 색
  낡음 = 0.7,
  seed = 21,
}) {
  const 깊이 = z1 - z0;
  const 가운데z = (z0 + z1) / 2;
  const 바닥폭 = 끝x - 시작x + 8; // 방 안쪽으로도 조금 물려 틈이 안 보이게
  const 천장폭 = 끝x - 시작x;

  // ── 부서진 천장 ────────────────────────────────────
  //   한 장짜리 판으로는 구멍을 못 뚫는다. 그래서 마감판(타일) 격자로 쪼개고
  //   일부는 아예 안 그린다(= 떨어져 나간 자리), 일부는 처지게 기울인다.
  //   지오메트리를 '월드 좌표 그대로' 직접 짜서 회전을 안 쓴다.
  //     → 판마다 네 귀퉁이 높이를 따로 줄 수 있어 처진 모양이 자연스럽다.
  //   UV = (x/CEIL_TEX, z/CEIL_TEX) 로 잡으면 판이 나뉘어도 무늬가 이어진다.
  const 천장텍 = 천장텍스처(천장시드, 천장낡음);
  const { 천장geo, 구멍들 } = useMemo(() => {
    const rnd = makeRandom(천장시드 + 5);
    const nx = Math.max(1, Math.round(천장폭 / 타일));
    const nz = Math.max(1, Math.round(깊이 / 타일));
    const tx = 천장폭 / nx;
    const tz = 깊이 / nz;
    const z시작 = 가운데z - 깊이 / 2;
    const pos = [];
    const uvs = [];
    const 구멍 = [];

    const 찍기 = (x, y, zz) => {
      pos.push(x, y, zz);
      uvs.push(x / CEIL_TEX, zz / CEIL_TEX);
    };

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x0 = 시작x + i * tx,
          x1 = x0 + tx;
        const za = z시작 + j * tz,
          zb = za + tz;
        const r = rnd();
        if (r < 무너짐) {
          구멍.push({ x: (x0 + x1) / 2, z: (za + zb) / 2, tx, tz, t: rnd() });
          continue; // 안 그린다 = 뻥 뚫린 자리
        }
        // 처진 판은 귀퉁이마다 조금씩 다르게 내려앉는다
        const sag = r < 무너짐 + 처짐 ? 0.35 + rnd() * 0.8 : 0;
        const h = () => 높이 - sag * (0.25 + rnd() * 0.75);
        const c00 = h(),
          c10 = h(),
          c11 = h(),
          c01 = h();
        // 삼각형 2장. 재질을 DoubleSide 로 두므로 감는 방향은 신경 안 써도 된다.
        찍기(x0, c00, za);
        찍기(x1, c10, za);
        찍기(x1, c11, zb);
        찍기(x0, c00, za);
        찍기(x1, c11, zb);
        찍기(x0, c01, zb);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return { 천장geo: g, 구멍들: 구멍 };
  }, [천장폭, 깊이, 시작x, 가운데z, 높이, 타일, 무너짐, 처짐, 천장시드]);
  useEffect(() => () => 천장geo.dispose(), [천장geo]);

  // 뚫린 자리로 보이는 철골 격자. 천장 위에 깔아 두면
  //   판이 남아 있는 곳은 가려지고, 떨어져 나간 자리에서만 드러난다.
  const 골조가로 = useMemo(() => {
    const n = Math.max(1, Math.round(천장폭 / 골조간격));
    return Array.from(
      { length: n },
      (_, i) => 시작x + (천장폭 / n) * (i + 0.5),
    );
  }, [천장폭, 시작x, 골조간격]);
  const 골조세로 = useMemo(() => {
    const n = Math.max(1, Math.round(깊이 / (골조간격 * 2.2)));
    return Array.from(
      { length: n },
      (_, i) => 가운데z - 깊이 / 2 + (깊이 / n) * (i + 0.5),
    );
  }, [깊이, 가운데z, 골조간격]);

  // ── 천장 설비 좌표 계산 ────────────────────────────
  //   덕트·배관은 '기차와 나란히'(z 방향) 지나간다. 기차를 가로지르면
  //   시선을 끊어 버려서, 오히려 공간이 좁아 보인다.
  const 덕트X = 시작x + 천장폭 * 덕트자리;
  const 배관X = 시작x + 천장폭 * 배관자리;
  const 설비길이 = 깊이 + 6; // 양끝을 화면 밖으로 빼서 '어디서 와서 어디로 가는지' 안 보이게

  // 일정 간격으로 z 좌표를 만드는 작은 도우미 (덕트 이음매 · 행거 공용)
  const 줄지어 = (간) => {
    const n = Math.max(1, Math.round(설비길이 / 간));
    const d = 설비길이 / n;
    return Array.from(
      { length: n },
      (_, i) => 가운데z - 설비길이 / 2 + d / 2 + i * d,
    );
  };
  const 이음들 = useMemo(() => 줄지어(이음간격), [설비길이, 이음간격, 가운데z]); // eslint-disable-line
  const 행거들 = useMemo(() => 줄지어(행거간격), [설비길이, 행거간격, 가운데z]); // eslint-disable-line

  // ★ 드로우콜 줄이기 — 같은 재질의 잔가지들을 한 덩어리로 합친다.
  //   철골 격자와 행거는 전부 '색 하나짜리 가는 막대'다. 삼각형은 몇 백 개인데
  //   메시로 나눠 두면 그 수만큼 그리기 명령이 나간다. 드로우콜은 개수 자체가
  //   비용이라, 작고 많은 것일수록 합쳐서 얻는 이득이 크다.
  const 골조지오 = useMemo(() => {
    if (!골조) return null;
    return 상자합치기([
      ...골조가로.map((gx) => ({
        크기: [골조굵기, 골조굵기 * 2.4, 깊이],
        위치: [gx, 0, 가운데z],
      })),
      ...골조세로.map((gz) => ({
        크기: [천장폭, 골조굵기, 골조굵기 * 2],
        위치: [(시작x + 끝x) / 2, 골조굵기 * 1.4, gz],
      })),
    ]);
  }, [골조, 골조가로, 골조세로, 골조굵기, 깊이, 천장폭, 시작x, 끝x, 가운데z]);

  const 행거지오 = useMemo(() => {
    if (!설비) return null;
    return 상자합치기(
      행거들.flatMap((hz) => [
        { 크기: [0.1, 덕트내림, 0.1], 위치: [덕트X, 높이 - 덕트내림 / 2, hz] },
        // 배관 다발은 가로 받침대 하나로 통째로 걸어 둔다
        {
          크기: [배관간격 * 배관수 + 0.5, 0.12, 0.12],
          위치: [배관X, 높이 - 배관내림 - 0.18, hz],
        },
        { 크기: [0.09, 배관내림, 0.09], 위치: [배관X, 높이 - 배관내림 / 2, hz] },
      ]),
    );
  }, [설비, 행거들, 덕트X, 배관X, 높이, 덕트내림, 배관내림, 배관간격, 배관수]);

  useEffect(
    () => () => {
      골조지오?.dispose();
      행거지오?.dispose();
    },
    [골조지오, 행거지오],
  );

  // 배관 4줄. 굵기를 조금씩 다르게 해야 '다발'로 보인다 — 다 같으면 빗살무늬가 된다.
  const 배관들 = useMemo(() => {
    const rnd = makeRandom(seed + 41);
    return Array.from({ length: 배관수 }, (_, i) => ({
      x: 배관X + (i - (배관수 - 1) / 2) * 배관간격,
      r: 배관굵기 * (0.6 + rnd() * 0.8),
      dy: (rnd() - 0.5) * 0.25, // 높이도 살짝 흩어 놓는다
    }));
  }, [배관수, 배관X, 배관간격, 배관굵기, seed]);

  // 단열재가 벗겨진 구간 — 배관 위에 누런 토막을 몇 개만 얹는다
  const 벗겨짐 = useMemo(() => {
    const rnd = makeRandom(seed + 77);
    return Array.from({ length: 5 }, () => ({
      i: Math.floor(rnd() * 배관수),
      z: 가운데z + (rnd() - 0.5) * 설비길이 * 0.9,
      len: 1.2 + rnd() * 3.5,
    }));
  }, [배관수, 설비길이, 가운데z, seed]);

  // 선로 구역 바닥 — 방 바닥과 같은 방식(텍스처 + 정점 얼룩)으로 만든다.
  //   예전엔 조명을 안 받는 어두운 판이라 '색만 칠한 종이'처럼 납작했다.
  //   면을 잘게 나눠야 정점 얼룩이 먹는다(정점이 4개뿐이면 얼룩질 데가 없다).
  const 바닥텍 = 바닥텍스처(바닥시드);
  const 바닥geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      바닥폭,
      깊이,
      Math.round(바닥폭 / 1.5),
      Math.round(깊이 / 1.5),
    );
    면얼룩(g, 바닥시드 + 7, { 개수: 26, 세기: 바닥얼룩 });
    return g;
  }, [바닥폭, 깊이, 바닥시드, 바닥얼룩]);
  useEffect(() => () => 바닥geo.dispose(), [바닥geo]);

  return (
    <>
      {/* 선로 구역 바닥 */}
      {바닥 && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[시작x + 바닥폭 / 2 - 4, 바닥y, 가운데z]}
          geometry={바닥geo}
          receiveShadow
        >
          <meshToonMaterial
            color={바닥색}
            map={바닥텍}
            gradientMap={TOON_GRADIENT}
            vertexColors
          />
        </mesh>
      )}

      {/* 먼 벽 — 기차 저편. -x 를 보게 90° 돌린다 */}
      <group
        position={[끝x, 0, 가운데z]}
        rotation={[0, -Math.PI / 2, 0]}
        visible={먼벽}
      >
        <벽조각
          w={깊이}
          h={높이 - 4}
          x={0}
          y={(높이 + 4) / 2}
          색={벽색}
          seed={seed}
          낡음={낡음}
        />
        <벽조각
          w={깊이}
          h={4}
          x={0}
          y={2}
          색={아랫단색}
          seed={seed}
          낡음={낡음}
        />
      </group>

      {/* 천장 연장 ────────────────────────────────────────
             예전엔 민무늬 판이라, 질감 있는 방 천장에서 여기로 넘어올 때
             한 번에 뚝 끊겨 '렌더 안 된 구멍'처럼 보였다.
             → 방 천장과 똑같은 텍스처를 깔고 색만 어둡게 한다.
               재질이 같으니 경계가 '재질 차이'가 아니라 '밝기 차이'로 바뀐다. */}
      {천장 && (
        <>
          {/* 철골 격자 — 천장판보다 위에 있어서, 판이 떨어져 나간 자리에서만 보인다.
                 이게 없으면 구멍이 그냥 '검은 사각형'으로 보인다. */}
          {골조 && 골조지오 && (
            <group position={[0, 높이 + 0.55, 0]}>
              {/* 가로살·세로살 20여 개가 한 메시다. 전부 같은 색·같은 재질이라
                  나눠 그릴 이유가 없다(합쳐도 격자 모양은 그대로 남는다). */}
              <mesh geometry={골조지오}>
                <meshToonMaterial color={골조색} gradientMap={TOON_GRADIENT} />
              </mesh>
            </group>
          )}

          {/* 천장 마감판 — 격자로 쪼갠 것을 지오메트리 하나로 합쳐 그린다.
                 위(철골)와 아래(방) 양쪽에서 보이므로 DoubleSide. */}
          <mesh geometry={천장geo} receiveShadow>
            <meshToonMaterial
              color={천장색}
              map={천장텍}
              gradientMap={TOON_GRADIENT}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* 매달린 판 — 떨어지다 만 마감판. 구멍 가장자리에 비스듬히 걸린다.
                 이 몇 장이 '무너지는 중'이라는 인상을 만든다. */}
          {늘어진판 &&
            구멍들
              .filter((_, i) => i % 4 === 0)
              .slice(0, 6)
              .map((c, i) => (
                <mesh
                  key={`sag${i}`}
                  position={[
                    c.x + c.tx * 0.3,
                    높이 - 0.45 - c.t * 0.6,
                    c.z + c.tz * 0.2,
                  ]}
                  rotation={[-1.05 - c.t * 0.4, c.t * 1.2, 0.25 - c.t * 0.5]}
                >
                  <planeGeometry args={[c.tx * 0.85, c.tz * 0.8]} />
                  <meshToonMaterial
                    color={천장색}
                    map={천장텍}
                    gradientMap={TOON_GRADIENT}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              ))}
        </>
      )}

      {/* 천장 설비 — 환기 덕트 + 배관 다발 ─────────────────
             완전한 검정은 '깊은 공간'이 아니라 '빈 구멍'으로 읽힌다.
             어둠 속에 형태가 몇 개 지나가야 비로소 깊이가 생긴다.
             기차와 나란히(z 방향) 깔아서 시선을 끊지 않게 한다. */}
      {설비 && (
        <group>
          {/* ── 환기 덕트 ──────────────────────────────── */}
          <mesh position={[덕트X, 높이 - 덕트내림, 가운데z]}>
            <boxGeometry args={[덕트가로, 덕트세로, 설비길이]} />
            <meshToonMaterial color={덕트색} gradientMap={TOON_GRADIENT} />
          </mesh>
          {/* 이음매 테 — 덕트를 덕트로 읽히게 하는 건 사실 이 테다.
                 밋밋한 긴 상자는 그냥 '막대'로 보인다. */}
          {이음들.map((dz, i) => (
            <mesh key={`joint${i}`} position={[덕트X, 높이 - 덕트내림, dz]}>
              <boxGeometry args={[덕트가로 * 1.12, 덕트세로 * 1.12, 0.22]} />
              <meshToonMaterial color={덕트색} gradientMap={TOON_GRADIENT} />
            </mesh>
          ))}

          {/* ── 배관 다발 ──────────────────────────────── */}
          {배관들.map((p, i) => (
            <mesh
              key={`pipe${i}`}
              position={[p.x, 높이 - 배관내림 + p.dy, 가운데z]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              {/* 원기둥은 기본이 Y축으로 서 있다 → X축으로 90° 눕혀 Z 방향으로 눕힌다.
                     면 8개면 충분하다. 어두운 실루엣이라 각져도 안 보인다. */}
              <cylinderGeometry args={[p.r, p.r, 설비길이, 8]} />
              <meshToonMaterial color={배관색} gradientMap={TOON_GRADIENT} />
            </mesh>
          ))}

          {/* 벗겨진 단열재 — 배관보다 살짝 굵게, 누렇게 삭은 색으로 토막만 */}
          {벗겨짐.map((w, i) => {
            const p = 배관들[w.i];
            if (!p) return null;
            return (
              <mesh
                key={`ins${i}`}
                position={[p.x, 높이 - 배관내림 + p.dy, w.z]}
                rotation={[Math.PI / 2, 0, 0]}
              >
                <cylinderGeometry args={[p.r * 1.45, p.r * 1.45, w.len, 8]} />
                <meshToonMaterial
                  color={단열색}
                  gradientMap={TOON_GRADIENT}
                  flatShading
                />
              </mesh>
            );
          })}

          {/* ── 행거 — 천장에 매다는 가는 봉.
                 이게 없으면 덕트도 배관도 허공에 둥둥 떠 보인다. */}
          {/* 행거 하나가 봉 3개라 예전엔 N×3 개의 메시였다. 전부 같은 색이라
              한 덩어리로 합친다 — 가는 봉이라 삼각형은 얼마 안 되는데
              그리라는 명령만 많이 나가던 자리다. */}
          {행거지오 && (
            <mesh geometry={행거지오}>
              <meshToonMaterial color={배관색} gradientMap={TOON_GRADIENT} />
            </mesh>
          )}
        </group>
      )}
    </>
  );
}

// ===== 비밀 복도 (왼쪽 벽 뒤) =====
// 방은 x −20 ~ +16 이라 그 왼쪽(x < −20)이 통째로 비어 있다. 거기에 복도를 깐다.
// 바닥·천장·바깥벽·양끝벽 + 안쪽벽(방 쪽 벽의 '뒷면')으로 이루어진다.
//
// [안쪽벽이 왜 따로 필요한가] 방의 왼쪽 벽은 평면 한 장이고 앞면만 그린다.
//   복도에서 보면 뒷면이라 아예 안 보인다(그냥 뻥 뚫려 보인다).
//   그래서 복도 쪽을 향한 벽을 한 장 더 세운다.
// ===== 복도 깊이 감광 (공용) =====
// 벽·측면문·끝문이 '같은 규칙'으로 어두워져야 따로 노는 느낌이 안 난다.
// 그래서 계산을 한 군데로 모았다.
//
//   ① 기본 감광 : 방으로 통하는 문(문z)에서 멀어질수록 어두워진다. 양쪽 다.
//   ② 끝쪽 감광 : 비상계단이 있는 '복도 끝(z0)' 방향으로만 한 번 더 어둡게.
//                 복도가 실제보다 길어 보이게 만드는 장치다 —
//                 사람 눈은 '멀수록 어둡다'를 거리로 읽는다.
//
// 끝기울기가 1보다 크면 곡선이 뒤로 몰린다.
//   = 문 근처는 거의 그대로 두고, 끝에 가까워질 때 급격히 어두워진다.
//   (1이면 일정하게 어두워져서 복도 전체가 그냥 칙칙해진다)
function 복도깊이밝기(z, o) {
  const t = Math.min(1, Math.abs(z - o.문z) / Math.max(1, o.감쇠));
  let b = Math.max(o.최소밝기, 1 - o.어둠 * t);
  if (o.끝어둠 > 0 && z < o.문z) {
    const 끝까지 = Math.max(1, o.문z - o.z0);
    const u = Math.min(1, (o.문z - z) / 끝까지); // 0 = 문 앞, 1 = 복도 끝
    b *= 1 - o.끝어둠 * Math.pow(u, o.끝기울기);
  }
  return b;
}

// ===== 복도 천장 배관 · 전선 트레이 =====
// [왜 넣는가]
//   ① 복도가 길어 보인다. 천장을 따라 뻗은 선은 소실점으로 모이면서 원근을 만든다.
//      '끝쪽 어둡게'가 거리감을 주고, 배관이 원근을 준다. 둘은 겹칠수록 세진다.
//   ② 설정에 맞는다. 폐역에 수사본부를 급히 차렸으니 전기·통신은 노출 배선일 수밖에 없다.
//
// [비용]
//   재질이 같은 것끼리 미리 하나의 지오메트리로 합친다.
//     파이프 5개 → 1개 · 트레이 → 1개 · 행어 → 1개  = 메시 3개(외곽선 포함 6콜)
//
// [깊이 감광]
//   ★ 벽만 어두워지고 배관은 끝까지 밝으면 오히려 거리감이 깨진다.
//   벽과 똑같이 복도깊이밝기()를 쓰되, 메시를 쪼개지 않고 '정점색'으로 넣는다.
//   정점색은 재질 색에 곱해지므로, 한 덩어리 안에서도 z에 따라 밝기가 달라진다.

// z축을 따라 뻗는 파이프 하나를 만든다.
//   CylinderGeometry 는 Y축 방향이라 X로 90° 돌려 Z축에 눕힌다.
function 파이프지오(반지름, z0, z1, x, y, 길이분할 = 24) {
  const 길이 = Math.abs(z1 - z0);
  const g = new THREE.CylinderGeometry(반지름, 반지름, 길이, 8, 길이분할);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

// 합쳐진 지오메트리에 '정점의 z 위치'로 밝기를 칠한다.
function 깊이색입히기(geo, 밝기함수) {
  if (!geo) return geo;
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = 밝기함수(pos.getZ(i));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

// ===== 벽 부착함 라벨 텍스처 =====
// 표지판은 3D로 깎지 않고 그림으로 그린다. 글자와 기호는 폴리곤으로 만들면
// 비싸기만 하고 안 예쁘다. 대신 '툰 테두리'를 그림 안에 직접 그려 넣어야
// 주변 물체의 외곽선과 굵기가 맞는다(비상계단 표지와 같은 원칙).
const 표지폰트 = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
const _벽함라벨캐시 = new Map();

// 낡음 — 라벨 위에 얼룩·긁힘을 얹는다. 새 표지판은 이 세계에 없다.
function 라벨낡음(g, W, H, seed, 세기 = 1) {
  const rnd = makeRandom(seed);
  for (let i = 0; i < 26 * 세기; i++) {
    g.globalAlpha = 0.05 + rnd() * 0.12;
    g.fillStyle = rnd() > 0.5 ? "#000000" : "#6b5a3a";
    const r = 4 + rnd() * 22;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2);
    g.fill();
  }
  // 긁힘 — 가로로 길게
  for (let i = 0; i < 8 * 세기; i++) {
    g.globalAlpha = 0.1 + rnd() * 0.18;
    g.strokeStyle = "#0d0f12";
    g.lineWidth = 0.8 + rnd() * 1.6;
    const y = rnd() * H;
    g.beginPath();
    g.moveTo(rnd() * W * 0.4, y);
    g.lineTo(rnd() * W * 0.6 + W * 0.4, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
}

// ── 배전반 라벨 — 노란 바탕 + 경고 삼각형 + 고압 문구 ──
function 배전반라벨텍스처(바탕 = "#c9a83c", 선색 = "#131314", 번호 = "N-3", 때 = 1) {
  const 키 = "b|" + 바탕 + 선색 + 번호 + 때.toFixed(2);
  if (_벽함라벨캐시.has(키)) return _벽함라벨캐시.get(키);
  const W = 320, H = 208;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });

  g.fillStyle = 선색; g.fillRect(0, 0, W, H);          // 툰 테두리
  g.fillStyle = 바탕; g.fillRect(8, 8, W - 16, H - 16);

  // 경고 삼각형 — 국제 표준 기호. 글자를 못 읽어도 뜻이 통한다.
  const cx = 74, cy = 78, r = 46;
  g.fillStyle = 선색;
  g.beginPath();
  g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.92, cy + r * 0.68);
  g.lineTo(cx - r * 0.92, cy + r * 0.68); g.closePath(); g.fill();
  g.fillStyle = 바탕;
  g.beginPath();
  g.moveTo(cx, cy - r + 12); g.lineTo(cx + r * 0.72, cy + r * 0.52);
  g.lineTo(cx - r * 0.72, cy + r * 0.52); g.closePath(); g.fill();
  // 번개 기호
  g.fillStyle = 선색;
  g.beginPath();
  g.moveTo(cx + 6, cy - 26); g.lineTo(cx - 12, cy + 4); g.lineTo(cx - 1, cy + 4);
  g.lineTo(cx - 8, cy + 30); g.lineTo(cx + 13, cy - 4); g.lineTo(cx + 1, cy - 4);
  g.closePath(); g.fill();

  g.fillStyle = 선색;
  g.textAlign = "left"; g.textBaseline = "middle";
  g.font = `700 40px ${표지폰트}`;
  g.fillText("고압 위험", 134, 58);
  g.font = `600 24px ${표지폰트}`;
  g.fillText("관계자 외 취급금지", 134, 96);
  // 아래 띠 — 관리번호
  g.fillStyle = 선색; g.fillRect(8, H - 56, W - 16, 48);
  g.fillStyle = 바탕;
  g.font = `700 30px ${표지폰트}`;
  g.fillText("배전반  " + 번호, 24, H - 31);

  라벨낡음(g, W, H, 4211, 때);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _벽함라벨캐시.set(키, t);
  return t;
}

// ── 소화전 라벨 — 붉은 바탕 + 흰 글자 ──
function 소화전라벨텍스처(바탕 = "#a5342a", 선색 = "#131314", 때 = 1) {
  const 키 = "s|" + 바탕 + 선색 + 때.toFixed(2);
  if (_벽함라벨캐시.has(키)) return _벽함라벨캐시.get(키);
  const W = 320, H = 208;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const 흰 = "#f0ece4";

  g.fillStyle = 선색; g.fillRect(0, 0, W, H);
  g.fillStyle = 바탕; g.fillRect(8, 8, W - 16, H - 16);
  g.strokeStyle = 흰; g.lineWidth = 3;
  g.strokeRect(20, 20, W - 40, H - 40);

  g.fillStyle = 흰;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `800 74px ${표지폰트}`;
  g.fillText("소화전", W / 2, 82);
  g.font = `600 26px ${표지폰트}`;
  g.fillText("FIRE HOSE CABINET", W / 2, 136);
  // 유리 깨짐 안내 띠
  g.fillStyle = 흰; g.fillRect(28, 158, W - 56, 30);
  g.fillStyle = 바탕;
  g.font = `700 20px ${표지폰트}`;
  g.fillText("화재시 유리를 깨시오", W / 2, 174);

  라벨낡음(g, W, H, 917, 때);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _벽함라벨캐시.set(키, t);
  return t;
}

// ===== 벽 부착함 (배전반 · 소화전함) =====
// [왜 넣는가]
//   ① 빈 벽을 채운다. 복도가 '문 + 벽'만이면 통로가 아니라 복도 모형처럼 보인다.
//   ② 건물이 살아 있었다는 증거다. 전기를 끌어오고 소방 설비를 달았던 흔적.
//   ③ 나중에 퍼즐로 승격시킬 씨앗이다. 지금 소품으로 심어 두면
//      나중에 '차단기를 올려 전원을 복구한다'가 뜬금없지 않다.
//
// [구성] 함체 + 문짝 + 라벨 + 부속(경첩·걸쇠) + (배전반만) 천장으로 올라가는 전선관
//   부속은 재질이 같아 하나로 병합한다 → 메시 4개(외곽선 포함 6콜).
function 벽함({
  종류 = "배전반", // "배전반" | "소화전"
  x = -30.5,
  z = -20,
  방향 = 1, // +1 이면 함의 앞면이 +x 를 향한다(= 왼쪽 바깥벽에 붙은 경우)
  폭 = 1.6, // 벽을 따라(z 방향) 놓이는 가로 길이
  높이 = 2.1,
  깊이 = 0.4, // 벽에서 튀어나온 정도
  바닥높이 = 3.1, // 바닥에서 함 아래까지
  함색 = "#565b62",
  문색 = "#4b5057",
  부속색 = "#7b828a",
  라벨바탕 = "#c9a83c",
  선색 = "#131314",
  번호 = "N-3",
  때 = 1,
  전선관 = true, // 배전반에서 천장으로 올라가는 관
  천장높이 = 8,
  전선관색 = "#474c53",
  밝기 = 1,
  여닫이켬 = false, // 문을 [E] 로 열 수 있게 할지(소화전만 켠다)
  // 활짝 열었을 때 각도(도). 90 을 넘으면 문이 함 앞면보다 더 젖혀진다.
  //   경첩이 함 앞면에 있고 문은 복도 쪽으로 열리므로, 120 까지도 벽에 안 닿는다.
  문열림각 = 102,
  속, // 소화전 속 설정 묶음(Leva 「소화전 속」)
  선,
}) {
  const d = 방향;
  const cy = 바닥높이 + 높이 / 2;
  const 라벨 = useMemo(
    () =>
      종류 === "소화전"
        ? 소화전라벨텍스처(라벨바탕, 선색, 때)
        : 배전반라벨텍스처(라벨바탕, 선색, 번호, 때),
    [종류, 라벨바탕, 선색, 번호, 때],
  );

  // ── 손잡이 홈 — 손을 넣어 당기는 '파인 자리' ─────────────
  // [왜 문에 구멍을 안 뚫었나]
  //   문짝 바로 뒤(0.02)가 함체 앞면이다. 문에 구멍을 내도 함체 표면이 곧바로
  //   보여서 깊이가 0.02 밖에 안 나온다 — 파인 것으로 안 읽힌다.
  //   그래서 **문 위에 얇은 테를 두르고 그 안을 어둡게** 깔았다.
  //   눈에는 테보다 0.05 안쪽으로 파인 홈으로 보이고, 그게 목적이다.
  //   (자판기 동전 반환구를 같은 방식으로 팠다)
  const 홈폭 = Math.min(0.11, 폭 * 0.08); // 손가락이 들어가는 폭(z)
  const 홈높 = Math.min(0.34, 높이 * 0.17);
  const 홈테 = Math.min(0.035, 폭 * 0.025);
  // 기본 폭(1.4)에서 예전 걸쇠가 있던 자리(폭/2 − 0.12)가 그대로 나온다
  const 홈z = 폭 / 2 - 0.03 - 홈테 - 홈폭 / 2;
  const 홈왼 = 홈z - 홈폭 / 2 - 홈테;

  // 부속(경첩 2 + 아래 받침)을 한 덩어리로. 걸쇠는 아래 '손잡이 홈'이 대신한다.
  const 합본 = useMemo(() => {
    const 앞 = d * (깊이 / 2 + 0.02);
    return 상자합치기([
      // 경첩 — 문짝이 열리는 쪽(z 음수 방향)
      ...[-1, 1].map((sy) => ({
        크기: [0.1, 0.28, 0.1],
        위치: [앞, cy + sy * (높이 * 0.3), -(폭 / 2) + 0.06],
      })),
      // 아래 받침 — 함이 벽에 그냥 떠 있지 않게
      { 크기: [깊이 * 0.8, 0.09, 폭 * 0.9], 위치: [d * (깊이 * 0.35), 바닥높이 - 0.05, 0] },
    ]);
  }, [d, 깊이, 폭, 높이, cy, 바닥높이]);

  // 홈 테 — 문 위에 두른 얇은 테두리. 뒤쪽은 함체 앞면까지 내려 붙여
  //   문 밖으로 조금 걸쳐도 공중에 뜨지 않게 한다.
  const 홈테지오 = useMemo(() => {
    const 두께 = 0.075; // 문 앞면 위로 서는 높이
    const x0 = d * (깊이 / 2 + 두께 / 2);
    // ★ y 기준이 0 이다 — 이 지오는 문 그룹(이미 cy 에 올라가 있다) 안에 들어간다.
    const zL = 홈z - 홈폭 / 2 - 홈테,
      zR = 홈z + 홈폭 / 2 + 홈테;
    const yB = -홈높 / 2 - 홈테,
      yT = 홈높 / 2 + 홈테;
    return 상자합치기([
      { 크기: [두께, 홈높 + 홈테 * 2, 홈테], 위치: [x0, 0, zL + 홈테 / 2] },
      { 크기: [두께, 홈높 + 홈테 * 2, 홈테], 위치: [x0, 0, zR - 홈테 / 2] },
      { 크기: [두께, 홈테, 홈폭], 위치: [x0, yT - 홈테 / 2, 홈z] },
      { 크기: [두께, 홈테, 홈폭], 위치: [x0, yB + 홈테 / 2, 홈z] },
      // 손가락 턱 — 홈 안쪽 아래에 걸친 작은 단. 여기 손가락을 걸고 당긴다.
      {
        크기: [0.045, 0.028, 홈폭],
        위치: [d * (깊이 / 2 + 0.05), -홈높 / 2 + 0.024, 홈z],
      },
    ]);
  }, [d, 깊이, 홈폭, 홈높, 홈테, 홈z]);

  // 앞이 열린 함체 껍데기 — 뒤판 + 네 변 테두리.
  //   앞 테두리(테)가 남아 **구멍이 문보다 조금 작다**. 그래야 '파인 속'으로 보인다.
  const 껍데기 = useMemo(() => {
    if (!여닫이켬) return null;
    const 테 = 0.08;
    return 상자합치기([
      { 크기: [0.08, 높이, 폭], 위치: [-d * (깊이 / 2 - 0.04), cy, 0] }, // 뒤판
      { 크기: [깊이, 높이, 테], 위치: [0, cy, -폭 / 2 + 테 / 2] }, // 좌
      { 크기: [깊이, 높이, 테], 위치: [0, cy, 폭 / 2 - 테 / 2] }, // 우
      { 크기: [깊이, 테, 폭], 위치: [0, cy + 높이 / 2 - 테 / 2, 0] }, // 위
      { 크기: [깊이, 테, 폭], 위치: [0, cy - 높이 / 2 + 테 / 2, 0] }, // 아래
    ]);
  }, [여닫이켬, 깊이, 높이, 폭, cy, d]);

  // 배전반에서 천장 트레이로 올라가는 전선관 2개
  const 관 = useMemo(() => {
    if (!전선관) return null;
    const 위 = 천장높이 - 0.1;
    const 아래 = 바닥높이 + 높이;
    if (위 <= 아래) return null;
    const 조각 = [-1, 1].map((sz) => {
      const g = new THREE.CylinderGeometry(0.062, 0.062, 위 - 아래, 8, 1);
      g.translate(d * (깊이 * 0.35), (위 + 아래) / 2, sz * 0.32);
      return g;
    });
    const 합 = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
    return 합;
  }, [전선관, 천장높이, 바닥높이, 높이, d, 깊이]);

  useEffect(
    () => () => {
      합본 && 합본.dispose();
      껍데기 && 껍데기.dispose();
      홈테지오 && 홈테지오.dispose();
      관 && 관.dispose();
    },
    [합본, 껍데기, 홈테지오, 관],
  );

  // 라벨 폭 — 손잡이 홈을 침범하지 않는 선에서 최대한 크게
  const 라벨폭 = Math.max(0.2, Math.min(폭 * 0.74, (홈왼 - 0.015) * 2));

  // ── 문 여닫기 ────────────────────────────────────────────
  //   오른쪽(+z) 손잡이를 잡아 몸쪽으로 당기면 열린다 → 경첩은 왼쪽(−z) 세로변.
  //   [왜 각도를 state 로 안 두나] 여닫는 동안 매 프레임 바뀐다.
  //   state 로 두면 그때마다 복도 전체가 다시 그려진다.
  const 문ref = useRef(null);
  const 문판ref = useRef(null);
  const 열림 = useRef(0);
  const 문id = `벽함:${종류}:${x.toFixed(1)},${z.toFixed(1)}`;
  useFrame((_, dt) => {
    const o = 문ref.current;
    if (!o) return;
    const 목표 = 여닫이켬 && 열렸나(문id) ? 1 : 0;
    열림.current += (목표 - 열림.current) * (1 - Math.exp(-dt * 9));
    // ★ 부호가 방향(d)을 따라간다.
    //   앞면이 −x 쪽(d=−1)이면 자유변이 −x 로 나와야 하므로 각도도 음수다.
    o.rotation.y = d * ((문열림각 * Math.PI) / 180) * 열림.current;
  });

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    <group position={[x, 0, z]}>
      {/* ① 함체 —
             여닫는 함은 **앞이 열린 껍데기**여야 한다. 통짜 상자로 두면
             문을 열어도 상자 앞면이 그대로 있어 속이 하나도 안 보인다. */}
      {여닫이켬 ? (
        <mesh geometry={껍데기} castShadow receiveShadow>
          <meshToonMaterial color={색밝기(함색, 밝기)} gradientMap={TOON_GRADIENT} />
          {선긋기}
        </mesh>
      ) : (
        <mesh position={[0, cy, 0]} castShadow receiveShadow>
          <boxGeometry args={[깊이, 높이, 폭]} />
          <meshToonMaterial color={색밝기(함색, 밝기)} gradientMap={TOON_GRADIENT} />
          {선긋기}
        </mesh>
      )}

      {/* ①-b 속 — 문이 열려야 보인다. 닫혀 있으면 문이 가린다.
             ★ 종류마다 속이 다르다. 소화전은 호스·밸브, 배전반은 차단기·전선. */}
      {여닫이켬 && 종류 === "배전반" && (
        <group position={[0, cy, 0]}>
          <배전반내부
            폭={폭}
            높이={높이}
            깊이={깊이}
            d={d}
            안색={속?.안색}
            판색={속?.판색}
            차단기색={속?.차단기색}
            차단기면색={속?.차단기면색}
            레버색={속?.레버색}
            동색={속?.동색}
            덕트색={속?.덕트색}
            금속색={속?.금속색}
            검은선색={속?.검은선색}
            파란선색={속?.파란선색}
            초록선색={속?.초록선색}
            빨간선색={속?.빨간선색}
            라벨색={속?.라벨색}
            차단기줄={속?.차단기줄}
            전선굵기={속?.전선굵기}
            굵은선굵기={속?.굵은선굵기}
            딱지={속?.딱지}
            밝기={밝기}
            선={
              속
                ? {
                    외곽선: 속.외곽선,
                    외곽선굵기: 속.외곽선굵기,
                    외곽선색: 속.외곽선색,
                    주름선: 속.주름선,
                  }
                : 선
            }
          />
        </group>
      )}
      {여닫이켬 && 종류 !== "배전반" && (
        <group position={[0, cy, 0]}>
          <소화전내부
            폭={폭}
            높이={높이}
            깊이={깊이}
            d={d}
            안색={속?.안색}
            금속색={속?.금속색}
            호스색={속?.호스색}
            빨강={라벨바탕}
            경종바깥색={속?.경종바깥색}
            경종속색={속?.경종속색}
            발신기바깥색={속?.발신기바깥색}
            발신기속색={속?.발신기속색}
            표시등색={속?.표시등색}
            경종크기={속?.경종크기}
            경종속크기={속?.경종속크기}
            경종높이={속?.경종높이}
            경종속위아래={속?.경종속위아래}
            발신기크기={속?.발신기크기}
            발신기속크기={속?.발신기속크기}
            빛세기={속?.빛세기}
            부품깊이={속?.부품깊이}
            밝기={밝기}
            /* 속 부품 외곽선은 함 바깥선과 따로 조절한다 */
            선={
              속
                ? {
                    외곽선: 속.외곽선,
                    외곽선굵기: 속.외곽선굵기,
                    외곽선색: 속.외곽선색,
                    주름선: 속.주름선,
                  }
                : 선
            }
          />
        </group>
      )}

      {/* ④ 부속 — 경첩·받침 합본.
             ★ 문 그룹 **밖**이다. 안에 넣으면 문을 따라 돌고, 문 그룹이
               이미 cy 에 올라가 있어서 한 번 더 올라가 공중에 뜬다. */}
      <mesh geometry={합본} castShadow>
        <meshToonMaterial color={색밝기(부속색, 밝기)} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>

      {/* ② 문짝 — 경첩은 **왼쪽(−z) 세로변**. 오른쪽 손잡이를 당겨 연다.
             문짝·라벨·손잡이가 한 그룹이라 같이 돌아간다. */}
      <group ref={문ref} position={[0, cy, -(폭 - 0.14) / 2]}>
        <group ref={문판ref} position={[0, 0, (폭 - 0.14) / 2]}>
      <mesh position={[d * (깊이 / 2 - 0.02), 0, 0]} castShadow>
        <boxGeometry args={[0.08, 높이 - 0.16, 폭 - 0.14]} />
        <meshToonMaterial color={색밝기(문색, 밝기)} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>

      {/* ③ 라벨 — 문짝 표면에 붙인 평면.
             방향에 따라 뒤집어야 글자가 정면으로 보인다. */}
      <mesh
        position={[d * (깊이 / 2 + 0.045), 높이 * 0.12, 0]}
        rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
      >
        {/* ★ 손잡이 홈 왼쪽까지만. 겹치면 홈 테가 라벨을 뚫고 나온다.
               자리가 넉넉하면 예전 폭(0.74)을 그대로 쓴다. */}
        <planeGeometry
          args={[라벨폭, 라벨폭 * (208 / 320)]}
        />
        <meshBasicMaterial map={라벨} toneMapped={false} color={색밝기("#ffffff", 밝기)} />
      </mesh>

      {/* ④-b 손잡이 홈 — 어두운 바닥판을 먼저 깔고, 그 위에 테를 두른다.
             바닥판이 문 앞면보다 0.005 앞에 있어야 문에 가려지지 않는다. */}
      <mesh position={[d * (깊이 / 2 + 0.015), 0, 홈z]}>
        <boxGeometry args={[0.02, 홈높, 홈폭]} />
        <meshToonMaterial
          color={색밝기(문색, 밝기 * 0.32)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>
      <mesh geometry={홈테지오} castShadow>
        <meshToonMaterial color={색밝기(부속색, 밝기)} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>
      {여닫이켬 && (
        <상호대상
          id={문id}
          반경={0.5}
          거리={5}
          위치={() => {
            const o = 문판ref.current;
            if (!o) return null;
            o.getWorldPosition(_벽함점);
            return [_벽함점.x, _벽함점.y, _벽함점.z];
          }}
          라벨=""
          실행={() => 여닫기(문id)}
        />
      )}
        </group>
      </group>

      {/* ⑤ 전선관 — 천장 트레이로 올라간다.
             이게 있어야 배전반이 '어디서 온 전기인지' 읽히고,
             천장 배관과 한 세트로 보인다. */}
      {관 && (
        <mesh geometry={관} castShadow>
          <meshToonMaterial
            color={색밝기(전선관색, 밝기)}
            gradientMap={TOON_GRADIENT}
          />
          {선긋기}
        </mesh>
      )}
    </group>
  );
}

function 복도배관({
  x0 = -31,
  x1 = -20,
  z0 = -60,
  z1 = 25,
  높이 = 8,
  x비율 = 0.62, // 0 = 바깥벽(문 있는 쪽), 1 = 안쪽벽. 문 위를 피해 안쪽으로 치우친다
  처짐 = 0.1, // 천장에서 얼마나 내려 달았나 — 천장에 거의 붙여 단 상태
  큰지름 = 0.18,
  작은지름 = 0.1,
  트레이폭 = 1.0,
  가로대간격 = 1.7,
  행어간격 = 6,
  파이프색 = "#474c53",
  트레이색 = "#474c54",
  행어색 = "#3e434a",
  밝기 = 0.7,
  깊이 = null, // { 문z, 감쇠, 어둠, 최소밝기, 끝어둠, 끝기울기, z0 }
  선,
}) {
  const px = x0 + (x1 - x0) * x비율;
  const py = 높이 - 처짐;

  // 벽과 같은 규칙. 깊이 정보가 없으면 감광 없음.
  // ★ 부모가 깊이={{...}} 처럼 객체를 그 자리에서 만들어 넘기면
  //   렌더할 때마다 '새 객체'라서 useMemo가 매번 다시 돈다 → 지오메트리를
  //   매 프레임 새로 만들고 버리게 된다(GPU 메모리 낭비 + 끊김).
  //   그래서 객체가 아니라 '안에 든 숫자들'을 의존성으로 쓴다.
  const { 문z: d문z, 감쇠: d감쇠, 어둠: d어둠, 최소밝기: d최소, 끝어둠: d끝어둠,
          끝기울기: d끝기울기, z0: dz0 } = 깊이 || {};
  const 밝기함수 = useMemo(() => {
    if (!깊이) return () => 밝기;
    const o = {
      문z: d문z, 감쇠: d감쇠, 어둠: d어둠, 최소밝기: d최소,
      끝어둠: d끝어둠, 끝기울기: d끝기울기, z0: dz0,
    };
    return (z) => 복도깊이밝기(z, o) * 밝기;
  }, [d문z, d감쇠, d어둠, d최소, d끝어둠, d끝기울기, dz0, 밝기, !!깊이]);

  const 합본 = useMemo(() => {
    const zA = Math.min(z0, z1) + 0.2;
    const zB = Math.max(z0, z1) - 0.2;

    // ── 파이프 다발 — 굵은 것 2 + 전선관 3, 전부 한 덩어리로 ──
    const 파이프 = mergeGeometries(
      [
        파이프지오(큰지름, zA, zB, px - 0.34, py, 40),
        파이프지오(큰지름 * 0.78, zA, zB, px + 0.02, py + 0.06, 40),
        파이프지오(작은지름, zA, zB, px + 0.3, py - 0.02, 40),
        파이프지오(작은지름, zA, zB, px + 0.42, py + 0.05, 40),
        파이프지오(작은지름 * 0.8, zA, zB, px + 0.36, py - 0.13, 40),
      ],
      false,
    );

    // ── 케이블 트레이 — 사다리형(레일 2 + 가로대) ──
    const ty = py - 0.62;
    const 가로대수 = Math.max(2, Math.floor((zB - zA) / 가로대간격));
    const 트레이 = 상자합치기([
      // 레일 2개
      ...[-1, 1].map((sx) => ({
        크기: [0.07, 0.12, zB - zA],
        위치: [px + sx * (트레이폭 / 2), ty, (zA + zB) / 2],
      })),
      // 가로대
      ...Array.from({ length: 가로대수 }, (_, i) => ({
        크기: [트레이폭, 0.04, 0.09],
        위치: [px, ty - 0.03, zA + ((zB - zA) * (i + 0.5)) / 가로대수],
      })),
    ]);

    // ── 천장 행어 — 파이프를 천장에 매다는 ㄷ자 브래킷 ──
    const 행어수 = Math.max(2, Math.floor((zB - zA) / 행어간격));
    const 행어 = 상자합치기(
      Array.from({ length: 행어수 }, (_, i) => {
        const z = zA + ((zB - zA) * (i + 0.5)) / 행어수;
        return [
          // 천장에서 내려오는 세로 막대 2개
          ...[-0.5, 0.6].map((sx) => ({
            크기: [0.06, 처짐 + 0.72, 0.06],
            위치: [px + sx, 높이 - (처짐 + 0.72) / 2, z],
          })),
          // 파이프를 받치는 가로대
          { 크기: [1.24, 0.07, 0.07], 위치: [px + 0.05, py - 0.34, z] },
          // 트레이를 받치는 가로대
          { 크기: [트레이폭 + 0.2, 0.06, 0.06], 위치: [px, ty - 0.11, z] },
        ];
      }).flat(),
    );

    return {
      파이프: 깊이색입히기(파이프, 밝기함수),
      트레이: 깊이색입히기(트레이, 밝기함수),
      행어: 깊이색입히기(행어, 밝기함수),
    };
  }, [
    px, py, z0, z1, 높이, 처짐, 큰지름, 작은지름,
    트레이폭, 가로대간격, 행어간격, 밝기함수,
  ]);

  // 지오메트리는 GPU 메모리를 잡는다. 값이 바뀌어 새로 만들면 옛것은 반드시 버린다.
  useEffect(
    () => () => {
      for (const g of Object.values(합본)) g && g.dispose();
    },
    [합본],
  );

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    <group>
      <mesh geometry={합본.파이프} castShadow>
        <meshToonMaterial
          color={파이프색}
          vertexColors
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>
      <mesh geometry={합본.트레이} castShadow>
        <meshToonMaterial
          color={트레이색}
          vertexColors
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>
      <mesh geometry={합본.행어} castShadow>
        <meshToonMaterial
          color={행어색}
          vertexColors
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>
    </group>
  );
}

function 비밀복도({
  x0 = -26.5, // 복도 바깥벽
  x1 = -20, // 방과 맞닿은 벽 (= MIN_X)
  z0 = -12,
  z1 = 10,
  높이 = 8, // 방(12)보다 낮게 — 사람이 다니라고 낸 좁은 통로 느낌
  문z = -4, // 밀리는 벽 칸 — 이 자리에는 안쪽벽을 안 세운다
  문폭 = 4.4,
  문높이: 문높이입력 = 7, // 방 쪽 구멍과 같은 높이로 맞춘다
  벽색 = "#525b69",
  아랫단색 = "#4e5462",
  바닥색 = "#3a3d42",
  천장색 = "#23262b",
  낡음 = 1.1,
  바닥시드 = 340,
  잔해 = 14,
  잔해색 = "#3b4048",
  거칠기 = 0.32,
  어둠 = 0.6, // 깊이 감광 세기 (0 = 없음, 1 = 끝이 완전히 검정)
  감쇠 = 34, // 이 거리(유닛)만큼 멀어지면 감광이 최대가 된다
  최소밝기 = 0.45, // ★ 아무리 멀어도 이 아래로는 안 어두워진다(바닥값)
  벽밝기 = 1.3, // 벽 전체에 곱하는 배수. 1보다 크면 벽이 밝아진다
  끝어둠 = 0.45, // ★ 비상계단(복도 끝) 쪽만 추가로 얼마나 어둡게 할지
  끝기울기 = 1.8, // 클수록 '끝에 가까워질 때만' 급격히 어두워진다
  seed = 88,
  선,
}) {
  const 폭 = x1 - x0;
  const 길이 = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  // ── 깊이 감광 ────────────────────────────────────────
  //   문(방으로 통하는 구멍)에서 멀어질수록 어두워진다.
  //   빛을 더 놓는 대신 '정점색'으로 재질 밝기를 직접 깎는 방식이다.
  //   장점: 조명 계산이 늘지 않고, 셀 셰이딩의 단계(2~3칸)도 안 부순다.
  //   반환값은 0~1 배수 → 재질 색에 곱해진다.
  //   [바닥값이 필요한 이유]
  //     '멀수록 어둡게'만 걸면 먼 쪽이 0에 수렴해 아무것도 안 보인다.
  //     어둠은 '분위기'지 '정보를 지우는 것'이 아니다. 그래서 하한을 둔다.
  //   [배수가 필요한 이유]
  //     벽만 따로 밝히고 싶을 때 조명을 더 켜면 셀 셰이딩이 깨진다.
  //     정점색에 곱하는 배수 하나면 조명 계산 없이 벽만 올릴 수 있다.
  const 깊이밝기 = (z) =>
    복도깊이밝기(z, { 문z, 감쇠, 어둠, 최소밝기, 끝어둠, 끝기울기, z0 }) * 벽밝기;

  // 바깥벽용 밝기 배열 — 왼쪽 끝(로컬 -w/2)이 월드 z1, 오른쪽 끝이 z0 이다.
  //   (이 그룹은 +90° 회전이라 로컬 +X = 월드 -Z)
  const 벽분할 = Math.max(4, Math.round(길이 / 7));
  const 바깥벽밝기 = useMemo(
    () =>
      Array.from({ length: 벽분할 + 1 }, (_, i) =>
        깊이밝기(z1 - (길이 * i) / 벽분할),
      ),
    [벽분할, z0, z1, 길이, 문z, 어둠, 감쇠, 최소밝기, 벽밝기, 끝어둠, 끝기울기],
  );

  const 바닥텍 = 바닥텍스처(바닥시드);
  const 바닥geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      폭,
      길이,
      Math.max(2, Math.round(폭 / 1.2)),
      Math.max(2, Math.round(길이 / 1.2)),
    );
    면얼룩(g, 바닥시드 + 9, { 개수: 22, 세기: 1.1 });
    // 면얼룩이 만들어 둔 정점색에 깊이 감광을 '곱한다'.
    //   덮어쓰면 얼룩이 사라지므로 반드시 곱셈이어야 한다.
    //   바닥판은 X축 -90° 로 눕혀 놓았다 → 로컬 y 가 월드 z 의 반대(월드z = cz - y).
    const pos = g.attributes.position;
    const col = g.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const m = 깊이밝기(cz - pos.getY(i));
      if (col) col.setXYZ(i, col.getX(i) * m, col.getY(i) * m, col.getZ(i) * m);
    }
    if (col) col.needsUpdate = true;
    return g;
  }, [폭, 길이, 바닥시드, 어둠, 감쇠, 문z, cz]);
  useEffect(() => () => 바닥geo.dispose(), [바닥geo]);

  // 바닥에 흩어진 잔해 — 오래 안 쓴 통로라는 걸 말해 주는 유일한 단서다
  const 돌들 = useMemo(() => {
    const rnd = makeRandom(seed + 17);
    return Array.from({ length: 잔해 }, (_, i) => ({
      x: x0 + 0.6 + rnd() * (폭 - 1.2),
      z: z0 + rnd() * 길이,
      y: 0.12 + rnd() * 0.3,
      s: 0.25 + rnd() * 0.9,
      r: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
      b: 0.75 + rnd() * 0.5,
      k: seed * 131 + i,
    }));
  }, [잔해, x0, z0, 폭, 길이, seed]);

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  // 안쪽벽(방 쪽)은 문 자리를 비워 두고 위·아래로 나눠 세운다.
  //   문 왼쪽 조각 / 문 오른쪽 조각 / 문 위 인방(lintel)
  const 문좌 = 문z - 문폭 / 2;
  const 문우 = 문z + 문폭 / 2;
  // 방 쪽 구멍과 같은 높이여야 문틀이 어긋나 보이지 않는다.
  //   다만 복도 천장(높이)보다는 낮아야 하므로 위로 한 번 잘라 준다.
  const 문높이 = Math.min(높이 - 0.6, 문높이입력);

  return (
    <group>
      {/* 바닥 */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, 0.01, cz]}
        geometry={바닥geo}
        receiveShadow
      >
        <meshToonMaterial
          color={바닥색}
          map={바닥텍}
          gradientMap={TOON_GRADIENT}
          vertexColors
        />
      </mesh>

      {/* 천장 — 낮고 어둡게. 질감 없이 색만으로 충분하다(거의 안 보인다) */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, 높이, cz]}>
        <planeGeometry args={[폭, 길이]} />
        <meshToonMaterial color={천장색} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* 바깥벽 (x0) — 복도 안쪽을 향하도록 +90° */}
      {/* +90° 회전이므로 로컬 +X = 월드 -Z.
             → 판의 왼쪽 끝(-w/2)이 z1, 오른쪽 끝(+w/2)이 z0 이다. */}
      <group position={[x0, 0, cz]} rotation={[0, Math.PI / 2, 0]}>
        {/* ★ 바깥벽 — 예전에는 밝기 그라데이션 때문에 24조각으로 쪼갰다.
               (판 하나는 정점이 네 개뿐이라 양 끝 두 값만 표현할 수 있어서)
               → 이제 판 '한 장'을 가로로 24칸 분할해 정점을 늘리고, 칸마다 밝기를
                 주는 방식으로 바꿨다. 정점만 늘 뿐 메시는 하나 → 드로우콜 48 → 2.
               시드·낡음은 반대쪽 벽과 같게 맞춰 무늬를 통일한다. */}
        <벽조각
          w={길이}
          h={높이 - 3}
          x={0}
          y={(높이 + 3) / 2}
          색={벽색}
          seed={seed + 21}
          낡음={낡음}
          분할={벽분할}
          밝기목록={바깥벽밝기}
        />
        <벽조각
          w={길이}
          h={3}
          x={0}
          y={1.5}
          색={아랫단색}
          seed={seed + 21}
          낡음={낡음}
          분할={벽분할}
          밝기목록={바깥벽밝기}
        />
      </group>

      {/* 양 끝벽 */}
      {[
        [z0, 0],
        [z1, Math.PI],
      ].map(([zz, ry], i) => (
        <group key={`end${i}`} position={[cx, 0, zz]} rotation={[0, ry, 0]}>
          <벽조각
            w={폭}
            h={높이 - 3}
            x={0}
            y={(높이 + 3) / 2}
            색={벽색}
            seed={seed + 21}
            낡음={낡음}
            밝기양끝={[깊이밝기(zz), 깊이밝기(zz)]}
          />
          <벽조각
            w={폭}
            h={3}
            x={0}
            y={1.5}
            색={아랫단색}
            seed={seed + 21}
            낡음={낡음}
            밝기양끝={[깊이밝기(zz), 깊이밝기(zz)]}
          />
        </group>
      ))}

      {/* 안쪽벽 (x1 = 방 쪽) — 복도를 향해 -90°. 문 자리만 비운다 */}
      <group position={[x1, 0, cz]} rotation={[0, -Math.PI / 2, 0]}>
        {/* ★ 좌표 부호 — 여기서 버그가 있었다.
              three.js 의 Y축 회전 공식:  x' = x·cosθ + z·sinθ ,  z' = -x·sinθ + z·cosθ
              θ = -90° 이면  로컬 (1,0,0) → 월드 (0,0,+1).  즉 로컬 +X = 월드 +Z 다.
              (방의 왼쪽 벽은 +90° 라서 반대. 그래서 두 벽의 공식이 다르다.)
              따라서  로컬x = 월드z - cz  가 맞는데, 앞서 부호를 뒤집어 놨었다.
              그 결과 안쪽벽의 문 구멍만 cz 기준으로 좌우가 뒤집힌 자리에 뚫려서,
              '옛 문자리에 구멍 / 새 문자리에 벽' 이 되어 있었다. */}
        {/* ★ 바깥벽과 똑같이 '위 본체 + 아래 굽' 두 장으로 나눠 세운다.
               한쪽 벽만 통짜면 복도가 좌우 비대칭으로 보여 어색하다.
               아래 굽(아랫단색)은 실제 건물의 걸레받이·타일 굽에 해당한다. */}
        {[
          { w: 문좌 - z0, c: (z0 + 문좌) / 2 },
          { w: z1 - 문우, c: (문우 + z1) / 2 },
        ].flatMap((seg, i) =>
          seg.w > 0.05
            ? [
                <벽조각
                  key={`in${i}a`}
                  w={seg.w}
                  h={높이 - 3}
                  x={seg.c - cz}
                  y={(높이 + 3) / 2}
                  색={벽색}
                  seed={seed + 21}
                  낡음={낡음}
                  밝기양끝={[
                    깊이밝기(seg.c - seg.w / 2),
                    깊이밝기(seg.c + seg.w / 2),
                  ]}
                  flipU
                />,
                <벽조각
                  key={`in${i}b`}
                  w={seg.w}
                  h={3}
                  x={seg.c - cz}
                  y={1.5}
                  색={아랫단색}
                  seed={seed + 21}
                  낡음={낡음}
                  밝기양끝={[
                    깊이밝기(seg.c - seg.w / 2),
                    깊이밝기(seg.c + seg.w / 2),
                  ]}
                  flipU
                />,
              ]
            : [],
        )}
        {/* 문 위 인방 */}
        {높이 - 문높이 > 0.05 && (
          <벽조각
            w={문폭}
            h={높이 - 문높이}
            x={문z - cz}
            y={(높이 + 문높이) / 2}
            색={벽색}
            seed={seed + 22}
            낡음={낡음}
            밝기양끝={[깊이밝기(문z), 깊이밝기(문z)]}
            flipU
          />
        )}
      </group>

      {/* 바닥 잔해 */}
      {돌들.map((c, i) => (
        <mesh
          key={`crub${i}`}
          geometry={돌지오(c.k, 거칠기)}
          position={[c.x, c.y, c.z]}
          rotation={c.r}
          scale={[c.s, c.s * 0.55, c.s * 0.8]}
          castShadow
          receiveShadow
        >
          <meshToonMaterial
            color={색밝기(잔해색, c.b)}
            gradientMap={TOON_GRADIENT}
            flatShading
          />
          {선긋기}
        </mesh>
      ))}
    </group>
  );
}

// ===== 비상계단 표지판 텍스처 =====
// 캔버스에 직접 그려서 만든다. 이미지 파일을 안 쓰는 이유:
//   ① 파일 하나 더 관리 안 해도 되고 ② 색·문구를 코드로 바꿀 수 있고
//   ③ 이 씬의 다른 질감들과 같은 방식이라 톤이 어긋나지 않는다.
// 색을 바꾸면 다시 그려야 하니 '색별'로 캐시한다(Map).
//   같은 색이면 한 번만 그리고 계속 재사용 → 매 프레임 캔버스를 다시 그리지 않는다.
const _비상표지캐시 = new Map();
function 비상계단표지텍스처(초록 = "#3f9e63", 선색 = "#131314") {
  const 키 = 초록 + "|" + 선색;
  if (_비상표지캐시.has(키)) return _비상표지캐시.get(키);

  const W = 512,
    H = 176;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const 흰 = "#f2f6f1";

  // ── ① 툰 테두리 — 우리 화풍의 핵심은 '굵고 어두운 외곽선'이다.
  //      3D 모델에는 Outlines 로 넣는 그 선을, 표지판에는 그림으로 넣는다.
  g.fillStyle = 선색;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 초록;
  g.fillRect(9, 9, W - 18, H - 18);
  // 초록 안쪽에 흰 얇은 테 — 실제 유도등에도 있는 구성이고, 색 대비를 한 겹 더 준다
  g.strokeStyle = 흰;
  g.lineWidth = 3;
  g.strokeRect(20, 20, W - 40, H - 40);

  // ── ② 픽토그램 — 문(흰 면) + 그 안에서 달려 나오는 사람(초록 실루엣)
  //      "흰 바탕 위 초록 사람" 이 표준 비상구 픽토그램의 구성이다.
  const dx = 40,
    dy = 32,
    dw = 118,
    dh = 112;
  g.fillStyle = 흰;
  g.fillRect(dx, dy, dw, dh); // 문(출입구)
  g.strokeStyle = 선색; // 문에도 툰 외곽선
  g.lineWidth = 3;
  g.strokeRect(dx, dy, dw, dh);
  // 문이 열린 쪽(오른쪽)에 문짝 두께
  g.fillStyle = 흰;
  g.fillRect(dx + dw, dy + dh - 26, 30, 12);
  g.strokeRect(dx + dw, dy + dh - 26, 30, 12);

  // 사람 — 문 색과 반대인 초록으로. 머리는 원, 몸통·팔다리는 굵은 선.
  const 사람 = (색, 굵기보정) => {
    g.fillStyle = 색;
    g.strokeStyle = 색;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.arc(78, 56, 13 + 굵기보정, 0, Math.PI * 2); // 머리
    g.fill();
    g.lineWidth = 15 + 굵기보정 * 2;
    g.beginPath();
    g.moveTo(80, 72); // 몸통
    g.lineTo(96, 104);
    g.stroke();
    g.lineWidth = 11 + 굵기보정 * 2;
    g.beginPath();
    g.moveTo(84, 80); // 앞팔 — 문 밖으로 뻗음
    g.lineTo(122, 84);
    g.moveTo(80, 78); // 뒷팔
    g.lineTo(56, 92);
    g.stroke();
    g.lineWidth = 13 + 굵기보정 * 2;
    g.beginPath();
    g.moveTo(96, 104); // 앞다리 — 문지방을 넘는다
    g.lineTo(126, 118);
    g.lineTo(146, 130);
    g.moveTo(96, 104); // 뒷다리
    g.lineTo(70, 122);
    g.lineTo(52, 132);
    g.stroke();
  };
  사람(선색, 2); // 먼저 어두운 색으로 두껍게 = 툰 외곽선
  사람(초록, 0); // 그 위에 초록으로 = 채움

  // ── ③ 글자 — 흰 글자에도 어두운 테두리를 둘러 툰 느낌을 맞춘다
  g.font = "bold 60px 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.strokeStyle = 선색;
  g.lineWidth = 8;
  g.strokeText("비상계단", 216, 78);
  g.fillStyle = 흰;
  g.fillText("비상계단", 216, 78);

  g.font = "600 24px 'Helvetica Neue', Arial, sans-serif";
  g.lineWidth = 6;
  g.strokeStyle = 선색;
  g.strokeText("EXIT", 218, 126);
  g.fillStyle = 흰;
  g.fillText("EXIT", 218, 126);

  // ── ④ 낡음 — 폐역이니 표지판도 깨끗하면 안 된다.
  //      아주 옅은 얼룩과 긁힘 몇 줄. 씬의 다른 질감과 톤을 맞추는 마지막 한 겹.
  const rnd = makeRandom(4242);
  g.globalAlpha = 0.16;
  g.fillStyle = "#0b1410";
  for (let i = 0; i < 90; i++) {
    const r = 1 + rnd() * 9;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.22;
  g.strokeStyle = "#0b1410";
  g.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const x0 = rnd() * W,
      y0 = rnd() * H;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + (rnd() - 0.5) * 120, y0 + (rnd() - 0.5) * 40);
    g.stroke();
  }
  g.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _비상표지캐시.set(키, t);
  return t;
}

// ===== 복도 형광 패널등 =====
// [왜 pointLight 하나로는 안 되나]
//   점광원 하나는 천장·바닥에 '흐릿한 타원 얼룩'만 남긴다. 셀 셰이딩과 안 맞고,
//   무엇보다 '조명 기구'가 화면에 없으니 빛의 출처를 눈이 못 찾는다.
//   → 눈에 보이는 기구(하얀 판)를 실제로 달고, 빛은 거기서 나오게 한다.
//     어두운 씬에서 밝은 물체는 그 자체가 조명처럼 읽힌다.

// 확산판(우유빛 아크릴) 텍스처 — 오래된 등이라 깨끗하면 안 된다.
//   얼룩 + 안에 들어가 죽은 벌레 자국이 '낡음'을 가장 빨리 말해 준다.
const _등판캐시 = new Map();
// ★ 캔버스 비율 주의 —
//   planeGeometry(폭, 길이) 는 UV의 x축이 '폭'(짧은 쪽), y축이 '길이'(긴 쪽)다.
//   그래서 가로로 긴 캔버스(512×128)를 쓰면 그림이 90° 눕혀져 늘어난다.
//   → 세로로 긴 캔버스(160×640)로 그려야 무늬가 등의 길이 방향을 따라간다.
//   (앞 버전이 '목재'처럼 보인 이유가 정확히 이것이다. 얼룩이 옆으로 쭉 늘어나
//    나뭇결이 됐다.)
function 형광판텍스처(seed = 1, 때 = 1) {
  const 키 = seed + "|" + 때.toFixed(2);
  if (_등판캐시.has(키)) return _등판캐시.get(키);
  const W = 160,
    H = 640;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = makeRandom(seed * 977 + 13);
  const A = (v) => Math.min(0.85, v * 때);

  // ① 바탕 — 밝아야 한다. 등은 '주변보다 밝은 것'이라서 등으로 읽힌다.
  //    때를 아무리 얹어도 이 밝기를 잡아먹으면 그냥 더러운 판때기가 된다.
  g.fillStyle = "#f2f0e7";
  g.fillRect(0, 0, W, H);

  // ② 형광등 관 2줄 — 이게 '형광등'을 만드는 결정적 단서다.
  //    확산판 뒤에 관이 있으니 그 자리만 더 밝고, 사이는 살짝 어둡다.
  for (const cx of [W * 0.3, W * 0.7]) {
    const gr = g.createLinearGradient(cx - W * 0.22, 0, cx + W * 0.22, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.95)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(cx - W * 0.22, 8, W * 0.44, H - 16);
  }
  // 관 양 끝의 검은 소켓 자국 — 형광등 특유의 디테일
  for (const cx of [W * 0.3, W * 0.7])
    for (const cy of [16, H - 16]) {
      g.fillStyle = `rgba(70,66,58,${A(0.5)})`;
      g.fillRect(cx - 13, cy - 7, 26, 14);
    }

  // ③ 누런 얼룩 — 옅게, 그리고 '군데군데'만. 판 전체를 덮으면 나무가 된다.
  for (let i = 0; i < 30; i++) {
    const cx = rnd() * W,
      cy = rnd() * H,
      r = 14 + rnd() * 70;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(122,112,88,${A(0.07 + rnd() * 0.1)})`);
    gr.addColorStop(1, "rgba(122,112,88,0)");
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // ④ 물 샌 자국 — 얇은 고리 2개만
  for (let i = 0; i < 5; i++) {
    const cx = rnd() * W,
      cy = rnd() * H,
      rx = 16 + rnd() * 40,
      ry = rx * (0.7 + rnd() * 0.5);
    g.strokeStyle = `rgba(96,84,56,${A(0.26)})`;
    g.lineWidth = 2.5;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
    g.stroke();
  }

  // ④-2 튄 자국 — 뭔가 튀어 굳은 얼룩.
  //    핵심은 '중심 덩어리 + 주변에 흩어진 작은 방울'이다.
  //    덩어리만 있으면 그냥 점이고, 방울이 붙어야 '튀었다'로 읽힌다.
  const 튄자국 = (cx, cy, 크기) => {
    g.beginPath();
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const a2 = (i / n) * Math.PI * 2;
      const r = 크기 * (0.5 + rnd() * 0.9); // 반지름을 흔들어 불규칙하게
      const px = cx + Math.cos(a2) * r;
      const py = cy + Math.sin(a2) * r * 1.2;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    for (let k = 0; k < 12; k++) {
      const a2 = rnd() * Math.PI * 2;
      const d = 크기 * (1.1 + rnd() * 2.8);
      const r2 = 크기 * (0.05 + rnd() * 0.2);
      g.beginPath();
      g.ellipse(
        cx + Math.cos(a2) * d,
        cy + Math.sin(a2) * d * 1.3,
        r2,
        r2 * (0.6 + rnd() * 0.9),
        rnd() * Math.PI,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  };
  for (let i = 0; i < 18; i++) {
    const 갈 = rnd() < 0.5 ? "72,58,36" : "54,48,40";
    g.fillStyle = `rgba(${갈},${A(0.22 + rnd() * 0.3)})`;
    튄자국(10 + rnd() * (W - 20), 20 + rnd() * (H - 40), 3 + rnd() * 9);
  }

  // ④-3 흘러내린 자국 — 튄 게 마르면서 길이 방향으로 늘어진 줄
  for (let i = 0; i < 13; i++) {
    const x = 12 + rnd() * (W - 24);
    const y0 = 20 + rnd() * (H - 140);
    const len = 30 + rnd() * 90;
    const w2 = 1.5 + rnd() * 3.5;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(70,58,38,${A(0.3)})`);
    gr.addColorStop(1, "rgba(70,58,38,0)");
    g.fillStyle = gr;
    g.fillRect(x, y0, w2, len);
    g.fillStyle = `rgba(70,58,38,${A(0.28)})`; // 아래 끝에 맺힌 방울
    g.beginPath();
    g.ellipse(x + w2 / 2, y0 + len, w2 * 1.4, w2 * 1.9, 0, 0, Math.PI * 2);
    g.fill();
  }

  // ④-4 쌓인 먼지 — 가장자리에서 안쪽으로 물결치며 덮인다.
  //    직선으로 깔면 '테두리 칠'이고, 경계가 울퉁불퉁해야 '쌓인 것'이 된다.
  const 먼지둑 = (축, 방향, 두께) => {
    g.fillStyle = `rgba(58,52,40,${A(0.3)})`;
    g.beginPath();
    if (축 === "가로") {
      const y0 = 방향 > 0 ? 0 : H;
      g.moveTo(0, y0);
      for (let x = 0; x <= W; x += 8) {
        const d = 두께 * (0.45 + 0.55 * rnd());
        g.lineTo(x, y0 + 방향 * d);
      }
      g.lineTo(W, y0);
    } else {
      const x0 = 방향 > 0 ? 0 : W;
      g.moveTo(x0, 0);
      for (let y = 0; y <= H; y += 10) {
        const d = 두께 * (0.45 + 0.55 * rnd());
        g.lineTo(x0 + 방향 * d, y);
      }
      g.lineTo(x0, H);
    }
    g.closePath();
    g.fill();
  };
  먼지둑("가로", 1, 26);
  먼지둑("가로", -1, 30);
  먼지둑("세로", 1, 22);
  먼지둑("세로", -1, 22);
  // 구석은 한 겹 더 (먼지는 구석에 제일 많이 쌓인다)
  for (const [cx, cy] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]) {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 70);
    gr.addColorStop(0, `rgba(48,42,32,${A(0.42)})`);
    gr.addColorStop(1, "rgba(48,42,32,0)");
    g.fillStyle = gr;
    g.fillRect(cx - 70, cy - 70, 140, 140);
  }

  // ⑤ 죽은 벌레 — 밝은 바탕 위의 '검은 점'이라 이게 제일 잘 읽힌다.
  //    가장자리(트로프 골)에 쌓이므로 좌우 끝 쪽에 몰아 준다.
  for (let i = 0; i < 62; i++) {
    const 가장자리로 = Math.pow(rnd(), 0.5);
    const x =
      rnd() < 0.5
        ? 6 + (1 - 가장자리로) * (W * 0.45)
        : W - 6 - (1 - 가장자리로) * (W * 0.45);
    const y = 14 + rnd() * (H - 28);
    const r = 1.6 + rnd() * (rnd() < 0.15 ? 5.5 : 2.8);
    g.fillStyle = `rgba(34,29,22,${A(0.55 + rnd() * 0.4)})`;
    g.beginPath();
    g.ellipse(
      x,
      y,
      r * (0.4 + rnd() * 0.5),
      r,
      rnd() * Math.PI,
      0,
      Math.PI * 2,
    );
    g.fill();
    if (r > 3.2) {
      g.strokeStyle = `rgba(34,29,22,${A(0.5)})`;
      g.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const a2 = rnd() * Math.PI * 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a2) * r * 1.8, y + Math.sin(a2) * r * 2.2);
        g.stroke();
      }
    }
  }

  // ⑥ 거미줄 — 네 모서리에만 아주 옅게
  g.strokeStyle = `rgba(150,146,134,${A(0.4)})`;
  g.lineWidth = 1;
  for (const [cx, cy] of [
    [6, 6],
    [W - 6, 6],
    [6, H - 6],
    [W - 6, H - 6],
  ])
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.arc(cx, cy, 10 + k * 9, 0, Math.PI * 2);
      g.stroke();
    }

  // ⑦ 테두리 때 — 틀에 닿는 가장자리만. 판 한가운데는 건드리지 않는다.
  const 테 = (x0, y0, w, h, a) => {
    g.fillStyle = `rgba(40,35,27,${A(a)})`;
    g.fillRect(x0, y0, w, h);
  };
  for (let i = 0; i < 10; i++) {
    테(0, 0, W, 2 + rnd() * 7, 0.12 + rnd() * 0.14);
    테(0, H - (2 + rnd() * 7), W, 9, 0.12 + rnd() * 0.14);
    테(0, 0, 2 + rnd() * 6, H, 0.1 + rnd() * 0.12);
    테(W - (2 + rnd() * 6), 0, 8, H, 0.1 + rnd() * 0.12);
  }

  // ⑧ 미세 점 — 아주 옅게. 밝기를 깎지 않을 정도로만.
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(60,55,45,${A(0.04 + rnd() * 0.08)})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd(), 1 + rnd());
  }

  // ⑨ 먼지 뭉치 — 솜뭉치처럼 뭉쳐 앉은 덩어리.
  //    경계가 흐린 큰 얼룩 + 그 안에 진한 심을 하나 넣으면 '덩어리'로 보인다.
  for (let i = 0; i < 14; i++) {
    const cx = rnd() * W,
      cy = rnd() * H,
      r = 8 + rnd() * 26;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(52,47,38,${A(0.3 + rnd() * 0.2)})`);
    gr.addColorStop(0.6, `rgba(52,47,38,${A(0.14)})`);
    gr.addColorStop(1, "rgba(52,47,38,0)");
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.fillStyle = `rgba(40,36,29,${A(0.35)})`;
    g.beginPath();
    g.ellipse(
      cx + (rnd() - 0.5) * r * 0.5,
      cy + (rnd() - 0.5) * r * 0.5,
      r * 0.22,
      r * 0.16,
      rnd() * Math.PI,
      0,
      Math.PI * 2,
    );
    g.fill();
  }

  // ⑩ 툰 테두리선 — 우리 화풍의 '굵고 어두운 선'을 판 그림 안에도 넣는다.
  //    3D Outlines 는 실루엣 바깥만 두르지, 판과 틀이 만나는 안쪽 경계는 못 긋는다.
  //    그 경계를 여기서 직접 그어야 셀 셰이딩 느낌이 완성된다.
  g.strokeStyle = "rgba(19,19,20,0.85)";
  g.lineWidth = 7;
  g.strokeRect(3.5, 3.5, W - 7, H - 7);
  g.strokeStyle = "rgba(19,19,20,0.35)"; // 한 겹 안쪽에 얇은 선 하나 더
  g.lineWidth = 2;
  g.strokeRect(11, 11, W - 22, H - 22);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _등판캐시.set(키, t);
  return t;
}

// 깜빡임 패턴 — '규칙적으로' 반복된다.
//   주기(초) 안에서 [시작초, 지속초] 구간에만 꺼진다. 배열이 길수록 여러 번 깜빡.
//   1번: 한 번 툭 / 2번: 빠르게 두 번 / 3번: 세 번 연달아
const 깜빡패턴 = [
  { 주기: 6.2, 오프셋: 0.0, 꺼짐: [[5.6, 0.09]] },
  {
    주기: 4.7,
    오프셋: 1.9,
    꺼짐: [
      [4.05, 0.07],
      [4.2, 0.05],
    ],
  },
  {
    주기: 8.1,
    오프셋: 3.4,
    꺼짐: [
      [7.1, 0.06],
      [7.22, 0.05],
      [7.33, 0.1],
    ],
  },
];

function 복도등({
  x = 0,
  y = 8,
  z = 0,
  회전 = 0, // Y축 회전(라디안) — 등을 비스듬히 달고 싶을 때
  폭 = 1.1,
  길이 = 4,
  판색 = "#fffce7", // 확산판 자체 색(빛 색과 별개)
  // 발광 = 판 색을 1보다 크게 곱해 흰색으로 '타오르게' 만드는 값.
  //   toneMapped={false} 라 1을 넘으면 화면에서 순백으로 뭉개진다.
  //   등이 등처럼 보이는 가장 직접적인 장치다(주변보다 확실히 밝아야 한다).
  발광 = 1.1,
  색 = "#8fa6c4", // 바닥을 비추는 빛 색
  세기 = 14.5,
  각도 = 0.51, // 스포트라이트 퍼짐 각(라디안)
  퍼짐 = 0.18, // 가장자리 흐림(1이면 테두리가 완전히 부드럽다)
  거리 = 16,
  틀색 = "#38383b",
  때 = 0.8,
  얼룩시드 = 1,
  깜빡임 = true,
  패턴 = 깜빡패턴[0],
  선,
}) {
  const 판ref = useRef();
  const 빛ref = useRef();
  const 타깃ref = useRef();
  const 텍 = 형광판텍스처(얼룩시드, 때);
  const 기준색 = useMemo(() => new THREE.Color(판색), [판색]);

  // ★ 스포트라이트는 target(비출 지점)이 '씬에 실제로 들어가 있는 물체'여야 한다.
  //   target-position 만 주면 target 이 씬에 없어서 조용히 원점(0,0,0)을 비춘다.
  //   그래서 빈 object3D 를 아래쪽에 하나 넣고, 그걸 target 으로 지정한다.
  useEffect(() => {
    if (빛ref.current && 타깃ref.current)
      빛ref.current.target = 타깃ref.current;
  }, []);

  useFrame(({ clock }) => {
    let 밝기 = 1;
    if (깜빡임) {
      const t = clock.getElapsedTime() + (패턴.오프셋 ?? 0);
      const p = t % 패턴.주기;
      for (const [s0, len] of 패턴.꺼짐) {
        if (p >= s0 && p < s0 + len) {
          밝기 = 0;
          break;
        }
        const d = p - (s0 + len);
        if (d > 0 && d < 0.16)
          밝기 = Math.min(밝기, 0.45 + Math.random() * 0.55);
      }
    }
    if (판ref.current)
      판ref.current.color
        .copy(기준색)
        .multiplyScalar((0.08 + 밝기 * 0.92) * 발광);
    if (빛ref.current) 빛ref.current.intensity = 세기 * 밝기;
  });

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    <group position={[x, y, z]} rotation={[0, 회전, 0]}>
      {/* 기구 몸체(테두리) */}
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[폭 + 0.18, 0.16, 길이 + 0.18]} />
        <meshToonMaterial color={틀색} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>
      {/* 확산판 — 아래를 향한 면. 빛을 안 받고 제 색을 내서 스스로 빛나 보인다 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[폭, 길이]} />
        <meshBasicMaterial
          ref={판ref}
          map={텍}
          toneMapped={false}
          fog={false}
        />
      </mesh>

      {/* 확산판 둘레의 어두운 테 — 밝은 판과 틀 사이를 끊어 주는 선.
             밝은 면이 배경으로 번져 보이는 걸 막아 실루엣이 또렷해진다.
             (셀 셰이딩에서 '선 한 줄'이 그림자 열 개보다 낫다) */}
      {[
        [0, -0.035, 길이 / 2, [폭 + 0.1, 0.06, 0.05]],
        [0, -0.035, -길이 / 2, [폭 + 0.1, 0.06, 0.05]],
        [폭 / 2, -0.035, 0, [0.05, 0.06, 길이 + 0.1]],
        [-폭 / 2, -0.035, 0, [0.05, 0.06, 길이 + 0.1]],
      ].map(([bx, by, bz, size], i) => (
        <mesh key={`rim${i}`} position={[bx, by, bz]}>
          <boxGeometry args={size} />
          <meshToonMaterial
            color={선?.외곽선색 ?? "#131314"}
            gradientMap={TOON_GRADIENT}
          />
        </mesh>
      ))}
      {/* ★ 점광원 → 스포트라이트로 교체.
             점광원은 사방으로 퍼져 '천장에도' 동그란 얼룩을 남긴다.
             스포트라이트는 아래쪽 원뿔만 비추므로 천장이 깨끗하게 남는다. */}
      <spotLight
        ref={빛ref}
        position={[0, -0.25, 0]}
        angle={각도}
        penumbra={퍼짐}
        distance={거리}
        decay={1.7}
        intensity={세기}
        color={색}
        castShadow={false}
      />
      <object3D ref={타깃ref} position={[0, -8, 0]} />
    </group>
  );
}

// ===== 상자 여러 개를 지오메트리 하나로 합치기 =====
// [왜]
//   문 하나에 붙는 부속(문틈선·패널선·못·경첩…)이 30~40개다. 각각이 별도 메시면
//   드로우콜도 30~40개. 그런데 이것들은 '움직이지 않고 재질이 같다'.
//   → 미리 하나의 지오메트리로 구워두면 드로우콜 1개로 끝난다.
//
// [원리]
//   각 상자를 만들고 → 위치·회전·크기를 '지오메트리 자체에' 적용(applyMatrix4) →
//   전부 이어 붙인다. 원래 mesh 의 position 이 하던 일을 정점 좌표에 미리 반영하는 것.
//
// 상자들: [{ 크기:[w,h,d], 위치:[x,y,z], 회전?:[rx,ry,rz] }]

// ===== 구역 스위치 (오클루전 컬링) =====
// [왜 필요한가]
//   지금은 방·복도·기차가 한 씬에 '전부 동시에' 존재한다. 벽에 가려 안 보일 뿐
//   three.js 는 벽 뒤에 뭐가 있는지 모른다(프러스텀 컬링은 '화면 밖'만 걸러낸다).
//   그래서 복도에 서 있어도 방 가구 전체가 매 프레임 그려진다.
//
// [해결]
//   플레이어 위치로 '지금 볼 수 있는 구역'만 켠다. group.visible = false 면
//   three 가 그 아래 전체를 통째로 건너뛴다 — 자식이 100개든 1000개든 비용 0.
//
// [왜 state 가 아니라 ref 인가]
//   useState 로 켜고 끄면 매번 React 리렌더 + GLB 재로딩이 일어난다.
//   ref 로 three 객체의 visible 만 직접 만지면 React 는 한 번도 안 돈다.
function 구역스위치({ 방, 복도, 기차, 배경, 켜기 = true }) {
  const { camera } = useThree();
  useFrame(() => {
    const p = camera.position;
    const 통 = 통로.값();

    // 끄기 옵션이면 전부 켠 상태로 되돌린다(디버깅용)
    if (!켜기) {
      for (const r of [방, 복도, 기차, 배경])
        if (r.current) r.current.visible = true;
      return;
    }

    const 복도안 = p.x < MIN_X; // 왼쪽 벽 바깥 = 복도
    const 문근처 = Math.abs(p.z - 통.문z) < 16; // 구멍으로 방이 보이는 범위

    // 방  : 복도 깊숙이 들어가 문이 안 보이면 끈다
    // 복도: 방 오른쪽(기차 쪽)에 있으면 구멍이 너무 멀어 안 보인다
    const 방켜기 = !복도안 || 문근처;
    const 복도켜기 = p.x < MIN_X + 12;

    // ★★ 기차 — 예전 조건은 `p.x > MIN_X + 2` 였다. 이게 버그였다. ★★
    //   MIN_X 는 **방의 왼쪽 벽**이다. 즉 x −20 ~ −18 은 아직 '방 안'인데
    //   거기서 이미 기차가 통째로 꺼져서, 방 왼쪽에 서서 기차 쪽을 보면
    //   그 자리가 새까맣게(캔버스 배경색 #000000) 보였다.
    //   → 방 안에서는 절대 끄지 않는다. 복도로 들어간 뒤에만 끈다.
    const 기차켜기 = !복도안 || 문근처;

    // ★ 배경(먼벽·확장천장·어둠판)은 기차와 **따로** 둔다.
    //   예전엔 기차를 끌 때 배경까지 같이 껐다. 그러면 가릴 것이 아무것도 없어져
    //   그 자리가 그대로 '검은 화면'이 된다 — 즉 컬링이 곧 암전이었다.
    //   배경은 큰 판 몇 장뿐이라 늘 켜 둬도 값이 거의 안 든다. 켜 두면
    //   기차가 꺼지는 순간에도 검정이 아니라 '기차 저편 공간'이 보인다.
    const 배경켜기 = true;

    if (방.current) 방.current.visible = 방켜기;
    if (복도.current) 복도.current.visible = 복도켜기;
    if (기차.current) 기차.current.visible = 기차켜기;
    if (배경.current) 배경.current.visible = 배경켜기;
  });
  return null;
}

// ===== 충돌 박스 보기 (디버그) =====
// 충돌은 눈에 안 보여서 "왜 막히지 / 왜 안 막히지"를 계속 추측하게 된다.
//   Leva 「사물 충돌 > 보기」를 켜면 실제 막고 있는 영역이 빨간 상자로 그려진다.
//   플레이어 반지름 R 은 hit() 안에서 더해지므로, 여기서도 R 만큼 부풀려 그려야
//   '실제로 못 들어가는 범위'와 화면이 일치한다.
function 충돌박스보기({ 보이기 = false, 높이 = 4 }) {
  const [목록, set목록] = useState([]);
  useEffect(() => {
    if (!보이기) { set목록([]); return; }
    const 갱신 = () =>
      set목록([...COLLIDERS, ...동적콜라이더.values()].map((c) => ({ ...c })));
    갱신();
    const id = setInterval(갱신, 500); // 물건을 옮기면 따라오게
    return () => clearInterval(id);
  }, [보이기]);
  if (!보이기) return null;
  return (
    <group>
      {목록.map((c, i) => {
        const w = c.maxX - c.minX + R * 2;
        const d = c.maxZ - c.minZ + R * 2;
        return (
          <mesh
            key={i}
            position={[(c.minX + c.maxX) / 2, 높이 / 2, (c.minZ + c.maxZ) / 2]}
          >
            <boxGeometry args={[w, 높이, d]} />
            <meshBasicMaterial color="#ff3b30" wireframe transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

// ===== GPU 판별 =====
// [왜 필요한가]
//   브라우저가 GPU를 못 쓰면 조용히 CPU로 3D를 계산한다(소프트웨어 렌더링).
//   에러가 안 나서 콘솔만 봐서는 절대 모른다. 그런데 속도는 10~50배 느리고,
//   메모리를 다 쓰면 컨텍스트가 날아가 화면이 검게 죽는다.
//   → 실제 렌더러 이름을 읽어와 화면에 찍는다. 캡처 한 장으로 판별된다.
function GPU이름읽기(gl) {
  try {
    const ctx = gl.getContext();
    // WEBGL_debug_renderer_info 가 있어야 '진짜 칩 이름'을 준다.
    //   없으면 브라우저가 감춘 것이라 일반 RENDERER 값으로 대체한다.
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    const 이름 = ext
      ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : ctx.getParameter(ctx.RENDERER);
    return String(이름 || "알 수 없음");
  } catch (e) {
    return "읽기 실패";
  }
}

// 이름에 이런 단어가 있으면 CPU로 그리고 있다는 뜻이다.
const 소프트웨어단어 = [
  "swiftshader", // 크롬의 CPU 렌더러
  "llvmpipe", // 리눅스 CPU 렌더러
  "software",
  "microsoft basic",
  "generic renderer",
];
function 소프트웨어렌더링인가(이름) {
  const n = 이름.toLowerCase();
  return 소프트웨어단어.some((w) => n.includes(w));
}

// ===== 성능 계기판 =====
// [왜 필요한가]
//   "느리다"는 느낌만으로는 못 고친다. 병목이 셋 중 어디인지 알아야 한다.
//     · 드로우콜(calls)  = CPU가 GPU에게 "이거 그려" 하고 부르는 횟수.
//                          물체 하나 = 최소 1콜. 여기가 크면 물체 개수가 문제.
//     · 삼각형(triangles) = GPU가 실제로 칠하는 양. 여기가 크면 모델이 무거운 것.
//     · 텍스처/지오메트리 = 메모리에 올라간 개수. 계속 늘면 '누수'다.
//   보통 웹 3D는 드로우콜 1000 넘어가면 눈에 띄게 버벅인다.
//
// [구현 메모] R3F 밖(HTML)에 글자를 그려야 해서, DOM 노드를 직접 만들어 붙인다.
//   setState 로 하면 초당 수십 번 리렌더가 되므로 textContent 만 갈아 끼운다.
// ===== 블랙박스 (크래시 직전 기록) =====
// 검은 화면이 되면 화면만 봐서는 원인을 알 수 없다.
//   ① GPU 연결이 끊겼나 (webglcontextlost)
//   ② 렌더는 도는데 씬이 다 꺼졌나 (드로우콜 급감)
//   ③ 메모리가 계속 새고 있었나 (지오메트리·텍스처 증가)
// 셋을 구분하려면 '사고 직전 몇 초'가 필요하다. 0.5초마다 한 줄씩, 최근 40줄(=20초)만 남긴다.
const 블랙박스 = {
  줄: [],            // [{t, fps, 최저, 콜, 삼, 지오, 텍, 프로, 위치}]
  최대: { 콜: 0, 지오: 0, 텍: 0, 프로: 0 },
  GPU: "",
  해상도: "",
  시작: Date.now(),
  기록(줄) {
    this.줄.push(줄);
    if (this.줄.length > 40) this.줄.shift();
    this.최대.콜 = Math.max(this.최대.콜, 줄.콜);
    this.최대.지오 = Math.max(this.최대.지오, 줄.지오);
    this.최대.텍 = Math.max(this.최대.텍, 줄.텍);
    this.최대.프로 = Math.max(this.최대.프로, 줄.프로);
  },
  // 사람이 읽을 수 있는 표로 뽑는다 — 그대로 캡처하거나 복사해서 보내면 된다
  보고서() {
    const 초 = ((Date.now() - this.시작) / 1000).toFixed(0);
    const 머리 =
      `GPU     : ${this.GPU}\n` +
      `해상도  : ${this.해상도}\n` +
      `실행시간: ${초}초\n` +
      `최대치  : 드로우콜 ${this.최대.콜} · 지오메트리 ${this.최대.지오} · 텍스처 ${this.최대.텍} · 셰이더 ${this.최대.프로}\n` +
      `\n  시각   fps  최저  드로우콜  삼각형  지오  텍스처 셰이더  카메라(x,y,z)\n`;
    const 표 = this.줄
      .map(
        (r) =>
          ` -${r.t.toFixed(1).padStart(4)}s ${String(r.fps).padStart(4)} ${String(r.최저).padStart(5)} ` +
          `${String(r.콜).padStart(9)} ${(r.삼 / 1000).toFixed(0).padStart(6)}k ${String(r.지오).padStart(5)} ` +
          `${String(r.텍).padStart(7)} ${String(r.프로).padStart(6)}   ${r.위치}`,
      )
      .join("\n");
    return 머리 + 표;
  },
};
// ★ 탭이 통째로 죽으면(크롬 "이런! 오류가 발생했습니다") 화면에 아무것도 못 띄운다.
//   그래서 0.5초마다 브라우저 저장소에도 같이 남긴다. 다시 열면 그 기록이 살아 있다.
블랙박스.저장 = function () {
  try {
    localStorage.setItem("왜곡_블랙박스", this.보고서());
    localStorage.setItem("왜곡_블랙박스_시각", new Date().toLocaleString());
  } catch (e) { /* 저장 공간이 막힌 브라우저는 그냥 넘어간다 */ }
};
블랙박스.지난기록 = (function () {
  try {
    const t = localStorage.getItem("왜곡_블랙박스");
    return t ? { 표: t, 시각: localStorage.getItem("왜곡_블랙박스_시각") || "" } : null;
  } catch (e) { return null; }
})();
블랙박스.지우기 = function () {
  try { localStorage.removeItem("왜곡_블랙박스"); localStorage.removeItem("왜곡_블랙박스_시각"); } catch (e) {}
};
if (typeof window !== "undefined") {
  window.__블랙박스 = 블랙박스;
  // 디버그용 — 콘솔에서 충돌 박스를 직접 들여다볼 수 있게 걸어둔다.
  //   window.__콜라이더 로 "지금 무엇이 길을 막고 있나"를 바로 확인한다.
  window.__콜라이더 = 동적콜라이더;
  window.__고정콜라이더 = COLLIDERS;
  window.__막힘 = (x, z) => hit(x, z);
  window.__통로 = 통로;
}

function 성능계기판({ 보이기 = true }) {
  const { gl, scene, camera } = useThree();
  // [디버그용] 콘솔에서 씬을 직접 뒤져볼 수 있게 전역에 걸어둔다.
  //   렌더에는 아무 영향이 없다(참조만 하나 더 들고 있을 뿐).
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__씬 = scene;
      window.__카메라 = camera;
      window.__gl = gl;
    }
  }, [scene, camera, gl]);
  const 칸 = useRef(null);
  const 누적 = useRef({ t: 0, f: 0, 콜: 0, 삼: 0, 최저: 999 });

  // ★ gl.info 는 렌더가 시작될 때 스스로 0으로 리셋된다(autoReset).
  //   useFrame 은 렌더 '직전'에 도는데, 그 사이 타이밍 때문에 1 같은 엉뚱한 값이 읽힌다.
  //   → 자동 리셋을 끄고, 내가 값을 챙긴 뒤 직접 리셋한다.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  // GPU 이름은 한 번만 읽으면 된다(바뀌지 않는다)
  const GPU = useMemo(() => {
    const 이름 = GPU이름읽기(gl);
    return { 이름, 소프트웨어: 소프트웨어렌더링인가(이름) };
  }, [gl]);

  useEffect(() => {
    if (!보이기) return;
    const d = document.createElement("div");
    // GPU를 못 잡았으면 빨간 테두리로 눈에 띄게 — 캡처만 봐도 바로 알 수 있게
    const 위험 = GPU.소프트웨어;
    d.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:9999;padding:6px 10px;" +
      "font:12px/1.5 ui-monospace,Menlo,monospace;" +
      (위험 ? "color:#ffd9d9;" : "color:#cfe3ff;") +
      "background:rgba(12,16,24,.88);border-radius:6px;" +
      (위험
        ? "border:2px solid #e2544a;"
        : "border:1px solid #2c3648;") +
      "max-width:340px;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(d);
    칸.current = d;
    return () => {
      d.remove();
      칸.current = null;
    };
  }, [보이기, GPU]);

  useFrame((_, dt) => {
    const i = gl.info;
    const n = 누적.current;
    // ★ 컨텍스트가 실제로 살아 있는지 직접 물어본다.
    //   gl.info 숫자는 자바스크립트가 세는 값이라 GPU가 죽어도 계속 오른다.
    //   isContextLost() 만이 진실을 말해준다.
    if (!블랙박스.컨텍스트손실) {
      try {
        if (gl.getContext().isContextLost()) 블랙박스.컨텍스트손실 = true;
      } catch (e) { 블랙박스.컨텍스트손실 = true; }
    }
    // 매 프레임 값을 걷어서 더하고 곧바로 0으로 되돌린다
    n.콜 += i.render.calls;
    n.삼 += i.render.triangles;
    i.reset();
    n.t += dt;
    n.f++;
    // dt = 이 프레임 한 장에 걸린 시간(초). 1/dt = 그 순간의 fps.
    //   평균 fps 는 '끊김'을 감춘다. 60→10→60 이어도 평균은 43 으로 보인다.
    //   그래서 창 안에서 '가장 느렸던 한 프레임'(=최저 fps)을 따로 기록한다.
    //   팀원 노트북에서 "가끔 뚝뚝 끊긴다"는 건 평균이 아니라 이 값에 나타난다.
    if (dt > 0) n.최저 = Math.min(n.최저, 1 / dt);
    if (!칸.current || n.t < 0.5) return; // 0.5초에 한 번만 화면 갱신
    const fps = n.f / n.t;
    // ★ GPU가 '얼마나 그리는지'의 진짜 단위는 픽셀 수다.
    //   drawingBuffer = 실제로 GPU가 칠하는 캔버스 해상도(= CSS크기 × DPR).
    //   레티나(DPR 2)면 같은 창이라도 픽셀이 4배다. 저사양 노트북이 죽는 1순위 원인.
    const bw = gl.domElement.width;   // 실제 렌더 버퍼 가로(px)
    const bh = gl.domElement.height;  // 실제 렌더 버퍼 세로(px)
    const 메가픽셀 = (bw * bh) / 1e6;
    // 초당 몇 메가픽셀을 칠하고 있나 = GPU 픽셀 처리량(fill rate) 체감치
    const 초당MP = 메가픽셀 * fps;
    칸.current.textContent =
      `${fps.toFixed(0)} fps  (${(1000 / fps).toFixed(1)} ms)  최저 ${n.최저.toFixed(0)}\n` +
      `드로우콜 ${Math.round(n.콜 / n.f)}\n` +
      `삼각형   ${(n.삼 / n.f / 1000).toFixed(0)}k\n` +
      `해상도 ${bw}×${bh} (${메가픽셀.toFixed(2)}MP · DPR ${window.devicePixelRatio})\n` +
      `픽셀처리 ${초당MP.toFixed(0)} MP/s\n` +
      `지오메트리 ${i.memory.geometries} · 텍스처 ${i.memory.textures}\n` +
      `셰이더 ${i.programs ? i.programs.length : "-"}\n` +
      `모드 ${저사양 ? "저사양(q=low)" : "일반"}\n` +
      `GPU: ${GPU.이름}` +
      (GPU.소프트웨어
        ? "\n⚠ GPU 미사용 — CPU로 그리는 중\n   크롬 설정 > 시스템 >\n   '하드웨어 가속 사용' 켜기"
        : "");
    // ── 블랙박스에 한 줄 남긴다 ────────────────────────────
    const p = camera.position;
    블랙박스.GPU = GPU.이름;
    블랙박스.해상도 = `${bw}×${bh} (DPR ${window.devicePixelRatio})` + (저사양 ? " · 저사양" : "");
    const 이번콜 = Math.round(n.콜 / n.f);
    블랙박스.기록({
      t: (Date.now() - 블랙박스.시작) / 1000,
      fps: Math.round(fps),
      최저: Math.round(n.최저),
      콜: 이번콜,
      삼: Math.round(n.삼 / n.f),
      지오: i.memory.geometries,
      텍: i.memory.textures,
      프로: i.programs ? i.programs.length : 0,
      위치: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
    });
    블랙박스.저장();
    // ★ 드로우콜이 갑자기 20 아래로 떨어졌는데 fps 는 멀쩡하다
    //   = GPU가 죽은 게 아니라 '그릴 게 없어진' 것 → 구역 컬링이 다 꺼버린 상황이다.
    //   검은 화면의 원인이 완전히 다르므로 화면에 따로 알린다.
    // ★ 기준을 '지금 씬에 올라와 있는 지오메트리 수'로 바꿨다.
    //   예전엔 블랙박스.최대.콜(그동안 본 최고 드로우콜)과 비교했는데,
    //   역(1100여 개) → 기차 안(30개 미만)처럼 **작은 씬으로 갈아타면**
    //   드로우콜이 정상적으로 20 아래가 되어 오탐이 났다.
    //   씬 자체가 작으면 드로우콜이 적은 게 맞으므로, 지금 씬의 크기를 본다.
    if (이번콜 < 20 && fps > 20 && i.memory.geometries > 200) {
      블랙박스.씬꺼짐 = true;
    }

    n.t = 0;
    n.f = 0;
    n.콜 = 0;
    n.삼 = 0;
    n.최저 = 999;
  });

  return null;
}

// ===== 낡은 문짝 텍스처 =====
// [핵심] 낡음은 '어둡게 하는 것'이 아니라 '얼룩덜룩하게 만드는 것'이다.
//   균일한 어두운 면은 그냥 새 문을 어두운 데 둔 것으로 보인다.
//   페인트가 벗겨져 밑칠이 드러나고, 물이 흘러 자국이 남고, 아래쪽에 때가
//   쌓여 있어야 '오래 안 쓴 문'이 된다.
const _낡은문캐시 = new Map();
function 낡은문텍스처(seed = 1, 때 = 1) {
  const 키 = seed + "|" + 때.toFixed(2);
  if (_낡은문캐시.has(키)) return _낡은문캐시.get(키);
  const W = 256,
    H = 544; // 문 비율(폭 3 : 높이 6.4)에 맞춘 세로 긴 캔버스
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = makeRandom(seed * 613 + 29);
  const A = (v) => Math.min(0.92, v * 때);

  // ① 바탕 = 칠해진 페인트. 회색빛 도는 낡은 색.
  g.fillStyle = "#9b968b";
  g.fillRect(0, 0, W, H);

  // ② 색 얼룩 — 넓게 겹쳐 색이 고르지 않게. 이게 '세월'의 바탕이다.
  for (let i = 0; i < 46; i++) {
    const cx = rnd() * W,
      cy = rnd() * H,
      r = 20 + rnd() * 120;
    const 톤 = rnd() < 0.5 ? "76,72,64" : "150,146,136";
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(${톤},${A(0.08 + rnd() * 0.16)})`);
    gr.addColorStop(1, `rgba(${톤},0)`);
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // ③ 페인트 벗겨짐 — 낡은 문의 1번 특징.
  //    가장자리를 뾰족뾰족하게 만든 다각형 + 테두리 한 줄.
  //    테두리가 있어야 '떨어져 나간 단차'로 보인다(그냥 얼룩이 아니라).
  const 벗겨짐 = (cx, cy, 크기) => {
    g.beginPath();
    const n = 9 + Math.floor(rnd() * 6);
    for (let i = 0; i <= n; i++) {
      const a2 = (i / n) * Math.PI * 2;
      const r = 크기 * (0.35 + rnd() * 0.95); // 반지름을 크게 흔든다
      const px = cx + Math.cos(a2) * r;
      const py = cy + Math.sin(a2) * r * 1.3;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = `rgba(96,88,74,${A(0.55)})`; // 드러난 밑칠
    g.fill();
    g.strokeStyle = `rgba(52,47,39,${A(0.6)})`; // 벗겨진 테두리
    g.lineWidth = 1.6;
    g.stroke();
  };
  for (let i = 0; i < 26; i++) {
    // 아래쪽·모서리에 더 많이 벗겨진다(발에 차이고 물이 닿는 곳)
    const 아래로 = Math.pow(rnd(), 0.6);
    벗겨짐(6 + rnd() * (W - 12), 20 + 아래로 * (H - 30), 4 + rnd() * 16);
  }

  // ④ 녹물·빗물 흘러내린 자국 — 위에서 아래로. 폭이 좁고 길수록 그럴듯하다
  for (let i = 0; i < 22; i++) {
    const x = rnd() * W;
    const y0 = rnd() * H * 0.55;
    const len = 60 + rnd() * 260;
    const w2 = 1 + rnd() * 4;
    const 녹 = rnd() < 0.45 ? "104,66,34" : "62,58,48";
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(${녹},${A(0.32)})`);
    gr.addColorStop(1, `rgba(${녹},0)`);
    g.fillStyle = gr;
    g.fillRect(x, y0, w2, len);
  }

  // ⑤ 물 차오른 자국 — 아래쪽에 물결치는 가로 경계선 몇 줄.
  //    바닥에 물이 고여 문 아랫부분이 젖었다 마른 흔적이다.
  for (let k = 0; k < 3; k++) {
    const base = H - 40 - k * 34 - rnd() * 20;
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, base);
    for (let x = 0; x <= W; x += 7) g.lineTo(x, base + (rnd() - 0.5) * 12);
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = `rgba(70,60,44,${A(0.16)})`;
    g.fill();
  }

  // ⑥ 아래쪽 때 — 바닥에 가까울수록 진하게
  const gb = g.createLinearGradient(0, H, 0, H * 0.6);
  gb.addColorStop(0, `rgba(38,34,27,${A(0.55)})`);
  gb.addColorStop(1, "rgba(38,34,27,0)");
  g.fillStyle = gb;
  g.fillRect(0, H * 0.6, W, H * 0.4);

  // ⑦ 긁힘 — 짧고 밝은 선. 어두운 얼룩만 있으면 '평평'해 보인다
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W,
      y = rnd() * H;
    const a2 = (rnd() - 0.5) * 0.8 + (rnd() < 0.5 ? 0 : Math.PI / 2);
    const l = 6 + rnd() * 40;
    g.strokeStyle =
      rnd() < 0.5 ? `rgba(190,186,176,${A(0.25)})` : `rgba(46,42,35,${A(0.3)})`;
    g.lineWidth = 0.8 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a2) * l, y + Math.sin(a2) * l);
    g.stroke();
  }

  // ⑧ 튄 자국 — 뭔가 튀어 굳은 얼룩
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(58,50,36,${A(0.3)})`;
    const cx = rnd() * W,
      cy = rnd() * H,
      k = 2 + rnd() * 7;
    g.beginPath();
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const a2 = (j / n) * Math.PI * 2;
      const r = k * (0.5 + rnd() * 0.9);
      const px = cx + Math.cos(a2) * r,
        py = cy + Math.sin(a2) * r;
      j === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    for (let m = 0; m < 8; m++) {
      const a2 = rnd() * Math.PI * 2,
        d = k * (1.2 + rnd() * 2.4),
        r2 = k * 0.12;
      g.beginPath();
      g.arc(cx + Math.cos(a2) * d, cy + Math.sin(a2) * d, r2, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ⑨ 미세 점
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(50,46,38,${A(0.05 + rnd() * 0.1)})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd(), 1 + rnd());
  }

  // ⑩ 툰 테두리 — 문짝 둘레에 어두운 선
  g.strokeStyle = "rgba(19,19,20,0.8)";
  g.lineWidth = 8;
  g.strokeRect(4, 4, W - 8, H - 8);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _낡은문캐시.set(키, t);
  return t;
}

// ===== 기차 출입문 텍스처 — 낡은 강철 미닫이 문 =====
// [의도] 참고 사진(KTX식) 구조: 매끈한 플러시 패널 + 파묻힌 손잡이 포켓 + 아래
//   킥패널 이음선. 색은 차체(#4A515C)와 같은 계열의 '살짝 연한' 톤(재질 color 지정).
//   ★ 문짝 판 자체는 차체 구멍(폭 0.423)을 덮는 크기라 좁히면 틈이 생긴다.
//     그래서 판은 그대로 두고 양옆에 '문틀(jamb)'을 그려 밝은 문 면만 좁아 보이게 한다.
//   ★ 한 짝을 통째로 0~1 UV 로 덮어 타일 반복 없이 자연스럽게 이어진다.
const _기차문캐시 = new Map();
function 기차문텍스처(seed = 1, opts = {}) {
  const {
    손잡이가로 = 0.78,
    손잡이세로 = 0.53,
    손잡이폭 = 0.072,
    손잡이높이 = 0.15,
    문틀폭 = 0.1,
    문틀색 = "#1c2027",
    낡음 = 1,
  } = opts;
  // 캐시 키에 옵션을 넣어야 값이 바뀔 때 새로 그린다(안 넣으면 옛 그림 재사용).
  const 키 =
    seed +
    "|" +
    [손잡이가로, 손잡이세로, 손잡이폭, 손잡이높이, 문틀폭, 낡음]
      .map((v) => v.toFixed(3))
      .join(",") +
    "|" + 문틀색;
  if (_기차문캐시.has(키)) return _기차문캐시.get(키);
  const 낡 = 낡음;
  const W = 384,
    H = 562; // 문 비율(폭 0.447 : 높이 0.655)
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = makeRandom(seed * 977 + 41);

  // 문 면(밝은 패널)이 차지하는 좌우 범위 — 양옆은 문틀이 먹는다.
  const jw = W * 문틀폭; // 문틀 폭(좌우 각각)
  const L = jw,
    R = W - jw,
    PW = R - L; // 패널 안쪽 폭

  // ── ① 바탕: 밝은 중립 강철(색은 재질 color 가 입힌다) ──
  g.fillStyle = "#d7dae0";
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 2) {
    const v = (rnd() - 0.5) * 8;
    g.fillStyle = `rgba(${Math.round(196 + v)},${Math.round(200 + v)},${Math.round(206 + v)},0.16)`;
    g.fillRect(x, 0, 1, H);
  }
  // 금속 광택 — 위에서 비스듬히 떨어지는 세로 하이라이트
  const sheen = g.createLinearGradient(0, 0, W * 0.7, H);
  sheen.addColorStop(0, "rgba(255,255,255,0.1)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0.03)");
  sheen.addColorStop(0.55, "rgba(0,0,0,0.03)");
  sheen.addColorStop(1, "rgba(0,0,0,0.08)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);
  // 넓고 옅은 톤 얼룩
  for (let i = 0; i < 20; i++) {
    const cx = L + rnd() * PW,
      cy = rnd() * H,
      r = 60 + rnd() * 140;
    const 톤 = rnd() < 0.5 ? "255,255,255" : "40,44,52";
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(${톤},${(0.03 + rnd() * 0.06).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${톤},0)`);
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // ── ② 아래 킥패널 이음선 — 패널 안쪽만 가로지른다 ──────
  const kickY = H * 0.82;
  g.strokeStyle = "rgba(30,33,39,0.42)";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(L + 4, kickY);
  g.lineTo(R - 4, kickY);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.28)";
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(L + 4, kickY + 2.6);
  g.lineTo(R - 4, kickY + 2.6);
  g.stroke();

  // ── ③ 파묻힌 손잡이 포켓 — 더 작게, 더 오른쪽 ──────────
  const round = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const pw = W * 손잡이폭,
    ph = H * 손잡이높이,
    pr = 9;
  const px = L + PW * 손잡이가로 - pw / 2,
    py = H * 손잡이세로 - ph / 2;
  let gr = g.createLinearGradient(0, py, 0, py + ph);
  gr.addColorStop(0, "rgba(20,22,27,0.9)");
  gr.addColorStop(1, "rgba(48,52,60,0.6)");
  round(px, py, pw, ph, pr);
  g.fillStyle = gr;
  g.fill();
  round(px, py, pw, ph, pr);
  g.strokeStyle = "rgba(14,16,21,0.7)";
  g.lineWidth = 2.4;
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.42)";
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(px + pr, py + ph - 1.3);
  g.lineTo(px + pw - pr, py + ph - 1.3);
  g.moveTo(px + pw - 1.3, py + pr);
  g.lineTo(px + pw - 1.3, py + ph - pr);
  g.stroke();
  // 손잡이 바 — 포켓 위쪽 가로 그립
  const bx = px + 4,
    bw = pw - 8,
    by = py + 6,
    bh = 6;
  g.fillStyle = "rgba(70,75,84,0.92)";
  g.fillRect(bx, by, bw, bh);
  g.fillStyle = "rgba(210,214,220,0.6)";
  g.fillRect(bx, by, bw, 1.4);
  g.fillStyle = "rgba(14,16,21,0.6)";
  g.fillRect(bx, by + bh - 1.4, bw, 1.4);
  g.fillStyle = "rgba(10,12,16,0.5)";
  g.fillRect(bx, by + bh, bw, ph - bh - 11);

  // ── ④ 찌그러짐 — 눌린 금속(패널 안, 은은하게) ──────────
  const 찌그러짐 = (cx, cy, r, 세기) => {
    const a = rnd() * Math.PI * 2;
    const dx = Math.cos(a),
      dy = Math.sin(a);
    let g2 = g.createRadialGradient(
      cx + dx * r * 0.4, cy + dy * r * 0.4, 0,
      cx + dx * r * 0.4, cy + dy * r * 0.4, r,
    );
    g2.addColorStop(0, `rgba(22,25,31,${(0.24 * 세기).toFixed(3)})`);
    g2.addColorStop(1, "rgba(22,25,31,0)");
    g.fillStyle = g2;
    g.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
    g2 = g.createRadialGradient(
      cx - dx * r * 0.4, cy - dy * r * 0.4, 0,
      cx - dx * r * 0.4, cy - dy * r * 0.4, r * 0.8,
    );
    g2.addColorStop(0, `rgba(255,255,255,${(0.2 * 세기).toFixed(3)})`);
    g2.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = g2;
    g.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
  };
  for (let i = 0; i < 3; i++)
    찌그러짐(L + 20 + rnd() * (PW - 40), 40 + rnd() * (H - 80), 15 + rnd() * 18, (0.6 + rnd() * 0.4) * 낡);
  찌그러짐(L + PW * (rnd() < 0.5 ? 0.2 : 0.8), H * (0.72 + rnd() * 0.14), 26 + rnd() * 12, 0.85 * 낡);

  // ── ⑤ 얼룩 — 흘러내린 때·녹물 + 번진 자국(패널 안, 절제) ─
  for (let i = 0; i < 10; i++) {
    const x = L + rnd() * PW,
      y0 = rnd() * H * 0.5,
      len = 50 + rnd() * 200,
      w2 = 1 + rnd() * 2.4;
    const 색 = rnd() < 0.3 ? "96,60,32" : "40,44,52";
    const g2 = g.createLinearGradient(0, y0, 0, y0 + len);
    g2.addColorStop(0, `rgba(${색},${((0.13 + rnd() * 0.1) * 낡).toFixed(3)})`);
    g2.addColorStop(1, `rgba(${색},0)`);
    g.fillStyle = g2;
    g.fillRect(x, y0, w2, len);
  }
  for (let i = 0; i < 3; i++) {
    const cx = L + 20 + rnd() * (PW - 40),
      cy = H * (0.55 + rnd() * 0.36),
      k = 11 + rnd() * 18;
    const 색 = rnd() < 0.5 ? "76,52,30" : "36,40,48";
    g.fillStyle = `rgba(${색},${((0.08 + rnd() * 0.08) * 낡).toFixed(3)})`;
    g.beginPath();
    const n = 12;
    for (let j = 0; j <= n; j++) {
      const a2 = (j / n) * Math.PI * 2,
        r = k * (0.5 + rnd() * 0.9);
      const qx = cx + Math.cos(a2) * r,
        qy = cy + Math.sin(a2) * r * 1.2;
      j === 0 ? g.moveTo(qx, qy) : g.lineTo(qx, qy);
    }
    g.closePath();
    g.fill();
  }

  // ── ⑥ 기스 — 손잡이 둘레 + 패널 안 몇 개 ───────────────
  const 긋기 = (x, y, l, a2, 밝) => {
    g.strokeStyle = 밝
      ? `rgba(255,255,255,${((0.13 + rnd() * 0.14) * 낡).toFixed(3)})`
      : `rgba(24,27,33,${((0.15 + rnd() * 0.15) * 낡).toFixed(3)})`;
    g.lineWidth = 0.6 + rnd() * 1.0;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a2) * l, y + Math.sin(a2) * l);
    g.stroke();
  };
  for (let i = 0; i < 18; i++)
    긋기(L + rnd() * PW, rnd() * H, 6 + rnd() * 26, (rnd() - 0.5) * 1.0 + (rnd() < 0.5 ? 0 : Math.PI / 2), rnd() < 0.5);
  for (let i = 0; i < 12; i++)
    긋기(px + pw / 2 + (rnd() - 0.5) * pw * 3, py + ph / 2 + (rnd() - 0.5) * ph * 1.8,
      7 + rnd() * 20, rnd() * Math.PI * 2, rnd() < 0.55);

  // ── ⑦ 아래쪽 때 — 킥패널 아래로 갈수록 진하게 ──────────
  const gb = g.createLinearGradient(0, H, 0, kickY - 20);
  gb.addColorStop(0, "rgba(20,22,27,0.4)");
  gb.addColorStop(1, "rgba(20,22,27,0)");
  g.fillStyle = gb;
  g.fillRect(L, kickY - 20, PW, H - (kickY - 20));

  // ── ⑧ 미세 알갱이 ────────────────────────────────────
  for (let i = 0; i < 1100; i++) {
    g.fillStyle = `rgba(34,38,45,${(0.025 + rnd() * 0.05).toFixed(3)})`;
    g.fillRect(L + rnd() * PW, rnd() * H, 1 + rnd(), 1 + rnd());
  }
  질감얹기(g, W, H, seed * 53 + 7, 0.4);

  // ── ⑨ 양옆 문틀(jamb) — 밝은 문 면을 좁아 보이게 ───────
  //   문틀은 살짝 어둡게(움푹 들어간 프레임). 안쪽 모서리에 밝은 베벨 한 줄로
  //   '문 면이 프레임보다 앞으로 나와 있다'를 만든다.
  const _hx = (h) => {
    const n = parseInt(h.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  };
  const 틀rgb = _hx(문틀색);
  g.fillStyle = `rgba(${틀rgb},0.82)`;
  g.fillRect(0, 0, jw, H);
  g.fillRect(R, 0, jw, H);
  // ★ 문틀 베벨/홈 라인과, 텍스처에 늘 굽던 검정 두꺼운 테두리는 제거했다.
  //   (문틀폭을 넘어 회색이 감싸 보이던 원인 + 조절과 무관한 검정 외곽.)
  //   외곽선은 이제 <만화선>의 조절 가능한 한 줄(외곽선굵기/색)만 쓴다.

  // ── 부드러운 가장자리 음영 — 문이 프레임에 살짝 잠긴 듯 4변을 은은하게 어둡게.
  //   딱딱한 검정 테두리 대신 이 소프트 그늘이 '자연스러운 외곽'을 만든다.
  const eg = 22;
  const 변그늘 = (x, y, w, h, x2, y2) => {
    const vg = g.createLinearGradient(x, y, x2, y2);
    vg.addColorStop(0, "rgba(8,10,14,0.42)");
    vg.addColorStop(1, "rgba(8,10,14,0)");
    g.fillStyle = vg;
    g.fillRect(x, y, w, h);
  };
  변그늘(0, 0, W, eg, 0, eg); // 위
  {
    const vg = g.createLinearGradient(0, H, 0, H - eg);
    vg.addColorStop(0, "rgba(8,10,14,0.42)");
    vg.addColorStop(1, "rgba(8,10,14,0)");
    g.fillStyle = vg;
    g.fillRect(0, H - eg, W, eg);
  } // 아래
  변그늘(0, 0, eg, H, eg, 0); // 왼
  {
    const vg = g.createLinearGradient(W, 0, W - eg, 0);
    vg.addColorStop(0, "rgba(8,10,14,0.42)");
    vg.addColorStop(1, "rgba(8,10,14,0)");
    g.fillStyle = vg;
    g.fillRect(W - eg, 0, eg, H);
  } // 오른

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _기차문캐시.set(키, t);
  return t;
}

// ===== 복도 측면 문 (오래 안 쓴 낡은 문) =====
// 벽면이 x 에 수직이라 '깊이 = x, 폭 = z, 높이 = y' 로 짠다.
//   글자(명패)는 넣지 않는다 — 여기는 튜토리얼 구간이고,
//   이 문들은 '열리지 않는 배경'이다. 이름표가 붙으면 열 수 있을 것 같아진다.
// ===== 널빤지 — 낡아 부서질 듯한 판재 =====
// 상자 하나를 그대로 쓰면 '새로 켠 각재'로 보인다. 세 가지를 흐트러뜨린다:
//   ① 뒤틀림 — 길이를 따라 완만하게 휜다(마른 나무는 반드시 휜다)
//   ② 표면 요철 — 면을 자잘하게 흔들어 결이 살아나게
//   ③ 쪼개진 끝 — 톱으로 자른 게 아니라 부러뜨린 것처럼 양 끝이 들쭉날쭉
function 널빤지지오(seed, 두께, 폭, 길이) {
  const g = new THREE.BoxGeometry(두께, 폭, 길이, 2, 3, 18);
  const rnd = makeRandom(seed * 131 + 7);
  const P = g.attributes.position.array;
  const 반 = 길이 / 2;
  const 위상 = rnd() * 6.283;
  for (let i = 0; i < g.attributes.position.count; i++) {
    const z = P[i * 3 + 2];
    const t = 반 ? z / 반 : 0; // -1(한쪽 끝) ~ 1(반대쪽 끝)
    // ① 뒤틀림
    P[i * 3 + 1] += Math.sin(t * 2.2 + 위상) * 폭 * 0.16;
    P[i * 3] += Math.cos(t * 1.7 + 위상) * 두께 * 0.35;
    // ③ 끝 쪼개짐 — 끝에서 28% 구간만 파고든다
    const 끝 = Math.max(0, Math.abs(t) - 0.72) / 0.28;
    if (끝 > 0) {
      P[i * 3 + 2] -= Math.sign(z) * 끝 * 반 * (0.05 + rnd() * 0.24);
      P[i * 3 + 1] += (rnd() - 0.5) * 폭 * 0.55 * 끝;
    }
    // ② 표면 요철
    P[i * 3] += (rnd() - 0.5) * 두께 * 0.35;
    P[i * 3 + 1] += (rnd() - 0.5) * 폭 * 0.1;
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function 복도측면문({
  x = -31,
  z = 0,
  방향 = 1, // +1 이면 문이 +x(복도 안)를 향한다
  폭 = 3.0,
  높이 = 6.4,
  // ── 색은 부위별로 전부 따로 받는다 ─────────────────────
  문색 = "#8b8880",
  리빌색 = "#3a3831",
  틈색 = "#5a6064",
  패널선색 = "#6a7076",
  경첩색 = "#6b4a2f",
  손잡이색 = "#8d8378",
  잠금판색 = "#5a5148",
  열쇠구멍색 = "#0c0e11",
  문턱색 = "#3f443f",
  판자색 = "#6a5b45",
  못색 = "#8a8078",
  틀돌출 = 0.06, // 문틀(케이싱)이 벽에서 나온 정도 — 얇게
  내림 = 0.03, // 문짝이 문틀 면보다 안쪽으로 들어간 정도
  발판돌출 = 0.06, // 문 밑 발판(문턱)이 복도로 나온 정도
  외곽선 = true,
  외곽선색 = "#131314",
  외곽선굵기 = 5,
  문두께 = 0.09,
  때 = 1,
  판자 = false,
  밝기 = 1,
  seed = 1,
  선,
}) {
  const 텍 = 낡은문텍스처(seed, 때);
  const 문 = 색밝기(문색, 밝기);
  const 틈 = 색밝기(틈색, 밝기);
  const 패널선 = 색밝기(패널선색, 밝기);
  const 선긋기 = 외곽선 ? (
    <Outlines thickness={외곽선굵기} color={외곽선색} />
  ) : null;

  const d = 방향;
  // 문짝은 개구부를 거의 꽉 채운다(둘레 틈만 살짝). 예전엔 폭-0.12 라 틈이 컸다.
  const 문w = 폭 - 0.06;
  const 문h = 높이 - 0.06;
  // ── 벽(x=0)은 꽉 찬 평면이다. 그래서 문은 그 벽에 '얕게 박힌' 플러시 문으로 짠다.
  //   깊은 알코브는 벽에 실제 구멍을 뚫어야 되는데 지금 바깥벽은 통짜라, 여기선 얕게.
  //   문짝 뒷면은 자연히 벽 뒤로 숨고(가려짐) 앞면만 살짝 나온다 → 두꺼운 슬래브 X.
  const 틀돌출c = Math.max(0, Math.min(틀돌출, 0.25)); // 문틀이 벽에서 나온 깊이
  const 틀d = Math.max(0.02, 틀돌출c); // 지오메트리용(0이면 퇴화 방지)
  const 내림c = Math.max(0, Math.min(내림, 0.1)); // 문짝이 문틀보다 들어간 깊이
  const 발판c = Math.max(0, Math.min(발판돌출, 0.4)); // 발판이 복도로 나온 깊이
  const 문앞면 = d * Math.max(0.01, 틀돌출c - 0.02 - 내림c); // 문 앞면(벽보다 앞, 문틀면보다 안)
  const 문앞 = 문앞면 - d * (문두께 / 2); // 문짝 중심 x — 아래 부속들이 이 값 기준
  const 앞 = 문앞 + d * (문두께 / 2 + 0.02); // 문 앞면 위에 살짝 뜬 선/패널
  const 굵 = 0.05;

  // ★ 부속을 재질별로 미리 '하나의 지오메트리'로 구워 둔다.
  //   전에는 문 하나가 메시 34개 = 드로우콜 34개(외곽선 포함하면 그 2배)였다.
  //   재질이 같고 움직이지 않는 것들이라 합쳐도 그림이 똑같다.
  const 합본 = useMemo(() => {
    // (문선/케이싱 제거 — 문 둘레를 감싸던 나무 테두리를 걷어냈다.
    //  이제 벽에 뚫린 개구부 안쪽면(리빌)이 그대로 테두리 역할을 한다.)

    // ② 문틈 선 4개 → 1개
    const 문틈 = 상자합치기([
      { 크기: [굵, 굵, 문w], 위치: [앞, 높이 / 2 + 문h / 2, 0] },
      { 크기: [굵, 굵, 문w], 위치: [앞, 높이 / 2 - 문h / 2, 0] },
      ...[-1, 1].map((sz) => ({
        크기: [굵, 문h, 굵],
        위치: [앞, 높이 / 2, sz * (문w / 2)],
      })),
    ]);

    // ③ 패널 테두리 2세트 × 4줄 = 8개 → 1개
    const pw = 문w - 0.7;
    const 패널 = 상자합치기(
      [
        { cy: 높이 * 0.62, ph: 높이 * 0.42 },
        { cy: 높이 * 0.25, ph: 높이 * 0.26 },
      ].flatMap((pn) => [
        { 크기: [굵 * 0.9, 굵 * 0.9, pw], 위치: [앞, pn.cy + pn.ph / 2, 0] },
        { 크기: [굵 * 0.9, 굵 * 0.9, pw], 위치: [앞, pn.cy - pn.ph / 2, 0] },
        ...[-1, 1].map((sz) => ({
          크기: [굵 * 0.9, pn.ph, 굵 * 0.9],
          위치: [앞, pn.cy, sz * (pw / 2)],
        })),
      ]),
    );

    // ④ 경첩 3개 → 1개
    const 경첩 = 상자합치기(
      [0.78, 0.5, 0.2].map((t) => ({
        크기: [0.1, 0.5, 0.22],
        위치: [
          문앞 + d * (문두께 / 2 + 0.02),
          0.4 + t * (문h - 0.6),
          -문w / 2 + 0.02,
        ],
      })),
    );

    // ⑤ 널빤지에 박힌 못 4개 → 1개 (널빤지 그룹 안 좌표 기준)
    const 못 = 상자합치기(
      [-1, 1].flatMap((sz) =>
        [-0.14, 0.14].map((oy) => ({
          크기: [0.05, 0.09, 0.09],
          위치: [d * 0.09, oy, sz * (폭 * 0.42)],
        })),
      ),
    );

    // ⓪ 문틀(케이싱) — 개구부를 감싸는 얇은 테두리(상 + 좌우) → 1개.
    //    벽면(x=0)에서 틀d 만큼만 나온다. 두꺼운 상자가 아니라 얇은 테.
    const 틀두께 = 0.16;
    const 문틀 = 상자합치기([
      {
        크기: [틀d, 틀두께, 폭 + 2 * 틀두께],
        위치: [d * (틀d / 2), 높이 + 틀두께 / 2 - 0.03, 0],
      },
      ...[-1, 1].map((sz) => ({
        크기: [틀d, 높이 + 틀두께, 틀두께],
        위치: [d * (틀d / 2), 높이 / 2, sz * (폭 / 2 + 틀두께 / 2)],
      })),
    ]);

    return { 문틈, 패널, 경첩, 못, 문틀 };
  }, [폭, 높이, 문두께, 틀d, d, 앞, 문앞, 문w, 문h, 굵]);

  useEffect(
    () => () => {
      for (const g of Object.values(합본)) g && g.dispose();
    },
    [합본],
  );

  const rnd = makeRandom(seed * 97 + 5);

  return (
    <group position={[x, 0, z]}>
      {/* ① 문틀(케이싱) — 벽에서 얇게 나온 테두리. 예전의 두꺼운 리빌 상자를 대체. */}
      <mesh geometry={합본.문틀} castShadow>
        <meshToonMaterial
          color={색밝기(리빌색, 밝기 * 1.1)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>

      {/* ③ 문짝 */}
      <mesh position={[문앞, 높이 / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[문두께, 문h, 문w]} />
        <meshToonMaterial color={문} map={텍} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>

      {/* ④ 문틈 선 (4줄 합본) */}
      <mesh geometry={합본.문틈}>
        <meshToonMaterial color={틈} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* ⑤ 패널 테두리 (8줄 합본) */}
      <mesh geometry={합본.패널}>
        <meshToonMaterial color={패널선} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* ⑥ 경첩 (3개 합본) */}
      <mesh geometry={합본.경첩} castShadow>
        <meshToonMaterial
          color={색밝기(경첩색, 밝기)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>

      {/* ⑦ 손잡이 — 뒷판 + 노브 + 열쇠구멍 (색이 달라 합치지 않는다) */}
      <mesh position={[문앞 + d * (문두께 / 2 + 0.02), 높이 * 0.44, 문w / 2 - 0.45]}>
        <boxGeometry args={[0.05, 0.7, 0.34]} />
        <meshToonMaterial
          color={색밝기(잠금판색, 밝기)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>
      <mesh
        position={[문앞 + d * (문두께 / 2 + 0.13), 높이 * 0.44, 문w / 2 - 0.45]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.17, 0.2, 0.26, 12]} />
        <meshToonMaterial
          color={색밝기(손잡이색, 밝기)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>
      <mesh position={[문앞 + d * (문두께 / 2 + 0.03), 높이 * 0.36, 문w / 2 - 0.45]}>
        <boxGeometry args={[0.03, 0.13, 0.08]} />
        <meshToonMaterial color={열쇠구멍색} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* ⑧ 널빤지 — 못은 4개를 하나로 합쳤다 */}
      {판자 &&
        [0.28, -0.2].map((rot, i) => {
          const y = 높이 * (i === 0 ? 0.55 : 0.3);
          return (
            <group
              key={`bd${i}`}
              position={[앞 + d * 0.06, y, 0]}
              rotation={[rot, 0, 0]}
            >
              <mesh castShadow>
                <boxGeometry args={[0.14, 0.62, 폭 + 0.5]} />
                <meshToonMaterial
                  color={색밝기(판자색, 밝기 * (0.85 + rnd() * 0.3))}
                  map={낡은문텍스처(seed + 70 + i, 때)}
                  gradientMap={TOON_GRADIENT}
                />
                {선긋기}
              </mesh>
              <mesh geometry={합본.못}>
                <meshToonMaterial
                  color={색밝기(못색, 밝기)}
                  gradientMap={TOON_GRADIENT}
                />
              </mesh>
            </group>
          );
        })}

      {/* ⑨ 발판(문턱) — 개구부 밑, 벽에서 복도로 발판c 만큼 나온 얕은 턱 */}
      <mesh position={[d * (발판c / 2), 0.06, 0]} receiveShadow>
        <boxGeometry args={[Math.max(0.04, 발판c), 0.12, 폭 + 0.12]} />
        <meshToonMaterial
          color={색밝기(문턱색, 밝기)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>
    </group>
  );
}

// ===== 복도 끝 비상계단 문 (닫혀 있는 철문) =====
// 이 문은 '열리는 문'이 아니라 '여기서 끝'을 알려 주는 장치다.
//   복도가 아무 표시 없이 벽으로 끝나면 미완성으로 보이지만,
//   닫힌 문 하나가 있으면 "저 너머에도 공간이 있다"는 인상이 생긴다.
//   (플레이어는 나중에 보이지 않는 벽으로 이 앞에서 막을 예정)
function 복도끝문({
  x = -25.5, // 복도 중앙 x
  z = -30, // 끝벽 z
  안쪽 = 1, // +1 이면 문이 +z 쪽(복도 안)을 향한다
  폭 = 3.4,
  높이 = 6.6,
  문색 = "#1c1d21",
  틀색 = "#1e2024",
  손잡이색 = "#cdd9e5",
  // ★ 우리 화풍에서 '선'은 어두운 외곽선이다. 그런데 이 문은 색 자체가 거의
  //   검정이라, 검은 선을 그으면 아무것도 안 보인다.
  //   → 이 문만은 선을 '밝은 쪽'으로 뒤집는다. 어두운 면 위의 밝은 모서리는
  //     실제로도 빛을 받은 금속 모서리라 자연스럽고, 실루엣이 살아난다.
  라인색 = "#41484b",
  대비 = 1.35, // 문틀을 문짝보다 이만큼 밝게 → 두 면이 붙어 보이지 않게
  선폭 = 0.75,
  선두께 = 0.15,
  문두께 = 0.05,
  유도등 = true,
  유도등크기 = 0.62,
  유도등높이 = 0.65,
  유도등테색 = "#31333b",
  유도등바탕색 = "#3f9e63",
  밝기 = 1,
  선,
}) {
  const 표지 = 비상계단표지텍스처(유도등바탕색, 선?.외곽선색 ?? "#131314");

  const zf = z + 안쪽 * 0.1;
  const 문 = 색밝기(문색, 밝기);
  const 틀 = 색밝기(틀색, 밝기 * 대비);
  const 라인 = 색밝기(라인색, 밝기);
  // 툰 외곽선 — 이 문만 밝은 선을 쓴다
  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={라인} />
  ) : null;

  // 얇은 '선 막대' 하나를 만드는 도우미.
  //   면과 면 사이에 밝은 막대를 끼우면 그게 곧 선이 된다.
  //   (텍스처로 선을 그리면 각도에 따라 뭉개지지만, 실제 막대는 안 뭉개진다)
  const 선막대 = (key, pos, size, 색 = 라인) => (
    <mesh key={key} position={pos}>
      <boxGeometry args={size} />
      <meshToonMaterial color={색} gradientMap={TOON_GRADIENT} />
    </mesh>
  );

  const 굵기 = 0.05; // 선 막대 두께
  const 앞 = zf + 안쪽 * (문두께 / 2 + 0.07); // 문짝 표면보다 살짝 앞
  const 문w = 폭 - 0.12;
  const 문h = 높이 - 0.1;

  // ★ 같은 재질의 부속을 하나의 지오메트리로 미리 합친다 (드로우콜 절약).
  //   이 문은 벽면이 z 에 수직이라 '폭 = x, 깊이 = z' 방향이다.
  const 합본 = useMemo(() => {
    // 문선(케이싱) 좌·우·상 3개
    const 문선 = 상자합치기([
      ...[-1, 1].map((sx) => ({
        크기: [선폭, 높이 + 선폭, 선두께],
        위치: [sx * (폭 / 2 + 선폭 / 2), (높이 + 선폭) / 2, zf + 안쪽 * 0.1],
      })),
      {
        크기: [폭 + 선폭 * 2, 선폭, 선두께],
        위치: [0, 높이 + 선폭 / 2, zf + 안쪽 * 0.1],
      },
    ]);
    // 문틈 4줄
    const 문틈 = 상자합치기([
      { 크기: [문w, 굵기, 굵기], 위치: [0, 높이 / 2 + 문h / 2, 앞] },
      { 크기: [문w, 굵기, 굵기], 위치: [0, 높이 / 2 - 문h / 2, 앞] },
      ...[-1, 1].map((sx) => ({
        크기: [굵기, 문h, 굵기],
        위치: [sx * (문w / 2), 높이 / 2, 앞],
      })),
    ]);
    // 패널 스크라이브 4줄
    const iw = 문w - 0.7,
      ih = 문h - 0.9,
      cy = 높이 / 2 + 0.08;
    const 패널 = 상자합치기([
      { 크기: [iw, 굵기 * 0.7, 굵기 * 0.7], 위치: [0, cy + ih / 2, 앞] },
      { 크기: [iw, 굵기 * 0.7, 굵기 * 0.7], 위치: [0, cy - ih / 2, 앞] },
      ...[-1, 1].map((sx) => ({
        크기: [굵기 * 0.7, ih, 굵기 * 0.7],
        위치: [sx * (iw / 2), cy, 앞],
      })),
    ]);
    // 경첩 3개
    const 경첩 = 상자합치기(
      [0.78, 0.5, 0.2].map((t) => ({
        크기: [0.22, 0.5, 0.1],
        위치: [
          -문w / 2 + 0.02,
          0.4 + t * (문h - 0.6),
          zf + 안쪽 * (문두께 / 2 + 0.04),
        ],
      })),
    );
    return { 문선, 문틈, 패널, 경첩 };
  }, [폭, 높이, 선폭, 선두께, 문두께, zf, 안쪽, 앞, 문w, 문h, 굵기]);

  useEffect(
    () => () => {
      for (const g of Object.values(합본)) g && g.dispose();
    },
    [합본],
  );

  return (
    <group>
      {/* ① 문선(케이싱) — 좌·우·상 3조각을 하나의 지오메트리로 합쳤다 */}
      <mesh geometry={합본.문선} position={[x, 0, 0]} castShadow>
        <meshToonMaterial color={틀} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>

      {/* ② 개구부 안쪽면(리빌) — 문선과 문짝 사이의 깊이 */}
      <mesh position={[x, 높이 / 2, zf - 안쪽 * 0.02]}>
        <boxGeometry args={[폭 + 0.04, 높이 + 0.04, 0.3]} />
        <meshToonMaterial
          color={색밝기(틀색, 밝기 * 0.55)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>

      {/* ③ 문짝 — 민짜 한 장 */}
      <mesh position={[x, 높이 / 2, zf + 안쪽 * 0.06]} castShadow receiveShadow>
        <boxGeometry args={[문w, 문h, 문두께]} />
        <meshToonMaterial color={문} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>

      {/* ④ 문틈 선 — 문짝 둘레의 밝은 테.
             '문짝이 문틀에 끼워진 별개의 판'이라는 걸 말해 주는 가장 싼 신호다. */}
      <mesh geometry={합본.문틈} position={[x, 0, 0]}>
        <meshToonMaterial color={라인} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* ⑤ 패널 스크라이브 — 문 안쪽에 새긴 직사각형 테두리.
             오래된 관공서 문의 특징이고, 큰 검은 면 하나를 둘로 나눠
             '읽을 것'을 만들어 준다. */}
      <mesh geometry={합본.패널} position={[x, 0, 0]}>
        <meshToonMaterial color={라인} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* ⑥ 킥플레이트 — 문 아래를 막는 금속판. 발로 밀고 다녀 낡은 부분이다.
             바닥과 문 사이에 '단'을 만들어 문이 떠 보이지 않게 한다. */}
      <mesh position={[x, 0.62, zf + 안쪽 * (문두께 / 2 + 0.05)]} castShadow>
        <boxGeometry args={[문w - 0.16, 0.85, 0.05]} />
        <meshToonMaterial
          color={색밝기(문색, 밝기 * 2.1)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>

      {/* ⑦ 경첩 3개 — 왼쪽 모서리.
             "어느 쪽으로 열리는 문인가"를 알려 주는 유일한 단서다. */}
      <mesh geometry={합본.경첩} position={[x, 0, 0]} castShadow>
        <meshToonMaterial
          color={색밝기(라인색, 밝기 * 0.85)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>

      {/* ⑧ 손잡이 — 뒷판(에스커천) + 레버.
             손잡이만 밝아서 어둠 속에서 시선이 여기로 모인다. */}
      <mesh
        position={[
          x + 폭 / 2 - 0.5,
          높이 * 0.45,
          zf + 안쪽 * (문두께 / 2 + 0.05),
        ]}
      >
        <boxGeometry args={[0.34, 0.62, 0.05]} />
        <meshToonMaterial
          color={색밝기(라인색, 밝기 * 0.9)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>
      <mesh
        position={[x + 폭 / 2 - 0.5, 높이 * 0.45, zf + 안쪽 * 0.22]}
        castShadow
      >
        <boxGeometry args={[0.62, 0.13, 0.13]} />
        <meshToonMaterial
          color={색밝기(손잡이색, 밝기)}
          gradientMap={TOON_GRADIENT}
        />
        {선긋기}
      </mesh>

      {/* ⑨ 유도등 */}
      {유도등 && (
        <group position={[x, 높이 + 선폭 + 유도등높이, zf + 안쪽 * 0.12]}>
          {/* 케이스는 표지판 '뒤'에 — 상자 두께는 중심 기준이라
                 앞으로 튀어나와 표지판을 덮기 쉽다. 외곽선도 붙이지 않는다. */}
          <mesh position={[0, 0, -안쪽 * 0.13]}>
            <boxGeometry
              args={[
                폭 * 유도등크기 + 0.12,
                폭 * 유도등크기 * (176 / 512) + 0.12,
                0.16,
              ]}
            />
            <meshToonMaterial
              color={색밝기(유도등테색, 밝기)}
              gradientMap={TOON_GRADIENT}
            />
          </mesh>
          <mesh
            position={[0, 0, 안쪽 * 0.02]}
            rotation={[0, 안쪽 > 0 ? 0 : Math.PI, 0]}
          >
            <planeGeometry
              args={[폭 * 유도등크기, 폭 * 유도등크기 * (176 / 512)]}
            />
            <meshBasicMaterial map={표지} toneMapped={false} fog={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ===== 부서진 문틀 (벽에 뚫린 구멍의 테두리) =====
// [1차 시도의 실패] 벽은 통짜로 두고 그 앞에 판 하나 세워 돌을 붙였다.
//   그러니 '뚫린 구멍'이 아니라 '벽에 기대 놓은 판때기'로 보였다.
//
// 무언가가 '뚫렸다'고 읽히려면 세 가지가 필요하다.
//   ① 벽에 진짜 구멍이 있어야 한다      → 벽을 쪼개 그 자리를 안 그린다
//   ② 구멍 안쪽에 두께가 보여야 한다    → 리빌(개구부 안쪽면)을 세운다  ★이게 핵심
//   ③ 테두리가 찢어져 있어야 한다       → 둘레에 벽색 덩어리를 물린다
// 평면 벽은 두께가 0이라, ②가 없으면 아무리 꾸며도 종이에 뚫은 구멍처럼 보인다.
function 부서진문틀({
  x = -20, // 벽면 x
  문z = -4,
  문폭 = 4.4,
  문높이 = 7,
  두께 = 0.7, // 벽 두께 — 이만큼이 구멍 안쪽에 드러난다
  벽색 = "#4a5058",
  안쪽색 = "#2a2e34", // 리빌은 빛이 잘 안 들어 더 어둡다
  잔해색 = "#3b4048",
  거칠기 = 0.32,
  // 테두리 덩어리·발치 잔해를 그릴지. false면 '깨끗하게 뚫린 구멍'만 남는다.
  잔해보이기 = true,
  seed = 77,
  선,
}) {
  const 데이터 = useMemo(() => {
    const rnd = makeRandom(seed + 909);
    // 찢어진 테두리 — 개구부 둘레를 따라 벽색 덩어리를 박는다.
    //   위·좌·우만. 바닥 쪽은 잔해가 쌓이니까 따로 안 한다.
    const 테 = [];
    const 놓기 = (개수, 만들기) => {
      for (let i = 0; i < 개수; i++) 테.push(만들기(rnd, i));
    };
    놓기(7, (r, i) => ({
      // 위쪽 테두리
      y: 문높이 + (r() - 0.5) * 0.5,
      z: 문z - 문폭 / 2 + (문폭 / 6) * i + (r() - 0.5) * 0.4,
      s: 0.5 + r() * 1.1,
      k: seed * 31 + i,
    }));
    놓기(5, (r, i) => ({
      y: 1.2 + (문높이 / 5) * i + (r() - 0.5) * 0.6,
      z: 문z - 문폭 / 2 + (r() - 0.5) * 0.5,
      s: 0.45 + r() * 1.0,
      k: seed * 53 + i,
    }));
    놓기(5, (r, i) => ({
      y: 1.2 + (문높이 / 5) * i + (r() - 0.5) * 0.6,
      z: 문z + 문폭 / 2 + (r() - 0.5) * 0.5,
      s: 0.45 + r() * 1.0,
      k: seed * 71 + i,
    }));
    // 양쪽 바닥에 흘러내린 잔해 (방 쪽 +x, 복도 쪽 -x)
    const 바닥 = [];
    for (let side of [1, -1])
      for (let i = 0; i < 7; i++) {
        const d = rnd();
        바닥.push({
          x: x + side * (0.5 + d * 2.6),
          z: 문z + (rnd() - 0.5) * (문폭 + 1.5),
          y: 0.15 + rnd() * 0.3,
          s: (0.35 + rnd() * 1.0) * (1 - d * 0.4),
          r: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
          b: 0.75 + rnd() * 0.5,
          k: seed * 97 + side * 13 + i,
        });
      }
    return { 테, 바닥 };
  }, [x, 문z, 문폭, 문높이, seed]);

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;
  const 툰 = (색, flat) => (
    <meshToonMaterial
      color={색}
      gradientMap={TOON_GRADIENT}
      flatShading={flat}
    />
  );

  return (
    <group>
      {/* ① 리빌 — 개구부 안쪽면 3장(위·좌·우). 벽 두께를 눈에 보이게 만든다 */}
      <mesh position={[x, 문높이 - 0.06, 문z]}>
        <boxGeometry args={[두께, 0.12, 문폭]} />
        {툰(안쪽색)}
      </mesh>
      {[-1, 1].map((sz) => (
        <mesh
          key={`jamb${sz}`}
          position={[x, 문높이 / 2, 문z + (sz * 문폭) / 2]}
        >
          <boxGeometry args={[두께, 문높이, 0.12]} />
          {툰(안쪽색)}
        </mesh>
      ))}

      {/* ② 찢어진 테두리 — 벽과 같은 색이어야 '벽이 찢어진 것'으로 읽힌다.
             잔해색으로 칠하면 또 '벽 앞에 놓인 돌'이 된다. */}
      {잔해보이기 &&
        데이터.테.map((t, i) => (
          <mesh
            key={`edge${i}`}
            geometry={돌지오(t.k, 거칠기 * 0.7)}
            position={[x, t.y, t.z]}
            rotation={[t.k * 0.7, t.k * 1.3, t.k * 0.4]}
            scale={[두께 * 1.3, t.s, t.s * 0.9]}
            castShadow
          >
            {툰(벽색, true)}
            {선긋기}
          </mesh>
        ))}

      {/* ③ 발치에 흘러내린 잔해 — 구멍 양쪽 바닥으로 쏟아진다.
             문이 밀려도 이건 남는다(벽에 속한 것이니까). */}
      {잔해보이기 &&
        데이터.바닥.map((c, i) => (
          <mesh
            key={`spill${i}`}
            geometry={돌지오(c.k, 거칠기)}
            position={[c.x, c.y, c.z]}
            rotation={c.r}
            scale={[c.s, c.s * 0.55, c.s * 0.8]}
            castShadow
            receiveShadow
          >
            {툰(색밝기(잔해색, c.b), true)}
            {선긋기}
          </mesh>
        ))}
    </group>
  );
}

// ===== 밀리는 벽 한 칸 (구멍을 메우고 있는 위장 덩어리) =====
// 구멍 '안에' 딱 맞게 박혀 있어서, 겉보기엔 '무너져 메워진 자리'다.
// 인식장치를 풀면 이 덩어리가 통째로 옆으로 밀린다.
function 밀리는벽({
  x = -20,
  문z = -4,
  문폭 = 4.4,
  문높이 = 7,
  두께 = 0.7,
  열림 = 0, // 0~1. 1이면 문폭+여유만큼 옆으로 완전히 빠진다
  벽색 = "#4a5058",
  잔해색 = "#3b4048",
  거칠기 = 0.32,
  seed = 77,
  선,
}) {
  const 막이 = useMemo(() => {
    const rnd = makeRandom(seed + 5);
    // 구멍을 '메우고' 있어야 하므로 큼직한 덩어리를 겹쳐 채운다.
    //   작은 돌을 흩뿌리면 표면에 붙인 장식처럼 보인다.
    const 열 = 4,
      층 = 5;
    const out = [];
    for (let i = 0; i < 열; i++)
      for (let j = 0; j < 층; j++) {
        out.push({
          z: 문z + (-0.5 + (i + 0.5) / 열) * 문폭 + (rnd() - 0.5) * 0.5,
          y: ((j + 0.5) / 층) * 문높이 + (rnd() - 0.5) * 0.5,
          x: (rnd() - 0.5) * 두께 * 0.5,
          sz: (문폭 / 열) * (1.1 + rnd() * 0.7),
          sy: (문높이 / 층) * (1.1 + rnd() * 0.7),
          r: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
          b: 0.7 + rnd() * 0.55,
          k: seed * 211 + i * 10 + j,
        });
      }
    return out;
  }, [문z, 문폭, 문높이, 두께, seed]);

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    // 열리면 z 로 미끄러진다. 벽 뒤 주머니로 들어가는 미닫이라고 보면 된다.
    //   문폭 + 0.6 만큼 빠져야 구멍이 완전히 드러난다.
    <group position={[x, 0, 열림 * (문폭 + 0.6)]}>
      {/* 뒤판 — 구멍을 실제로 막는 얇은 판. 두께 안에 들어가 있어야 한다.
             이게 벽 앞으로 튀어나오면 곧바로 '판때기'로 보인다. */}
      <mesh position={[0, 문높이 / 2, 문z]} castShadow receiveShadow>
        <boxGeometry args={[두께 * 0.55, 문높이 - 0.1, 문폭 - 0.1]} />
        <meshToonMaterial
          color={색밝기(잔해색, 0.6)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>
      {/* 메우고 있는 덩어리 — 구멍 크기를 20칸으로 나눠 큼직하게 채운다 */}
      {막이.map((c, i) => (
        <mesh
          key={`blk${i}`}
          geometry={돌지오(c.k, 거칠기)}
          position={[c.x, c.y, c.z]}
          rotation={c.r}
          scale={[두께 * 0.9, c.sy, c.sz]}
          castShadow
        >
          <meshToonMaterial
            color={색밝기(잔해색, c.b)}
            gradientMap={TOON_GRADIENT}
            flatShading
          />
          {선긋기}
        </mesh>
      ))}
    </group>
  );
}

// ===== 승강장 끝벽 (기차가 뚫고 나온 무너진 벽) =====
// 승강장 홀의 앞·뒤 끝을 막는 벽. 다만 기차가 그 자리를 지나가므로
// 기차 크기만큼 구멍이 뚫려 있고, 그 테두리가 들쭉날쭉하게 헐려 있다.
//
// [왜 필요한가] 지금은 홀 양 끝이 그냥 트여서 검정으로 빠진다.
//   끝을 막아 주면 ① 검정 여백이 사라지고 ② 기차가 '어둠 속에서 뚫고 나온'
//   그림이 되어 사연이 생긴다.
//
// [만드는 법] 벽을 세로 막대(스트립) 여러 개로 쪼갠다.
//   막대마다 '벽이 어디서부터 시작하는지(top)'를 따로 정하면,
//   구멍 자리는 위쪽만 남고 바깥쪽은 바닥까지 꽉 찬 벽이 된다.
//   구멍 가장자리에 무작위 요동을 줘서 칼로 자른 티를 없앤다.
function 승강장끝벽({
  z = -22,
  뒤집기 = false,
  시작x = 16,
  끝x = 29.5,
  높이 = 12,
  구멍x0 = 13, // 기차가 지나가는 x 범위 (바깥에서 계산해 넘긴다)
  구멍x1 = 22,
  구멍높이 = 11,
  칸 = 18, // 세로 막대 개수. 많을수록 테두리가 곱게 갈라진다
  들쭉 = 1.8, // 구멍 테두리가 흔들리는 폭
  벽색 = "#525b69",
  아랫단색 = "#4e5462",
  낡음 = 0.7,
  잔해색 = "#3b4048",
  거칠기 = 0.34,
  잔해 = true,
  seed = 51,
  선,
}) {
  const 폭 = 끝x - 시작x;
  const 데이터 = useMemo(() => {
    const rnd = makeRandom(seed + 313);
    const w = 폭 / 칸;
    const 막대 = Array.from({ length: 칸 }, (_, i) => {
      const xc = 시작x + w * (i + 0.5);
      const 안쪽 = xc > 구멍x0 && xc < 구멍x1;
      const 가장자리 = Math.min(Math.abs(xc - 구멍x0), Math.abs(xc - 구멍x1));
      let top = 0;
      if (안쪽) {
        top = 구멍높이 + (rnd() - 0.5) * 들쭉;
      } else if (가장자리 < 들쭉) {
        // 구멍 바로 옆도 조금씩 뜯겨 나가야 경계가 부드럽지 않게 이어진다
        top = ((들쭉 - 가장자리) / 들쭉) * 구멍높이 * 0.55 * rnd();
      }
      return { xc, w, top: Math.max(0, Math.min(top, 높이 - 0.3)) };
    });
    // 구멍 발치에 쏟아진 잔해
    const 돌 = Array.from({ length: 8 }, (_, i) => ({
      x: 구멍x0 + rnd() * (구멍x1 - 구멍x0),
      z: z + (rnd() - 0.5) * 3.5,
      y: 0.2 + rnd() * 0.4,
      s: 0.5 + rnd() * 1.4,
      r: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
      b: 0.8 + rnd() * 0.4,
      k: seed * 91 + i,
    }));
    return { 막대, 돌 };
  }, [폭, 칸, 시작x, 구멍x0, 구멍x1, 구멍높이, 들쭉, 높이, z, seed]);

  const 선긋기 = 선?.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  return (
    <>
      <group position={[0, 0, z]} rotation={[0, 뒤집기 ? Math.PI : 0, 0]}>
        {데이터.막대.map((b, i) => {
          const 부호 = 뒤집기 ? -1 : 1;
          const 조각 = [];
          // 아랫단(0~4)과 윗단(4~높이)을 나눠 칠한다 — 방 벽과 같은 배색.
          if (b.top < 4) {
            const y0 = b.top;
            조각.push({
              키: `lo${i}`,
              h: 4 - y0,
              y: (y0 + 4) / 2,
              색: 아랫단색,
            });
          }
          const 위시작 = Math.max(b.top, 4);
          if (위시작 < 높이) {
            조각.push({
              키: `hi${i}`,
              h: 높이 - 위시작,
              y: (위시작 + 높이) / 2,
              색: 벽색,
            });
          }
          return 조각.map((c) => (
            <벽조각
              key={c.키}
              w={b.w * 1.02} // 살짝 겹쳐야 막대 사이에 실금이 안 보인다
              h={c.h}
              x={부호 * b.xc}
              y={c.y}
              색={c.색}
              seed={seed}
              낡음={낡음}
              flipU={뒤집기}
            />
          ));
        })}
      </group>

      {잔해 &&
        데이터.돌.map((c, i) => (
          <mesh
            key={`endrub${i}`}
            geometry={돌지오(c.k, 거칠기)}
            position={[c.x, c.y, c.z]}
            rotation={c.r}
            scale={[c.s, c.s * 0.6, c.s * 0.85]}
            castShadow
            receiveShadow
          >
            <meshToonMaterial
              color={색밝기(잔해색, c.b)}
              gradientMap={TOON_GRADIENT}
              flatShading
            />
            {선긋기}
          </mesh>
        ))}
    </>
  );
}

// ===== 멈춰 선 기차 (Meshy 모델 + 문 열기 가공) =====
// 방 오른쪽(+x)은 벽이 없다 — 원래 승강장이던 자리라 비워 뒀고, 거기 기차가 선다.
//
// [이 모델이 어떻게 만들어졌나]
//   Meshy 원본은 758,118면짜리 한 덩어리였고 문도 차체에 붙어 있었다. 그래서
//   ① 안쪽으로 향한 면(껍데기 속 노이즈) 16,708면을 버리고
//   ② 실측한 문 자리(x −0.045~+0.355 · y −0.27~+0.32)의 면만 떼어내 '문짝'으로 분리,
//   ③ 양옆으로 밀어 '열린 채로' 굳히고
//   ④ 뚫린 자리 뒤에 앞면 없는 어둠상자를 끼워 속이 캄캄해 보이게 했다.
//   → GLB 안에 부품이 셋 있다: body(차체) · door(문짝) · dark(어둠상자)
//
// 실측 비율 : 길이 2.064 : 높이 1.000 : 폭 0.686  (높이 1.0 정규화 · 밑면 y=0)
//   그래서 '크기' 값이 곧 기차 높이(유닛)다. 11.5 ≈ 3.5m — 실제 전동차와 비슷하다.
useGLTF.preload("/models/train.glb");

// ═══════════════════════════════════════════════════════════════
//  기차 문 — 여러 개지만 안은 하나
// ═══════════════════════════════════════════════════════════════
// [왜 목록으로 두는가]
//   기차는 칸이 여러 개고 칸마다 문이 있다. 문 좌표를 손으로 적어 두면
//   Leva 로 기차를 옮기거나 칸 수를 바꿀 때마다 어긋난다.
//   → 문 자리에 빈 오브젝트를 하나 심고, **실제로 그려진 위치**를 읽어서 등록한다.
//     기차와 같은 group 안에 있으니 아무리 기울이고 돌려도 절대 안 어긋난다.
//
// [어느 문으로 들어가든 안은 하나]
//   모든 문이 같은 /train 으로 간다. 다만 '어느 문으로 들어갔는지'는 기억해 둔다.
//   나올 때 그 문 앞에 다시 세워야 순간이동한 느낌이 안 나기 때문이다.
const 기차문목록 = new Map(); // 칸번호 -> {x, z}
export const 기차문 = {
  등록: (칸, 위치) => 기차문목록.set(칸, 위치),
  해제: (칸) => 기차문목록.delete(칸),
  목록: () => [...기차문목록.entries()],
  // 가장 가까운 문과 그 거리 — 문을 열지, 들어갈지를 한 번에 판단한다.
  //   제한 거리를 두지 않는다. 거리 값 자체가 필요하기 때문이다.
  가까운문상세: (x, z) => {
    let 최소 = Infinity,
      찾음 = null;
    for (const [칸, q] of 기차문목록) {
      const d = Math.hypot(x - q.x, z - q.z);
      if (d < 최소) {
        최소 = d;
        찾음 = { 칸, 거리: d, x: q.x, z: q.z };
      }
    }
    return 찾음;
  },
  // 가장 가까운 문. 판정 거리 안에 없으면 null
  가까운문: (x, z, 거리) => {
    let 최소 = 거리,
      찾음 = null;
    for (const [칸, p] of 기차문목록) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 최소) {
        최소 = d;
        찾음 = 칸;
      }
    }
    return 찾음;
  },
};
// 마지막으로 들어간 문. 기차에서 나올 때 이 자리로 되돌린다.
//   위치까지 같이 적어 둔다 — 역 씬이 다시 켜질 때 문 목록은 아직 비어 있어서
//   (표식이 그려진 뒤에야 등록된다) 그 순간에는 문 좌표를 물어볼 수가 없다.
export const 들어간문 = { 칸: null, 위치: null };

// ★ 문 열림 연출용 — 지금 가장 가까운 문과 그 거리.
//   매 프레임 바뀌는 값이라 React state 로 두면 초당 60번 리렌더가 난다.
//   그래서 바깥 상자에 담아 두고 문짝이 useFrame 안에서 직접 읽는다.
export const 문상태 = { 칸: null, 거리: Infinity };

// ★ 기차에서 막 내렸을 때 곧바로 다시 빨려 들어가는 것을 막는 잠금.
//   내리면 문 바로 앞에 서게 되는데 그 자리가 이미 '진입 거리 안'이라,
//   잠그지 않으면 내리자마자 무한히 다시 탄다.
export const 진입잠금 = { 켬: false };

// 역 씬이 '기차에서 나온 직후'인지. 그때만 문 앞으로 되돌려 세운다.
export const 기차에서나옴 = { 켬: false };

// 콘솔 확인용 — 렌더에는 아무 영향이 없다.
//   콘솔에 __기차문.목록() 을 치면 지금 등록된 문 좌표를 볼 수 있다.
//   __기차문.가까운문상세(x, z) 로 판정 거리도 직접 재 볼 수 있다.
if (typeof window !== "undefined") {
  window.__기차문 = 기차문;
  window.__문상태 = 문상태;
  window.__들어간문 = 들어간문;
  window.__진입잠금 = 진입잠금;
  window.__기차에서나옴 = 기차에서나옴;
}

// 문 자리에 심는 눈에 안 보이는 표식.
//   그려진 뒤 한 번만 월드 좌표를 읽는다(그 전에 읽으면 원점이 나온다).
function 기차문표식({ 칸, 위치 }) {
  const ref = useRef(null);
  useEffect(() => {
    const o = ref.current;
    if (!o) return;
    let 남은 = 20;
    const 재기 = () => {
      o.updateWorldMatrix(true, false);
      const w = new THREE.Vector3();
      o.getWorldPosition(w);
      if (Number.isFinite(w.x) && (w.x !== 0 || w.z !== 0)) {
        기차문.등록(칸, { x: w.x, z: w.z });
        return true;
      }
      return --남은 <= 0;
    };
    const id = setInterval(() => {
      if (재기()) clearInterval(id);
    }, 200);
    재기();
    return () => {
      clearInterval(id);
      기차문.해제(칸);
    };
  }, [칸, 위치[0], 위치[1], 위치[2]]);
  return <object3D ref={ref} position={위치} />;
}

// ═══════════════════════════════════════════════════════════════
//  문짝 — 구멍 크기에 맞춘 한 짝. 다가가면 옆으로 미끄러진다
// ═══════════════════════════════════════════════════════════════
// [모델의 문을 안 쓰는 이유]
//   train.glb 를 실제로 재 보면 이렇다(모델 로컬 단위, 차체 길이가 2.064).
//     body  x −1.032 ~  1.032
//     dark  x −0.043 ~  0.380   ← 뚫린 구멍. 폭 0.423 · 높이 0.639
//     door  x −0.181 ~  0.528   ← 폭 0.709
//   door 메시는 구멍(0.423)보다 넓고 좌우로 벌어져 있다. 즉 **처음부터
//   양옆으로 활짝 열린 문 두 짝**이 모델에 박혀 있는 것이다.
//   그래서 그걸 옆으로 밀면 '문이 열린다'가 아니라 '열린 문이 이동한다'가 된다.
//   → 모델 문은 그리지 않고(본체조각에서 뺐다), 구멍에 딱 맞는 한 짝을 직접 만든다.
//
// [왜 React state 를 안 쓰나]
//   열림 정도는 매 프레임 바뀐다. state 로 두면 초당 60번 리렌더가 나고,
//   그 리렌더가 기차 전체(칸 수 × 조각 수)를 다시 그린다. 그래서 ref 에 담고
//   three 객체를 직접 움직인다 — React 는 이 변화를 아예 모른다.

// 모델에서 직접 잰 구멍 값. 여기만 고치면 문 크기·자리가 전부 따라온다.
const 문구멍 = {
  중심x: (-0.043 + 0.38) / 2, // 0.1685
  중심y: (0.212 + 0.851) / 2, // 0.5315
  폭: 0.423,
  높이: 0.639,
  // 방을 향한 면(−z)의 차체 표면이 z = −0.343.
  //   그보다 아주 살짝 안쪽에 둬야 차체 테두리가 문틀처럼 문을 감싼다.
  z: -0.327,
};

function 문짝({ 칸, 선, 열림폭, 색, 옵션 = {} }) {
  const ref = useRef(null);
  const 열림 = useRef(0);
  // 구멍보다 아주 조금 크게 만든다. 딱 맞추면 가장자리에 실틈이 비친다.
  // ★ 캐비넷과 같은 방식: 면을 분할한 박스의 정점을 노멀 방향으로 밀어
  //   '진짜 눌린 굴곡'을 만든다. 분할이 없으면 밀 정점이 없어 찌그러지지 않는다.
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(
      문구멍.폭 + 0.024, 문구멍.높이 + 0.016, 0.03,
      24, 32, 1, // 앞·뒤 면을 촘촘히 쪼갠다 → 눌림이 매끈한 굴곡으로
    );
    const 개수 = 옵션.찌그러짐 ?? 4;
    const 깊이 = 옵션.찌그러짐깊이 ?? 0.022;
    if (개수 > 0 && 깊이 > 0) 찌그러뜨리기(g, 칸 * 37 + 5, 개수, 깊이, 0.07);
    g.computeVertexNormals(); // 눌린 뒤 노멀 재계산 → 각진 다이아몬드 대신 부드러운 음영
    return g;
  }, [칸, 옵션.찌그러짐, 옵션.찌그러짐깊이]);
  useEffect(() => () => geo.dispose(), [geo]);
  // 외곽선 전용 — 찌그러지지 않은 '깔끔한 사각 박스'.
  //   ★ 외곽선을 찌그러진 문에 직접 두르면 눌림 자국까지 선이 따라 그려져
  //     검은 다이아몬드가 찍힌다(외곽선색=얼룩색처럼 보이던 원인).
  //   그래서 외곽선은 이 매끈한 박스에만 두르고, 찌그러짐은 음영으로만 보인다.
  const 선geo = useMemo(
    () => new THREE.BoxGeometry(문구멍.폭 + 0.024, 문구멍.높이 + 0.016, 0.03),
    [],
  );
  useEffect(() => () => 선geo.dispose(), [선geo]);
  // 칸마다 seed 를 달리해 문짝 얼룩·기스가 제각각이 되게. 텍스처는 캐시되므로
  //   여러 번 그리지 않고, 공유 자원이라 여기서 dispose 하지 않는다.
  const 문맵 = useMemo(
    () => 기차문텍스처(칸 + 1, 옵션),
    [
      칸,
      옵션.손잡이가로,
      옵션.손잡이세로,
      옵션.손잡이폭,
      옵션.손잡이높이,
      옵션.문틀폭,
      옵션.문틀색,
      옵션.낡음,
    ],
  );
  // 문 전용 외곽선 — 공유 선 대신 폴더 값으로 굵기·색을 따로 조절한다.
  const 문선 = useMemo(
    () => ({
      외곽선: (옵션.외곽선굵기 ?? 1.5) > 0,
      외곽선굵기: 옵션.외곽선굵기 ?? 1.5,
      외곽선색: 옵션.외곽선색 ?? "#242a33",
      주름선: false,
    }),
    [옵션.외곽선굵기, 옵션.외곽선색],
  );

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    // 목표: 내가 가장 가까운 문이고 열림 거리 안이면 1(열림), 아니면 0(닫힘)
    const 목표 = 문상태.칸 === 칸 && 문상태.거리 < 문열림거리 ? 1 : 0;
    // 지수 보간 — 프레임 간격(dt)이 흔들려도 '열리는 속도'가 일정하다.
    //   (목표-현재)*0.1 처럼 고정 비율로 하면 60fps 와 30fps 에서 속도가 달라진다.
    열림.current += (목표 - 열림.current) * (1 - Math.exp(-dt * 5));
    // 닫힘(0) = 구멍을 덮은 자리 · 열림(1) = 옆으로 열림폭만큼 비켜난 자리.
    //   차체가 X축으로 길므로 문도 X축으로 미끄러진다.
    g.position.x = 열림.current * 열림폭;
  });

  return (
    <group ref={ref}>
      <mesh
        geometry={geo}
        position={[문구멍.중심x, 문구멍.중심y, 문구멍.z]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial map={문맵} color={색} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 외곽선 전용 메시 — 눈에 안 보이는 매끈한 박스에 외곽선만 두른다.
          (찌그러진 문에 직접 두르지 않으므로 눌림 자국이 선에 안 걸린다.) */}
      <mesh geometry={선geo} position={[문구멍.중심x, 문구멍.중심y, 문구멍.z]}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        {문선.외곽선 && (
          <Outlines
            thickness={문선.외곽선굵기}
            color={문선.외곽선색}
            transparent
            opacity={0.8}
          />
        )}
      </mesh>
    </group>
  );
}

const TRAIN_LEN = 2.064; // 높이 1 기준 길이. 여러 칸을 이어 붙일 때 간격 계산에 쓴다

function Train({
  pos = [18, -1], // [x, z] — 방 오른쪽 뚫린 변 바깥
  y = 0,
  rot = Math.PI / 2, // 모델은 X축으로 길다 → 90° 돌려야 방의 z축(세로)과 나란해진다
  크기 = 11.5, // = 기차 높이(유닛)
  대수 = 3,
  // 간격 = 칸 중심 사이 거리 배수. 1.0 이면 끝끼리 딱 닿고, 1보다 작으면 겹친다.
  //   [왜 겹치나] 끝벽·손잡이·연결기가 맞닿으면 지저분해서 예전엔 검은
  //   주름막으로 덮었는데, 그게 '검은 판때기'로 보였다.
  //   간격을 0.88 로 두면 둥근 끝머리가 서로 파고들어 이음매가 아예 사라진다.
  //   (0.86 / 0.90 / 0.94 / 1.00 을 따로 렌더해서 비교한 값이다)
  간격 = 0.88,
  좌우기울기 = 0, // 길이축(X) 기준으로 옆으로 기울인다 — 탈선해 기운 느낌
  앞뒤기울기 = 0, // 폭축(Z) 기준으로 앞뒤로 기울인다 — 코가 들리거나 처진다
  휨 = 0, // 칸마다 꺾이는 각(rad). 0이면 일직선, 크면 완만한 곡선 위의 열차
  차체색 = "#4A515C",
  문색 = "#39404A",
  어둠색 = "#0A0C10",
  문열림폭 = 0.46, // 옆으로 미끄러지는 폭. 구멍 폭 0.423 보다 조금 크게.
  문옵션 = {},
  선,
}) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/train.glb");
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (!o.isMesh) return;
      const 어둠 = o.name === "dark";
      // 어둠상자는 '빛을 받는 물체'가 아니라 '뚫린 구멍'이다.
      //   MeshBasicMaterial = 조명을 아예 안 받는 재질 → 조명이 어떻든 늘 캄캄하다.
      //   DoubleSide = 상자 안쪽에서 봐야 하므로 뒷면도 그린다.
      o.material = 어둠
        ? new THREE.MeshBasicMaterial({
            color: 어둠색,
            side: THREE.DoubleSide,
            toneMapped: false,
          })
        : new THREE.MeshToonMaterial({
            color: o.name === "door" ? 문색 : 차체색,
            gradientMap: TOON_GRADIENT,
          });
      o.castShadow = !어둠;
      o.receiveShadow = !어둠;
    });
    return c;
  }, [scene, 차체색, 문색, 어둠색]);
  const 조각 = useMemo(() => GLB조각(model), [model]);
  // ★ 모델의 door 메시는 아예 그리지 않는다.
  //   그것은 '열린 문 두 짝'이라, 그걸 쓰면 문이 닫힌 모습을 만들 수가 없다.
  //   대신 구멍에 딱 맞는 한 짝을 <문짝> 이 직접 만든다.
  const 본체조각 = useMemo(() => 조각.filter((c) => c.name !== "door"), [조각]);

  // ── 칸 배치 ────────────────────────────────────────────
  //   휨 = 0 이면 그냥 일직선으로 늘어놓는다.
  //   휨 ≠ 0 이면 반지름 R = (칸 길이) / 휨 인 원호 위를 걸어가며 놓는다.
  //     · 호를 a 만큼 돈 지점 = (R·sin a, 0, R·(1−cos a))
  //     · 그 지점의 진행 방향 = (cos a, 0, sin a)
  //   three.js 의 Y축 회전은 로컬 +X 를 (cos φ, 0, −sin φ) 로 보낸다.
  //   진행 방향과 맞추려면 φ = −a 로 돌려야 한다(부호를 놓치면 칸이 어긋난다).
  const 칸배치 = useMemo(() => {
    const L = TRAIN_LEN * 간격;
    const 가운데 = (대수 - 1) / 2;
    return Array.from({ length: 대수 }, (_, i) => {
      const k = i - 가운데;
      if (Math.abs(휨) < 1e-4) return { x: k * L, z: 0, a: 0 };
      const a = 휨 * k;
      const R = L / 휨;
      return { x: R * Math.sin(a), z: R * (1 - Math.cos(a)), a };
    });
  }, [대수, 간격, 휨]);

  return (
    // 바깥 group = 놓을 자리 + 방위각(어느 쪽을 보는가)
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      {/* 안쪽 group = 기울기 + 크기.
          기울기를 바깥 group 의 rotation 에 같이 넣으면 오일러 축이 섞여
          '옆으로 기울였는데 방향까지 돌아가는' 현상이 생긴다. 그래서 나눈다.
          모델은 X로 길고 Y로 높고 Z로 넓다 →
            X축 회전 = 좌우 기우뚱(롤) · Z축 회전 = 앞뒤 기우뚱(피치) */}
      <group rotation={[좌우기울기, 0, 앞뒤기울기]} scale={크기}>
        {/* 여러 칸 — 지오메트리는 공유되므로 칸을 늘려도 메모리는 거의 안 는다.
          가운데 칸이 방 뚫린 변 정중앙에 오도록 (i − (대수−1)/2) 로 좌우 대칭 배치. */}
        {칸배치.map((c, i) => (
          <group
            key={`car${i}`}
            position={[c.x, 0, c.z]}
            rotation={[0, -c.a, 0]}
          >
            {/* dark(어둠상자)에는 선을 두르지 않는다 — 구멍에 테두리가 생기면
                '뚫린 곳'이 아니라 '검은 판때기'로 보인다. */}
            <조각그리기
              조각={본체조각}
              선={선}
              선제외={["dark"]}
              그림자받기={false}
            />
            {/* 문은 모델 것을 안 쓰고 직접 만든다 (위 문짝 주석 참고) */}
            <문짝 칸={i} 선={선} 열림폭={문열림폭} 색={문색} 옵션={문옵션} />
            {/* 문 앞 자리 — 모델 기준 door 메시는 x 0.175 언저리, 폭 방향(z)은
                양쪽에 다 있다. 방을 향한 쪽(-z)에서 한 걸음 물러난 자리를 잡는다. */}
            <기차문표식 칸={i} 위치={[0.175, 0.5, -0.55]} />
          </group>
        ))}
      </group>
    </group>
  );
}

// ===== 천장 작업등 (수사본부가 폐역에 새로 설치한 조명) =====
// 컨셉 이미지: 천장 부착부 → 꺾인 금속 팔 → 늘어진 선 → 반구 갓.
// 우리 톤(로우폴리+toon)으로 단순화해 코드로 만든다.
// 빛은 갓 아래 pointLight가 담당한다(모델은 '모양', 빛은 따로).
//   pos=[x,z] 천장 부착 위치. drop=갓이 매달린 높이(부착부 아래로 얼마나 내려오나).
function WorkLamp({
  pos = [0, 0],
  drop = 2.8, // 천장에서 갓까지 내려온 길이
  on = true,
  크기 = 1, // 갓 지름 배수
  갓색 = "#3A4048", // 에나멜 갓 바깥 — 폐역 톤에 맞춘 짙은 회청색
  전구색 = "#FFD9A0",
  빛세기 = 110,
  빛퍼짐 = 0.95, // 원뿔이 벌어지는 각(rad)
  번짐 = 0.55, // '퍼지는 빛' 한 겹을 얼마나 세게 깔지 (빛세기 대비 배수)
  빛감쇠 = 1.4, // 거리에 따라 빛이 죽는 속도. 2=물리적으로 정확, 낮출수록 멀리 퍼진다
  천장번짐 = 0, // 갓 위로 새는 빛 — 기본은 끔(셀 셰이딩과 화풍이 어긋난다)
  선,
}) {
  const [x, z] = pos;
  // spotLight 는 '어디를 비출지'를 target(Object3D)으로 받는다.
  //   지정하지 않으면 씬 원점(0,0,0)이 기본이라, 구석에 달린 등 4개가
  //   전부 방 한가운데를 비스듬히 노려본다 → 빛 웅덩이가 타원으로 찌그러진다.
  const 속빛ref = useRef(null);
  const 퍼짐ref = useRef(null);
  const 타깃ref = useRef(null);
  useEffect(() => {
    if (타깃ref.current) {
      if (속빛ref.current) 속빛ref.current.target = 타깃ref.current;
      if (퍼짐ref.current) 퍼짐ref.current.target = 타깃ref.current;
    }
  }, [on]);
  const ceilY = ROOM_H - 0.05; // 천장 바로 아래
  const shadeY = ceilY - drop; // 갓 입구 높이
  const metal = "#2E333A"; // 파이프·부착부 — 갓보다 어두운 철물
  const 갓높이 = 0.8 * 크기;
  const 갓아래 = 0.92 * 크기; // 갓 입구 반지름
  const 갓위 = 0.2 * 크기; // 갓 목 반지름
  const 목Y = shadeY + 갓높이; // 갓 윗면(목) 높이

  return (
    <group position={[x, 0, z]}>
      {/* 천장 부착 원판 */}
      <mesh position={[0, ceilY - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.1, 16]} />
        <meshToonMaterial color={metal} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {/* 매달린 파이프 — 부착부에서 갓 목까지 한 줄로 곧게 */}
      <mesh position={[0, (ceilY - 0.1 + 목Y) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, ceilY - 0.1 - 목Y, 10]} />
        <meshToonMaterial color={metal} gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>

      {/* ── 갓 — 공장·창고에서 쓰는 에나멜 원뿔 갓 ────────────
             바깥은 짙은 철색, 안쪽은 밝은 에나멜.
             두 겹으로 나눈 이유: toon 재질은 앞뒤 면에 다른 색을 못 준다.
             바깥 원뿔(앞면만) + 안쪽 원뿔(뒷면만)을 겹쳐 두 색을 낸다. */}
      <group position={[0, shadeY + 갓높이 / 2, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[갓위, 갓아래, 갓높이, 24, 1, true]} />
          <meshToonMaterial
            color={갓색}
            gradientMap={TOON_GRADIENT}
            side={THREE.FrontSide}
          />
          {선?.외곽선 && (
            <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
          )}
        </mesh>
        {/* 안쪽 에나멜 — 켜지면 빛을 머금은 듯 밝다(자체발광) */}
        <mesh scale={0.97}>
          <cylinderGeometry args={[갓위, 갓아래, 갓높이, 24, 1, true]} />
          <meshBasicMaterial
            color={on ? "#FFF3D2" : "#565B62"}
            side={THREE.BackSide}
            toneMapped={false}
          />
        </mesh>
        {/* 갓 윗면 마감 — 위에서 보면 뚫려 있어 어색하다 */}
        <mesh position={[0, 갓높이 / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[갓위, 24]} />
          <meshToonMaterial color={갓색} gradientMap={TOON_GRADIENT} />
        </mesh>
      </group>

      {/* 전구 — 갓 입구 안쪽에 살짝 들어가 있다 */}
      <mesh position={[0, shadeY + 0.2 * 크기, 0]}>
        <sphereGeometry args={[0.16 * 크기, 12, 10]} />
        <meshBasicMaterial color={on ? 전구색 : "#3A3A3A"} toneMapped={false} />
      </mesh>

      {/* 빛이 향할 지점 — 램프 바로 아래 바닥.
             group 안에 있어서 world 좌표로는 [x, 0, z] 가 된다. */}
      <object3D ref={타깃ref} position={[0, 0, 0]} />

      {/* ── 실제 빛 — 두 겹으로 깐다 ──────────────────────────
             ① 속빛 : 램프답게 아래로 모이는 원뿔
             ② 퍼짐 : 훨씬 넓고 약한 원뿔. 가장자리를 완전히 흐려서
                      ①의 동그란 테두리를 지우고 '번지는' 느낌을 만든다.
             한 겹만 쓰면 아무리 흐리게 해도 원 경계가 남는다. */}
      {on && (
        <>
          <spotLight
            ref={속빛ref}
            position={[0, shadeY, 0]}
            angle={빛퍼짐}
            /* penumbra = 원뿔 가장자리를 얼마나 흐리게 할지 (0 칼같음 ~ 1 완전히 흐림) */
            penumbra={0.92}
            intensity={빛세기}
            distance={ROOM_H + 10}
            decay={빛감쇠}
            color={전구색}
            castShadow={false}
          />
          {/* ② 퍼짐 겹 — 각을 1.6배로 벌리고 세기는 번짐 배수만큼만.
                 THREE 의 spotLight angle 상한이 90°(1.5708) 라 1.45 로 잘라 둔다. */}
          {번짐 > 0 && (
            <spotLight
              ref={퍼짐ref}
              position={[0, shadeY, 0]}
              angle={Math.min(빛퍼짐 * 1.6, 1.45)}
              penumbra={1}
              intensity={빛세기 * 번짐}
              distance={ROOM_H + 14}
              decay={Math.max(빛감쇠 - 0.5, 0.4)}
              color={전구색}
              castShadow={false}
            />
          )}
          {/* 갓 안쪽이 밝게 비치도록 아주 약한 보조광 하나 */}
          <pointLight
            position={[0, shadeY + 0.25 * 크기, 0]}
            intensity={6}
            distance={3.2}
            decay={2}
            color={전구색}
          />
          {/* ★ 갓 위로 새는 빛 — 천장이 새까매지지 않게 하는 용도.
                 예전에는 distance 가 짧아(목까지 거리의 3.2배) 천장에
                 '밝은 동그라미'가 찍혔다. 그게 '빛이 천장으로 간다'는 인상의 원인.
                 → 세기를 크게 낮추고 distance 를 넓혀 '넓고 옅은 기운'으로 바꿨다.
                 천장 전체를 들어 올리는 건 이 빛이 아니라
                 아래 「벽·바닥 질감 → 천장자체밝기」가 담당한다. */}
          {천장번짐 > 0 && (
            <pointLight
              position={[0, 목Y + 0.5 * 크기, 0]}
              intensity={천장번짐}
              distance={(ceilY - 목Y) * 12}
              decay={1.1}
              color={전구색}
            />
          )}
        </>
      )}
    </group>
  );
}

// ===== 스탠드 조명 (Meshy 모델 + 코드 빛) =====
// 모양은 Meshy(lamp.glb), 빛은 코드. AI는 빛을 만들 수 없다.
//
// 아래 세 상수는 눈대중이 아니라 GLB를 파이썬으로 '실측'한 값이다.
//   갓 입구를 눈대중으로 잡으면 빛이 갓 밖으로 새거나 갓 안에 파묻힌다.
// 모델은 높이 1.0 으로 정규화돼 있다 → scale 값이 곧 '램프 높이(유닛)'.
useGLTF.preload("/models/lamp.glb");
const LAMP_MOUTH = [-0.2378, 0.802, -0.0627]; // 갓 입구 중심
const LAMP_AXIS = [-0.703, -0.7112, 0.0]; // 빛이 나가는 방향(수직에서 44.7°)

// 장스탠드(바닥에 세우는 긴 것) — 같은 모델의 기둥만 4배로 늘여 만든 변형.
// 높이가 달라졌으니 갓 입구 좌표도 당연히 다르다(다시 실측한 값).
useGLTF.preload("/models/lamp_floor.glb");
const FLOOR_MOUTH = [-0.1013, 0.9157, -0.0267];
const FLOOR_AXIS = [-0.703, -0.7112, 0.0];

function DeskLamp({
  url = "/models/lamp.glb", // 탁상용/장스탠드 둘 다 이 컴포넌트를 쓴다
  mouth = LAMP_MOUTH, // 갓 입구 좌표 (모델마다 다름)
  axis = LAMP_AXIS, // 빛 방향   (모델마다 다름)
  pos = [0, 0], // [x, z]
  baseY = 2.05, // 받침이 놓이는 높이(책상 상판 / 장스탠드는 0 = 바닥)
  rot = 0, // y축 회전. 0 = 갓이 -X 쪽을 비춘다
  height = 1.5, // 램프 높이(유닛). 1유닛 ≈ 0.30m 이므로 1.5 ≈ 45cm
  on = true,
  bulb = "#FFC271", // 전구색
  body = "#3A3E44", // 금속 몸체색
  inner = "#F7E2BA", // 갓 안쪽색
  intensity = 70,
  spread = 0.55, // 원뿔이 벌어지는 각(rad)
  shadow = false,
  // ★ 이 램프 GLB는 기둥(body) 꼭대기와 팔(head) 사이가 실제로 떠 있다.
  //   실측: lamp 는 기둥 0.769 / 팔 시작 0.820, lamp_floor 는 0.902 / 0.923.
  //   기둥을 y로만 조금 늘려 팔 안쪽까지 물리게 한다.
  //   밑동이 y=0 이라 늘려도 바닥에서 뜨지 않는다.
  기둥늘림 = 1.09,
  음영바닥 = 55, // 그늘 칸의 밝기(0=완전 검정)
  선,
}) {
  const [x, z] = pos;
  const lightRef = useRef();
  const targetRef = useRef();

  const { scene } = useGLTF(url);
  // 스탠드 전용 그라디언트 — 그늘이 새까맣게 뭉치지 않도록 바닥을 올린다
  const 그라디 = useMemo(() => makeToonGradient(3, 음영바닥), [음영바닥]);
  useEffect(() => () => 그라디.dispose(), [그라디]);
  const model = useMemo(() => {
    const c = scene.clone(true); // 캐시 오염 방지 — 3개가 서로 다른 색을 가질 수 있게
    c.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name;
      if (n === "bulb") {
        // 전구·갓 안쪽은 '스스로 빛나는' 재질(basic)이라 어둠 속에서도 밝다
        o.material = new THREE.MeshBasicMaterial({
          color: on ? bulb : "#3A3A3A",
          toneMapped: false,
        });
      } else if (n === "shade_in") {
        o.material = new THREE.MeshBasicMaterial({
          color: on ? inner : "#4A4A4A",
          toneMapped: false,
          side: THREE.DoubleSide, // 안쪽 면이라 뒷면도 보이게
        });
      } else {
        o.material = new THREE.MeshToonMaterial({
          color: n === "cap" ? "#565A60" : body,
          gradientMap: 그라디,
          // 예전에는 양면(DoubleSide)으로 그렸는데, 갓 안쪽에서 바깥벽 뒷면이
          //   앞면과 겹쳐 지저분한 얼룩이 생겼다.
          //   갓 안쪽은 shade_in(양면·자체발광)이 이미 막아 주므로 앞면만 그린다.
        });
      }
      o.castShadow = true;
      o.receiveShadow = false; // 자기 표면에 지는 얼룩(섀도 아크네) 방지
    });
    return c;
  }, [scene, on, bulb, body, inner, 그라디]);
  const 조각 = useMemo(
    () =>
      GLB조각(model).map((c) =>
        c.name === "body"
          ? { ...c, s: [c.s[0], c.s[1] * 기둥늘림, c.s[2]] }
          : c,
      ),
    [model, 기둥늘림],
  );

  // spotLight는 '어디를 비출지'를 target(Object3D)으로 받는다.
  // 지정하지 않으면 씬 원점(0,0,0)이 기본값이라 스탠드 3개가 전부 방 한가운데를 노려본다.
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current;
    }
  }, [on]);

  const [mx, my, mz] = mouth;
  const [ax, ay, az] = axis;
  const T = 8; // 목표점을 얼마나 멀리 둘지(방향만 정해지면 되므로 값 자체는 중요하지 않다)

  return (
    <group position={[x, baseY, z]} rotation={[0, rot, 0]} scale={height}>
      <조각그리기
        조각={조각}
        선={선}
        선제외={["bulb", "shade_in"]}
        그림자받기={false}
      />

      {on && (
        <spotLight
          ref={lightRef}
          position={[mx + ax * 0.05, my + ay * 0.05, mz + az * 0.05]}
          angle={spread}
          penumbra={0.7}
          intensity={intensity}
          distance={24}
          decay={2}
          color={bulb}
          castShadow={shadow}
          /* 책상 위 물건이 작고 촘촘해서 1024로는 그림자가 계단처럼 깨졌다.
             normalBias 를 키워 표면에 얼룩이 안 지게 하고, radius 로 가장자리를 눅인다. */
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.12}
          shadow-radius={3}
        />
      )}
      {/* 빛이 향할 지점 — 같은 group 안이라 램프를 돌리면 함께 돈다 */}
      <object3D
        ref={targetRef}
        position={[mx + ax * T, my + ay * T, mz + az * T]}
      />
    </group>
  );
}

// ===== 서류 캐비닛 (Meshy 모델 + 코드로 만든 낡음) =====
// Meshy가 만드는 '낡음'은 대부분 텍스처(녹·얼룩 그림)인데,
// 우리는 toon 단색으로 덮어쓰기 때문에 그 텍스처를 통째로 버린다.
//   → 그래서 찌그러짐은 '정점을 밀어넣어' 진짜 굴곡으로,
//     얼룩은 '정점 색'으로 직접 만든다. 둘 다 시드로 조절되므로
//     같은 GLB 하나로 서로 다르게 낡은 캐비닛을 몇 개든 만들 수 있다.
useGLTF.preload("/models/cabinet.glb");
useGLTF.preload("/models/coat_rack.glb");
useGLTF.preload("/models/fedora.glb");

// ===== 중절모 (Meshy) =====
// 원본이 비스듬히 기울어져 있어서 파이프라인에서 '챙 테두리 평면'을 실측해
//   수평으로 바로잡아 두었다. → 기울기 0 이면 책상에 반듯이 놓인다.
// 모델은 '챙 지름 = 1.0' 으로 정규화 → 크기 값이 곧 챙 지름(유닛).
//   1유닛 ≈ 0.30m 이므로 크기 1.0 ≈ 챙 30cm (실물 중절모 크기)
// 주름선 — 이웃한 두 면이 이루는 각이 기준보다 크면 그 경계에 선을 긋는다.
//   모자는 매끈한 곡면이라 toon 3단계 음영만으로는 한 덩어리로 뭉개진다.
//   실측해보니 40° 기준에서 선이 딱 세 군데에 몰린다:
//     y 0.00~0.07 = 챙 끝 접힘 / y 0.11~0.15 = 챙과 크라운 경계(모자띠)
//     y 0.37~0.43 = 꼭대기 눌린 자국
//   이 셋이 곧 '중절모'로 읽히게 하는 선이다.
function Fedora({
  pos = [0, 0],
  y = 0,
  rot = 0,
  기울기 = 0,
  크기 = 1,
  색 = "#5C422A",
  선,
}) {
  const { scene } = useGLTF("/models/fedora.glb");
  // <primitive>는 자식 JSX를 못 받아 <Outlines>를 넣을 수 없다 → 지오메트리만 꺼내 쓴다.
  const geo = useMemo(() => {
    let g = null;
    scene.traverse((o) => {
      if (o.isMesh && !g) g = o.geometry;
    });
    return g;
  }, [scene]);

  // group 을 두 겹으로 나눈 이유:
  //   바깥 = 어느 쪽을 향하나(회전), 안쪽 = 얼마나 자빠졌나(기울기).
  //   한 group 에 [기울기, 회전, 0] 을 같이 주면 두 축이 서로 섞여 예측이 안 된다.
  return (
    <group position={[pos[0], y, pos[1]]} rotation={[0, rot, 0]}>
      <group rotation={[기울기, 0, 0]} scale={크기}>
        <mesh geometry={geo} castShadow receiveShadow>
          <meshToonMaterial color={색} gradientMap={TOON_GRADIENT} />
          <만화선 geo={geo} 선={선} />
        </mesh>
      </group>
    </group>
  );
}

// 서랍 칸 경계선 — GLB를 실측해서 얻은 y 값(모델 높이 1.0 기준).
//   Meshy 모델은 홈이 얕아서 어두운 방에서는 한 덩어리로 보인다.
//   → 진짜 '선'을 그려서 서랍을 구분한다. (셀셰이딩 만화 외곽선과 같은 역할)
const CAB_SEAMS = [0.035, 0.28, 0.52, 0.745, 0.965]; // 서랍 5개 경계
const CAB_FX = 0.17; // 앞면 좌우 끝
const CAB_FZ = 0.2395; // 앞면 평면(0.234)보다 살짝 앞 — 선이 면에 파묻히지 않게
// 서랍을 빼면 드러나는 '구멍'의 앞면 z.
//   GLB 앞판(0.234)과 손잡이 돌기(~0.2455)를 통째로 덮어야 하므로 그보다 앞에 둔다.
const CAB_SLOT_Z = 0.25;

// 선분 목록. 닫힌 캐비닛용(열림 없음)은 한 번만 만들어 같이 쓴다(GPU 낭비 방지).
//   열린 서랍이 있으면 그 칸의 선만 앞으로 나와야 하므로 그때만 따로 만든다.
function 캐비닛선분(열림) {
  const p = [];
  // 사각형 하나 = 선분 4개. LineSegments 는 점 2개씩 짝지어 선을 긋는다.
  const 사각 = (x0, y0, x1, y1, z) => {
    p.push(
      x0,
      y0,
      z,
      x1,
      y0,
      z,
      x1,
      y0,
      z,
      x1,
      y1,
      z,
      x1,
      y1,
      z,
      x0,
      y1,
      z,
      x0,
      y1,
      z,
      x0,
      y0,
      z,
    );
  };
  for (let i = 0; i < 4; i++) {
    const y0 = CAB_SEAMS[i],
      y1 = CAB_SEAMS[i + 1];
    // 이 칸이 열려 있으면 앞판이 d만큼 나와 있으니 선도 같이 나간다
    const d = 열림 && 열림.칸 === i ? 열림.양 : 0;
    const z = d ? CAB_SLOT_Z + d + 0.0145 : CAB_FZ;
    사각(-CAB_FX, y0, CAB_FX, y1, z); // 서랍 앞판 테두리
    const hy = (y0 + y1) / 2 - 0.02; // 손잡이(돌출 위치 실측값)
    사각(-0.055, hy - 0.017, 0.055, hy + 0.017, z + 0.006);
    const ly = (y0 + y1) / 2 + 0.052; // 라벨 꽂이
    사각(-0.04, ly - 0.02, 0.04, ly + 0.02, z + 0.002);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}
const CAB_LINE_GEO = 캐비닛선분(null);

// ── 의자 끌기 ──────────────────────────────────────────────
// [왜 매 프레임 state 를 안 쓰나]
//   끌고 있는 동안 위치는 초당 60번 바뀐다. state 로 두면 로비 전체가 그만큼
//   다시 그려진다. 그래서 그룹을 ref 로 직접 밀고, **놓는 순간에만** 상태에 적는다.
//
// [자식이 절대좌표로 그려지는 문제]
//   의자는 자기 안에서 pos=[x,z] 절대좌표로 그려진다. 그래서 그룹에는
//   '기준 자리에서 얼마나 벗어났는지'(차이)만 넣는다.
//
// [실제 게임이 하는 네 가지를 그대로 넣었다]
//   ① 자기 반지름으로 막는다  ② 벽 안쪽으로 가둔다
//   ③ 막히면 미끄러진다      ④ 각도만 돌려 몸을 통과하지 않는다
const 끌기위치 = { x: 0, z: 0 }; // 놓을 때 읽는다. 프레임마다 갱신.
const _끌앞 = new THREE.Vector3();
// 각도 차이를 -π..π 로 접는다. 이걸 안 하면 350°와 10° 사이를 340° 돌아간다.
const 각차 = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function 의자끌기({
  이름,
  기준,
  반경 = 1,
  높이 = 3,
  거리 = 3.2,
  속도 = 24, // 유닛/초. 걷기(6)·달리기(10)보다 넉넉하고, 홱 돌 때 따라올 만큼.
  children,
}) {
  const g = useRef(null);
  const { camera } = useThree();
  // 끌고 가는 상태는 전부 여기 들어 있다(state 가 아니라 상자 — 다시 그리지 않는다)
  const 지금 = useRef({ x: 기준[0], z: 기준[1], 각: 0, 첫: true });
  const 박스이름 = `${이름}:끌기`;

  // 잡는 순간 '지금 있는 자리'로 채워 둔다.
  //   따라오는 계산이 한 번도 안 돈 상태에서 E 를 눌러도 제자리에 놓이도록.
  useEffect(() => {
    지금.current = { x: 기준[0], z: 기준[1], 각: 0, 첫: true };
    끌기위치.x = 기준[0];
    끌기위치.z = 기준[1];
    return () => {
      동적콜라이더.delete(박스이름);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;
    camera.getWorldDirection(_끌앞);
    _끌앞.y = 0;
    if (_끌앞.lengthSq() < 1e-6) return;
    _끌앞.normalize();

    const s = 지금.current;

    // ① 각도만 돌린다 (거리는 유지)
    //    목표점까지 직선으로 당기면 **뒤를 돌아볼 때 의자가 내 몸을 통과한다** —
    //    앞 3.2 와 뒤 3.2 를 잇는 직선이 카메라를 정확히 지나기 때문이다.
    //    카메라가 의자 외곽선 껍데기 안에 들어가면 화면이 통째로 덮여
    //    드로우콜이 폭발한다('동적 충돌 박스' 주석의 그 사고다).
    //    거리를 두고 각도만 돌리면 의자가 **몸 주위를 돌아** 그 일이 없다.
    const 목표각 = Math.atan2(_끌앞.x, _끌앞.z);
    if (s.첫) {
      s.각 = 목표각;
      s.첫 = false;
    }
    s.각 += 각차(목표각 - s.각) * (1 - Math.exp(-dt * 9));

    // ② 가고 싶은 자리 — 방 안으로 가둔다.
    //    벽은 충돌 박스가 아니어서(경계 사각형으로 막는다) 전에는 끌던 의자가
    //    벽을 아무 저항 없이 통과해 기차 쪽까지 나갔다.
    const 벽 = 반경 + 벽몰딩;
    let 목표x = THREE.MathUtils.clamp(
      camera.position.x + Math.sin(s.각) * 거리, MIN_X + 벽, MAX_X - 벽,
    );
    let 목표z = THREE.MathUtils.clamp(
      camera.position.z + Math.cos(s.각) * 거리, MIN_Z + 벽, MAX_Z - 벽,
    );

    // ②-b 너무 가까우면 시선 쪽으로 밀어낸다.
    //   벽에 코를 박고 서면 위 가두기가 목표를 **내 발밑까지** 당겨 온다.
    //   그대로 두면 카메라가 의자 외곽선 껍데기 안에 들어가 화면이 통째로 덮인다.
    //
    //   ★ 이 보정을 '결과'가 아니라 **'목표'** 에 거는 게 핵심이다.
    //     결과를 밀어내면 다음 프레임에 목표가 다시 당기고, 그걸 또 밀어내며
    //     매 프레임 왕복한다 — 그게 눈에 보이던 **잔떨림**이다.
    //     목표는 카메라 자세만으로 정해지는 값이라(되돌이가 없다) 떨리지 않는다.
    const 몸반경 = 반경 * 0.85;
    const 최소 = 몸반경 + 0.25; // 카메라가 의자 발자국 밖에 있기만 하면 된다
    const tdx = 목표x - camera.position.x;
    const tdz = 목표z - camera.position.z;
    const td = Math.hypot(tdx, tdz);
    if (td < 최소) {
      const ux = td > 1e-3 ? tdx / td : Math.sin(s.각);
      const uz = td > 1e-3 ? tdz / td : Math.cos(s.각);
      목표x = camera.position.x + ux * 최소;
      목표z = camera.position.z + uz * 최소;
    }

    // ③ 다가간다 — 부드럽게, 그러나 **정해진 속도 이상으로는 절대 안 움직인다.**
    //    전에는 막히면 '마지막 성한 자리'에 굳었다가 풀리는 순간 목표로 튀었다 —
    //    그게 눈에 보이던 순간이동이다.
    //    지수 감쇠만 쓰면 벌어진 거리에 비례해 움직이므로 크게 벌어졌을 때 여전히
    //    한 프레임에 몇 유닛을 뛴다. 그래서 속도에 **천장**을 씌운다 —
    //    이러면 얼마나 벌어져 있든 화면에서는 '빠르게 끌려온다'로 보인다.
    const k = 1 - Math.exp(-dt * 18);
    let dxg = (목표x - s.x) * k;
    let dzg = (목표z - s.z) * k;
    const 한번에 = 속도 * dt;
    const 걸음 = Math.hypot(dxg, dzg);
    if (걸음 > 한번에) {
      dxg *= 한번에 / 걸음;
      dzg *= 한번에 / 걸음;
    }
    const nx = s.x + dxg;
    const nz = s.z + dzg;

    // ④ 축을 따로 풀어 **미끄러지게** 한다.
    //    한 축이 막혀도 다른 축으로는 가므로, 벽에 대고 밀면 벽을 따라 흐른다.
    //    (걷기 판정도 같은 방식이다 — 공용.jsx use이동)
    const r = 몸반경; // 가구는 살짝 헐렁하게. 딱 맞추면 옆을 지날 때 걸린다.
    const 갇힘 = 막힘반경(s.x, s.z, r, 박스이름); // 이미 안에 있으면 빠져나가게 허용
    if (갇힘 || !막힘반경(nx, s.z, r, 박스이름)) s.x = nx;
    if (갇힘 || !막힘반경(s.x, nz, r, 박스이름)) s.z = nz;

    // ⑤ 끌려가는 동안에도 남들이 나를 피하게 박스를 같이 옮긴다.
    //    Chair 가 등록하는 박스는 '원래 자리'에 붙어 있어서 끌 때는 껐다.
    //    그런데 아무 박스도 없으면 **내가 끌던 의자 안으로 내가 걸어 들어간다.**
    동적콜라이더.set(박스이름, 원형박스(s.x, s.z, r, 높이));

    끌기위치.x = s.x;
    끌기위치.z = s.z;
    o.position.set(s.x - 기준[0], 0, s.z - 기준[1]);
  });

  return <group ref={g}>{children}</group>;
}

// ── 서랍 한 칸만 빛나게 ────────────────────────────────────
// [왜 캐비닛 통째로 안 빛내나]
//   겨냥 대상은 '서랍 한 칸'인데 캐비닛 전체가 빛나면 무엇을 여는지가 안 보인다.
//   그렇다고 서랍만 <강조> 로 감쌀 수도 없다 — **닫혀 있을 때 서랍은 GLB 몸통의
//   일부라 따로 떼어낼 메시가 없기 때문이다.**
//   그래서 그 칸 앞면 크기의 얇은 판을 하나 덧대고, 그것만 밝힌다.
//   더하기 합성(Additive)이라 원래 색을 지우지 않고 밝기만 올린다 → Bloom 이 번지게 한다.
function 서랍겨냥빛({ id, 칸, z, 색 = "#fffee7", 세기 = 0.45 }) {
  const ref = useRef(null);
  const 양 = useRef(0);
  const y0 = CAB_SEAMS[칸],
    y1 = CAB_SEAMS[칸 + 1];

  useFrame((_, dt) => {
    const o = ref.current;
    if (!o) return;
    const 목표 = 겨냥.값() === id ? 1 : 0;
    양.current += (목표 - 양.current) * (1 - Math.exp(-dt * 14));
    o.visible = 양.current > 0.01;
    o.material.opacity = 양.current * 세기;
    o.material.color.set(색);
  });

  return (
    <mesh
      ref={ref}
      visible={false}
      position={[0, (y0 + y1) / 2, z + 0.003]}
      scale={[CAB_FX * 2, y1 - y0, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// ===== 열린 서랍 (코드로 생성) =====
// GLB는 서랍이 통짜로 붙어 있어 '열' 수가 없다.
//   → 그 칸을 어두운 상자로 덮어 구멍처럼 만들고, 그 앞에 서랍 상자를 새로 그린다.
//   실제 서랍도 빼낸 깊이(d)만큼만 속이 보이므로, 이 방식이 그대로 맞아떨어진다.
const 서류색 = ["#E7E0CE", "#D6CAAE", "#EFEBE1", "#DED3BC", "#E9E3D3"];
function CabinetDrawer({
  칸,
  양: d,
  서류 = false,
  color = "#4A4F56",
  seed = 1,
  찌그러짐 = 4,
  깊이 = 0.016,
  얼룩 = 10,
  얼룩세기 = 1,
  낡음배율 = 1, // 몸통 대비 눌린 자국 깊이. 1 = 몸통과 같게
  선,
}) {
  const y0 = CAB_SEAMS[칸],
    y1 = CAB_SEAMS[칸 + 1];
  const h = y1 - y0; // 칸 높이
  const cy = (y0 + y1) / 2; // 칸 중심
  const zf = CAB_SLOT_Z + d; // 서랍 앞판 안쪽 면
  // 서랍 몸통(측벽·바닥)은 겉면보다 조금 어둡게 — 안쪽이라 빛을 덜 받는다
  const 안색 = useMemo(
    () => new THREE.Color(color).multiplyScalar(0.72).getStyle(),
    [color],
  );

  // ★ 서랍도 캐비닛 몸통과 '똑같은 낡음'을 쓴다.
  //   예전에는 민무늬 상자라 열린 서랍만 매끈하고 색도 달라 보였다.
  //   같은 시드를 쓰되 부품마다 조금씩 어긋나게 해서 판박이가 되지 않게 한다.
  //   면 분할(6,6,2)을 줘야 찌그러진 자국이 실제로 눌린다.
  const 부품 = useMemo(() => {
    const mk = (w, hh, dd, 씨, 오프셋) => {
      const g = new THREE.BoxGeometry(w, hh, dd, 12, 12, 2);
      // 미세 흔들림은 약하게만 — 세게 주면 정사각 격자 때문에 사선 줄무늬가 뜬다
      자글자글(g, 씨, 0.01);
      // 눌린 자국은 부품이 작으니 반경을 크게(0.12) 잡아야 실제로 눌린 게 보인다.
      //   ★ 예전에는 깊이를 0.45배로 줄여 놔서 **열린 서랍만 유독 매끈**했다.
      //     닫혀 있을 때 보이는 건 GLB 몸통(제 깊이)인데 열면 이 부품으로 바뀌니
      //     같은 서랍인데 여닫을 때마다 낡은 정도가 달라 보였다. 이제 몸통과 같게 준다.
      찌그러뜨리기(g, 씨, 찌그러짐, 깊이 * 낡음배율, 0.12);
      얼룩입히기(g, 씨, 얼룩, 얼룩세기, 오프셋);
      return g;
    };
    return {
      앞판: mk(0.34, h, 0.014, seed + 1, cy),
      측벽: mk(0.008, h - 0.01, d, seed + 2, cy),
      바닥: mk(0.336, 0.01, d, seed + 3, y0 + 0.014),
      손잡이: mk(0.11, 0.034, 0.012, seed + 4, cy - 0.02),
    };
  }, [seed, 찌그러짐, 깊이, 얼룩, 얼룩세기, 낡음배율, h, d, cy, y0]);
  // 슬라이더를 움직이면 새로 만들어지므로 이전 것은 버린다(GPU 누수 방지)
  useEffect(
    () => () => Object.values(부품).forEach((g) => g.dispose()),
    [부품],
  );
  // 서랍 안 서류 — 세워 꽂힌 파일철. 위로 살짝 튀어나와야 눈에 띈다.
  const 종이 = useMemo(() => {
    if (!서류 || d < 0.05) return [];
    const rnd = makeRandom(seed + 313);
    const n = 5;
    return Array.from({ length: n }, (_, i) => {
      const t = (i + 0.5) / n; // 서랍 앞뒤 방향 위치(0=구멍쪽, 1=앞판쪽)
      return {
        z: CAB_SLOT_Z + 0.018 + t * (d - 0.036),
        tilt: (rnd() - 0.5) * 0.16, // 살짝 기울어 꽂힘
        hh: h * (0.62 + rnd() * 0.22), // 종이 높이
        up: 0.012 + rnd() * 0.026, // 칸 윗변 위로 삐져나온 정도
        w: 0.27 + rnd() * 0.03,
        c: 서류색[i % 서류색.length],
      };
    });
  }, [서류, d, h, seed]);

  return (
    <group>
      {/* 구멍 — 뒤로 파고들어 GLB 앞판·손잡이 돌기를 통째로 가린다.
          구멍은 '빈 공간'이라 선을 두르지 않는다(두르면 판때기처럼 보인다). */}
      <mesh
        geometry={단위상자}
        position={[0, cy, CAB_SLOT_Z - 0.031]}
        scale={[0.336, h - 0.006, 0.062]}
      >
        <meshToonMaterial color="#191D24" gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 서랍 측벽 2장 + 바닥 — 빼낸 깊이만큼만 보인다 */}
      {[-1, 1].map((sx) => (
        <mesh
          key={sx}
          geometry={부품.측벽}
          position={[sx * 0.166, cy, CAB_SLOT_Z + d / 2]}
          castShadow
        >
          <meshToonMaterial
            color={안색}
            gradientMap={TOON_GRADIENT}
            vertexColors
            flatShading
          />
          <만화선 geo={부품.측벽} 선={선} />
        </mesh>
      ))}
      <mesh
        geometry={부품.바닥}
        position={[0, y0 + 0.014, CAB_SLOT_Z + d / 2]}
        castShadow
      >
        <meshToonMaterial
          color={안색}
          gradientMap={TOON_GRADIENT}
          vertexColors
          flatShading
        />
        <만화선 geo={부품.바닥} 선={선} />
      </mesh>
      {/* 서랍 앞판 + 손잡이 — 몸통과 같은 재질 설정(정점색 + 각진 음영) */}
      <mesh
        geometry={부품.앞판}
        position={[0, cy, zf + 0.007]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial
          color={color}
          gradientMap={TOON_GRADIENT}
          vertexColors
          flatShading
        />
        <만화선 geo={부품.앞판} 선={선} />
      </mesh>
      <mesh
        geometry={부품.손잡이}
        position={[0, cy - 0.02, zf + 0.02]}
        castShadow
      >
        <meshToonMaterial
          color={안색}
          gradientMap={TOON_GRADIENT}
          vertexColors
          flatShading
        />
        <만화선 geo={부품.손잡이} 선={선} />
      </mesh>
      {/* 안에 꽂힌 서류 */}
      {종이.map((s, i) => (
        <mesh
          key={i}
          geometry={단위상자}
          position={[0, y0 + 0.02 + s.hh / 2, s.z]}
          rotation={[0, 0, s.tilt]}
          scale={[s.w, s.hh + s.up, 0.005]}
          castShadow
        >
          <meshToonMaterial color={s.c} gradientMap={TOON_GRADIENT} />
          <만화선 geo={단위상자} 선={선} />
        </mesh>
      ))}
    </group>
  );
}

// 움푹 파인 자국 — 정점을 법선 반대쪽(안쪽)으로 밀어넣는다.
// 반경 = 자국 하나의 크기(물체 대각선 대비 비율). 작은 부품은 크게 잡아야 눌린 게 보인다.
function 찌그러뜨리기(geo, seed, 개수, 깊이, 반경 = 0.05) {
  // ★ cabinet.glb에는 NORMAL 속성이 없다(POSITION만 들어 있음).
  //   찌그러뜨릴 '방향'을 노멀에서 얻는데 그게 없으면 undefined.array 로 터진다.
  //   (노트북·의자 GLB도 같은 상태였다 — 이 모델들 공통 특징)
  //   → 없으면 여기서 계산해 준다.
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const rnd = makeRandom(seed);
  const P = geo.attributes.position.array;
  const N = geo.attributes.normal.array;
  const n = geo.attributes.position.count;

  // ★ 자국 크기·깊이를 '물체 크기'에 비례시킨다.
  //   그래야 캐비닛 본체(높이 1)와 서랍 앞판(높이 0.22)이
  //   같은 값으로 같은 정도로 낡아 보인다.
  //   기준 1.19 = 캐비닛 본체의 대각선 길이 → 본체는 예전과 완전히 동일하게 나온다.
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const 크기 = new THREE.Vector3();
  bb.getSize(크기);
  const 기준 = 크기.length() / 1.19;

  // 찍을 자리를 '평평한 패널 한가운데'로 제한한다.
  //   모서리를 찌그러뜨리면 상자 형태 자체가 무너져서 캐비닛으로 안 보인다.
  //   위아래 끝은 빼둔다(높이의 15~90% 구간).
  const yA = bb.min.y + 크기.y * 0.15,
    yB = bb.min.y + 크기.y * 0.9;
  const 후보 = [];
  for (let i = 0; i < n; i++) {
    const nx = Math.abs(N[i * 3]),
      nz = Math.abs(N[i * 3 + 2]),
      y = P[i * 3 + 1];
    if ((nx > 0.85 || nz > 0.85) && y > yA && y < yB) 후보.push(i);
  }
  if (!후보.length) return;

  for (let k = 0; k < 개수; k++) {
    const c = 후보[Math.floor(rnd() * 후보.length)] * 3;
    const cx = P[c],
      cy = P[c + 1],
      cz = P[c + 2];
    const R = 기준 * (반경 + rnd() * 반경);
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy, P[i * 3 + 2] - cz);
      if (d >= R) continue;
      const t = 1 - d / R;
      const s = t * t * (3 - 2 * t) * 깊이 * 기준; // smoothstep — 가운데 깊고 가장자리로 갈수록 얕게
      P[i * 3] -= N[i * 3] * s;
      P[i * 3 + 1] -= N[i * 3 + 1] * s;
      P[i * 3 + 2] -= N[i * 3 + 2] * s;
    }
  }
  geo.attributes.position.needsUpdate = true;
}

// 면을 자글자글하게 — 정점을 법선 방향으로 아주 조금씩 흔든다.
// [왜 필요한가]
//   캐비닛 몸통(Meshy GLB)은 삼각형이 불규칙해서 flatShading 을 주면
//   면마다 밝기가 갈려 '구겨진 철판'처럼 보인다.
//   반면 코드로 만든 상자는 완벽한 평면이라 toon 3단 명암 중 한 칸에
//   통째로 들어가 버린다 → 혼자 매끈하고 색도 달라 보였다.
//   면을 미세하게 흔들어 주면 같은 명암 분포가 생겨 몸통과 톤이 맞는다.
function 자글자글(geo, seed, 세기) {
  if (세기 <= 0) return;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const rnd = makeRandom(seed + 4441);
  const P = geo.attributes.position.array;
  const N = geo.attributes.normal.array;
  geo.computeBoundingBox();
  const 크기 = new THREE.Vector3();
  geo.boundingBox.getSize(크기);
  const a = 크기.length() * 세기;
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const s = (rnd() - 0.5) * a;
    P[i * 3] += N[i * 3] * s;
    P[i * 3 + 1] += N[i * 3 + 1] * s;
    P[i * 3 + 2] += N[i * 3 + 2] * s;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals(); // 흔든 뒤 노멀을 다시 잡아야 면이 각지게 보인다
}

// 얼룩 — 정점 색(vertexColors)으로. UV가 없어도 되고 toon 색에 곱해진다.
// 오프셋 = 이 지오메트리가 캐비닛 안에서 놓이는 높이.
//   '바닥에 가까울수록 때가 탄다' 를 부품에도 똑같이 먹이려면 필요하다.
function 얼룩입히기(geo, seed, 개수, 세기, 오프셋 = 0) {
  const rnd = makeRandom(seed + 9973);
  const P = geo.attributes.position.array;
  const n = geo.attributes.position.count;
  const dark = new Float32Array(n);
  geo.computeBoundingBox();
  const 크기 = new THREE.Vector3();
  geo.boundingBox.getSize(크기);
  const 기준 = 크기.length() / 1.19; // 캐비닛 본체 = 1

  for (let k = 0; k < 개수; k++) {
    const c = Math.floor(rnd() * n) * 3;
    const cx = P[c],
      cy = P[c + 1],
      cz = P[c + 2];
    const R = 기준 * (0.1 + rnd() * 0.24);
    const S = 0.4 + rnd() * 0.7;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy, P[i * 3 + 2] - cz);
      if (d >= R) continue;
      const t = 1 - d / R;
      dark[i] += t * t * S;
    }
  }
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    dark[i] += Math.max(0, 0.16 - (P[i * 3 + 1] + 오프셋)) * 2.4; // 바닥에 가까울수록 때가 탄다
    const f = 1 - Math.min(0.5, dark[i] * 세기);
    col[i * 3] = f;
    col[i * 3 + 1] = f * 0.985;
    col[i * 3 + 2] = f * 0.95; // 살짝 누렇게
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

function Cabinet({
  pos = [0, 0],
  baseY = 0,
  rot = 0, // 0 = 앞면(서랍)이 +Z 를 본다
  height = 4.3, // 유닛. 4.3 ≈ 1.3m
  seed = 7, // ★ 이 숫자만 바꾸면 얼룩·찌그러짐이 통째로 달라진다
  color = "#4A4F56",
  찌그러짐 = 4,
  깊이 = 0.009,
  얼룩 = 10,
  얼룩세기 = 1.0,
  선보이기 = true,
  선색 = "#8A929C",
  열림 = null, // { 칸: 0~3, 양: 뺀 깊이, 서류: bool } — null이면 전부 닫힘
  겨냥 = null, // { id, 칸, 색, 세기 } — 이 칸만 빛낸다. 없으면 안 빛낸다.
  서랍낡음 = 1,
  선,
}) {
  const [x, z] = pos;
  const { scene } = useGLTF("/models/cabinet.glb");

  // GLB 안에 메시가 하나뿐이라 '지오메트리'만 꺼내 쓴다.
  //   <primitive>(THREE 객체를 통째로 꽂는 방식)는 자식 JSX를 못 받아서
  //   drei <Outlines>를 넣을 수 없다. → JSX <mesh>로 직접 그린다.
  const geo = useMemo(() => {
    let src = null;
    scene.traverse((o) => {
      if (o.isMesh && !src) src = o.geometry;
    });
    const c = src.clone(); // 캐비닛마다 자기 지오메트리를 가져야 따로 찌그러진다
    찌그러뜨리기(c, seed, 찌그러짐, 깊이);
    얼룩입히기(c, seed, 얼룩, 얼룩세기);
    return c;
  }, [scene, seed, 찌그러짐, 깊이, 얼룩, 얼룩세기]);
  // 슬라이더를 움직이면 새 지오메트리가 생기므로 이전 것은 버린다(GPU 누수 방지)
  useEffect(() => () => geo.dispose(), [geo]);

  // 열린 서랍이 있으면 그 칸 선만 앞으로 나온 전용 지오메트리를 쓴다.
  const 선geo = useMemo(
    () => (열림 ? 캐비닛선분(열림) : CAB_LINE_GEO),
    [열림?.칸, 열림?.양], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // 슬라이더를 움직이면 새로 만들어지므로 이전 것은 버린다(GPU 메모리 누수 방지)
  useEffect(
    () => () => {
      if (선geo !== CAB_LINE_GEO) 선geo.dispose();
    },
    [선geo],
  );

  return (
    <group position={[x, baseY, z]} rotation={[0, rot, 0]} scale={height}>
      {/* 몸통 — <Outlines>가 실루엣 둘레에 만화 테두리를 두른다.
          방 구조물·책상·의자에 쓰는 것과 같은 컴포넌트라 선 굵기·색이 통일된다. */}
      <mesh geometry={geo} castShadow receiveShadow>
        <meshToonMaterial
          color={color}
          gradientMap={TOON_GRADIENT}
          vertexColors /* 얼룩 색이 여기에 곱해진다 */
          flatShading /* 면마다 각지게 — 철제 상자는 모서리가 살아야 한다 */
        />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {열림 && (
        <강조
          id={겨냥?.id}
          색={겨냥?.색}
          세기={겨냥?.세기}
          확대={0} /* 서랍은 커지지 않는다 — 몸통 구멍에서 삐져나와 보인다 */
          기준={() => [0, 0, 0]}
        >
        <CabinetDrawer
          선={선}
          찌그러짐={찌그러짐}
          깊이={깊이}
          얼룩={얼룩}
          얼룩세기={얼룩세기}
          칸={열림.칸}
          양={열림.양}
          서류={열림.서류}
          낡음배율={서랍낡음}
          color={color}
          seed={seed}
        />
        </강조>
      )}
      {/* 서랍 구분선 — 지오메트리는 셋이 공유하고 색만 따로 준다.
          toneMapped=false 라 어두운 방에서도 지정한 색 그대로 보인다. */}
      {선보이기 && (
        <lineSegments geometry={선geo}>
          <lineBasicMaterial color={선색} toneMapped={false} />
        </lineSegments>
      )}
      {/* 겨냥 강조 — 만질 수 있는 그 한 칸만.
             ★ 닫혀 있을 때만 이 덧판을 쓴다. 닫힌 서랍은 GLB 몸통의 일부라
               따로 밝힐 메시가 없기 때문이다.
               열려 있으면 위쪽 <강조> 가 **서랍 메시 전체**(앞판·측벽·바닥·손잡이)를
               밝힌다 — 예전에는 앞면만 빛나서 안쪽이 캄캄했다. */}
      {겨냥 && !(열림 && 열림.칸 === 겨냥.칸) && (
        <서랍겨냥빛
          id={겨냥.id}
          칸={겨냥.칸}
          z={CAB_FZ}
          색={겨냥.색}
          세기={겨냥.세기}
        />
      )}
    </group>
  );
}

// 어느 캐비닛의 몇 번째 서랍을 얼마나 열지 (칸: 아래부터 0)
//   12칸 중 3칸만 연다 — 둘은 살짝, 하나는 더 열어 서류가 보이게.
const CAB_OPEN_PLAN = [
  { 칸: 0, 세기: "살짝" }, // 캐비닛1 — 맨 아래
  { 칸: 2, 세기: "많이", 서류: true }, // 캐비닛2 — 아래에서 세 번째(허리 높이라 안이 잘 보인다)
  { 칸: 1, 세기: "많이", 서류: true }, // 캐비닛3(왼쪽 끝) — 아래에서 두 번째, 서류 보임
];

// ===== 옷걸이 스탠드 (전부 코드) =====
// 옷걸이 스탠드 — 십자 받침 + 기둥 + 비스듬한 가지 여러 개
function 옷걸이스탠드({
  스탠드색 = "#2A2E34",
  옷색 = "#3E4A5C",
  높이 = 5.8, // 유닛. 5.8 ≈ 1.74m
  반전 = false, // 좌우를 뒤집어 둘이 똑같아 보이지 않게
  선,
}) {
  const { scene } = useGLTF("/models/coat_rack.glb");

  // 스탠드와 옷은 GLB 안에서 이름이 나뉘어 있다("rack" / "coat").
  //   → 색을 따로 줄 수 있다. 파이프라인에서 위치로 갈라 붙여 둔 이름이다.
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshToonMaterial({
        color: o.name === "coat" ? 옷색 : 스탠드색,
        gradientMap: TOON_GRADIENT,
        side: o.name === "coat" ? THREE.DoubleSide : THREE.FrontSide, // 천은 안쪽도 보인다
      });
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return c;
  }, [scene, 스탠드색, 옷색]);
  const 조각 = useMemo(() => GLB조각(model), [model]);

  // 모델은 높이 1.0 으로 정규화돼 있다 → scale 값이 곧 '높이(유닛)'.
  return (
    <group scale={[반전 ? -높이 : 높이, 높이, 높이]}>
      <조각그리기 조각={조각} 선={선} />
    </group>
  );
}

// ── SceneInventory 씨앗 ──────────────────────────────────────
// 방을 '코드'가 아니라 '데이터'로 정의하는 첫 단계.
//   나중에 이 배열이 통째로 JSON 파일로 빠지고, AI 에이전트가 이 형식을 만들어낸다.
//   그러면 방 2·3은 새 코드 없이 데이터만 갈아끼우면 된다.
const 증거목록 = [
  {
    id: "E-01",
    종류: "봉투",
    이름: "증거물 봉투 #01",
    사건: "2026-나주-014",
    품목: "향토지 사본 3면",
    설명: "1998년 나주군 향토지에서 뜯겨 나온 낱장. 완사천 항목이 있어야 할 자리다.",
    단서: "페이지 번호가 건너뛴다 — 187 다음이 190.",
  },
  {
    id: "E-02",
    종류: "번호표",
    번호: 2,
    이름: "증거 번호 표지 2",
    사건: "2026-나주-014",
    품목: "현장 표지",
    설명: "완사천 우물 옆 바닥에 세워 둔 노란 삼각 표지. 촬영용 번호다.",
    단서: "표지가 가리키던 자리에는 지금 아무것도 남아 있지 않다.",
  },
  {
    id: "E-03",
    종류: "상자",
    이름: "증거물 상자",
    사건: "2026-나주-014",
    품목: "압수 기록 일괄",
    설명: "현장에서 걷어 온 기록을 담은 상자. 봉인 테이프가 한 번 뜯겼다가 다시 붙었다.",
    단서: "봉인 날짜와 재봉인 날짜가 다르다.",
  },
  {
    id: "E-04",
    종류: "번호표",
    번호: 1,
    이름: "증거 번호 표지 1",
    사건: "2026-나주-014",
    품목: "현장 표지",
    설명: "안내판 바로 앞에 세운 표지. 1번은 늘 '문제의 물건'에 붙는다.",
    단서: "안내판 문구가 2019년 판과 한 글자 다르다 — 그 한 글자가 전부다.",
  },
  {
    id: "E-05",
    종류: "번호표",
    번호: 3,
    이름: "증거 번호 표지 3",
    사건: "2026-나주-014",
    품목: "현장 표지",
    설명: "우물에서 동문다리 쪽으로 스무 걸음 떨어진 자리에 세운 표지.",
    단서: "3번 자리는 현장 사진에만 있고 조서에는 빠져 있다.",
  },
  {
    id: "E-06",
    종류: "수거품상자",
    이름: "현장 수거품 상자",
    사건: "2026-나주-014",
    품목: "현장 수거품 일괄",
    설명: "완사천 주변에서 걷어 온 잡물. 아직 분류 전이라 반출 대기 딱지가 붙어 있다.",
    단서: "봉인 날짜가 증거물 상자보다 하루 늦다.",
  },
];

// ── 라벨 텍스처 ──────────────────────────────────────────────
// 사건번호가 찍히는 순간 '상자'가 '증거'가 된다. 이게 이 물건들의 핵심.
const 라벨캐시 = new Map();
function 라벨텍스처(키, 그리기, w = 256, h = 160) {
  if (!라벨캐시.has(키)) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    그리기(g, w, h);
    // 인쇄물처럼 너무 깨끗하지 않게 — 키 문자열로 씨드를 만들어 늘 같은 얼룩이 나온다
    let 씨 = 0;
    for (let i = 0; i < 키.length; i++)
      씨 = (씨 * 31 + 키.charCodeAt(i)) % 99991;
    질감얹기(g, w, h, 씨 + 1, 0.9);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    라벨캐시.set(키, t);
  }
  return 라벨캐시.get(키);
}

// ── 증거물 3종 (전부 코드) ───────────────────────────────────
// 납작하고 각진 물건은 Meshy가 못 만든다 — 서류·화이트보드와 같은 이유.
// 두께 = 지퍼백 자체의 얇기(월드 유닛). 봉투는 '납작할수록' 증거물처럼 보인다.
// 크기 = 이 봉투만 따로 주는 배수. 최종 = 증거물(공통)의 크기 × 이 값.
function 증거봉투({ 사건, 품목, 선, 두께 = 0.05, 크기 = 1 }) {
  const tex = useMemo(
    () =>
      라벨텍스처(`bag-${사건}-${품목}`, (g, w, h) => {
        g.fillStyle = "#E9E3CD";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#3A3E46";
        g.lineWidth = 3;
        g.strokeRect(9, 9, w - 18, h - 18);
        g.fillStyle = "#B3271E";
        g.fillRect(9, 9, w - 18, 30);
        g.fillStyle = "#F6F2E6";
        g.font = "bold 19px sans-serif";
        g.fillText("EVIDENCE · 증거물", 20, 31);
        g.fillStyle = "#23262B";
        g.font = "17px sans-serif";
        g.fillText(`사건 ${사건}`, 20, 72);
        g.fillText(`품목 ${품목}`, 20, 98);
        g.strokeStyle = "#8A8677";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(20, 118);
        g.lineTo(w - 20, 118);
        g.stroke();
        g.font = "14px sans-serif";
        g.fillStyle = "#5A5648";
        g.fillText("수집 2026.08.21  담당 ______", 20, 138);
      }),
    [사건, 품목],
  );
  // 안에 든 종이는 봉투보다 항상 얇아야 한다.
  //   고정값 0.02 로 두면 봉투를 0.01 까지 줄였을 때 종이가 봉투를 뚫고 나온다.
  //   → 봉투 두께의 45% 로 따라가게 묶는다.
  const 종이두께 = 두께 * 0.45;
  // 라벨(스티커)은 봉투 '겉면'에 붙는다. 겉면 = 두께의 절반.
  //   0.002 는 z-파이팅(같은 평면 두 장이 깜빡이는 현상) 방지용 틈.
  const 라벨z = 두께 / 2 + 0.002;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} scale={크기}>
      {/* 지퍼백 — 반투명해야 '봉투 안에 뭔가 들어 있다'로 읽힌다 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.66, 0.9, 두께]} />
        <meshToonMaterial
          color="#CFD6DA"
          gradientMap={TOON_GRADIENT}
          transparent
          opacity={0.55}
        />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {/* 안에 든 종이 */}
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[0.56, 0.74, 종이두께]} />
        <meshToonMaterial color="#DED8C6" gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 라벨 — 봉투 위쪽에 붙은 스티커 */}
      <mesh position={[0, 0.22, 라벨z]}>
        <planeGeometry args={[0.58, 0.36]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function 증거번호표({ 번호 = 2, 선 }) {
  const tex = useMemo(
    () =>
      라벨텍스처(
        `num-${번호}`,
        (g, w, h) => {
          g.fillStyle = "#E8B62C";
          g.fillRect(0, 0, w, h);
          g.fillStyle = "#23262B";
          g.font = "bold 108px sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(String(번호), w / 2, h / 2 + 4);
        },
        160,
        160,
      ),
    [번호],
  );
  // A자로 접힌 표지 — 판 두 장을 '위에서' 맞대 세운다.
  //   ★ 예전 코드는 rotation.x 부호가 반대라 윗변이 바깥으로 벌어졌다(∨ 모양).
  //     바닥에 꼭짓점이 닿고 위가 열린, 뒤집힌 표지로 보이던 원인이다.
  //   판 한 장만 제대로 세우고, 나머지 한 장은 Y로 180° 돌린 '거울상'으로 만든다.
  //     이러면 뒷장도 숫자가 바깥을 보고 똑바로 읽힌다(뒤에서 보면 좌우가 뒤집히던 문제도 사라진다).
  return (
    <group>
      {[0, Math.PI].map((yaw, i) => (
        <group key={i} rotation={[0, yaw, 0]}>
          <mesh
            geometry={단위판}
            position={[0, 0.21, 0.11]}
            rotation={[-0.42, 0, 0]}
            scale={[0.42, 0.46, 1]}
            castShadow
          >
            <meshBasicMaterial
              map={tex}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
            {/* 평면이라 외곽선(면 부풀리기)은 안 통한다 → 주름선이 테두리가 된다 */}
            <만화선 geo={단위판} 선={선} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// 상자 모서리 선 — 캐비닛 서랍선과 같은 방식(lineSegments).
//   면을 부풀리는 <Outlines>와 달리 모서리에 딱 붙어서 만화 선처럼 떨어진다.
//   상자 크기가 고정이라 한 번만 만들어 모든 상자가 같이 쓴다.
const 상자_크기 = [1.35, 0.9, 1.05];
const 상자선_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(...상자_크기));

function 증거상자({ 사건, 선 }) {
  const tex = useMemo(
    () =>
      라벨텍스처(`box2-${사건}`, (g, w, h) => {
        g.fillStyle = "#EDE6D2";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#3A3E46";
        g.lineWidth = 4;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = "#23262B";
        g.font = "bold 26px sans-serif";
        g.fillText("왜곡 단서", 22, 48);
        g.font = "20px sans-serif";
        g.fillText(`사건 ${사건}`, 22, 84);
        g.fillText("봉인 2026.08.21", 22, 112);
        g.fillStyle = "#B3271E";
        g.font = "bold 20px sans-serif";
        g.fillText("재봉인 08.25", 22, 140);
      }),
    [사건],
  );
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={상자_크기} />
        <meshToonMaterial color="#A8977A" gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {/* 모서리 선 — '주름선' 칸에서 켜고 끄고 색을 고른다.
          toneMapped=false 라 어두운 방에서도 지정한 색 그대로 나온다 */}
      {선?.주름선 && (
        <lineSegments position={[0, 0.45, 0]} geometry={상자선_GEO}>
          <lineBasicMaterial color={선.주름선색} toneMapped={false} />
        </lineSegments>
      )}
      {/* 봉인 테이프 — 뚜껑 가운데를 가로지른다 */}
      <mesh position={[0, 0.905, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.2, 1.05]} />
        <meshToonMaterial color="#C9BE9A" gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 라벨 */}
      <mesh position={[0, 0.47, 0.528]}>
        <planeGeometry args={[0.95, 0.6]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ===== 증거 상자 ② 현장 수거품 (아래 상자와 완전히 별개 물건) =====
// 크기·위치·회전을 Leva "증거물6(수거품 상자)" 에서 따로 조절한다.
//   밑면이 y=0 에 오도록 그려서, 폴더의 '높이' 가 곧 바닥에서 띄운 값이 된다.
function 수거품상자({ 사건, 선, 가로 = 0.95, 세로 = 0.78, 상자높이 = 0.62 }) {
  // 라벨 — 아래 상자와 같은 서식, 내용만 다르다
  const tex2 = useMemo(
    () =>
      라벨텍스처(`box2b-${사건}`, (g, w, h) => {
        g.fillStyle = "#EDE6D2";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#3A3E46";
        g.lineWidth = 4;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = "#23262B";
        g.font = "bold 26px sans-serif";
        g.fillText("현장 수거품", 22, 48);
        g.font = "20px sans-serif";
        g.fillText(`사건 ${사건}`, 22, 84);
        g.fillText("봉인 2026.08.22", 22, 112);
        g.fillStyle = "#B3271E";
        g.font = "bold 20px sans-serif";
        g.fillText("반출 대기", 22, 140);
      }),
    [사건],
  );
  // 크기를 바꾸면 모서리선도 같이 바뀌어야 한다
  const 선geo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(가로, 상자높이, 세로)),
    [가로, 상자높이, 세로],
  );
  useEffect(() => () => 선geo.dispose(), [선geo]);

  return (
    <group position={[0, 상자높이 / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[가로, 상자높이, 세로]} />
        {/* 아래 상자와 같은 골판지지만 한 톤 어둡게 — 색이 똑같으면 한 덩어리로 보인다 */}
        <meshToonMaterial color="#9C8C71" gradientMap={TOON_GRADIENT} />
        {선?.외곽선 && (
          <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
        )}
      </mesh>
      {선?.주름선 && (
        <lineSegments geometry={선geo}>
          <lineBasicMaterial color={선.주름선색} toneMapped={false} />
        </lineSegments>
      )}
      {/* 봉인 테이프 — 뚜껑을 가로지른다 */}
      <mesh
        position={[0, 상자높이 / 2 + 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.16, 세로]} />
        <meshToonMaterial color="#C9BE9A" gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 라벨 — 상자 크기에 맞춰 같이 커진다 */}
      <mesh position={[0, 0.02, 세로 / 2 + 0.003]}>
        <planeGeometry args={[가로 * 0.72, 상자높이 * 0.68]} />
        <meshBasicMaterial map={tex2} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ===== 3D 씬 =====
function Scene({
  active,
  onNear,
  controlsRef,
  onLockChange,
  삼인칭 = false,
  플레이어참조 = null,
  사이드킥설정 = undefined,
  치비설정 = undefined,
  툰설정 = undefined,
  외곽선설정 = undefined,
}) {
  // ── 로비 물건 상태 (서랍·램프·의자·들고 있는 것) ──────────
  //   겨냥은 여기서 구독하지 않는다. 고개만 돌려도 방 전체가 다시 그려지기 때문이다.
  const 로비 = use로비상태();
  // ── 자판기 — 돈을 넣었나 · 무엇이 나왔나 ──────────────────
  //   버튼 불빛·눌림 같은 **매 프레임 값은 여기로 안 올라온다.**
  //   그것까지 state 로 만들면 초당 60번 복도가 다시 그려진다
  //   (자판기상태.js 를 useFrame 에서 직접 읽어 재질만 손으로 고친다).
  const 음료자판상태 = use자판기("음료");
  const 커피자판상태 = use자판기("커피");
  // ── 바닥도 물건을 놓을 수 있는 면이다 ────────────────────
  useEffect(() => {
    표면등록("바닥", {
      minX: MIN_X,
      maxX: MAX_X,
      minZ: MIN_Z,
      maxZ: MAX_Z,
      top: 0,
    });
    return () => 표면해제("바닥");
  }, []);
  // ── 시점(눈높이) 조절 ──────────────────────────────────
  //   usePlayer보다 먼저 선언해야 값을 넘겨줄 수 있다.
  //   (React 훅은 매 렌더마다 '같은 순서'로 호출돼야 하므로 위치를 고정한다)
  const CAM = useSavedControls("시점(눈높이)", {
    눈높이: { value: EYE, min: 2, max: 10, step: 0.05 },
    앉은높이: { value: CROUCH_EYE, min: 0.8, max: 6, step: 0.05 },
  });
  // ★ 기차에서 막 내렸다면 탔던 문 앞에 다시 세운다.
  //   카메라는 씬이 바뀌어도 하나뿐이라, 그냥 두면 기차 안 좌표(0, 6.5, 0)가
  //   그대로 역 좌표로 해석돼 방 한가운데에 뚝 떨어진다.
  //   useMemo 로 감싼 이유 = 이 판단은 씬이 켜질 때 딱 한 번만 해야 하기 때문이다.
  const 복귀 = useMemo(() => {
    if (!기차에서나옴.켬 || !들어간문.위치) return null;
    기차에서나옴.켬 = false; // 한 번 쓰면 끈다
    const d = 들어간문.위치;
    return {
      시작: [d.x - 2.6, undefined, d.z], // 문에서 방 안쪽으로 두 걸음 물러난 자리
      바라봄: Math.PI / 2, // -x = 방 안쪽을 본다
    };
  }, []);
  usePlayer(
    active,
    onNear,
    CAM.눈높이,
    CAM.앉은높이,
    복귀,
    삼인칭,
    플레이어참조,
  );
  // ── 벽·바닥 질감 ───────────────────────────────────────
  //   콘크리트 블록 벽 + 민바닥 콘크리트. 시드를 바꾸면 얼룩 배치가 통째로 달라진다.
  const MAT = useSavedControls("벽·바닥 질감", {
    벽색: "#525b69",
    벽아랫단색: "#4e5462",
    벽시드: { value: 7, min: 1, max: 999, step: 1 },
    벽얼룩: { value: 0.5, min: 0, max: 1.5, step: 0.05 },
    // 벗겨진 페인트 · 실금 · 아래에서 올라온 때 — '더러움'이 아니라 '세월'
    벽낡음: { value: 0.7, min: 0, max: 2, step: 0.05 },
    바닥색: "#424448",
    바닥시드: { value: 340, min: 1, max: 999, step: 1 },
    바닥얼룩: { value: 0.85, min: 0, max: 1.5, step: 0.05 },
    // 천장 — 벽·바닥과 같은 방식의 노출 콘크리트
    천장색: "#5a5f69",
    // 천장자체밝기 = 빛과 상관없이 천장 재질이 스스로 내는 밝기(emissive).
    //   조명으로 천장을 밝히면 '동그란 웅덩이'가 찍히지만,
    //   이 값은 천장 전체를 고르게 들어 올린다 → 검게 죽는 것만 막아 준다.
    //   너무 올리면 종이처럼 납작해지니 0.1~0.2 사이가 적당하다.
    천장자체밝기: { value: 0.14, min: 0, max: 0.6, step: 0.01 },
    천장시드: { value: 12, min: 1, max: 999, step: 1 },
    천장얼룩: { value: 0.7, min: 0, max: 1.5, step: 0.05 },
    천장낡음: { value: 0.7, min: 0, max: 2, step: 0.05 },
  });

  const 바닥텍 = 바닥텍스처(MAT.바닥시드);
  const 바닥geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      ROOM_W,
      ROOM_D,
      Math.round(ROOM_W / 1.5),
      Math.round(ROOM_D / 1.5),
    );
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, uv.getX(i) * (ROOM_W / FLOOR_TEX));
      uv.setY(i, uv.getY(i) * (ROOM_D / FLOOR_TEX));
    }
    면얼룩(g, MAT.바닥시드, { 개수: 24, 세기: MAT.바닥얼룩 });
    return g;
  }, [MAT.바닥시드, MAT.바닥얼룩]);
  useEffect(() => () => 바닥geo.dispose(), [바닥geo]);

  // 천장도 바닥과 같은 방식 — 면을 잘게 나눠 정점 얼룩을 얹는다
  const 천장텍 = 천장텍스처(MAT.천장시드, MAT.천장낡음);
  const 천장geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      ROOM_W,
      ROOM_D,
      Math.round(ROOM_W / 1.5),
      Math.round(ROOM_D / 1.5),
    );
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, uv.getX(i) * (ROOM_W / CEIL_TEX));
      uv.setY(i, uv.getY(i) * (ROOM_D / CEIL_TEX));
    }
    면얼룩(g, MAT.천장시드, { 개수: 20, 세기: MAT.천장얼룩 });
    return g;
  }, [MAT.천장시드, MAT.천장얼룩]);
  useEffect(() => () => 천장geo.dispose(), [천장geo]);

  // ── Leva 튜닝 패널 ──────────────────────────────────────
  // 화면 오른쪽 위에 슬라이더가 뜬다. 값을 돌려보며 폐역 톤을 직접 맞추고,
  // 마음에 드는 값을 찾으면 알려주면 코드에 고정한다. (개발용 — 최종엔 끈다)
  const L = useSavedControls("폐역 조명", {
    기본광밝기: { value: 1.5, min: 0, max: 1.7, step: 0.01 },
    기본광색: "#ffffff",
    반구광밝기: { value: 0.78, min: 0, max: 1.5, step: 0.01 },
    주광밝기: { value: 2.88, min: 0, max: 3, step: 0.01 },
    주광색: "#ffffff",
    앰버포인트밝기: { value: 49, min: 0, max: 120, step: 1 },
    안개농도시작: { value: 42, min: 0, max: 120, step: 1 },
    안개농도끝: { value: 274, min: 20, max: 300, step: 1 },
    안개색: "#cfd9eb",
  });

  // ── 스탠드 조명 ────────────────────────────────────────
  // ★ 새 폴더라 기존 "폐역 조명" 값은 하나도 건드리지 않는다.
  //   전체어둡게 = 기존 조명 3개에 곱하는 배율. 1.0 으로 올리면 예전 상태 그대로 복구.
  const S = useSavedControls("스탠드(공통)", {
    천장등끄기: false,
    // 0.73 → 0.79. 조명 3개(기본·반구·주광)에 한꺼번에 곱하는 값이라
    //   수사본부실과 복도가 같이 아주 살짝 밝아진다.
    전체어둡게: { value: 0.79, min: 0, max: 1, step: 0.01 },
    켜기: true,
    높이: { value: 1.5, min: 0.5, max: 4, step: 0.05 }, // 유닛. 1.5 ≈ 45cm
    전구색: "#fdffda",
    갓안쪽색: "#242322",
    몸체색: "#34383e",
    빛세기: { value: 30, min: 0, max: 300, step: 1 },
    빛퍼짐: { value: 0.55, min: 0.1, max: 1.4, step: 0.01 },
    // 그늘 칸의 밝기. 0이면 그늘이 완전 검정이라 갓·기둥에 새까만 얼룩이 크게 진다.
    음영바닥: { value: 55, min: 0, max: 140, step: 5 },
    그림자: false, // 켤수록 무겁다(스탠드마다 그림자맵 한 장씩 더 그림)

    // 굵기 2.0 = 다른 물건(3.0)보다 얇게. 스탠드는 자잘한 부품이 많아
    //   같은 굵기를 주면 선이 서로 붙어 뭉개진다.
    ...선스키마({ 굵기: 2.0, 색: "#1a1614", 주름: false, 각도: 45 }),
  });
  // 개별 조절 — 관절 각도는 없다(Meshy 모델은 한 덩어리라 못 꺾는다).
  //   회전 0 = 갓이 -X 쪽을 비춘다.
  const st1 = useSavedControls("스탠드1", {
    x: { value: -12.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.2, min: -14, max: 14, step: 0.1 },
    받침높이: { value: 2.05, min: 0, max: 6, step: 0.05 },
    회전: { value: 3.02, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별배율: { value: 1.0, min: 0.3, max: 2.5, step: 0.01 },
  });
  const st2 = useSavedControls("스탠드2", {
    x: { value: -10.9, min: -20, max: 20, step: 0.1 },
    z: { value: -1.0, min: -14, max: 14, step: 0.1 },
    받침높이: { value: 2.05, min: 0, max: 6, step: 0.05 },
    회전: { value: 0.31, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별배율: { value: 1.0, min: 0.3, max: 2.5, step: 0.01 },
  });
  const st3 = useSavedControls("스탠드3", {
    x: { value: 1.6, min: -20, max: 20, step: 0.1 },
    z: { value: -2.0, min: -14, max: 14, step: 0.1 },
    받침높이: { value: 2.05, min: 0, max: 6, step: 0.05 },
    회전: { value: -1.06, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별배율: { value: 1.0, min: 0.3, max: 2.5, step: 0.01 },
  });
  const stLive = [st1, st2, st3];
  // 램프 개별 on/off — 손으로 만진 적이 없으면 Leva 공통값을 따른다.
  const 램프보기 = (id, 기본) => 로비.램프[id] ?? 기본;

  // ── 서류 캐비닛 ────────────────────────────────────────
  //   색·크기는 셋이 공통, 시드만 달라서 얼룩·찌그러짐이 서로 다르다.
  const CB = useSavedControls("캐비닛(공통)", {
    보이기: true,
    색: "#4d5460",
    높이: { value: 4.3, min: 2, max: 8, step: 0.05 }, // 4.3 ≈ 1.3m
    찌그러짐: { value: 4, min: 0, max: 12, step: 1 },
    깊이: { value: 0.016, min: 0, max: 0.026, step: 0.001 },
    얼룩: { value: 10, min: 0, max: 24, step: 1 },
    얼룩세기: { value: 0.0, min: 0, max: 2, step: 0.05 },
    선보이기: true,
    선색: "#000000",
    // 서랍 열기 — 12칸 중 3칸(CAB_OPEN_PLAN)만 연다. 값은 모델 높이 1 기준.
    서랍열기: true,
    살짝열림: { value: 0.12, min: 0, max: 0.25, step: 0.005 },
    많이열림: { value: 0.14, min: 0, max: 0.25, step: 0.005 },
    서류보이기: true,
    // 열린 서랍 부품의 눌린 자국 깊이(몸통 대비). 1 = 몸통과 같게.
    //   닫혔을 때 보이는 GLB 몸통과 열었을 때 보이는 코드 부품의 낡은 정도를 맞춘다.
    서랍낡음: { value: 1.0, min: 0, max: 2, step: 0.05 },

    ...선스키마({ 주름: true, 각도: 40 }),
  });
  const cb1 = useSavedControls("캐비닛1", {
    x: { value: -11.6, min: -20, max: 20, step: 0.1 },
    z: { value: 10.2, min: -14, max: 14, step: 0.1 },
    회전: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01 },
    시드: { value: 6511, min: 1, max: 9999, step: 1 },
  });
  const cb2 = useSavedControls("캐비닛2", {
    x: { value: -10.0, min: -20, max: 20, step: 0.1 },
    z: { value: 10.2, min: -14, max: 14, step: 0.1 },
    회전: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01 },
    시드: { value: 6145, min: 1, max: 9999, step: 1 },
  });
  const cb3 = useSavedControls("캐비닛3", {
    x: { value: -8.4, min: -20, max: 20, step: 0.1 },
    z: { value: 10.2, min: -14, max: 14, step: 0.1 },
    회전: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01 },
    시드: { value: 4022, min: 1, max: 9999, step: 1 },
  });
  const cbLive = [cb1, cb2, cb3];

  // ── 서랍 여닫기 (S4-009 · CT-007) ──────────────────────
  const 서랍칸 = (i) => CAB_OPEN_PLAN[i]?.칸 ?? 1;
  const 서랍기본 = (i) =>
    CB.서랍열기 && CAB_OPEN_PLAN[i]
      ? {
          칸: CAB_OPEN_PLAN[i].칸,
          양: CAB_OPEN_PLAN[i].세기 === "많이" ? CB.많이열림 : CB.살짝열림,
          서류: !!CAB_OPEN_PLAN[i].서류 && CB.서류보이기,
        }
      : null;
  const 서랍보기 = (i) => {
    const 손 = 로비.서랍[`cab${i}`];
    if (손 === undefined) return 서랍기본(i);
    if (손 === null) return null;
    return { ...손, 서류: !!CAB_OPEN_PLAN[i]?.서류 && CB.서류보이기 };
  };
  const 서랍열렸나 = (i) => {
    const v = 서랍보기(i);
    return !!v && v.양 > 0.005;
  };
  const 서랍위치 = (i) => {
    const c = cbLive[i];
    const 칸 = 서랍칸(i);
    const cy = (CAB_SEAMS[칸] + CAB_SEAMS[칸 + 1]) / 2;
    const fz = CAB_FZ * CB.높이;
    return [
      c.x + Math.sin(c.회전) * fz,
      cy * CB.높이,
      c.z + Math.cos(c.회전) * fz,
    ];
  };

  // ── 서랍 안에 놓인 물건은 서랍과 한 몸으로 움직인다 ──────
  //   증거 번호표 2번이 캐비닛1 맨 아래 서랍 안에 있다. 서랍만 움직이면
  //   표지가 캐비닛을 뚫고 허공에 남는다.
  //   ★ 지금 좌표는 **서랍이 살짝 열린 모습을 보고 맞춘 값**이라,
  //     열림 0 을 기준으로 더하면 두 번 밀린다. 기본 열림량과의 '차이'만 움직인다.
  //   ★ 서랍에 실린 물건은 **집을 수 없다**(아래 들물건에서 뺀다).
  //     서랍과 한 몸이라, 따로 떼어 옮길 수 있게 하면 열고 닫을 때 표지가
  //     어느 쪽을 따라가야 하는지가 매번 애매해진다. 규칙은 여기 하나뿐이다 —
  //     서랍승객에 이름이 있으면 그 물건은 서랍 것이다.
  const 서랍승객 = { "E-02": 0 }; // 증거물 id -> 올라탄 캐비닛 번호
  const 서랍보정 = (항목id) => {
    const i = 서랍승객[항목id];
    if (i === undefined) return [0, 0];
    const d = ((서랍보기(i)?.양 ?? 0) - (서랍기본(i)?.양 ?? 0)) * CB.높이;
    const c = cbLive[i];
    return [Math.sin(c.회전) * d, Math.cos(c.회전) * d];
  };

  // ── 증거물 3종(소품) ───────────────────────────────────────
  const EV = useSavedControls("증거물(공통)", {
    보이기: true,
    크기: { value: 1.0, min: 0.3, max: 3, step: 0.01 },

    ...선스키마({ 주름: true, 각도: 40 }),
  });
  const ev1 = useSavedControls("증거물1(봉투)", {
    x: { value: -13.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.7, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.06, min: 0, max: 6, step: 0.01 },
    회전: { value: 0.34, min: -Math.PI, max: Math.PI, step: 0.01 },
    // 봉투 두께 — 지퍼백이 얼마나 납작한지. 안의 종이·라벨이 자동으로 따라온다.
    두께: { value: 0.01, min: 0.008, max: 0.12, step: 0.001 },
    // 봉투만 따로 주는 크기. 최종 = 증거물(공통) 크기 × 이 값.
    크기: { value: 1.0, min: 0.3, max: 2, step: 0.01 },
  });
  const ev2 = useSavedControls("증거물2(번호표)", {
    x: { value: -11.8, min: -20, max: 20, step: 0.1 },
    z: { value: 9.0, min: -14, max: 14, step: 0.1 },
    높이: { value: 0.55, min: 0, max: 6, step: 0.01 },
    회전: { value: -0.78, min: -Math.PI, max: Math.PI, step: 0.01 },
  });
  const ev3 = useSavedControls("증거물3(상자)", {
    x: { value: -1.3, min: -20, max: 20, step: 0.1 },
    z: { value: -3.5, min: -14, max: 14, step: 0.1 },
    높이: { value: 0.0, min: 0, max: 6, step: 0.01 },
    회전: { value: -1.9, min: -Math.PI, max: Math.PI, step: 0.01 },
  });
  // 번호표 1·3 — 2번과 같은 표지인데 번호만 다르다.
  //   1번은 봉투 옆 책상 위, 3번은 증거물 상자 옆 바닥에 세워 뒀다.
  const ev4 = useSavedControls("증거물4(번호표1)", {
    x: { value: 0.6, min: -20, max: 20, step: 0.1 },
    z: { value: -1.6, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.06, min: 0, max: 6, step: 0.01 },
    회전: { value: 0.83, min: -Math.PI, max: Math.PI, step: 0.01 },
  });
  const ev5 = useSavedControls("증거물5(번호표3)", {
    x: { value: -9.5, min: -20, max: 20, step: 0.1 },
    z: { value: 10.1, min: -14, max: 14, step: 0.1 },
    높이: { value: 4.3, min: 0, max: 6, step: 0.01 },
    회전: { value: 0.61, min: -Math.PI, max: Math.PI, step: 0.01 },
  });
  // ── 증거물6 — 현장 수거품 상자 ─────────────────────────────
  //   증거물 상자와 완전히 별개 물건이다. 위치·회전은 다른 증거물과 같은 방식이고,
  //   상자 크기(가로·세로·상자높이)는 여기서만 조절한다.
  //   기본값은 증거물3 상자(-1.3, -3.5) 뚜껑 위(높이 0.9)에 올려 둔 자리다.
  const ev6 = useSavedControls("증거물6(수거품 상자)", {
    x: { value: -1.4, min: -20, max: 20, step: 0.01 },
    z: { value: -3.65, min: -14, max: 14, step: 0.01 },
    높이: { value: 0.95, min: 0, max: 6, step: 0.01 },
    회전: { value: -1.5, min: -Math.PI, max: Math.PI, step: 0.01 },
    가로: { value: 1.19, min: 0.2, max: 2.5, step: 0.01 },
    세로: { value: 0.78, min: 0.2, max: 2.5, step: 0.01 },
    상자높이: { value: 0.83, min: 0.15, max: 2.0, step: 0.01 },
  });

  const evLive = [ev1, ev2, ev3, ev4, ev5, ev6];

  // ── 옷걸이 스탠드 2개 ───────────────────────────────────────
  //   (걸려 있던 외투 4벌은 뺐다 — 스탠드만 남긴다)
  const CT = useSavedControls("옷걸이(공통)", {
    보이기: true,
    스탠드색: "#33373c",
    스탠드높이: { value: 4.3, min: 3, max: 9, step: 0.05 },

    ...선스키마({ 주름: true, 각도: 45 }),
  });
  const rk1 = useSavedControls("옷걸이1", {
    x: { value: -18.5, min: -20, max: 20, step: 0.1 },
    z: { value: -12.3, min: -14, max: 14, step: 0.1 },
    회전: { value: -1.78, min: -Math.PI, max: Math.PI, step: 0.01 },
    옷색: "#4e3d22",
    좌우반전: true,
  });
  // ── 중절모 1개 ──────────────────────────────────────────
  //   옷걸이 가지에 비스듬히 걸린 것 (책상에 놓았던 모자2는 뺐다)
  // 선 설정 — 모자가 늘어나도 같이 쓰도록 공통 폴더로 뺀다
  const HT = useSavedControls("모자(공통·선)", {
    ...선스키마({ 굵기: 3.0, 색: "#312922", 주름: true, 각도: 30 }),
  });
  const ht1 = useSavedControls("모자1(옷걸이)", {
    보이기: true,
    x: { value: -0.8, min: -20, max: 20, step: 0.05 },
    z: { value: -12.5, min: -14, max: 14, step: 0.05 },
    높이: { value: 3.32, min: 0, max: 8, step: 0.02 },
    회전: { value: -1.78, min: -Math.PI, max: Math.PI, step: 0.01 },
    기울기: { value: 1.15, min: -1.8, max: 1.8, step: 0.01 }, // 자빠진 정도
    크기: { value: 1.0, min: 0.3, max: 2.5, step: 0.01 }, // 챙 지름(유닛)
    색: "#4e4838",
  });
  const rk2 = useSavedControls("옷걸이2", {
    x: { value: -0.5, min: -20, max: 20, step: 0.1 },
    z: { value: -12.5, min: -14, max: 14, step: 0.1 },
    회전: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01 },
    옷색: "#4e4838",
    좌우반전: false,
  });
  // ── 장스탠드(바닥) ──────────────────────────────────────
  //   높이 5유닛 ≈ 1.5m. 회전 0 = 갓이 -X 쪽을 비춘다.
  //   기본 위치·각도는 화이트보드(-1.8, 2.1)를 비추도록 잡아 뒀다.
  const FL = useSavedControls("장스탠드", {
    보이기: true,
    켜기: true,
    x: { value: 4.4, min: -20, max: 20, step: 0.1 },
    z: { value: -0.5, min: -14, max: 14, step: 0.1 },
    바닥높이: { value: 0, min: -1, max: 4, step: 0.05 },
    회전: { value: 1.04, min: -Math.PI, max: Math.PI, step: 0.01 },
    높이: { value: 4.8, min: 2, max: 9, step: 0.05 },
    빛세기: { value: 46, min: 0, max: 400, step: 1 },
    빛퍼짐: { value: 0.8, min: 0.1, max: 1.4, step: 0.01 },

    ...선스키마({ 굵기: 2.0, 색: "#1a1614", 주름: false, 각도: 25 }),
  });

  // 책상 공통 조절 (모든 책상에 함께 적용 — 크기·바닥높이)
  const D = useSavedControls("책상(공통)", {
    크기: { value: 2.2, min: 0.5, max: 5, step: 0.05 },
    높이미세: { value: -0.3, min: -2, max: 2, step: 0.02 },

    ...선스키마({ 주름: true, 각도: 50 }),
  });

  // 책상 위 컴퓨터(pc.glb) 공통 조절 — 크기와 색을 3대에 함께 적용
  const PC = useSavedControls("컴퓨터(공통·색)", {
    크기: { value: 0.93, min: 0.1, max: 5, step: 0.01 },
    색: "#3e4248",

    ...선스키마({ 주름: true, 각도: 45 }),
  });
  // 세트 3개 개별 조절 (위치·높이·회전) — 조절한 값 고정
  const pc1 = useSavedControls("컴퓨터1", {
    x: { value: -9.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.9, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.9, min: 0, max: 6, step: 0.05 },
    회전: { value: -2.51, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
  });
  const pc3 = useSavedControls("컴퓨터3", {
    x: { value: 6.5, min: -20, max: 20, step: 0.1 },
    z: { value: -2.7, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.9, min: 0, max: 6, step: 0.05 },
    회전: { value: -2.5, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
  });
  const pcLive = [pc1, pc3];

  // ── 키보드 조절 ────────────────────────────────────────
  // 모니터와 별개의 모델이라 위치·크기·색·회전을 따로 준다.
  //   위치는 '그 자리 모니터 기준 상대값'이라 컴퓨터1·컴퓨터3 양쪽에 똑같이 적용된다.
  //   크기 = 월드 유닛 가로폭 (모델을 폭 1.0 으로 정규화해 뒀기 때문).
  //     1 유닛 ≈ 0.30m → 실제 44cm 키보드 ≈ 1.45
  const KB = useSavedControls("키보드(공통)", {
    보이기: true,
    크기: { value: 1.55, min: 0.3, max: 3, step: 0.01 },

    // 두께·깊이 = 가로폭 대비 배수. 1 = 모델에 이미 구워 둔 기본 비율.
    //   Meshy 원본은 가로 1 : 두께 0.317 : 깊이 0.481 로, 두께가 실제 키보드의 4배였다.
    //   → 통짜 쐐기처럼 보여서 모델 자체를 Y×0.35 · Z×0.8 로 눌러 다시 구웠다.
    //   구운 직후 비율 = 가로 1 : 두께 0.111 : 깊이 0.385.
    //   아래 0.5 / 0.83 은 그 위에서 화면 보며 한 번 더 눌러 맞춘 값이다
    //   → 실제 화면 비율 = 가로 1 : 두께 0.056 : 깊이 0.320.
    두께: { value: 0.5, min: 0.3, max: 2.5, step: 0.01 },
    깊이: { value: 0.83, min: 0.6, max: 1.6, step: 0.01 },

    좌우: { value: -0.31, min: -3, max: 3, step: 0.01 }, // 로컬 X
    앞뒤: { value: 0.82, min: -3, max: 3, step: 0.01 }, // 로컬 Z (+가 사용자 쪽)
    // 높이 = '놓이는 자리'(위아래 위치). 물건 자체의 두께와는 다른 값이다.
    높이: { value: -0.85, min: -2, max: 2, step: 0.01 }, // 모니터 y 에서의 차이
    회전: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
    색: "#2c2f34",

    // 주름선 각도 = "이웃한 두 면이 이 각도보다 크게 꺾이면 그 경계에 선을 긋는다".
    //   키가 90개쯤 붙어 있어 각도를 낮추면 선이 폭발한다(45°면 8,300선).
    //   70° 면 '키 윗면 테두리'만 남고, 낮출수록 자판 질감이 촘촘해진다.
    //   아래 값들은 화면에서 직접 맞춘 것 (각도 25 = 촘촘한 쪽).
    ...선스키마({
      굵기: 3.0,
      색: "#120f0d",
      주름: true,
      각도: 25,
      주름색: "#19191f",
    }),
  });

  // ── 마우스 조절 ────────────────────────────────────────
  //   크기 = 월드 유닛 길이 (모델을 길이 1.0 으로 정규화). 실제 11cm ≈ 0.37
  //   비율 = 길이 1 : 가로 0.498 : 높이 0.257 (실제 마우스 11 × 6 × 3.5cm 와 비슷)
  const MS = useSavedControls("마우스(공통)", {
    보이기: true,
    크기: { value: 0.37, min: 0.1, max: 1.5, step: 0.005 },
    좌우: { value: 0.82, min: -3, max: 3, step: 0.01 },
    앞뒤: { value: 0.93, min: -3, max: 3, step: 0.01 },
    높이: { value: -0.88, min: -2, max: 2, step: 0.01 },
    회전: { value: -2.98, min: -Math.PI, max: Math.PI, step: 0.01 },
    색: "#2c2f34",

    // 매끈한 덩어리라 각도를 낮게 잡아야 '버튼 가운데 갈라진 선'과 휠 홈이 살아난다.
    //   아래 값들은 화면에서 직접 맞춘 것 (각도 21).
    ...선스키마({
      굵기: 3.0,
      색: "#1a1614",
      주름: true,
      각도: 21,
      주름색: "#000000",
    }),
  });

  // ── 노트북 조절 ────────────────────────────────────────
  // 공통 폴더: 크기 + 부위별 색 5개 (두 대에 함께 적용)
  const LP = useSavedControls("노트북(공통·색)", {
    크기: { value: 0.65, min: 0.1, max: 3, step: 0.01 },
    화면색: "#b6bac6",
    테두리색: "#737d8e",
    키보드색: "#2d2f36",
    트랙패드색: "#5a606a",
    본체색: "#787e8a",
    화면켜기: true,
    화면빛색: "#e4f1ff",

    ...선스키마({ 주름: true, 각도: 45 }),
  });
  // 개별 폴더: 대마다 위치·높이·회전을 따로 조절(값이 폴더에 유지되어 리셋되지 않음)
  const lp1 = useSavedControls("노트북1", {
    x: { value: 3.9, min: -20, max: 20, step: 0.1 },
    z: { value: -2.9, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.0, min: 0, max: 6, step: 0.01 },
    회전: { value: -2.7, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
  });
  const lp2 = useSavedControls("노트북2", {
    x: { value: -9.4, min: -20, max: 20, step: 0.1 },
    z: { value: -1.1, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.0, min: 0, max: 6, step: 0.01 },
    회전: { value: 2.05, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
  });
  // 노트북3 — 예전 '컴퓨터2' 자리에 새로 놓는다.
  //   크기·높이는 기존 두 대와 똑같이(높이 2.0 / 개별크기 1.0) 맞췄고,
  //   x·z는 컴퓨터2가 있던 자리를 그대로 물려받았다. 회전·위치는 Leva에서 조절.
  const lp3 = useSavedControls("노트북3", {
    x: { value: -12.3, min: -20, max: 20, step: 0.1 },
    z: { value: -4.1, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.0, min: 0, max: 6, step: 0.01 },
    회전: { value: -1.29, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
  });
  const lpLive = [lp1, lp2, lp3];

  // ── 의자 5개 ───────────────────────────────────────────
  //   왼쪽 자리(노트북2·노트북3·컴퓨터1)에 3개, 오른쪽(노트북1·컴퓨터3)에 2개.
  //   시작 위치는 각 기기 앞쪽에 대충 놓았고, 회전·위치는 Leva에서 맞추면 된다.
  const CH = useSavedControls("의자(공통·색)", {
    크기: { value: 1.03, min: 0.2, max: 3, step: 0.01 },
    색: "#363b46",
    // 의자를 통과할 수 없게 막는다. 끄면 예전처럼 뚫고 지나갈 수 있다(비교용).
    충돌: true,


    ...선스키마({ 굵기: 2.0, 색: "#1a1614", 주름: true, 각도: 65 }),
  });
  const 의자틀 = (x, z, 회전) => ({
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    높이: { value: 0, min: -1, max: 4, step: 0.01 },
    회전: { value: 회전, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
  });
  const ch1 = useSavedControls("의자1(노트북2 앞)", 의자틀(-7.2, -2.5, -1.3));
  const ch2 = useSavedControls("의자2(노트북3 앞)", 의자틀(-14.3, -1.9, 1.98));
  const ch3 = useSavedControls("의자3(컴퓨터1 앞)", 의자틀(-9.5, -9.7, 0.41));
  const ch4 = useSavedControls("의자4(노트북1 앞)", 의자틀(1.7, -5.1, -0.1));
  const ch5 = useSavedControls("의자5(컴퓨터3 앞)", 의자틀(4.3, -6.0, 0.82));
  const chLive = [ch1, ch2, ch3, ch4, ch5];

  // ── 머그컵 3개 ─────────────────────────────────────────
  //   의자 3개짜리 왼쪽 자리에 2개, 의자 2개짜리 오른쪽 자리에 1개.
  //   높이 기본값 2.0 = 책상 윗면(노트북이 올라가 있는 높이와 같다).
  const MG = useSavedControls("머그컵(공통·색)", {
    크기: { value: 1.0, min: 0.2, max: 4, step: 0.01 },
    컵색: "#fff4e9",
    커피색: "#382114",

    ...선스키마({ 주름: false, 각도: 55 }),
  });
  const 머그틀 = (x, z, 회전, 개별 = 1.0) => ({
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    높이: { value: 2.0, min: 0, max: 6, step: 0.01 },
    회전: { value: 회전, min: -Math.PI, max: Math.PI, step: 0.01 },
    개별크기: { value: 개별, min: 0.2, max: 4, step: 0.01 },
  });
  const mg1 = useSavedControls(
    "머그컵1(왼쪽 책상)",
    머그틀(-12.2, -1.5, -1.98, 1.25),
  );
  const mg2 = useSavedControls(
    "머그컵2(왼쪽 책상)",
    머그틀(-9.8, -6.8, -2.61, 1.25),
  );
  const mg3 = useSavedControls("머그컵3(오른쪽 책상)", 머그틀(4.6, -3.4, 0.9));
  const mgLive = [mg1, mg2, mg3];

  // ── 증거 핀보드 ────────────────────────────────────────
  const PB = useSavedControls("증거 핀보드", {
    x: { value: 1.6, min: -20, max: 20, step: 0.1 },
    z: { value: 3.2, min: -14, max: 14, step: 0.1 },
    높이: { value: 0, min: -1, max: 4, step: 0.01 },
    회전: { value: -2.9, min: -Math.PI, max: Math.PI, step: 0.01 },
    크기: { value: 1.08, min: 0.3, max: 3, step: 0.01 },
    테두리색: "#2B3137",

    ...선스키마({ 주름: true, 각도: 15 }),
  });

  // ── 수사 화이트보드 ────────────────────────────────────
  const WB = useSavedControls("화이트보드", {
    x: { value: -3.6, min: -20, max: 20, step: 0.1 },
    z: { value: 4.1, min: -14, max: 14, step: 0.1 },
    높이: { value: 0, min: -1, max: 4, step: 0.01 },
    회전: { value: -2.98, min: -Math.PI, max: Math.PI, step: 0.01 },
    크기: { value: 1.1, min: 0.3, max: 3, step: 0.01 },
    테두리색: "#2B3137",

    ...선스키마({ 주름: false }),
  });

  // ── 물건별 '선' 값 묶기 ─────────────────────────────────
  //   각 폴더 안에 들어 있는 선 조절칸 6개만 뽑아 물건에 넘긴다.
  // ── 천장등(수사본부가 새로 매단 공장용 갓 조명) ────────────
  const CL = useSavedControls("천장등(공통)", {
    켜기: true,
    갓색: "#3A4048",
    전구색: "#f2ecc9",
    내림: { value: 2.2, min: 0.5, max: 7, step: 0.05 }, // 천장에서 갓까지
    크기: { value: 0.56, min: 0.4, max: 2.5, step: 0.01 },
    빛세기: { value: 42, min: 0, max: 400, step: 1 },
    빛퍼짐: { value: 0.2, min: 0.2, max: 1.4, step: 0.01 },

    // 번짐 = 속빛 위에 겹쳐 까는 '넓고 흐린 빛' 한 겹의 세기(빛세기 대비 배수).
    //   0 이면 원뿔 하나만 남아 바닥에 동그란 테두리가 그대로 보인다.
    //   올릴수록 그 테두리가 뭉개지면서 빛이 번져 나간다.
    번짐: { value: 0.35, min: 0, max: 1.5, step: 0.05 },
    // 빛감쇠 = 거리에 따라 빛이 죽는 속도. 2 = 물리적으로 정확(=금방 어두워짐).
    //   낮출수록 빛이 멀리까지 살아 있어 웅덩이 경계가 흐려진다.
    빛감쇠: { value: 1.5, min: 0.5, max: 2.5, step: 0.05 },
    // 갓 위로 새는 빛 — 기본을 0(끔)으로 둔다.
    //   [왜 껐나] 이 빛만 '부드럽게 번지는 그라데이션'이라, 2~3단으로 딱 끊긴
    //   다른 물건들과 화풍이 어긋난다. 세기를 낮춰도 천장에 얼룩처럼만 남는다.
    //   천장이 검게 죽는 건 조명이 아니라
    //   「벽·바닥 질감 → 천장자체밝기」(재질 emissive)가 막아 준다.
    //   반사광을 정말 넣고 싶으면 조명 말고 '그려 넣는' 편이 이 톤에 맞다.
    천장번짐: { value: 0, min: 0, max: 80, step: 1 },
  });

  // ── 멈춰 선 기차 ───────────────────────────────────────────
  //   크기 = 기차 '높이'(유닛). 모델을 높이 1.0 으로 정규화해 뒀다.
  //   이 씬은 1유닛 ≈ 0.30m → 11.5 ≈ 3.5m (실제 전동차 3.7m 와 비슷)
  //   그때 길이는 11.5 × 2.064 ≈ 23.7유닛(7.1m). 뚫린 변이 26유닛이라
  //   한 칸이 거의 딱 채우고, 3칸이면 양옆으로 넘쳐 '더 긴 기차의 일부'로 읽힌다.
  //  ※ 아래 몇몇 슬라이더는 '이름'을 바꿨다. useSavedControls 는 폴더+키로
  //     localStorage 에서 값을 되살리기 때문에, 뜻이 달라진 값은 이름을 바꿔야
  //     예전에 저장된 값이 안 딸려 오고 새 기본값이 먹는다.
  const TR = useSavedControls("기차", {
    보이기: true,
    대수: { value: 4, min: 1, max: 6, step: 1 },
    // 간격 0.88 = 칸끼리 겹쳐서 이음매가 사라지는 값(따로 렌더해 비교한 값).
    //   1.0 이면 끝끼리 딱 닿는데, 그 자리에 끝벽·손잡이가 뒤엉켜 지저분하다.
    칸겹침: { value: 0.9, min: 0.8, max: 1.3, step: 0.005 },
    크기: { value: 10.3, min: 4, max: 20, step: 0.1 },
    가로: { value: 17.6, min: 10, max: 30, step: 0.1 }, // 뚫린 변이 x=+16
    // 세로 = 기차를 길이 방향으로 얼마나 치우쳐 세울지. 방 중심은 z=-1.
    //   -5 로 밀어 두면 문이 방 정중앙에서 살짝 벗어나 '우연히 멈춘' 느낌이 난다.
    세로: { value: 0.5, min: -14, max: 14, step: 0.1 },
    바닥높이: { value: -0.35, min: -4, max: 4, step: 0.05 },
    // 모델은 X축으로 길다 → 90°(1.57)가 방의 세로(z축)와 딱 나란한 각도.
    //   1.63 은 거기서 약 3.4° 틀어 둔 값이다. 딱 평행하면 너무 반듯해서
    //   '주차해 둔 모형' 같고, 살짝 비틀면 '멈춰 선 채 버려진' 느낌이 난다.
    //   71유닛 길이 기준 양 끝이 x로 ±2.1유닛씩 어긋난다.
    기울기: { value: 1.4, min: -Math.PI, max: Math.PI, step: 0.005 },

    // ── 자세 3종 ──────────────────────────────────────
    // 좌우기울기 = 옆으로 기우뚱(롤). 탈선해 한쪽으로 기운 느낌.
    //   0.05 rad ≈ 2.9°. 기차가 길어서 조금만 줘도 끝이 크게 들린다.
    // 문이 열릴 때 미끄러지는 폭(모델 로컬 단위. 차체 길이가 2.064다).
    //   평소엔 이만큼 반대로 밀어 '닫힘'을 만들고, 다가오면 0 으로 돌아온다.
    //   ★ 문이 엉뚱한 쪽으로 닫히면 부호를 뒤집으면 된다(음수 가능).
    // 문이 열릴 때 옆으로 미끄러지는 폭(모델 로컬 단위).
    //   구멍 폭이 0.423 이므로 그보다 조금 커야 구멍이 완전히 드러난다.
    //   ★ 반대쪽으로 열리게 하려면 음수로 바꾸면 된다.
    문열림폭: { value: 0.46, min: -0.8, max: 0.8, step: 0.005 },
    좌우기울기: { value: 0.08, min: -0.4, max: 0.4, step: 0.005 },
    // 앞뒤기울기 = 코가 들리거나 처지는 각(피치).
    앞뒤기울기: { value: -0.01, min: -0.3, max: 0.3, step: 0.005 },
    // 휨 = 칸마다 꺾이는 각. 0이면 일직선, 0.05쯤이면 완만한 곡선 위에 선 열차.
    //   칸이 원호를 따라 이어지므로 이음매가 벌어지지 않는다.
    휨: { value: -0.11, min: -0.25, max: 0.25, step: 0.005 },
    차체색: "#1b2029",
    문색: "#252b36",
    어둠색: "#0a0c10", // 열린 문 안쪽 — 조명을 안 받는 재질이라 늘 캄캄하다

    ...선스키마({
      굵기: 1.5,
      색: "#242a33",
      주름: true,
      각도: 71,
      주름색: "#000000",
    }),
  });

  // ── 기차 외부 문 (문짝 텍스처·손잡이·문틀 실시간 조절) ──────
  //   문짝 판 크기는 차체 구멍에 묶여 있어 못 줄인다. 대신 '문틀폭'으로
  //   양옆 프레임을 키워 밝은 문 면이 좁아 보이게 한다(틈 없음).
  const 문설정 = useSavedControls("기차 외부 문", {
    문색: "#2a2f38", // 차체 계열의 살짝 연한 톤(현재 고정값)
    손잡이가로: { value: 0.78, min: 0.5, max: 0.96, step: 0.01 }, // 패널 안 0=왼 1=오른
    손잡이세로: { value: 0.48, min: 0.3, max: 0.72, step: 0.01 },
    손잡이폭: { value: 0.05, min: 0.03, max: 0.16, step: 0.002 },
    손잡이높이: { value: 0.17, min: 0.08, max: 0.3, step: 0.005 },
    문틀폭: { value: 0, min: 0, max: 0.2, step: 0.005 }, // 좌우 각각(0=문틀 없음)
    문틀색: "#caced5", // 양옆 문틀(프레임) 색
    낡음: { value: 2, min: 0, max: 2, step: 0.05 }, // 얼룩·기스(그림) 세기(0=깨끗)
    찌그러짐: { value: 10, min: 0, max: 14, step: 1 }, // 입체 눌림 개수(캐비넷식)
    찌그러짐깊이: { value: 0.03, min: 0, max: 0.05, step: 0.002 },
    외곽선굵기: { value: 2, min: 0, max: 8, step: 0.5 },
    외곽선색: "#000000",
  });

  // ── 기차 선로 (도상·침목·레일) ─────────────────────────────
  //   방 바닥은 x=+16 에서 끝나 그 바깥이 텅 비어 있었다. 여기를 채운다.
  //   위치·회전은 기차와 같은 값을 쓴다(따로 두면 레일 위에 안 얹힌다).
  const RL = useSavedControls("기차 선로", {
    보이기: true,
    // 높이 -0.62 → 레일 꼭대기가 y=-0.09. 방 바닥판(y=0)에 가려
    //   사무실 안쪽으로는 레일이 안 넘어온다. 올리면 바닥을 뚫고 올라온다.
    선로높이: { value: -0.55, min: -3, max: 1, step: 0.01 },
    길이: { value: 127, min: 30, max: 200, step: 1 },
    // 폭을 키우면 도상이 방 안쪽으로 넓게 퍼진다(바닥에 가려 안 보이지만 낭비).
    도상폭: { value: 6.5, min: 3, max: 20, step: 0.5 },
    // ★ 체크하면 기차와 똑같은 각도로 깔린다(= 기차 밑에 나란히).
    //   끄면 아래 '따로기울기' 값을 쓴다 — 기차만 비스듬히 밀려난 그림이 된다.
    기차와같은각도: true,
    따로기울기: { value: 1.16, min: -Math.PI, max: Math.PI, step: 0.005 },
    // 궤간 = 레일 사이 간격. 표준궤 1,435mm ÷ 0.30m ≈ 4.8유닛
    궤간: { value: 5.6, min: 2, max: 9, step: 0.1 },
    자갈: true,
    도상색: "#292520",
    침목색: "#1f1a16",
    레일색: "#4c4f53",

    ...선스키마({
      굵기: 3.5,
      색: "#080707",
      주름: false,
      각도: 40,
      주름색: "#000000",
    }),
  });

  // ── 기차에 부딪혀 무너진 벽 끝 ─────────────────────────────
  //   앞벽(z=-14)·뒷벽(z=+12)이 x=+16 에서 칼로 자른 듯 끊겨 있었다.
  const WK = useSavedControls("부서진 벽 끝", {
    보이기: true,
    // 들쭉 = 층마다 벽 끝이 얼마나 들쭉날쭉한지(유닛).
    //   +면 기존 벽보다 더 튀어나오고, −면 파먹힌다. 0이면 반듯하게 잘린 벽.
    들쭉: { value: 2.9, min: 0, max: 10, step: 0.1 },
    층: { value: 33, min: 6, max: 40, step: 1 },

    // ── 앞벽(z=-14) / 뒷벽(z=+12) 을 따로 민다 ────────────────
    // '얼마나 물러날지' 대신 '어디까지 갈지'를 x 좌표로 직접 잡는다.
    //   상대값(후퇴)은 머릿속으로 계산해야 해서 어디까지 왔는지 감이 안 온다.
    //
    // [지금 기차 위치 — 여기에 맞춰 잡으면 된다]
    //   기차 앞면  x ≈ 14.1   (가로 17.6 − 폭0.343 × 크기 10.3)
    //   기차 뒷면  x ≈ 21.1
    //   → 벽끝x 를 15 쯤 두면 기차 앞에 닿고,
    //     조각끝x 를 21 이상 주면 조각이 기차를 뚫고 지나가 뒤를 가린다.
    앞벽끝x: { value: 15.8, min: -4, max: 34, step: 0.2 },
    앞벽조각끝x: { value: 21, min: -4, max: 36, step: 0.2 },
    뒷벽끝x: { value: 12, min: -4, max: 34, step: 0.2 },
    뒷벽조각끝x: { value: 21, min: -4, max: 36, step: 0.2 },

    // 가운데파임 = 기차가 지나간 높이(중간쯤)를 얼마나 더 파먹을지.
    //   1이면 그 높이에서 벽이 거의 안 뻗어서, 아무리 당겨도 기차에 안 닿는다.
    //   0이면 위아래 구분 없이 고르게 뻗어 확실히 맞부딪힌다.
    가운데파임: { value: 0.9, min: 0, max: 1, step: 0.05 },
    // 거칠기 = 잔해 돌 표면을 얼마나 울퉁불퉁하게 밀지. 0이면 매끈한 상자.
    거칠기: { value: 0.04, min: 0, max: 0.6, step: 0.01 },
    잔해색: "#3b4048",

    ...선스키마({
      굵기: 1.5,
      색: "#000000",
      주름: false,
      각도: 45,
      주름색: "#000000",
    }),
  });

  // ── 기차 저편 배경 ─────────────────────────────────────────
  //   방 오른쪽엔 벽이 없어서 3D 물체가 없는 자리는 캔버스 바탕색(#22262E)이
  //   그대로 비친다 — 그게 '푸른 여백'이다. 어두운 판으로 막는다.
  const BG = useSavedControls("기차 저편 공간", {
    확장: true, // 벽·천장을 기차 저편까지 이어 붙여 '한 공간'으로 만든다
    // 먼벽 = 기차 저편(긴 방향)을 막는 벽. 끄면 그쪽이 트여 보인다.
    먼벽: true,
    먼벽x: { value: 29.5, min: 18, max: 45, step: 0.5 },
    // 먼벽색 = 기차 저편 벽 색. 비워 두지 않고 따로 잡을 수 있게 뺐다.
    먼벽색: "#3c3e43",
    // ★ 확장 천장 — 방 천장과 달리 민무늬라, 밝게 두면 회색 판이 떠 보인다.
    //   기본을 거의 검정으로 두면 어둠판과 이어져 하나의 검은 공간이 된다.
    확장천장: true,
    // ★ 확장 천장에 방 천장과 같은 질감을 깔았다. 색이 너무 어두우면
    //   질감이 안 보여서 예전처럼 '검은 판' 그대로다 → 조금 올려 잡았다.
    //   완전 검정으로 되돌리고 싶으면 #0f1115 로 내리면 된다.
    확장천장색: "#0f1115",

    // ── 부서진 천장 ──────────────────────────────────
    // 천장판을 격자로 쪼개고 일부를 아예 안 그린다 = 떨어져 나간 자리.
    //   그 위로 철골 격자가 드러나서 '검은 구멍'이 '무너진 천장'이 된다.
    타일: { value: 3, min: 1, max: 6, step: 0.1 },
    무너짐: { value: 0.14, min: 0, max: 0.7, step: 0.01 },
    처짐: { value: 0.14, min: 0, max: 0.5, step: 0.01 },
    골조: true,
    골조간격: { value: 1.6, min: 0.6, max: 5, step: 0.1 },
    골조굵기: { value: 0.13, min: 0.04, max: 0.5, step: 0.01 },
    골조색: "#171b21",
    늘어진판: true,

    // ── 천장 설비 (환기 덕트 + 배관 다발) ─────────────
    // 검정은 그 자체로 나쁘지 않다. 문제는 '읽을 게 하나도 없는 검정'이다.
    //   기차와 나란히 지나가는 설비 몇 줄이면 공간에 깊이가 생긴다.
    설비: true,
    // 자리 = 시작x(16) ~ 먼벽x 사이 어디에 걸지. 0 = 방 쪽, 1 = 먼벽 쪽
    덕트자리: { value: 0.29, min: 0, max: 1, step: 0.01 },
    덕트내림: { value: 0.85, min: 0.2, max: 4, step: 0.05 },
    덕트가로: { value: 1.75, min: 0.4, max: 4, step: 0.05 },
    덕트세로: { value: 1.05, min: 0.3, max: 3, step: 0.05 },
    이음간격: { value: 6, min: 2, max: 20, step: 0.5 },
    배관자리: { value: 0.62, min: 0, max: 1, step: 0.01 },
    배관내림: { value: 0.75, min: 0.2, max: 4, step: 0.05 },
    배관수: { value: 4, min: 1, max: 8, step: 1 },
    배관굵기: { value: 0.2, min: 0.05, max: 0.6, step: 0.01 },
    배관간격: { value: 0.55, min: 0.2, max: 2, step: 0.05 },
    행거간격: { value: 5, min: 2, max: 20, step: 0.5 },
    덕트색: "#23262c",
    배관색: "#1b1f25",
    단열색: "#4a4536",

    // ★★ 캔버스 배경색 — '3D 물체가 하나도 없는 자리'에 비치는 색.
    //   벽·천장·어둠판 어느 것도 아닌 회색 면이 보인다면 십중팔구 이것이다.
    //   원래 코드에 #22262E 로 박혀 있어 Leva 에서 못 만졌다 → 밖으로 뺐다.
    //   [확인법] 이 색을 자홍색(#ff00ff) 같은 걸로 확 바꿔 보면
    //           그 면이 같이 변하는지 3초 만에 알 수 있다.
    //   ※ 실제로 이 값이 '검정 옆 회색 면'의 정체였다. 완전 검정으로 고정.
    배경색: "#000000",
    // 선로 구역 바닥 — 조명을 받는 진짜 바닥이라 납작해 보이지 않는다
    선로바닥: true,
    선로바닥높이: { value: -0.66, min: -4, max: 1, step: 0.02 },
    선로바닥색: "#252629",
    선로바닥얼룩: { value: 0.9, min: 0, max: 1.5, step: 0.05 },
    // 확장으로도 안 막히는 자리(맨 끝·아래)를 위한 보조 어둠판
    어둠판: true,
    어둠판거리: { value: 48, min: 25, max: 70, step: 0.5 },
    어둠색: "#0a0b0d",
    바닥색: "#101318",
    바닥높이: { value: -2.4, min: -8, max: 0, step: 0.1 },
  });

  // ── 사물 충돌 (통과 막기) ─────────────────────────────────
  //   책상·캐비닛·보드 같은 큰 물건을 통과하지 못하게 막는다.
  //   막는 이유는 두 가지다.
  //     ① 물건을 뚫고 지나가면 게임이 어색하다
  //     ② 카메라가 물체 '안'에 들어가면 외곽선 껍데기가 화면을 통째로 덮어
  //        프레임이 몇 초로 늘어나고, 윈도우가 그래픽 드라이버를 리셋해 탭이 죽는다
  const COL = useSavedControls("사물 충돌", {
    켜기: true,
    // 실제 크기의 몇 %로 막을지. 낮추면 물건에 더 가까이 붙을 수 있다.
    여유: { value: 0.9, min: 0.5, max: 1.2, step: 0.05 },
    // 막고 있는 영역을 빨간 상자로 보여준다(작업용).
    보기: false,
    보기높이: { value: 4, min: 0.5, max: 12, step: 0.5 },
  });

  // ── 성능 계기판 ───────────────────────────────────────────
  const PF = useSavedControls("성능", {
    계기판: true,
    // 안 보이는 구역을 통째로 끄는 최적화. 끄면 예전처럼 전부 그린다(비교용).
    구역최적화: true,
  });

  // 구역별 group 참조 — visible 을 직접 만지려고 ref 로 잡는다
  const 방ref = useRef(null);
  const 복도ref = useRef(null);
  const 기차ref = useRef(null);
  const 배경ref = useRef(null);

  // ── 비밀 복도 (왼쪽 벽 뒤) ─────────────────────────────────
  //   지금은 '열림' 슬라이더로 직접 여닫는다.
  //   나중에 인식장치 퍼즐이 붙으면 이 값을 코드가 대신 움직인다.
  //   기계장치를 먼저 만들고 스위치는 나중에 바꿔 끼우는 순서다.
  const CD = useSavedControls("비밀 복도", {
    보이기: true,
    열림: { value: 1, min: 0, max: 1, step: 0.01 }, // 1 = 완전히 열림(지금은 통행 확인용)
    // 구멍을 메우고 있는 '위장 덩어리'를 그릴지.
    //   퍼즐(지문인식)이 붙기 전까지는 꺼 둔다 → 구멍이 그냥 뚫려 있고 걸어 들어갈 수 있다.
    막이보이기: false,
    // 복도 폭 = MIN_X(-20) - 바깥x. -25.5 면 폭 5.5 → 사람 하나 지나는 좁은 통로.
    //   폭이 넓으면 '방'처럼 보이고, 좁아야 '통로'로 읽힌다.
    바깥x: { value: -31, min: -45, max: -21, step: 0.5 },
    // ★ 복도는 '건물 바깥으로 이어지는 통로'라 방보다 길어야 한다.
    //   방 z 범위는 -14 ~ +12. 복도를 그보다 길게 빼면 양 끝이 어둠으로
    //   사라져 '어디론가 계속 이어진다'로 읽힌다. 범위도 ±32 로 넓혔다.
    z시작: { value: -60, min: -60, max: 12, step: 0.5 },
    z끝: { value: 25.5, min: -14, max: 60, step: 0.5 },
    높이: { value: 8, min: 4, max: 12, step: 0.2 },
    // 문 자리 — 책상 구역을 피해 뒤쪽(+z)으로 옮겼다.
    //   책상은 z = -7.3 ~ -2.5 에 몰려 있어서(빨강·파랑·초록) 문 바로 앞이 막혔다.
    //   z = +4 면 가장 가까운 책상(초록 z=-2.5)과 6.5유닛 떨어져 통로가 트인다.
    문z: { value: 4, min: -14, max: 12, step: 0.2 },
    문폭: { value: 3.6, min: 2, max: 8, step: 0.1 },
    문높이: { value: 5.7, min: 3, max: 11, step: 0.1 },
    // 벽 두께 — 구멍 안쪽에 드러나는 '단면'의 깊이.
    //   0 이면 종이에 뚫은 구멍처럼 보인다. 이 값이 '뚫렸다'를 만든다.
    문두께: { value: 0.2, min: 0.2, max: 2, step: 0.05 },
    벽색: "#525b69",
    아랫단색: "#4e5462",
    바닥색: "#2d2f31",
    천장색: "#23262b",
    // 구멍 테두리의 부서진 덩어리 — 지금은 끈다(깨끗하게 뚫린 구멍만 남김)
    테두리잔해: false,
    잔해: { value: 0, min: 0, max: 40, step: 1 }, // 복도 바닥에 굴러다니는 돌 개수
    잔해색: "#3b4048",
    거칠기: { value: 0.32, min: 0, max: 0.6, step: 0.01 },
    // 깊이 감광 — 문에서 멀어질수록 어두워진다(정점색으로 재질 밝기를 깎음)
    // 0.66 → 0.60 · 최소밝기 0.45 → 0.53. 복도 전체를 아주 살짝 들어 올린다.
    //   깊이감(멀수록 어둡다)은 그대로 두고 바닥값만 올리는 쪽이 안전하다 —
    //   감광 자체를 끄면 복도가 짧아 보인다.
    깊이어둠: { value: 0.6, min: 0, max: 1, step: 0.01 },
    감쇠거리: { value: 33, min: 5, max: 80, step: 1 },
    최소밝기: { value: 0.53, min: 0, max: 1, step: 0.01 }, // 감광 바닥값
    벽밝기: { value: 1.35, min: 0.5, max: 2.5, step: 0.05 }, // 벽 전체 배수
    // 비상계단(복도 끝) 쪽만 추가로 어둡게 — 복도가 더 길어 보이게 하는 장치
    // ★ 복도 끝(비상계단 쪽) 추가 감광. 0.45 → 0.58 로 올렸다 —
    //   끝이 더 깊이 들어가 보이게. 되돌리려면 이 값 하나만 내리면 된다.
    끝쪽어둠: { value: 0.58, min: 0, max: 0.9, step: 0.01 },
    끝쪽기울기: { value: 1.8, min: 0.5, max: 4, step: 0.1 }, // 클수록 끝에서만 급격히

    // ── 천장 배관 · 전선 트레이 ────────────────────────────
    //   복도를 길어 보이게 하는 장치. 천장을 따라 뻗은 선이 소실점으로 모인다.
    배관보이기: true,
    배관x비율: { value: 0.62, min: 0, max: 1, step: 0.02 }, // 0=문 있는 바깥벽, 1=안쪽벽
    배관처짐: { value: 0.1, min: 0.02, max: 2, step: 0.02 }, // 천장에서 내려 단 거리
    배관큰지름: { value: 0.18, min: 0.05, max: 0.6, step: 0.01 },
    배관작은지름: { value: 0.1, min: 0.03, max: 0.3, step: 0.01 },
    배관트레이폭: { value: 1.0, min: 0.3, max: 2, step: 0.05 },
    배관가로대간격: { value: 1.7, min: 0.5, max: 6, step: 0.1 },
    배관행어간격: { value: 6, min: 2, max: 20, step: 0.5 },
    배관색: "#474c53",
    배관트레이색: "#474c54",
    배관행어색: "#3e434a",
    배관밝기: { value: 0.7, min: 0.3, max: 2.5, step: 0.05 },

    // ── 벽 부착함 (배전반 · 소화전함) ───────────────────────
    //   z비율 = 복도 길이에서의 위치(0 = 비상계단 쪽 끝, 1 = 방 쪽 끝).
    //   측면문이 0.18~0.78 을 쓰므로 그 바깥에 두면 겹치지 않는다.
    함때: { value: 1, min: 0, max: 2, step: 0.05 }, // 라벨 얼룩·긁힘
    함부속색: "#7b828a", // 경첩·걸쇠 (둘 공통)

    배전반보이기: true,
    배전반z비율: { value: 0.88, min: 0, max: 1, step: 0.01 },
    배전반폭: { value: 1.6, min: 0.6, max: 3, step: 0.05 },
    배전반높이: { value: 2.0, min: 0.8, max: 4, step: 0.05 },
    배전반깊이: { value: 0.4, min: 0.1, max: 1, step: 0.02 },
    배전반바닥높이: { value: 2.8, min: 0.5, max: 6, step: 0.05 },
    배전반색: "#4d5055",
    배전반문색: "#5e646c",
    배전반라벨색: "#c9a83c",
    배전반번호: "N-3",
    배전반전선관: true, // 천장 트레이로 올라가는 관
    // 문이 활짝 열리는 각도(도) — 소화전과 같은 규칙
    배전반문열림각: { value: 102, min: 30, max: 130, step: 1 },

    소화전보이기: true,
    소화전z비율: { value: 0.88, min: 0, max: 1, step: 0.01 },
    소화전폭: { value: 1.4, min: 0.6, max: 3, step: 0.05 },
    소화전높이: { value: 2.25, min: 0.8, max: 4, step: 0.05 },
    소화전깊이: { value: 0.38, min: 0.1, max: 1, step: 0.02 },
    소화전바닥높이: { value: 2.25, min: 0.5, max: 6, step: 0.05 },
    소화전색: "#804239",
    소화전문색: "#79352c",
    소화전라벨색: "#cb4e43",
    // 문이 활짝 열리는 각도(도). 71 → 102 로 키웠다.
    //   90 을 넘으면 함 앞면보다 더 젖혀져 속이 훨씬 잘 보인다.
    소화전문열림각: { value: 102, min: 30, max: 130, step: 1 },

    // ── 자판기 2대 ────────────────────────────────────────
    //   바깥벽에 붙여 세운다(정면이 복도 안쪽 +x 를 본다).
    //   깊이 2.4 를 빼면 지나갈 폭이 약 4.1(1.2m) 남는다 — 좁지만 다닐 만하다.
    // ── 바닥 잡동사니(캔·종이·각목·꽁초·물웅덩이) ──
    잡동사니보이기: true,
    // 복도 1 유닛당 몇 개 — 길이를 바꿔도 밀도가 유지된다
    // 0.55 → 0.38. 바닥이 빽빽하면 '지저분하다'가 아니라 '어수선하다'가 된다.
    잡동사니밀도: { value: 0.38, min: 0, max: 2, step: 0.05 },
    // 실물 치수대로 두면 넓은 복도에서 너무 작게 읽힌다 → 조금 키워 둔다
    잡동사니크기: { value: 1.45, min: 0.6, max: 3, step: 0.05 },
    웅덩이수: { value: 3, min: 0, max: 12, step: 1 },
    // ── 부식 자국(바닥·벽에 번진 녹과 물때) ──
    부식보이기: true,
    부식바닥수: { value: 12, min: 0, max: 60, step: 1 },
    부식벽수: { value: 18, min: 0, max: 80, step: 1 },
    // 벽에 금 간 자리
    벽금수: { value: 8, min: 0, max: 40, step: 1 },
    부식크기: { value: 1.3, min: 0.3, max: 3, step: 0.05 },
    자판기보이기: true,
    // 앞뒤(깊이)만 두 대가 같이 쓴다 — 같은 벽에 등을 대고 서 있어서다.
    //   가로·세로는 대마다 따로 조절한다(「음료 자판기」·「커피 자판기」 폴더).
    자판기깊이: { value: 2.4, min: 1.2, max: 3.5, step: 0.05 },
    // ★ 퍼즐이 나중에 밀어 넣을 자리. 지금은 Leva 로 눈으로 확인한다.
    커피선택: { value: "없음", options: ["없음", "핫", "아이스"] },
    음료뽑힌캔: { value: -1, min: -1, max: 5, step: 1 },
    커피컵: false,
    커피문열림: { value: 0, min: 0, max: 1, step: 0.05 },

    // ── 복도 측면 사무실 문 (바깥벽에 나란히) ───────────────
    측면문보이기: true,
    측면문개수: { value: 3, min: 0, max: 6, step: 1 },
    측면문폭: { value: 3.0, min: 2, max: 5, step: 0.1 },
    측면문높이: { value: 6.4, min: 4, max: 9, step: 0.1 },
    측면문두께: { value: 0.09, min: 0.04, max: 0.2, step: 0.01 }, // 문짝 두께
    측면문틀돌출: { value: 0.06, min: 0, max: 0.25, step: 0.01 }, // 문틀(케이싱)이 벽에서 나온 정도
    측면문내림: { value: 0.03, min: 0, max: 0.1, step: 0.01 }, // 문짝이 문틀 면보다 안쪽으로 들어간 정도
    측면문발판돌출: { value: 0.06, min: 0, max: 0.4, step: 0.01 }, // 발판(문턱)이 복도로 나온 정도
    측면문시작: { value: 0.18, min: 0, max: 1, step: 0.01 }, // 복도 길이 비율
    측면문끝: { value: 0.78, min: 0, max: 1, step: 0.01 },
    // 텍스처와 곱해지는 색이라 너무 어두우면 얼룩이 다 죽는다.
    //   검정 계열 대신 '어두운 회색' — 검정은 형태가 안 읽히고 텍스처도 다 먹는다.
    // 부위별 색 — 파생시키지 않고 전부 따로 둔다(하나만 바꿔도 다른 데가 안 흔들림)
    측면문색: "#5a5f62", // 문짝
    측면문리빌색: "#313339", // 개구부 안쪽 깊이
    측면문틈색: "#303136", // 문짝 둘레 틈 선
    측면문패널선색: "#3f4346", // 문짝에 새긴 패널 테두리
    측면문경첩색: "#2a2c33",
    측면문손잡이색: "#2e2e2f", // 노브
    측면문잠금판색: "#5a5148", // 손잡이 뒷판
    측면문열쇠구멍색: "#0c0e11",
    측면문턱색: "#2b2d2f",
    측면문판자색: "#36210d",
    측면문못색: "#363534",
    측면문외곽선: true,
    측면문외곽선색: "#131314",
    측면문외곽선굵기: { value: 5, min: 0, max: 20, step: 0.5 },
    측면문밝기: { value: 1.85, min: 0.3, max: 3, step: 0.05 }, // 문 전체 밝기
    측면문때: { value: 0.6, min: 0, max: 2, step: 0.05 },
    측면문판자: true, // 널빤지로 막아 둔 문 섞기

    // ── 복도 끝 비상계단 문 (z시작 쪽 끝벽) ─────────────────
    끝문보이기: true,
    끝문폭: { value: 2.4, min: 2, max: 6, step: 0.1 },
    끝문높이: { value: 6.1, min: 4, max: 9, step: 0.1 },
    끝문색: "#1c1d21", // 문짝 — 어둠에 묻히는 짙은 회색
    끝문틀색: "#1e2024", // 문선(케이싱)
    끝문손잡이색: "#cdd9e5", // 손잡이만 밝게 → 유일하게 눈에 걸리는 부분
    // 문이 거의 검정이라 검은 외곽선이 안 보인다 → 이 문만 '밝은 선'을 쓴다
    끝문라인색: "#41484b",
    끝문대비: { value: 1.35, min: 1, max: 3, step: 0.05 }, // 문틀 : 문짝 밝기 비
    끝문선폭: { value: 0.75, min: 0.2, max: 2, step: 0.05 }, // 문선 폭
    끝문선두께: { value: 0.15, min: 0.05, max: 0.6, step: 0.01 }, // 벽에서 나온 정도
    끝문두께: { value: 0.05, min: 0.05, max: 0.5, step: 0.01 },
    // 문만 따로 밝히거나 죽이고 싶을 때(1 = 복도 감광 그대로)
    끝문밝기보정: { value: 0.95, min: 0.2, max: 2.5, step: 0.05 },
    유도등: true,
    유도등크기: { value: 0.62, min: 0.2, max: 1.4, step: 0.02 },
    유도등높이: { value: 0.65, min: 0, max: 3, step: 0.05 },
    유도등테색: "#31333b", // 케이스는 어둡게 → 초록 표지판만 떠 보인다
    유도등바탕색: "#3f9e63", // 표지판 초록 바탕
    // 개발용 — 켜면 벽 판정을 느슨하게 풀어 방·복도를 자유롭게 오간다.
    //   지금은 꺼 둔다 = 문 앞에서만 방↔복도 통과.
    자유이동: false,

    // ── 복도 조명 — 천장 형광 패널등 ─────────────────────
    불켜기: true,
    등개수: { value: 3, min: 1, max: 8, step: 1 },
    등폭: { value: 1.1, min: 0.4, max: 3, step: 0.05 }, // 복도를 가로지르는 쪽
    등길이: { value: 4, min: 1, max: 10, step: 0.1 }, // 복도를 따라가는 쪽
    등회전: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
    등내림: { value: 0.12, min: 0, max: 2, step: 0.01 }, // 천장에서 내린 거리
    등틀색: "#38383b", // 기구 몸체 — 어둡되 완전한 검정은 아니라 형태가 남는다
    등판색: "#fffce7", // 확산판 색(빛 색과 별개) — 따뜻한 백색
    등때: { value: 0.8, min: 0, max: 2, step: 0.05 }, // 얼룩·벌레 세기
    등발광: { value: 1.1, min: 0.3, max: 4, step: 0.05 }, // 1보다 크면 흰색으로 타오름
    빛각도: { value: 0.51, min: 0.2, max: 1.5, step: 0.01 },
    빛퍼짐: { value: 0.18, min: 0, max: 1, step: 0.01 },
    빛거리: { value: 16, min: 5, max: 80, step: 1 },
    깜빡임: true,
    불세기: { value: 14.5, min: 0, max: 60, step: 0.5 },
    불색: "#8fa6c4",

    ...선스키마({ 굵기: 5, 색: "#131314", 주름: false }),
  });

  // ── 소화전 속 (문을 열면 보이는 것들) ─────────────────────
  //   함 바깥(색·크기)은 「비밀 복도」 폴더에 있고, 여기는 **속**만 다룬다.
  const 소화전속 = useSavedControls("소화전 속", {
    안색: "#2e2828",
    금속색: "#9aa1a8",
    호스색: "#d1cfc9",
    // ── 경종(종) — 바깥 원 + 속 원 ──
    //   바깥색 기본은 **함 바깥색(#804239)보다 아주 살짝 밝은** 값이다.
    //   같은 색이면 문을 연 순간 벽에 묻히고, 확 다르면 따로 논다.
    경종바깥색: "#934c42",
    경종속색: "#797979",
    경종크기: { value: 0.2, min: 0.08, max: 0.45, step: 0.005 },
    경종속크기: { value: 0.12, min: 0.02, max: 0.4, step: 0.005 },
    경종높이: { value: 0, min: -0.3, max: 0.3, step: 0.005 }, // 경종 전체
    경종속위아래: { value: -0.03, min: -0.15, max: 0.15, step: 0.005 }, // 속 원만
    // ── 발신기(누름 버튼) — 경종처럼 바깥/속을 따로 ──
    발신기바깥색: "#d1cccc",
    발신기속색: "#f54531",
    발신기크기: { value: 0.18, min: 0.06, max: 0.4, step: 0.005 },
    발신기속크기: { value: 0.74, min: 0.1, max: 0.9, step: 0.02 }, // 바깥 대비
    // ── 위치표시등 ──
    표시등색: "#ffffff",
    // 0 이면 안 빛난다. 화면 Bloom 임계값(0.85)을 넘겨야 외곽이 번진다.
    빛세기: { value: 1.1, min: 0, max: 3, step: 0.05 },
    // 뒤판에 얼마나 붙일지. 0 = 뒤판에 딱 붙음, 1 = 함 앞면까지 나옴.
    부품깊이: { value: 0.04, min: 0, max: 1, step: 0.02 },
    // ── 속 부품 외곽선 — 함 바깥선과 따로 조절한다 ──
    //   ※ 호스에는 어차피 안 들어간다(접힌 틈마다 두꺼운 줄무늬가 생긴다).
    외곽선: true,
    외곽선굵기: { value: 3.5, min: 0, max: 12, step: 0.5 },
    외곽선색: "#000000",
    주름선: false,
  });

  // ── 배전반 속 — 문을 열면 보이는 차단기·부스바·전선 ──────
  //   ※ 전선 색은 실물 규격을 따라 검정(상)·파랑(중성)·초록(접지)이 기본이다.
  //     빨강은 분기 배선에 섞어 단조로움을 깬다.
  const 배전반속 = useSavedControls("배전반 속", {
    안색: "#31353a",
    판색: "#aeb3ae", // 기기를 물리는 뒷판(실물은 흰빛 도장)
    차단기색: "#d5d6d1",
    차단기면색: "#4b4f54",
    레버색: "#212327",
    동색: "#b0702c", // 부스바·접지 동판
    덕트색: "#9aa0a2",
    금속색: "#8f979e",
    검은선색: "#17181a",
    파란선색: "#2f5fa8",
    초록선색: "#3e8f45",
    빨간선색: "#a3392f",
    라벨색: "#e8c53a",
    차단기줄: { value: 11, min: 4, max: 16, step: 1 },
    전선굵기: { value: 0.017, min: 0.006, max: 0.04, step: 0.001 },
    굵은선굵기: { value: 0.034, min: 0.012, max: 0.07, step: 0.002 },
    딱지: true, // 주차단기에 붙은 「전기위험」 표찰
    외곽선: true,
    외곽선굵기: { value: 3.5, min: 0, max: 12, step: 0.5 },
    외곽선색: "#000000",
    주름선: false,
  });

  // ── 음료 자판기(위치·색·외곽선 따로) ─────────────────────
  //   회전도: 90=바깥벽(왼쪽) 정면, -90=반대편 벽(오른쪽)에서 복도를 향함.
  const 음료자판CD = useSavedControls("음료 자판기", {
    위치x: { value: -21.3, min: -34, max: -19, step: 0.1 },
    위치y: { value: 0, min: -2, max: 6, step: 0.1 },
    위치z: { value: 9.2, min: -60, max: 26, step: 0.5 },
    회전도: { value: -90, min: -180, max: 180, step: 90 },
    // 대별 크기 — 앞뒤(깊이)만 「복도」 폴더에서 두 대가 같이 쓴다
    가로길이: { value: 3.4, min: 2, max: 5, step: 0.05 },
    세로길이: { value: 7.4, min: 4, max: 9, step: 0.05 },
    몸통색: "#5f5e5e",
    테색: "#3b3b3b",
    간판색: "#fffdf2",
    간판글자색: "#141414", // COLD DRINKS 글자색(밝은 간판이라 검정)
    유리색: "#d7dcde",
    선반색: "#3a4652",
    버튼틀색: "#404348",
    패널색: "#20272e",
    어두운색: "#838383",
    외곽선: true,
    외곽선굵기: { value: 3, min: 0, max: 12, step: 0.5 },
    외곽선색: "#000000",
    내부외곽선색: "#000000", // 캔·버튼·배출구 등 내부 외곽선 색
  });

  // ── 커피 자판기(위치·색·외곽선 따로) ─────────────────────
  const 커피자판CD = useSavedControls("커피 자판기", {
    위치x: { value: -21.3, min: -34, max: -19, step: 0.1 },
    위치y: { value: 0, min: -2, max: 6, step: 0.1 },
    위치z: { value: -3.2, min: -60, max: 26, step: 0.5 },
    회전도: { value: -90, min: -180, max: 180, step: 90 },
    가로길이: { value: 3.4, min: 2, max: 5, step: 0.05 },
    세로길이: { value: 7.4, min: 4, max: 9, step: 0.05 },
    몸통색: "#3e332b",
    테색: "#61656c",
    간판색: "#8d372e",
    간판글자색: "#fcfcfc",
    버튼틀색: "#3e3e3e",
    패널색: "#241a12",
    어두운색: "#15171b",
    컵색: "#cbc19e",
    커피색: "#342113",
    배출부벽색: "#cbcbcb",
    배출부유리색: "#c9ccce",
    외곽선: true,
    외곽선굵기: { value: 3, min: 0, max: 12, step: 0.5 },
    외곽선색: "#000000",
    내부외곽선색: "#000000", // 버튼·배출부 등 내부 외곽선 색
  });
  const mk선 = (v, 색) => ({
    외곽선: v.외곽선,
    외곽선굵기: v.외곽선굵기,
    외곽선색: 색,
    주름선: false,
  });
  const 음료자판선 = mk선(음료자판CD, 음료자판CD.외곽선색);
  const 음료자판내부선 = mk선(음료자판CD, 음료자판CD.내부외곽선색);
  const 커피자판선 = mk선(커피자판CD, 커피자판CD.외곽선색);
  const 커피자판내부선 = mk선(커피자판CD, 커피자판CD.내부외곽선색);

  // Leva 값 → 이동 경계용 상자에 밀어 넣는다.
  //   useFrame(이동 처리)은 React 렌더 밖에서 도니까, state 로 넘기면
  //   프레임마다 최신값을 못 본다. 그래서 모듈 바깥 상자를 쓴다.
  useEffect(() => {
    통로.세팅({
      // 통행 가능 여부.
      //   막이보이기가 꺼져 있으면 구멍을 막는 게 아예 없으므로 항상 열림(1).
      //   켜져 있을 때만 '열림' 슬라이더(=나중엔 퍼즐)가 통행을 결정한다.
      열림: !CD.보이기 ? 0 : CD.막이보이기 ? CD.열림 : 1,
      자유이동: CD.자유이동,
      문z: CD.문z,
      문폭: CD.문폭,
      복도x0: CD.바깥x,
      복도z0: CD.z시작,
      복도z1: CD.z끝,
    });
  }, [
    CD.보이기,
    CD.열림,
    CD.막이보이기,
    CD.자유이동,
    CD.문z,
    CD.문폭,
    CD.바깥x,
    CD.z시작,
    CD.z끝,
  ]);

  // ── 승강장 끝벽 (기차가 뚫고 나온 무너진 벽) ────────────────
  //   홀 양 끝을 막아 검정 여백을 없애고, 기차가 어둠에서 나온 그림을 만든다.
  //   구멍의 좌우 폭은 기차 크기에서 자동으로 계산한다(아래 배치 참고).
  const EW = useSavedControls("승강장 끝벽", {
    보이기: true,
    앞끝z: { value: MIN_Z - 8, min: -50, max: 0, step: 0.5 },
    뒷끝z: { value: MAX_Z + 8, min: 0, max: 50, step: 0.5 },
    구멍높이: { value: 11, min: 2, max: 14, step: 0.2 },
    // 구멍여유 = 기차 폭보다 얼마나 더 넓게 뚫을지. 0이면 딱 맞아서 부자연스럽다.
    구멍여유: { value: 0.9, min: 0, max: 6, step: 0.1 },
    칸: { value: 18, min: 6, max: 40, step: 1 },
    들쭉: { value: 1.8, min: 0, max: 6, step: 0.1 },
    잔해: true,
    잔해색: "#3b4048",
    거칠기: { value: 0.3, min: 0, max: 0.6, step: 0.01 },

    ...선스키마({ 굵기: 1.5, 색: "#000000", 주름: false }),
  });

  // ── 방 구조물 선 (몰딩·모서리기둥·부축기둥·구조기둥) ────────
  //   이 셋은 boxGeometry/cylinderGeometry를 JSX로 바로 만들어서
  //   지오메트리 참조가 없다 → 주름선(EdgesGeometry)은 못 걸고 외곽선만 조절한다.
  const RS = useSavedControls("방 구조물(선)", {
    외곽선: true,
    외곽선굵기: { value: 1.0, min: 0, max: 12, step: 0.5 },
    외곽선색: "#000000",
    // 걸레받이·허리몰딩·코니스에도 선을 두를지 (원래는 선이 없었다)
    몰딩선: true,
  });

  const D선 = 선뽑기(D),
    CB선 = 선뽑기(CB),
    CH선 = 선뽑기(CH),
    PC선 = 선뽑기(PC),
    KB선 = 선뽑기(KB),
    TR선 = 선뽑기(TR),
    RL선 = 선뽑기(RL),
    WK선 = 선뽑기(WK),
    EW선 = 선뽑기(EW),
    CD선 = 선뽑기(CD),
    MS선 = 선뽑기(MS),
    LP선 = 선뽑기(LP),
    MG선 = 선뽑기(MG),
    RK선 = 선뽑기(CT),
    EV선 = 선뽑기(EV),
    SD선 = 선뽑기(S),
    FL선 = 선뽑기(FL),
    PB선 = 선뽑기(PB),
    WB선 = 선뽑기(WB);

  // ── 서류 더미 ──────────────────────────────────────────
  // 공통 폴더 없이, 더미마다 전부 따로 조절한다.
  //   슬라이더 목록이 매번 같으므로 '틀'을 함수로 만들어 값만 갈아끼운다.
  //   (useControls 호출 자체는 폴더마다 하나씩 그대로 둔다 —
  //    React 훅은 매 렌더 같은 순서로 호출돼야 하기 때문)
  // 서류 더미는 낱장이 많아 폴더를 따로 두지 않고 한 곳에서 선을 조절한다.
  //   기본을 얇고 연하게 잡았다 — 종이는 선이 굵으면 금방 지저분해진다.
  const SP선 = 선뽑기(
    useSavedControls(
      "서류(공통·선)",
      선스키마({ 굵기: 1.5, 색: "#000000", 주름: true, 각도: 40 }),
    ),
  );

  const 서류틀 = (기본) => ({
    x: { value: 기본.x, min: -20, max: 20, step: 0.1 },
    z: { value: 기본.z, min: -14, max: 14, step: 0.1 },
    높이: { value: 기본.높이 ?? 2.05, min: 0, max: 6, step: 0.01 },
    회전: { value: 기본.회전, min: -Math.PI, max: Math.PI, step: 0.01 },
    크기: { value: 기본.크기 ?? 1, min: 0.3, max: 3, step: 0.01 },
    낱장수: { value: 기본.낱장수, min: 1, max: 60, step: 1 },
    흐트러짐: { value: 기본.흐트러짐, min: 0, max: 1.6, step: 0.01 },
    밀림: { value: 기본.밀림, min: 0, max: 0.8, step: 0.01 },
    무너짐: { value: 기본.무너짐, min: 0, max: 2, step: 0.01 },
    한장두께: {
      value: 기본.한장두께 ?? 0.014,
      min: 0.002, // 0.005 → 0.002 (더 얇게)
      max: 0.06,
      step: 0.0005, // 0.001 → 0.0005 (한 칸 올릴 때 덜 튀게)
    },
    씨드: { value: 기본.씨드, min: 1, max: 200, step: 1 },
    종이색: 기본.종이색 ?? "#EFEDE4",
    봉투색: 기본.봉투색 ?? "#D6C49B",
    집게수: { value: 기본.집게수 ?? 1, min: 0, max: 4, step: 1 },
    포스트잇수: { value: 기본.포스트잇수 ?? 0, min: 0, max: 5, step: 1 },
    글자표시: 기본.글자표시 ?? false,
    봉투글자: 기본.봉투글자 ?? false,
    글씨종류: { value: 기본.글씨종류 ?? "섞기", options: PAPER_STYLES },
  });

  // 서류1 — 크게 삐뚤빼뚤 쌓인 더미
  const sp1 = useSavedControls(
    "서류1(삐뚤빼뚤 큰더미)",
    서류틀({
      높이: 2.05,
      x: -10.4,
      z: -5.8,
      회전: -3.14,
      크기: 0.9,
      낱장수: 24,
      흐트러짐: 0.35,
      밀림: 0.16,
      무너짐: 0.19,
      한장두께: 0.01,
      씨드: 1,
      종이색: "#ffffff",
      봉투색: "#efe7dd",
      집게수: 2,
      포스트잇수: 1,
      글자표시: true,
      봉투글자: true,
      글씨종류: "보고서",
    }),
  );
  const sp2 = useSavedControls(
    "서류2(무너진 더미)",
    서류틀({
      높이: 2.05,
      x: -11.3,
      z: -2.6,
      회전: -1.84,
      크기: 0.9,
      낱장수: 17,
      흐트러짐: 0.38,
      밀림: 0.33,
      무너짐: 1.1,
      한장두께: 0.01,
      씨드: 129,
      종이색: "#f4efef",
      봉투색: "#ffffff",
      집게수: 1,
      포스트잇수: 1,
      글자표시: true,
      봉투글자: true,
      글씨종류: "섞기",
    }),
  );
  const sp3 = useSavedControls(
    "서류3(대충 몇장)",
    서류틀({
      높이: 2.05,
      x: 2.6,
      z: -2.1,
      회전: 2.86,
      크기: 0.9,
      낱장수: 11,
      흐트러짐: 0.75,
      밀림: 0.16,
      무너짐: 0.12,
      한장두께: 0.01,
      씨드: 58,
      종이색: "#ffffff",
      봉투색: "#ffffff",
      집게수: 0,
      포스트잇수: 0,
      글자표시: true,
      봉투글자: false,
      글씨종류: "손글씨메모",
    }),
  );
  const sp4 = useSavedControls(
    "서류4(문서+포스트잇)",
    서류틀({
      높이: 2.05,
      x: 1.6,
      z: -3.2,
      회전: 2.98,
      크기: 0.9,
      낱장수: 3,
      흐트러짐: 0.18,
      밀림: 0.12,
      무너짐: 0.1,
      한장두께: 0.01,
      씨드: 91,
      종이색: "#ffffff",
      봉투색: "#d0be96",
      집게수: 0,
      포스트잇수: 2,
      글자표시: true,
      봉투글자: false,
      글씨종류: "표·서식",
    }),
  );
  const sp5 = useSavedControls(
    "서류5(중간더미+포스트잇)",
    서류틀({
      높이: 2.05,
      x: 7,
      z: -5.4,
      회전: -1.13,
      크기: 0.9,
      낱장수: 12,
      흐트러짐: 0.45,
      밀림: 0.26,
      무너짐: 0.4,
      한장두께: 0.01,
      씨드: 133,
      종이색: "#ffffff",
      봉투색: "#ffffff",
      집게수: 1,
      포스트잇수: 2,
      글자표시: true,
      봉투글자: false,
      글씨종류: "체크리스트",
    }),
  );
  const sp6 = useSavedControls(
    "서류6(붙은책상·손글씨)",
    서류틀({
      높이: 2.05,
      x: -9.6,
      z: -3.4,
      회전: 1.51,
      크기: 0.95,
      낱장수: 8,
      흐트러짐: 0.55,
      밀림: 0.35,
      무너짐: 0.21,
      한장두께: 0.01,
      씨드: 27,
      종이색: "#ffffff",
      봉투색: "#ffffff",
      집게수: 1,
      포스트잇수: 1,
      글자표시: true,
      봉투글자: true,
      글씨종류: "손글씨메모",
    }),
  );
  const sp8 = useSavedControls(
    "서류8(빨강책상 오른쪽)",
    서류틀({
      높이: 2.05,
      x: -12.1,
      z: -7.1,
      회전: 2.7,
      크기: 0.9,
      낱장수: 4,
      흐트러짐: 0.39,
      밀림: 0.06,
      무너짐: 0.1,
      한장두께: 0.01,
      씨드: 76,
      종이색: "#ffffff",
      봉투색: "#ffffff",
      집게수: 0,
      포스트잇수: 1,
      글자표시: true,
      봉투글자: true,
      글씨종류: "체크리스트",
    }),
  );
  const spLive = [sp1, sp2, sp3, sp4, sp5, sp6, sp8];

  // ── 놓기 미리보기 색 ───────────────────────────────────
  //   형광색은 셀셰이딩 톤에서 혼자 튄다. 채도를 낮춘 파스텔이 기본값.
  const PV = useSavedControls("놓기 미리보기", {
    가능색: "#a5d5a6", // 연한 초록
    불가색: "#e58277", // 연한 코랄
    유령보이기: true,
    유령투명도: { value: 0.4, min: 0.05, max: 1, step: 0.05 },
  });

  // ── 겨냥 강조 ──────────────────────────────────────────
  //   글자 대신 물건 자체로 알려 준다. 두 가지가 동시에 걸린다 —
  //   살짝 커지고(둥), 재질이 스스로 빛나 화면의 Bloom 이 그 빛을 번지게 한다.
  //   ※ 세기가 낮으면 '노랗게 물들기'만 하고, Bloom 임계값(0.85)을 넘어야
  //     비로소 외곽이 **번진다.** 번짐이 약하면 세기를 올리면 된다.
  const HL = useSavedControls("겨냥 강조", {
    색: "#fffee7", // 아주 옅은 미색 — 물건 고유색을 덜 묻히고 밝기만 올린다
    세기: { value: 0.45, min: 0, max: 2, step: 0.05 },
    커지기: { value: 0.08, min: 0, max: 0.2, step: 0.005 }, // 들 수 있는 물건
    가구커지기: { value: 0.02, min: 0, max: 0.1, step: 0.005 }, // 캐비닛·의자·스탠드
  });

  // ── 들었다 놓을 수 있는 물건 (머그컵 3 · 노트북 3 · 서류 7 · 모자 · 번호표 3) ────
  const 들물건 = [
    ...mgLive.map((v, i) => ({ id: `mug${i}`, 종류: "머그", 이름: "머그컵", v })),
    ...lpLive.map((v, i) => ({ id: `laptop${i}`, 종류: "노트북", 이름: "노트북", v })),
    ...spLive.map((v, i) => ({ id: `paper${i}`, 종류: "서류", 이름: "서류", v })),
    // 중절모 — 옷걸이에 걸려 있다가 집어서 아무 데나 놓을 수 있다.
    ...(ht1.보이기
      ? [{ id: "hat0", 종류: "모자", 이름: "중절모", v: ht1 }]
      : []),
    // 현장 번호표 — 삼각 표지. 단, **서랍에 실린 2번은 뺀다**(서랍과 한 몸).
    ...(EV.보이기
      ? 증거목록
          .map((항목, i) => ({ 항목, v: evLive[i] }))
          .filter(
            ({ 항목 }) =>
              항목.종류 === "번호표" && 서랍승객[항목.id] === undefined,
          )
          .map(({ 항목, v }) => ({
            id: 항목.id,
            종류: "번호표",
            이름: `번호표 ${항목.번호}`,
            번호: 항목.번호,
            v,
          }))
      : []),
    // 증거물 상자 · 현장 수거품 상자.
    //   봉투는 뺐다 — 납작해서 들면 종잇장 한 장을 든 것처럼 보인다.
    ...(EV.보이기
      ? 증거목록
          .map((항목, i) => ({ 항목, v: evLive[i] }))
          .filter(
            ({ 항목 }) => 항목.종류 === "상자" || 항목.종류 === "수거품상자",
          )
          .map(({ 항목, v }) => ({
            id: 항목.id,
            종류: 항목.종류,
            이름: 항목.이름,
            사건: 항목.사건,
            v,
          }))
      : []),
    // 키보드·마우스 — 제자리가 '모니터 기준 상대좌표'라 월드 좌표로 펴서 넘긴다.
    ...pcLive.flatMap((p, i) => [
      ...(KB.보이기 !== false
        ? [{ id: `kb${i}`, 종류: "키보드", 이름: "키보드", v: 붙인자리(p, KB) }]
        : []),
      ...(MS.보이기 !== false
        ? [{ id: `ms${i}`, 종류: "마우스", 이름: "마우스", v: 붙인자리(p, MS) }]
        : []),
    ]),
  ];
  const 놓인곳 = (o) =>
    로비.자리[o.id] ?? { x: o.v.x, y: o.v.높이, z: o.v.z, rot: o.v.회전 };

  // ── 물건마다 '제자리'를 걸이(스냅 지점)로 등록한다 ──────────
  // [왜 필요한가]
  //   원래 자리는 어떤 물건이든 **언제든 되돌릴 수 있어야** 한다(GRD-01 되돌릴 수 있음).
  //   그런데 놓을 자리는 「광선 ↔ 수평면 교차」로 찾는다. 옷걸이 가지처럼 면이
  //   아닌 곳은 아예 못 잡고, 책상 위여도 '정확히 원래 그 자리'는 손으로 못 맞춘다.
  //   그래서 제자리를 **점**으로 등록해 두고, 시선이 거기 걸리면 그리로 스냅한다.
  //   모자에 쓰던 장치를 그대로 모든 물건에 편 것이다.
  const 제자리서명 = 들물건
    .map(
      (o) =>
        `${o.id}:${o.v.x},${o.v.높이},${o.v.z},${o.v.회전},${o.v.기울기 ?? 0}`,
    )
    .join("|");
  useEffect(() => {
    for (const o of 들물건)
      걸이등록(`제자리:${o.id}`, {
        물건id: o.id,
        x: o.v.x,
        y: o.v.높이,
        z: o.v.z,
        rot: o.v.회전,
        // 자빠진 각도가 있는 건 모자뿐이다. 걸린 모습 그대로 돌아가야 한다.
        기울기: o.종류 === "모자" ? o.v.기울기 : 0,
        // 모자는 공중에 걸린 점이라 넉넉하게, 나머지는 좁게 잡는다 —
        //   책상 위 물건은 반경이 크면 옆에 놓으려 해도 자꾸 제자리로 빨려든다.
        반경: o.종류 === "모자" ? 1.1 : 0.75,
      });
    return () => {
      for (const o of 들물건) 걸이해제(`제자리:${o.id}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [제자리서명]);

  // 옮겨 놓은 물건 목록을 배치 쪽에 알려 준다.
  //   제자리 겹침은 '누가 거기 갖다 놓은 것'만 따진다(배치.js 옮겨진것 참고).
  useEffect(() => {
    옮겨진것갱신(Object.keys(로비.자리));
  }, [로비.자리]);

  const 물건그리기 = (o, 곳) => {
    if (!o) return null;
    const pos = 곳 ? [곳.x, 곳.z] : [0, 0];
    const y = 곳 ? 곳.y : 0;
    const rot = 곳 ? 곳.rot : 0;
    if (o.종류 === "머그")
      return (
        <Mug
          선={MG선}
          pos={pos}
          rot={rot}
          y={y}
          scale={MG.크기}
          sizeMul={o.v.개별크기}
          cCup={MG.컵색}
          cCoffee={MG.커피색}
        />
      );
    if (o.종류 === "모자")
      return (
        <Fedora
          선={HT}
          pos={pos}
          y={y}
          rot={rot}
          // ★ 기울기(자빠진 정도)는 옷걸이에 걸려 있을 때만 준다.
          //   그대로 들거나 책상에 놓으면 챙이 파묻히거나 공중에 뜬다.
          기울기={곳 && !로비.자리[o.id] ? o.v.기울기 : 0}
          크기={o.v.크기}
          색={o.v.색}
        />
      );
    if (o.종류 === "번호표")
      return (
        <group
          position={[pos[0], y, pos[1]]}
          rotation={[0, rot, 0]}
          scale={EV.크기}
        >
          <증거번호표 번호={o.번호} 선={EV선} />
        </group>
      );
    if (o.종류 === "상자" || o.종류 === "수거품상자")
      return (
        <group
          position={[pos[0], y, pos[1]]}
          rotation={[0, rot, 0]}
          scale={EV.크기}
        >
          {o.종류 === "상자" ? (
            <증거상자 사건={o.사건} 선={EV선} />
          ) : (
            <수거품상자
              사건={o.사건}
              선={EV선}
              가로={o.v.가로}
              세로={o.v.세로}
              상자높이={o.v.상자높이}
            />
          )}
        </group>
      );
    if (o.종류 === "키보드")
      return <키보드 pos={pos} y={y} rot={rot} KB={KB} 선={KB선} />;
    if (o.종류 === "마우스")
      return <마우스 pos={pos} y={y} rot={rot} MS={MS} 선={MS선} />;
    if (o.종류 === "노트북")
      return (
        <Laptop
          선={LP선}
          pos={pos}
          rot={rot}
          y={y}
          scale={LP.크기 * o.v.개별크기}
          cScreen={LP.화면색}
          cBezel={LP.테두리색}
          cKeys={LP.키보드색}
          cTrackpad={LP.트랙패드색}
          cBody={LP.본체색}
          screenOn={LP.화면켜기}
          screenColor={LP.화면빛색}
        />
      );
    return (
      <PaperStack
        pos={pos}
        y={y}
        rot={rot}
        scale={o.v.크기}
        sheets={o.v.낱장수}
        spread={o.v.흐트러짐}
        slide={o.v.밀림}
        thick={o.v.한장두께}
        lean={o.v.무너짐}
        seed={o.v.씨드}
        paperColor={o.v.종이색}
        folderColor={o.v.봉투색}
        clipCount={o.v.집게수}
        stickyCount={o.v.포스트잇수}
        printed={o.v.글자표시}
        printedFolder={o.v.봉투글자}
        textStyle={o.v.글씨종류}
        선={SP선}
      />
    );
  };

  // 개별 책상 조절 — 각 책상마다 폴더 하나씩. 값이 폴더에 유지되어 리셋되지 않는다.
  //   조절 후 콘솔 '값출력' 버튼을 누르면 현재 값이 콘솔에 찍힌다 → DESK_SPOTS에 붙이면 고정.
  const d1 = useSavedControls("책상1(빨강)", {
    x: { value: DESK_SPOTS[0][0], min: -20, max: 20, step: 0.1 },
    z: { value: DESK_SPOTS[0][1], min: -14, max: 14, step: 0.1 },
    회전: { value: DESK_SPOTS[0][2], min: -Math.PI, max: Math.PI, step: 0.01 },
    가로길이: { value: DESK_SPOTS[0][3], min: 0.5, max: 3, step: 0.05 },
    세로길이: { value: DESK_SPOTS[0][4], min: 0.5, max: 3, step: 0.05 },
    높이: { value: DESK_SPOTS[0][5], min: 0.5, max: 2, step: 0.05 },
  });
  const d2 = useSavedControls("책상2(파랑)", {
    x: { value: DESK_SPOTS[1][0], min: -20, max: 20, step: 0.1 },
    z: { value: DESK_SPOTS[1][1], min: -14, max: 14, step: 0.1 },
    회전: { value: DESK_SPOTS[1][2], min: -Math.PI, max: Math.PI, step: 0.01 },
    가로길이: { value: DESK_SPOTS[1][3], min: 0.5, max: 3, step: 0.05 },
    세로길이: { value: DESK_SPOTS[1][4], min: 0.5, max: 3, step: 0.05 },
    높이: { value: DESK_SPOTS[1][5], min: 0.5, max: 2, step: 0.05 },
  });
  const d3 = useSavedControls("책상3(초록)", {
    x: { value: DESK_SPOTS[2][0], min: -20, max: 20, step: 0.1 },
    z: { value: DESK_SPOTS[2][1], min: -14, max: 14, step: 0.1 },
    회전: { value: DESK_SPOTS[2][2], min: -Math.PI, max: Math.PI, step: 0.01 },
    가로길이: { value: DESK_SPOTS[2][3], min: 0.5, max: 3, step: 0.05 },
    세로길이: { value: DESK_SPOTS[2][4], min: 0.5, max: 3, step: 0.05 },
    높이: { value: DESK_SPOTS[2][5], min: 0.5, max: 2, step: 0.05 },
  });
  const d4 = useSavedControls("책상4(노랑)", {
    x: { value: DESK_SPOTS[3][0], min: -20, max: 20, step: 0.1 },
    z: { value: DESK_SPOTS[3][1], min: -14, max: 14, step: 0.1 },
    회전: { value: DESK_SPOTS[3][2], min: -Math.PI, max: Math.PI, step: 0.01 },
    가로길이: { value: DESK_SPOTS[3][3], min: 0.5, max: 3, step: 0.05 },
    세로길이: { value: DESK_SPOTS[3][4], min: 0.5, max: 3, step: 0.05 },
    높이: { value: DESK_SPOTS[3][5], min: 0.5, max: 2, step: 0.05 },
  });
  const d5 = useSavedControls("책상5(보라)", {
    x: { value: DESK_SPOTS[4][0], min: -20, max: 20, step: 0.1 },
    z: { value: DESK_SPOTS[4][1], min: -14, max: 14, step: 0.1 },
    회전: { value: DESK_SPOTS[4][2], min: -Math.PI, max: Math.PI, step: 0.01 },
    가로길이: { value: DESK_SPOTS[4][3], min: 0.5, max: 3, step: 0.05 },
    세로길이: { value: DESK_SPOTS[4][4], min: 0.5, max: 3, step: 0.05 },
    높이: { value: DESK_SPOTS[4][5], min: 0.5, max: 2, step: 0.05 },
  });
  // 위 5개 값을 배열로 모아 렌더에서 사용
  const deskLive = [d1, d2, d3, d4, d5];

  // 값출력 — 콘솔에 현재 전체 배치를 코드로 찍는다(DESK_SPOTS에 붙여 고정)
  // ⚠️ Leva의 button()은 '처음 만들어질 때의 값'을 그대로 붙잡아 둔다(스테일 클로저).
  //    그래서 버튼 안에서 CAM·spLive 같은 값을 바로 쓰면, 슬라이더를 아무리 움직여도
  //    버튼은 '맨 처음 값'만 찍는다. → 지금까지 콘솔 출력이 항상 코드 기본값이었던 원인.
  //    해결: 매 렌더마다 최신 값을 상자(ref)에 담아두고, 버튼은 그 상자를 열어본다.
  const 라이브 = useRef(null);
  라이브.current = {
    CAM,
    L,
    D,
    PC,
    pcLive,
    KB,
    MS,
    LP,
    lpLive,
    spLive,
    deskLive,
  };

  useControls("★ 책상값 출력", {
    콘솔에출력: button(() => {
      const { deskLive } = 라이브.current; // ← 상자에서 '지금' 값을 꺼낸다
      const out = deskLive
        .map(
          (d) =>
            `  [${d.x}, ${d.z}, ${d.회전.toFixed(3)}, ${d.가로길이}, ${d.세로길이}, ${d.높이}],`,
        )
        .join("\n");
      console.log(
        "=== DESK_SPOTS (복사해서 코드에 붙이기) ===\nconst DESK_SPOTS = [\n" +
          out +
          "\n];",
      );
    }),
  });

  // ★ 전체값 출력 — 지금 Leva에 떠 있는 값을 '한 번에' 콘솔로 뽑는다.
  useControls("★ 전체값 출력", {
    // 저장된 값을 지우고 코드 기본값으로 되돌린다(자동저장을 초기화하고 싶을 때만)
    저장값초기화: button(() => {
      if (
        window.confirm(
          "브라우저에 저장된 Leva 값을 모두 지우고 코드 기본값으로 되돌립니다. 계속할까요?",
        )
      ) {
        localStorage.removeItem(LEVA_KEY);
        window.location.reload();
      }
    }),
    콘솔에전부출력: button(() => {
      // ← 여기서도 반드시 상자에서 꺼내 쓴다
      const { CAM, L, D, PC, pcLive, KB, MS, LP, lpLive, spLive, deskLive } =
        라이브.current;
      const 줄 = (제목, 값) =>
        `\n=== ${제목} ===\n` + JSON.stringify(값, null, 2);
      console.log(
        "===== K게서 현재 Leva 전체값 =====" +
          줄("시점(눈높이)", CAM) +
          줄("폐역 조명", L) +
          줄("책상(공통)", D) +
          줄("컴퓨터(공통·색)", PC) +
          줄("컴퓨터1/2/3", pcLive) +
          줄("키보드(공통)", KB) +
          줄("마우스(공통)", MS) +
          줄("노트북(공통·색)", LP) +
          줄("노트북1/2", lpLive) +
          줄("서류 더미", spLive) +
          "\n\n=== DESK_SPOTS (그대로 코드에 붙이기) ===\nconst DESK_SPOTS = [\n" +
          deskLive
            .map(
              (d) =>
                `  [${d.x}, ${d.z}, ${d.회전}, ${d.가로길이}, ${d.세로길이}, ${d.높이}],`,
            )
            .join("\n") +
          "\n];",
      );
    }),
  });

  return (
    <>
      {/* 3D 물체가 없는 자리에 비치는 바탕색. 방 안에서는 벽에 가려 안 보이지만,
          기차 쪽은 벽이 없어서 이 색이 그대로 드러난다. */}
      <color attach="background" args={[BG.배경색]} />

      {/* 폐역 실내 공기 — 어둡고 차가운 안개로 깊이를 죽여 음침하게 */}
      <fog attach="fog" args={[L.안개색, L.안개농도시작, L.안개농도끝]} />

      {/* ── 조명 (폐역 개조) ─────────────────────────────────────
          컨셉: 전체는 어둑하고 차갑게 눌러 '버려진 역'의 음침함을 만들고,
          장비/뒷벽 쪽만 따뜻한 앰버 포인트로 '숨은 수사본부'의 온기를 남긴다.
          값은 Leva 패널(L)에서 실시간 조절한다. */}
      {/* 기본광 — 폐역이라 낮게. 색은 차가운 회청색 */}
      <ambientLight
        intensity={L.기본광밝기 * S.전체어둡게}
        color={L.기본광색}
      />
      {/* 위/아래 색 기울기 — 위는 차가운 빛, 아래는 더 어둡게 */}
      <hemisphereLight
        args={["#9FB0C8", "#2A2E36", L.반구광밝기 * S.전체어둡게]}
      />

      {/* ① 위에서 비스듬히 내려오는 차가운 주광 — 그림자로 입체감. */}
      <directionalLight
        castShadow
        position={[-14, 30, -4]}
        intensity={L.주광밝기 * S.전체어둡게}
        color={L.주광색}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={90}
        shadow-bias={-0.0004}
        shadow-normalBias={0.09}
      />

      {/* ── 따뜻한 포인트(숨은 수사본부 장비 불빛) ────────────────
             차가운 폐역 속에서 이 앰버 웅덩이들만 온기를 낸다.
             나중에 실제 장비를 놓을 자리에 맞춰 위치를 조정한다. */}
      {/* ── 기차 저편 : 어둠판(맨 뒤) + 벽·천장 확장 ─────────────────── */}
      <group ref={배경ref}>
      {BG.어둠판 && (
        <기차배경
          x={BG.어둠판거리}
          z={ROOM_CZ}
          색={BG.어둠색}
          바닥색={BG.바닥색}
          바닥y={BG.바닥높이}
        />
      )}
      {BG.확장 && (
        <승강장확장
          시작x={16}
          끝x={BG.먼벽x}
          /* 방보다 앞뒤로 8유닛씩 더 길게 — 방 모서리 너머로 시선이 새는 걸 막는다.
             기차가 71유닛이라 방(26유닛) 밖으로 한참 빠져나가기 때문이다. */
          z0={MIN_Z - 8}
          z1={MAX_Z + 8}
          높이={ROOM_H}
          먼벽={BG.먼벽}
          천장={BG.확장천장}
          설비={BG.설비}
          덕트자리={BG.덕트자리}
          덕트내림={BG.덕트내림}
          덕트가로={BG.덕트가로}
          덕트세로={BG.덕트세로}
          이음간격={BG.이음간격}
          배관자리={BG.배관자리}
          배관내림={BG.배관내림}
          배관수={BG.배관수}
          배관굵기={BG.배관굵기}
          배관간격={BG.배관간격}
          행거간격={BG.행거간격}
          덕트색={BG.덕트색}
          배관색={BG.배관색}
          단열색={BG.단열색}
          바닥={BG.선로바닥}
          바닥y={BG.선로바닥높이}
          바닥색={BG.선로바닥색}
          바닥시드={MAT.바닥시드 + 3}
          바닥얼룩={BG.선로바닥얼룩}
          벽색={BG.먼벽색}
          아랫단색={MAT.벽아랫단색}
          천장색={BG.확장천장색}
          천장시드={MAT.천장시드}
          천장낡음={MAT.천장낡음}
          천장얼룩={MAT.천장얼룩}
          타일={BG.타일}
          무너짐={BG.무너짐}
          처짐={BG.처짐}
          골조={BG.골조}
          골조간격={BG.골조간격}
          골조굵기={BG.골조굵기}
          골조색={BG.골조색}
          늘어진판={BG.늘어진판}
          낡음={MAT.벽낡음}
          seed={MAT.벽시드 + 5}
        />
      )}

      </group>

      {/* 성능 계기판 — 왼쪽 아래에 fps·드로우콜 표시 */}
      {/* ★ 셰이더 선컴파일 — 「화면 전환하면 검게 된다」의 1순위 원인 대책.
          three는 물체가 '처음 화면에 보일 때' 그 재질의 셰이더를 컴파일한다.
          윈도우 크롬은 GLSL → HLSL → D3D 바이트코드로 두 번 번역하기 때문에
          이 컴파일이 맥보다 훨씬 오래 걸린다.
          그래서 물건이 많은 구역에 들어서는 순간 수십 개가 한꺼번에 컴파일되고,
          그 한 프레임이 2초를 넘으면 윈도우가 그래픽 드라이버를 강제로 리셋한다(TDR).
          → 화면이 검게 되고 GPU 연결이 끊긴다.

          Preload all 은 시작할 때 숨겨진 것까지 전부 잠깐 켜서 한 번에 컴파일해 둔다.
          첫 로딩이 조금 길어지는 대신, 게임 중에는 컴파일이 일어나지 않는다.
          (구역 컬링으로 꺼둔 그룹도 포함해서 컴파일한다) */}

      {/* 구역 스위치 — 플레이어 위치로 안 보이는 구역을 통째로 끈다 */}
      <구역스위치
        방={방ref}
        복도={복도ref}
        기차={기차ref}
        배경={배경ref}
        켜기={PF.구역최적화 && !구역끄기}
      />

      {/* ── 비밀 복도 + 밀리는 벽 ─────────────────────────────────── */}
      <group ref={복도ref}>
      {CD.보이기 && (
        <>
          <비밀복도
            x0={CD.바깥x}
            x1={MIN_X}
            z0={CD.z시작}
            z1={CD.z끝}
            높이={CD.높이}
            문z={CD.문z}
            문폭={CD.문폭}
            문높이={CD.문높이}
            벽색={CD.벽색}
            아랫단색={CD.아랫단색}
            바닥색={CD.바닥색}
            천장색={CD.천장색}
            낡음={MAT.벽낡음 + 0.4}
            바닥시드={MAT.바닥시드 + 11}
            잔해={CD.잔해}
            잔해색={CD.잔해색}
            거칠기={CD.거칠기}
            어둠={CD.깊이어둠}
            감쇠={CD.감쇠거리}
            최소밝기={CD.최소밝기}
            벽밝기={CD.벽밝기}
            끝어둠={CD.끝쪽어둠}
            끝기울기={CD.끝쪽기울기}
            선={CD선}
          />

          {/* 바닥 잡동사니 — 벽 밑으로 쏠려 쌓인다.
                 깊이 감광을 벽과 **같은 규칙**으로 먹여야 어두운 끝에
                 쓰레기만 혼자 환하게 뜨지 않는다. */}
          {CD.잡동사니보이기 && (
            <복도잡동사니
              x0={CD.바깥x}
              x1={MIN_X}
              z0={CD.z시작}
              z1={CD.z끝}
              개수={Math.round((CD.z끝 - CD.z시작) * CD.잡동사니밀도)}
              웅덩이={CD.웅덩이수}
              /* 비밀복도의 바닥판이 y=0.01 에 깔려 있다 — 같은 값을 줘야
                 물건 밑동이 바닥에 안 파묻힌다 */
              바닥y={0.01}
              /* 물방울이 시작하는 높이 — 천장 배관 언저리 */
              천장y={CD.높이 - 0.9}
              seed={MAT.바닥시드 + 4711}
              밝기={(z) =>
                복도깊이밝기(z, {
                  문z: CD.문z,
                  감쇠: CD.감쇠거리,
                  어둠: CD.깊이어둠,
                  최소밝기: CD.최소밝기,
                  끝어둠: CD.끝쪽어둠,
                  끝기울기: CD.끝쪽기울기,
                  z0: CD.z시작,
                })
              }
              크기={CD.잡동사니크기}
              선={CD선}
            />
          )}

          {/* 부식 자국 — 벽·바닥이 **고르게** 낡으면 반복 무늬가 드러난다.
                 한 군데씩 썩어 들어간 얼룩이 있어야 세월로 읽힌다. */}
          {CD.부식보이기 && (
            <복도부식
              x0={CD.바깥x}
              x1={MIN_X}
              z0={CD.z시작}
              z1={CD.z끝}
              바닥y={0.01}
              벽높이={CD.높이}
              바닥개수={CD.부식바닥수}
              벽개수={CD.부식벽수}
              금개수={CD.벽금수}
              크기={CD.부식크기}
              문z={CD.문z}
              문폭={CD.문폭}
              바닥색={CD.바닥색}
              벽색={CD.벽색}
              seed={MAT.바닥시드 + 909}
              밝기={(z) =>
                복도깊이밝기(z, {
                  문z: CD.문z,
                  감쇠: CD.감쇠거리,
                  어둠: CD.깊이어둠,
                  최소밝기: CD.최소밝기,
                  끝어둠: CD.끝쪽어둠,
                  끝기울기: CD.끝쪽기울기,
                  z0: CD.z시작,
                })
              }
            />
          )}

          {/* 천장 배관 · 전선 트레이 — 복도를 길어 보이게 한다 */}
          {CD.배관보이기 && (
            <복도배관
              x0={CD.바깥x}
              x1={MIN_X}
              z0={CD.z시작}
              z1={CD.z끝}
              높이={CD.높이}
              x비율={CD.배관x비율}
              처짐={CD.배관처짐}
              큰지름={CD.배관큰지름}
              작은지름={CD.배관작은지름}
              트레이폭={CD.배관트레이폭}
              가로대간격={CD.배관가로대간격}
              행어간격={CD.배관행어간격}
              파이프색={CD.배관색}
              트레이색={CD.배관트레이색}
              행어색={CD.배관행어색}
              밝기={CD.배관밝기}
              /* 벽과 똑같은 규칙으로 어두워지게 한다 */
              깊이={{
                문z: CD.문z,
                감쇠: CD.감쇠거리,
                어둠: CD.깊이어둠,
                최소밝기: CD.최소밝기,
                끝어둠: CD.끝쪽어둠,
                끝기울기: CD.끝쪽기울기,
                z0: CD.z시작,
              }}
              선={CD선}
            />
          )}

          {/* ── 벽 부착함 2개 ─────────────────────────────────
                 배전반은 문이 있는 바깥벽(+x 를 봄),
                 소화전함은 맞은편 안쪽벽(-x 를 봄)에 붙인다.
                 밝기는 벽·문과 같은 규칙으로 깎아 따로 놀지 않게 한다. */}
          {CD.배전반보이기 && (
            <벽함
              종류="배전반"
              x={CD.바깥x + CD.배전반깊이 / 2 + 0.05}
              z={CD.z시작 + (CD.z끝 - CD.z시작) * CD.배전반z비율}
              방향={1}
              폭={CD.배전반폭}
              높이={CD.배전반높이}
              깊이={CD.배전반깊이}
              바닥높이={CD.배전반바닥높이}
              함색={CD.배전반색}
              문색={CD.배전반문색}
              부속색={CD.함부속색}
              라벨바탕={CD.배전반라벨색}
              선색={CD선?.외곽선색}
              번호={CD.배전반번호}
              때={CD.함때}
              전선관={CD.배전반전선관}
              여닫이켬
              문열림각={CD.배전반문열림각}
              속={배전반속}
              천장높이={CD.높이}
              전선관색={CD.배관색}
              밝기={
                복도깊이밝기(
                  CD.z시작 + (CD.z끝 - CD.z시작) * CD.배전반z비율,
                  {
                    문z: CD.문z, 감쇠: CD.감쇠거리, 어둠: CD.깊이어둠,
                    최소밝기: CD.최소밝기, 끝어둠: CD.끝쪽어둠,
                    끝기울기: CD.끝쪽기울기, z0: CD.z시작,
                  },
                ) * CD.벽밝기
              }
              선={CD선}
            />
          )}
          {CD.소화전보이기 && (
            <벽함
              종류="소화전"
              x={MIN_X - CD.소화전깊이 / 2 - 0.05}
              z={CD.z시작 + (CD.z끝 - CD.z시작) * CD.소화전z비율}
              방향={-1}
              폭={CD.소화전폭}
              높이={CD.소화전높이}
              깊이={CD.소화전깊이}
              바닥높이={CD.소화전바닥높이}
              함색={CD.소화전색}
              문색={CD.소화전문색}
              부속색={CD.함부속색}
              라벨바탕={CD.소화전라벨색}
              선색={CD선?.외곽선색}
              때={CD.함때}
              전선관={false}
              여닫이켬
              문열림각={CD.소화전문열림각}
              속={소화전속}
              밝기={
                복도깊이밝기(
                  CD.z시작 + (CD.z끝 - CD.z시작) * CD.소화전z비율,
                  {
                    문z: CD.문z, 감쇠: CD.감쇠거리, 어둠: CD.깊이어둠,
                    최소밝기: CD.최소밝기, 끝어둠: CD.끝쪽어둠,
                    끝기울기: CD.끝쪽기울기, z0: CD.z시작,
                  },
                ) * CD.벽밝기
              }
              선={CD선}
            />
          )}
          {/* 복도 옆 사무실 문들 — 바깥벽(x = 바깥x)에 같은 간격으로.
                 시작~끝 비율 사이를 (개수-1)등분해 규칙적으로 놓는다. */}
          {CD.측면문보이기 &&
            Array.from({ length: CD.측면문개수 }, (_, i) => {
              const n = Math.max(1, CD.측면문개수 - 1);
              const t =
                CD.측면문개수 === 1
                  ? (CD.측면문시작 + CD.측면문끝) / 2
                  : CD.측면문시작 + ((CD.측면문끝 - CD.측면문시작) * i) / n;
              const zz = CD.z시작 + (CD.z끝 - CD.z시작) * t;
              return (
                <복도측면문
                  key={`sd${i}`}
                  x={CD.바깥x}
                  z={zz}
                  방향={1}
                  폭={CD.측면문폭}
                  높이={CD.측면문높이}
                  문두께={CD.측면문두께}
                  틀돌출={CD.측면문틀돌출}
                  내림={CD.측면문내림}
                  발판돌출={CD.측면문발판돌출}
                  문색={CD.측면문색}
                  리빌색={CD.측면문리빌색}
                  틈색={CD.측면문틈색}
                  패널선색={CD.측면문패널선색}
                  경첩색={CD.측면문경첩색}
                  손잡이색={CD.측면문손잡이색}
                  잠금판색={CD.측면문잠금판색}
                  열쇠구멍색={CD.측면문열쇠구멍색}
                  문턱색={CD.측면문턱색}
                  판자색={CD.측면문판자색}
                  못색={CD.측면문못색}
                  외곽선={CD.측면문외곽선}
                  외곽선색={CD.측면문외곽선색}
                  외곽선굵기={CD.측면문외곽선굵기}
                  /* 문마다 때를 다르게 — 같으면 복사한 티가 난다 */
                  때={CD.측면문때 * [1, 0.75, 1.35][i % 3]}
                  /* 널빤지는 일부 문에만. 전부 막으면 패턴처럼 보인다 */
                  판자={CD.측면문판자 && i % 2 === 0}
                  seed={i + 1}
                  /* 문도 복도와 같은 규칙으로 어두워진다 */
                  밝기={
                    복도깊이밝기(zz, {
                      문z: CD.문z,
                      감쇠: CD.감쇠거리,
                      어둠: CD.깊이어둠,
                      최소밝기: CD.최소밝기,
                      끝어둠: CD.끝쪽어둠,
                      끝기울기: CD.끝쪽기울기,
                      z0: CD.z시작,
                    }) * CD.측면문밝기
                  }
                  선={CD선}
                />
              );
            })}

          {/* 복도 끝(z시작 쪽)의 닫힌 비상계단 문 */}
          {CD.끝문보이기 && (
            <복도끝문
              x={(CD.바깥x + MIN_X) / 2}
              z={CD.z시작}
              안쪽={1}
              폭={CD.끝문폭}
              높이={CD.끝문높이}
              문색={CD.끝문색}
              틀색={CD.끝문틀색}
              손잡이색={CD.끝문손잡이색}
              라인색={CD.끝문라인색}
              대비={CD.끝문대비}
              선폭={CD.끝문선폭}
              선두께={CD.끝문선두께}
              문두께={CD.끝문두께}
              유도등={CD.유도등}
              유도등크기={CD.유도등크기}
              유도등높이={CD.유도등높이}
              유도등테색={CD.유도등테색}
              유도등바탕색={CD.유도등바탕색}
              /* 문도 복도와 같은 규칙으로 어두워져야 따로 노는 느낌이 안 난다.
                 (유도등만 basic 재질이라 이 감광을 안 받는다 — 의도한 것) */
              밝기={
                복도깊이밝기(CD.z시작, {
                  문z: CD.문z,
                  감쇠: CD.감쇠거리,
                  어둠: CD.깊이어둠,
                  최소밝기: CD.최소밝기,
                  끝어둠: CD.끝쪽어둠,
                  끝기울기: CD.끝쪽기울기,
                  z0: CD.z시작,
                }) * CD.끝문밝기보정
              }
              선={CD선}
            />
          )}

          {/* ── 자판기 2대 ───────────────────────────────────
                 바깥벽에 등을 대고 정면(로컬 +z)이 복도 안쪽을 보도록
                 Y 로 90° 돌린다. 밝기는 벽·함과 같은 깊이 규칙을 그대로 쓴다
                 — 안 그러면 복도 끝에서 자판기만 혼자 환하게 뜬다. */}
          {CD.자판기보이기 &&
            (() => {
              const 깊이규칙 = {
                문z: CD.문z,
                감쇠: CD.감쇠거리,
                어둠: CD.깊이어둠,
                최소밝기: CD.최소밝기,
                끝어둠: CD.끝쪽어둠,
                끝기울기: CD.끝쪽기울기,
                z0: CD.z시작,
              };
              const zc = 음료자판CD.위치z;
              const zk = 커피자판CD.위치z;
              return (
                <>
                  <캔자판기
                    위치={[음료자판CD.위치x, 음료자판CD.위치y, zc]}
                    회전={(음료자판CD.회전도 * Math.PI) / 180}
                    폭={음료자판CD.가로길이}
                    높이={음료자판CD.세로길이}
                    깊이={CD.자판기깊이}
                    몸통색={음료자판CD.몸통색}
                    테색={음료자판CD.테색}
                    간판색={음료자판CD.간판색}
                    간판글자색={음료자판CD.간판글자색}
                    유리색={음료자판CD.유리색}
                    선반색={음료자판CD.선반색}
                    버튼틀색={음료자판CD.버튼틀색}
                    패널색={음료자판CD.패널색}
                    어두운색={음료자판CD.어두운색}
                    자판기id="음료"
                    /* Leva 값이 있으면 그게 이긴다(연출 확인용).
                       평소에는 버튼을 눌러 나온 것을 보여 준다. */
                    뽑힌캔={
                      CD.음료뽑힌캔 >= 0
                        ? CD.음료뽑힌캔
                        : 음료자판상태.나온것 >= 0
                          ? 음료자판상태.나온것
                          : null
                    }
                    밝기={복도깊이밝기(zc, 깊이규칙)}
                    선={음료자판선}
                    내부선={음료자판내부선}
                  />
                  <커피자판기
                    위치={[커피자판CD.위치x, 커피자판CD.위치y, zk]}
                    회전={(커피자판CD.회전도 * Math.PI) / 180}
                    폭={커피자판CD.가로길이}
                    높이={커피자판CD.세로길이}
                    깊이={CD.자판기깊이}
                    몸통색={커피자판CD.몸통색}
                    테색={커피자판CD.테색}
                    간판색={커피자판CD.간판색}
                    간판글자색={커피자판CD.간판글자색}
                    버튼틀색={커피자판CD.버튼틀색}
                    패널색={커피자판CD.패널색}
                    어두운색={커피자판CD.어두운색}
                    컵색={커피자판CD.컵색}
                    커피색={커피자판CD.커피색}
                    배출부벽색={커피자판CD.배출부벽색}
                    배출부유리색={커피자판CD.배출부유리색}
                    자판기id="커피"
                    선택={
                      CD.커피선택 !== "없음" ? CD.커피선택 : 커피자판상태.선택
                    }
                    컵있음={CD.커피컵 || 커피자판상태.컵}
                    문열림={CD.커피문열림}
                    밝기={복도깊이밝기(zk, 깊이규칙)}
                    선={커피자판선}
                    내부선={커피자판내부선}
                  />
                </>
              );
            })()}

          {/* 구멍의 테두리 — 리빌(안쪽 단면) + 찢어진 가장자리 + 발치 잔해.
                 벽 자체의 구멍은 아래 '벽' 블록에서 판을 쪼개 뚫는다. */}
          <부서진문틀
            x={MIN_X}
            문z={CD.문z}
            문폭={CD.문폭}
            문높이={CD.문높이}
            두께={CD.문두께}
            벽색={MAT.벽색}
            잔해색={CD.잔해색}
            거칠기={CD.거칠기}
            잔해보이기={CD.테두리잔해}
            선={CD선}
          />
          {CD.막이보이기 && (
            <밀리는벽
              x={MIN_X}
              문z={CD.문z}
              문폭={CD.문폭}
              문높이={CD.문높이}
              두께={CD.문두께}
              열림={CD.열림}
              벽색={CD.벽색}
              잔해색={CD.잔해색}
              거칠기={CD.거칠기}
              선={CD선}
            />
          )}
          {/* 복도 조명 — 천장에 붙은 형광 패널등 N개.
                 복도 길이를 N등분한 칸의 '한가운데'에 하나씩 → 규칙적인 간격 */}
          {CD.불켜기 &&
            Array.from({ length: CD.등개수 }, (_, i) => {
              const t = (i + 0.5) / CD.등개수;
              return (
                <복도등
                  key={`cl${i}`}
                  x={(CD.바깥x + MIN_X) / 2}
                  y={CD.높이 - CD.등내림}
                  z={CD.z시작 + (CD.z끝 - CD.z시작) * t}
                  폭={CD.등폭}
                  길이={CD.등길이}
                  색={CD.불색}
                  세기={CD.불세기}
                  틀색={CD.등틀색}
                  판색={CD.등판색}
                  회전={CD.등회전}
                  각도={CD.빛각도}
                  퍼짐={CD.빛퍼짐}
                  거리={CD.빛거리}
                  /* 등마다 때를 다르게 — 같은 값이면 복사한 티가 난다.
                     시드도 다르고(무늬가 다름) 세기도 다르게(더러운 정도가 다름) */
                  때={CD.등때 * [1, 1.5, 0.72][i % 3]}
                  발광={CD.등발광}
                  깜빡임={CD.깜빡임}
                  얼룩시드={i + 1}
                  패턴={깜빡패턴[i % 깜빡패턴.length]}
                  선={CD선}
                />
              );
            })}
        </>
      )}
      </group>

      <group ref={기차ref}>
      {/* ── 승강장 끝벽 2곳 — 기차가 뚫고 나온 무너진 벽 ─────────────
             구멍 좌우는 기차에서 자동 계산한다.
             기차 반폭 = 모델 폭 0.686 ÷ 2 × 크기 → 여기에 여유를 더한다. */}
      {EW.보이기 &&
        BG.확장 &&
        [
          [EW.앞끝z, false, 51],
          [EW.뒷끝z, true, 63],
        ].map(([ez, flip, sd]) => (
          <승강장끝벽
            key={`endwall${sd}`}
            z={ez}
            뒤집기={flip}
            시작x={16}
            끝x={BG.먼벽x}
            높이={ROOM_H}
            구멍x0={TR.가로 - 0.343 * TR.크기 - EW.구멍여유}
            구멍x1={TR.가로 + 0.343 * TR.크기 + EW.구멍여유}
            구멍높이={EW.구멍높이}
            칸={EW.칸}
            들쭉={EW.들쭉}
            벽색={MAT.벽색}
            아랫단색={MAT.벽아랫단색}
            낡음={MAT.벽낡음}
            잔해={EW.잔해}
            잔해색={EW.잔해색}
            거칠기={EW.거칠기}
            seed={sd}
            선={EW선}
          />
        ))}

      {/* ── 기차 선로 — 위치는 기차와 같게, 회전만 따로(반듯하게) ────── */}
      {RL.보이기 && (
        <기차선로
          pos={[TR.가로, TR.세로]}
          y={RL.선로높이}
          rot={RL.기차와같은각도 ? TR.기울기 : RL.따로기울기}
          길이={RL.길이}
          폭={RL.도상폭}
          궤간={RL.궤간}
          자갈={RL.자갈}
          도상색={RL.도상색}
          침목색={RL.침목색}
          레일색={RL.레일색}
          선={RL선}
        />
      )}

      {/* ── 기차가 뚫고 지나간 벽의 부서진 끝 (앞벽·뒷벽) ────────────── */}
      {WK.보이기 &&
        [
          [MIN_Z, 3, false, WK.앞벽끝x, WK.앞벽조각끝x],
          [MAX_Z, 8, true, WK.뒷벽끝x, WK.뒷벽조각끝x],
        ].map(([wz, sd, flip, 끝x, 조각끝x]) => (
          <부서진벽끝
            key={`wreck${sd}`}
            z={wz}
            뒤집기={flip}
            끝x={끝x}
            한계x={조각끝x}
            가운데파임={WK.가운데파임}
            층={WK.층}
            들쭉={WK.들쭉}
            거칠기={WK.거칠기}
            seed={sd}
            높이={ROOM_H}
            벽색={MAT.벽색}
            아랫단색={MAT.벽아랫단색}
            낡음={MAT.벽낡음}
            잔해색={WK.잔해색}
            선={WK선}
          />
        ))}

      {/* ── 멈춰 선 기차 — 방 오른쪽(+x) 뚫린 변 바깥 ─────────────── */}
      {TR.보이기 && (
        <Suspense fallback={null}>
          <Train
            pos={[TR.가로, TR.세로]}
            y={TR.바닥높이}
            rot={TR.기울기}
            크기={TR.크기}
            대수={TR.대수}
            간격={TR.칸겹침}
            좌우기울기={TR.좌우기울기}
            앞뒤기울기={TR.앞뒤기울기}
            휨={TR.휨}
            차체색={TR.차체색}
            문색={문설정.문색}
            어둠색={TR.어둠색}
            문열림폭={TR.문열림폭}
            문옵션={문설정}
            선={TR선}
          />
        </Suspense>
      )}
      </group>

      <group ref={방ref}>
      {/* ── 천장 작업등(수사본부가 설치) — 2×2 균일 격자 ──────────────
             실제 빛은 여기서 나온다. 낡은 천장에 새로 매단 반구 갓 조명. */}
      {[
        [-8, -7],
        [8, -7],
        [-8, 7],
        [8, 7],
      ].map(([lx, lz], i) => (
        <WorkLamp
          key={`ceil${i}`}
          pos={[lx, lz]}
          on={CL.켜기 && !S.천장등끄기}
          drop={CL.내림}
          크기={CL.크기}
          갓색={CL.갓색}
          전구색={CL.전구색}
          빛세기={CL.빛세기}
          빛퍼짐={CL.빛퍼짐}
          번짐={CL.번짐}
          빛감쇠={CL.빛감쇠}
          천장번짐={CL.천장번짐}
          선={RS}
        />
      ))}

      {/* ── 스탠드 조명 3개 ──────────────────────────────
             천장등을 끄고 이 좁은 빛 웅덩이들만 남기면 '야간 수사' 톤이 된다.
             위치·각도는 Leva 폴더 스탠드1/2/3 에서 실시간으로 맞춘다. */}
      {stLive.map((s3, i) => (
        <group key={`lamp${i}`}>
        <상호대상
          id={`stand${i}`}
          반경={0.7}
          위치={() => [s3.x, s3.받침높이 + S.높이 * s3.개별배율 * 0.9, s3.z]}
          라벨={() =>
            램프보기(`stand${i}`, S.켜기) ? "[E] 스탠드 끄기" : "[E] 스탠드 켜기"
          }
          실행={() => 램프토글(`stand${i}`, S.켜기)}
        />
        <강조
          id={`stand${i}`}
          색={HL.색}
          세기={HL.세기}
          확대={HL.가구커지기}
          기준={() => [s3.x, s3.받침높이, s3.z]}
        >
        <잰다
          id={`stand${i}`}
          자리
          다시재기={`${s3.x},${s3.z},${s3.받침높이},${s3.회전},${s3.개별배율},${S.높이}`}
        >
        <DeskLamp
          선={SD선}
          pos={[s3.x, s3.z]}
          baseY={s3.받침높이}
          rot={s3.회전}
          height={S.높이 * s3.개별배율}
          on={램프보기(`stand${i}`, S.켜기)}
          bulb={S.전구색}
          body={S.몸체색}
          inner={S.갓안쪽색}
          intensity={S.빛세기}
          spread={S.빛퍼짐}
          음영바닥={S.음영바닥}
          shadow={S.그림자}
        />
        </잰다>
        </강조>
        </group>
      ))}

      {/* ── 장스탠드 1개 (바닥에 세우는 긴 것) ────────────────
             탁상 스탠드와 같은 컴포넌트를 쓰고 모델 파일만 바꾼다.
             baseY=0 → 책상이 아니라 바닥에 선다. */}
      {FL.보이기 && (
        <충돌체
          이름="floorlamp"
          켬={COL.켜기}
          여유={COL.여유}
          다시재기={`${FL.x},${FL.z},${FL.회전},${FL.높이}`}
        >
        <상호대상
          id="floorlamp"
          반경={0.8}
          위치={() => [FL.x, FL.바닥높이 + FL.높이 * 0.9, FL.z]}
          라벨={() =>
            램프보기("floorlamp", FL.켜기) ? "[E] 장스탠드 끄기" : "[E] 장스탠드 켜기"
          }
          실행={() => 램프토글("floorlamp", FL.켜기)}
        />
        <DeskLamp
          선={FL선}
          기둥늘림={1.05}
          url="/models/lamp_floor.glb"
          mouth={FLOOR_MOUTH}
          axis={FLOOR_AXIS}
          pos={[FL.x, FL.z]}
          baseY={FL.바닥높이}
          rot={FL.회전}
          height={FL.높이}
          on={램프보기("floorlamp", FL.켜기)}
          bulb={S.전구색}
          body={S.몸체색}
          inner={S.갓안쪽색}
          intensity={FL.빛세기}
          spread={FL.빛퍼짐}
          음영바닥={S.음영바닥}
          shadow={S.그림자}
        />
        </충돌체>
      )}

      {/* ── 서류 캐비닛 3개 ───────────────────────────────
             모델 파일은 하나. 시드만 달라서 얼룩·찌그러짐이 셋 다 다르다. */}
      {CB.보이기 &&
        cbLive.map((c, i) => (
          <충돌체
            key={`cab${i}`}
            이름={`cab${i}`}
            켬={COL.켜기}
            여유={COL.여유}
            다시재기={`${c.x},${c.z},${c.회전},${CB.높이}`}
          >
          {/* 만질 수 있는 서랍 한 칸 */}
          <상호대상
            id={`cab${i}`}
            반경={0.8}
            위치={() => 서랍위치(i)}
            라벨={() => (서랍열렸나(i) ? "[E] 서랍 닫기" : "[E] 서랍 열기")}
            실행={() =>
              서랍움직이기(
                `cab${i}`,
                서랍칸(i),
                CB.많이열림,
                서랍열렸나(i) ? "닫기" : "열기",
              )
            }
          />
          <Cabinet
            선={CB선}
            pos={[c.x, c.z]}
            rot={c.회전}
            seed={c.시드}
            height={CB.높이}
            color={CB.색}
            찌그러짐={CB.찌그러짐}
            깊이={CB.깊이}
            얼룩={CB.얼룩}
            얼룩세기={CB.얼룩세기}
            선보이기={CB.선보이기}
            선색={CB.선색}
            열림={서랍보기(i)}
            서랍낡음={CB.서랍낡음}
            겨냥={{
              id: `cab${i}`,
              칸: 서랍칸(i),
              색: HL.색,
              세기: HL.세기,
            }}
          />
          </충돌체>
        ))}

      {/* ── 증거물 3종 — 그냥 놓여 있는 소품이다(조사 기능 없음) ── */}
      {EV.보이기 &&
        증거목록.map((항목, i) => {
          // 들 수 있게 옮긴 것은 여기서 그리지 않는다(두 번 그려진다).
          //   ★ 단, 서랍에 실린 번호표는 여기 남는다 — 집을 수 없고,
          //     서랍이 열리고 닫힐 때 같이 움직여야 하기 때문이다.
          if (항목.종류 === "번호표" && 서랍승객[항목.id] === undefined)
            return null;
          if (항목.종류 === "상자" || 항목.종류 === "수거품상자") return null;
          const v = evLive[i];
          const [dx, dz] = 서랍보정(항목.id); // 서랍에 실린 것이면 같이 움직인다
          return (
            <group
              key={항목.id}
              position={[v.x + dx, v.높이, v.z + dz]}
              rotation={[0, v.회전, 0]}
              scale={EV.크기}
            >
              {항목.종류 === "봉투" && (
                <증거봉투
                  사건={항목.사건}
                  품목={항목.품목}
                  선={EV선}
                  두께={v.두께}
                  크기={v.크기}
                />
              )}
              {항목.종류 === "번호표" && (
                <증거번호표 번호={항목.번호 ?? 2} 선={EV선} />
              )}
              {항목.종류 === "상자" && <증거상자 사건={항목.사건} 선={EV선} />}
              {항목.종류 === "수거품상자" && (
                <수거품상자
                  사건={항목.사건}
                  선={EV선}
                  가로={v.가로}
                  세로={v.세로}
                  상자높이={v.상자높이}
                />
              )}
            </group>
          );
        })}

      {/* ── 옷걸이 스탠드 2개 ─────────────────────────────── */}
      {CT.보이기 && (
        <>
          {[rk1, rk2].map((r, i) => (
            <충돌체
              key={`rack${i}`}
              이름={`rack${i}`}
              켬={COL.켜기}
              여유={COL.여유}
              다시재기={`${r.x},${r.z},${r.회전},${CT.스탠드높이}`}
            >
            <group
              position={[r.x, 0, r.z]}
              rotation={[0, r.회전, 0]}
            >
              <옷걸이스탠드
                선={RK선}
                스탠드색={CT.스탠드색}
                옷색={r.옷색}
                높이={CT.스탠드높이}
                반전={r.좌우반전}
              />
            </group>
            </충돌체>
          ))}
        </>
      )}

      {/* ── 바닥 — 폐역 개조: 유리 통로 없애고 전체를 타일 한 판으로 ─────
          (중앙 우주 통로를 걷어내고 바닥을 꽉 채운 낡은 타일로 통일한다) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[ROOM_CX, 0, ROOM_CZ]}
        geometry={바닥geo}
        receiveShadow
      >
        <meshToonMaterial
          color={MAT.바닥색}
          map={바닥텍}
          gradientMap={TOON_GRADIENT}
          vertexColors
        />
      </mesh>

      {/* ── 천장 — 폐역 개조: 채광창(우주) 없애고 낡은 평천장 한 장으로 ───── */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[ROOM_CX, ROOM_H, ROOM_CZ]}
        geometry={천장geo}
        receiveShadow
      >
        <meshToonMaterial
          color={MAT.천장색}
          map={천장텍}
          gradientMap={TOON_GRADIENT}
          vertexColors
          /* emissive = 빛을 안 받아도 스스로 내는 색.
             천장색과 같은 색으로 아주 약하게 깔아 '검게 죽는 것'만 막는다. */
          emissive={MAT.천장색}
          emissiveIntensity={MAT.천장자체밝기}
        />
      </mesh>

      {/* ── 벽 (아래 굽 + 위 본체) — 폐역 개조 ─────────────────────
          좌표를 ROOM_W/ROOM_D에서 계산해 방 크기를 바꿔도 벽이 따라온다.
          오른쪽(+x) 벽은 제거 — 기차가 들어와 벽 역할을 하는 자리라 비운다. */}
      <group position={[ROOM_CX, 0, ROOM_CZ]}>
        {[
          [0, -ROOM_D / 2, 0], // 앞벽(뒤쪽)
          [0, ROOM_D / 2, Math.PI], // 뒷벽(앞쪽)
          [-ROOM_W / 2, 0, Math.PI / 2], // 왼쪽 벽
          // 오른쪽 벽 없음(기차 자리)
        ].map(([x, z, ry], i) => {
          const side = i >= 2; // 0,1 = 앞뒤(긴 벽) / 2 = 왼쪽(짧은 벽)
          // ★ 앞·뒷벽은 기차 앞에서 끊는다.
          //   원래는 x=+16 까지 꽉 차 있어서, 기차가 방을 빠져나가는 양 끝을
          //   벽이 가로막고 서 있었다. 후퇴시킨 만큼(기본 4유닛) 짧게 만들고
          //   그 끊긴 자리는 아래 <부서진벽끝> 이 들쭉날쭉하게 마감한다.
          //   폭을 줄인 만큼 중심도 옮겨야 '왼쪽 끝(-20)'은 그대로 남는다.
          //   i=1 은 180° 돌아간 벽이라 오프셋 부호가 반대다.
          // i=0 → 앞벽(z=-14) / i=1 → 뒷벽(z=+12). 후퇴를 따로 준다.
          //   후퇴가 음수면 벽이 x=+16 을 넘어 기차 쪽으로 더 뻗는다.
          // 벽이 끝나는 x 를 직접 받아 '얼마나 물러났는지'로 되돌린다.
          const 후퇴 = 16 - (i === 1 ? WK.뒷벽끝x : WK.앞벽끝x);
          const w = side ? ROOM_D : ROOM_W - 후퇴;
          const xOff = side ? 0 : (i === 1 ? 1 : -1) * (후퇴 / 2);

          // ★ 왼쪽 벽(i===2)에 비밀 통로용 '진짜 구멍'을 뚫는다.
          //   ─ 왜 벽을 쪼개나?
          //     구멍 앞에 문짝만 세우면 '벽에 기대 놓은 판때기'로 보인다.
          //     벽 자체를 그 자리만 안 그려야 비로소 '뚫렸다'가 된다.
          //   ─ 좌표 주의:
          //     이 벽은 rotation Y = 90°. three.js 에서 Y축 90° 회전은
          //     로컬 +X 를 월드 -Z 로 보낸다. 그래서
          //         로컬x = ROOM_CZ - 월드z
          //     문 위치(CD.문z)는 월드 z 기준이라 이렇게 변환해야 한다.
          const 구멍 = side && CD.보이기;
          const dx = ROOM_CZ - CD.문z; // 문 중심(벽 로컬 x)
          const 반 = CD.문폭 / 2;
          const 왼끝 = -w / 2,
            오른끝 = w / 2;

          // 그릴 판 목록을 먼저 계산한다.
          //   구멍이 없으면 통짜 2장(위 본체 + 아래 굽),
          //   있으면 좌 조각 + 우 조각 + 인방(문 위 남는 벽).
          const 판목록 = [];
          const 통짜 = (pw, px) => {
            판목록.push({ w: pw, xOff: px, h: 8, y0: 4, color: MAT.벽색 });
            판목록.push({
              w: pw,
              xOff: px,
              h: 4,
              y0: 0,
              color: MAT.벽아랫단색,
            });
          };
          if (!구멍) {
            통짜(w, xOff);
          } else {
            const wL = dx - 반 - 왼끝; // 문 왼쪽에 남는 벽 폭
            const wR = 오른끝 - (dx + 반); // 문 오른쪽에 남는 벽 폭
            if (wL > 0.01) 통짜(wL, 왼끝 + wL / 2);
            if (wR > 0.01) 통짜(wR, 오른끝 - wR / 2);
            // 인방 = 문 위에 남는 벽. 문높이부터 천장까지.
            const 인방h = ROOM_H - CD.문높이;
            if (인방h > 0.01)
              판목록.push({
                w: CD.문폭,
                xOff: dx,
                h: 인방h,
                y0: CD.문높이,
                color: MAT.벽색,
              });
          }

          return (
            <group key={i} position={[x, 0, z]} rotation={[0, ry, 0]}>
              {판목록.map((p, k) => (
                <WallPanel
                  key={k}
                  w={p.w}
                  xOff={p.xOff}
                  h={p.h}
                  y0={p.y0}
                  color={p.color}
                  seed={MAT.벽시드 + i}
                  얼룩={MAT.벽얼룩}
                  낡음={MAT.벽낡음}
                />
              ))}
            </group>
          );
        })}
      </group>

      {/* (폐역 개조: 옛 채광창 구조의 천장 격자보 제거 —
          낡은 평천장으로 바꿨으므로 불필요. 천장 디테일은 나중에 전등·질감으로) */}

      {/* 걸레받이·허리몰딩·코니스·모서리 기둥·부축기둥 */}
      <RoomShell
        선={RS}
        문={CD.보이기 ? { z: CD.문z, 폭: CD.문폭, 높이: CD.문높이 } : null}
      />

      {/* 구조 기둥 — 폐역 개조: 오른쪽 1개만 (왼쪽은 책상 구역이라 제거) */}
      <Column x={8} z={0} 선={RS} />

      {/* (폐역 개조: 뒷벽 안내 패널 + 전광판 제거 — 운행 정보가 필요 없는 폐역) */}

      {/* (폐역 개조: 좌우 사이드 게이트 제거 — 오른쪽은 기차가 들어올 자리라 비우고,
          왼쪽 출입문은 나중에 따로 만든다) */}

      {/* 철제 책상 5개 — 각 책상은 개별 Leva 폴더(deskLive)로 실시간 조절.
          외곽선·주름선은 '책상(공통)' 폴더에서 함께 조절한다. */}
      <Suspense fallback={null}>
        {deskLive.map((d, i) => (
          <충돌체
            key={`desk${i}`}
            이름={`desk${i}`}
            켬={COL.켜기}
            여유={COL.여유}
            다시재기={`${d.x},${d.z},${d.회전},${d.가로길이},${d.세로길이},${D.크기}`}
          >
          <잰다
            id={`면:desk${i}`}
            면
            다시재기={`${d.x},${d.z},${d.회전},${d.가로길이},${d.세로길이},${d.높이},${D.크기},${D.높이미세}`}
          >
          <Desk
            pos={[d.x, d.z]}
            rot={d.회전}
            stretch={d.가로길이}
            zStretch={d.세로길이}
            yStretch={d.높이}
            scale={D.크기}
            lift={D.높이미세}
            선={D선}
            color={DESK_DEBUG ? DESK_COLORS[i] : P.struct}
          />
          </잰다>
          </충돌체>
        ))}
      </Suspense>

      {/* 책상 위 컴퓨터 3대 — 각 대마다 Leva 폴더(컴퓨터1/2/3)로
          위치·높이·회전·개별크기를 따로 조절. 크기·색은 공통 폴더에서. */}
      <Suspense fallback={null}>
        {pcLive.map((p, i) => (
          <잰다
            key={`pc${i}`}
            id={`pc${i}`}
            자리
            다시재기={`${p.x},${p.z},${p.회전},${p.높이},${p.개별크기},${PC.크기}`}
          >
          <PcSet
            선={PC선}
            pos={[p.x, p.z]}
            rot={p.회전}
            y={p.높이}
            scale={PC.크기}
            sizeMul={p.개별크기}
            color={PC.색}
          />
          </잰다>
        ))}
      </Suspense>

      {/* 사무용 의자 5개 — 왼쪽 자리에 3개, 오른쪽에 2개.
          대마다 Leva 폴더(의자1~5)로 위치·회전을 따로 조절한다. */}
      <Suspense fallback={null}>
        {chLive.map((c, i) => {
          const id = `chair${i}`;
          const 놓인 = 로비.의자자리[id];
          const cx = 놓인 ? 놓인.x : c.x;
          const cz = 놓인 ? 놓인.z : c.z;
          const 끌리는중 = 로비.끄는의자 === id;
          const 의자 = (
            <>
              <상호대상
                id={id}
                반경={0.9}
                위치={() => [cx, 1.6, cz]}
                라벨="[E] 의자 끌기"
                끔={() => !!로비.끄는의자 || !!로비.든것}
                실행={() => 의자잡기(id)}
              />
              <강조
                id={id}
                색={HL.색}
                세기={HL.세기}
                확대={HL.가구커지기}
                기준={() => [cx, 0, cz]}
              >
                <Chair
                  선={CH선}
                  이름={id}
                  // 끌고 있는 동안은 충돌을 끈다.
                  //   안 끄면 내가 끌고 가는 의자에 내가 막혀 앞으로 못 간다.
                  충돌={CH.충돌 && !끌리는중}
                  pos={[cx, cz]}
                  rot={c.회전}
                  y={c.높이}
                  scale={CH.크기}
                  sizeMul={c.개별크기}
                  color={CH.색}
                />
              </강조>
            </>
          );
          return (
            <group key={id}>
              {끌리는중 ? (
                <의자끌기
                  이름={id}
                  기준={[cx, cz]}
                  /* Chair 안의 충돌 박스와 같은 식 — 한쪽만 바뀌면 어긋난다 */
                  반경={0.65 * CHAIR_SCALE * CH.크기 * c.개별크기}
                  높이={1.9 * CHAIR_SCALE * CH.크기 * c.개별크기}
                >
                  {의자}
                </의자끌기>
              ) : (
                의자
              )}
            </group>
          );
        })}
      </Suspense>

      {/* 증거 핀보드 — 사진·메모를 붉은 실로 이어 놓은 판 */}
      <충돌체
        이름="pinboard"
        켬={COL.켜기}
        여유={COL.여유}
        다시재기={`${PB.x},${PB.z},${PB.회전},${PB.크기}`}
      >
        <PinBoard
          선={PB선}
          pos={[PB.x, PB.z]}
          rot={PB.회전}
          y={PB.높이}
          scale={PB.크기}
          cFrame={PB.테두리색}
        />
      </충돌체>

      {/* 수사 화이트보드 1개 — 판 그림은 코드로 그린 캔버스 텍스처 */}
      <충돌체
        이름="whiteboard"
        켬={COL.켜기}
        여유={COL.여유}
        다시재기={`${WB.x},${WB.z},${WB.회전},${WB.크기}`}
      >
        <Whiteboard
          선={WB선}
          pos={[WB.x, WB.z]}
          rot={WB.회전}
          y={WB.높이}
          scale={WB.크기}
          cFrame={WB.테두리색}
        />
      </충돌체>

      {/* ── 들었다 놓을 수 있는 물건 (머그컵 3 · 노트북 3 · 서류 7) ──────
             어디에 놓여 있는지는 '자리'가 정하고, 손에 든 것 하나는 여기서 빠져
             카메라 앞(손에든것)에 그려진다. 배치·색·크기는 각자의 Leva 폴더에서. */}
      <Suspense fallback={null}>
        {들물건.map((o) => {
          if (로비.든것 === o.id) return null;
          const 곳 = 놓인곳(o);
          return (
            <group key={o.id}>
              <상호대상
                id={`집기:${o.id}`}
                반경={0.55}
                위치={() => {
                  const c = 놓인곳(o);
                  return [c.x, c.y + 0.25, c.z];
                }}
                라벨={`[E] ${o.이름} 들기`}
                // ★ 위에 뭔가 얹혀 있으면 아예 겨냥 대상에서 뺀다.
                //   글자로 이유를 알려 주지 않기로 했으니, '빛나지 않는다'가
                //   곧 '지금은 못 든다'라는 뜻이 되어야 한다.
                끔={() => !!로비.든것 || !!위에얹힌것(o.id)}
                실행={() => 집기(o.id)}
              />
              {/* 면 = 이 위에도 올릴 수 있다 · 자리 = 겹침 검사 · 재기 = 발자국 크기 */}
              <잰다
                id={o.id}
                /* ★ 위에 물건을 올릴 수 있는 건 윗면이 평평한 것만.
                     컵·모자·삼각 번호표의 상자 크기 윗면은 실제로는 뾰족하거나
                     둥글어서, 올릴 수 있게 하면 물건이 허공에 걸쳐 보인다. */
                면={
                  o.종류 === "노트북" ||
                  o.종류 === "서류" ||
                  o.종류 === "상자" ||
                  o.종류 === "수거품상자"
                }
                자리
                재기
                기준y={곳.y}
                다시재기={`${곳.x},${곳.y},${곳.z},${곳.rot},${o.v.개별크기 ?? o.v.크기 ?? 1},${MG.크기},${LP.크기},${EV.크기},${KB.크기},${KB.두께},${KB.깊이},${MS.크기}`}
              >
                <강조
                  id={`집기:${o.id}`}
                  색={HL.색}
                  세기={HL.세기}
                  확대={HL.커지기}
                  기준={() => {
                    const c = 놓인곳(o);
                    return [c.x, c.y, c.z];
                  }}
                >
                  {물건그리기(o, 곳)}
                </강조>
              </잰다>
            </group>
          );
        })}
      </Suspense>
      </group>

      {/* ── 손에 든 것과 미리보기는 '방 그룹' 밖에 둔다 ────────────
             방 그룹은 구역 최적화가 통째로 껐다 켠다. 안에 두면 복도로 나가는 순간
             들고 있던 컵이 화면에서 사라진다. */}
      <Suspense fallback={null}>
        {/* 계산은 보여주기와 분리 — 표시를 꺼도 놓기가 동작해야 한다 */}
        <놓을자리계산 물건id={로비.든것} />

        {로비.든것 && PV.유령보이기 && (
          <놓기유령
            가능색={PV.가능색}
            불가색={PV.불가색}
            투명도={PV.유령투명도}
          >
            {물건그리기(들물건.find((o) => o.id === 로비.든것))}
          </놓기유령>
        )}

        {로비.든것 && (
          <손에든것 물건id={로비.든것}>
            {물건그리기(들물건.find((o) => o.id === 로비.든것))}
          </손에든것>
        )}
      </Suspense>

      {로비치비테스트 && 치비설정 && (
        <Suspense fallback={null}>
          <LobbyChibi 보이기={삼인칭} 플레이어참조={플레이어참조} 설정={치비설정} 몸체={로비치비몸체} 툰={툰설정} 외곽선={외곽선설정} />
        </Suspense>
      )}
      {로비아바타테스트 && !로비치비테스트 && (
        <Suspense fallback={null}>
          <LobbySidekick
            보이기={삼인칭}
            플레이어참조={플레이어참조}
            설정={사이드킥설정}
          />
        </Suspense>
      )}

      {/* ══════════════════════════════════════════════════════
          소품 자리 — 나중에 GLB 모델을 여기에 배치한다.
          COLLIDERS의 AABB는 그대로 살아 있으므로 아래 좌표에 맞춰 넣으면 된다.

            벤치          : position [10.5, 0, 6]     (AABB x 8.5~12.5 / z 5.4~6.6)
            화분          : [-5, 0, -9.5] , [5, 0, -9.5]
            포스터        : 좌벽 [-23.6, 5, -8] , [-23.6, 5, 6] / 우벽 [23.6, 5, 8]
            키오스크      : 미정
            펜던트 조명   : [-8, ?, 0] , [8, ?, 0] , [0, ?, 6]
          ══════════════════════════════════════════════════════ */}

      {/* 후처리: 골드 악센트·우주·기포가 은은하게 번지도록.
          autoClear={false} — Outline이 선택 물체를 별도 레이어에 그리므로 필요. */}
      {/* ?fx=off 로 후처리를 통째로 뺄 수 있다.
          후처리는 화면 크기만 한 렌더타깃을 여러 장 잡아서, 내장 GPU에서 메모리 문제가
          의심될 때 가장 먼저 빼보는 대상이다. 기본값은 켜짐이라 평소엔 그대로다. */}
      {/* ★ 후처리(EffectComposer)와 시점 조작(PointerLockControls)은
             App(껍데기)로 옮겼다. 이유는 두 가지다.
             ① 마우스 잠금 — 여기 있으면 씬이 바뀔 때 컨트롤이 통째로 사라졌다가
                새로 생긴다. 그 순간 잠금이 풀려서 기차를 타고 내릴 때마다
                T 를 다시 눌러야 했다.
             ② 화면 톤 — 여기 있으면 역에만 블룸·비네트가 걸리고 기차 안에는
                안 걸려서, 같은 게임인데 두 곳의 분위기가 달라 보였다.
             껍데기에 두면 씬이 바뀌어도 그대로 유지된다. */}
    </>
  );
}

// ===== 최상위 (로직 변경 없음) =====
// ===== 실행 모드 =====


export default function App() {
  const controlsRef = useRef(null);
  // 지금 어떤 씬인지 — 주소로 정한다. /train 이면 기차 안.
  const 위치 = useLocation();
  const 이동하기 = useNavigate();
  const 기차안 = 위치.pathname === "/train";
  const [locked, setLocked] = useState(false);
  const [삼인칭, set삼인칭] = useState(로비아바타테스트);
  // 테스트 주소가 아니면 null 로 두어 아바타·패널 코드 자체를 건드리지 않는다.
  const [사이드킥설정, set사이드킥설정] = useState(() =>
    로비아바타테스트 && !로비치비테스트 ? 사이드킥외형읽기(로비외형저장키) : null,
  );
  const [치비설정, set치비설정] = useState(() =>
    로비치비테스트 ? 메시외형읽기(로비메시저장키) : null,
  );
  const [툰설정, set툰설정] = useState(() => ({ ...기본툰, 켬: !로비툰끄기 }));
  const [외곽선설정, set외곽선설정] = useState(() => ({ ...기본외곽선, 켬: !로비외곽선끄기 }));
  const 플레이어참조 = useRef({
    position: new THREE.Vector3(0, EYE, 12),
    footY: 0,
    groundY: 0,
    facing: Math.PI,
    moving: false,
    running: false,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
    attackSerial: 0,
    attackMotion: "Punch_Jab",
  });
  // 계기판 표시 여부 — Scene 안의 Leva 값은 껍데기에서 못 읽으므로 여기서 따로 만든다.
  // ★ 계기판 기본 꺼짐. 개발용이라 팀원 화면에도, 내 화면에도 평소엔 안 뜬다.
  //   필요하면 Leva 「성능(공통) → 계기판」 을 켜면 된다.
  const { 계기판: PF계기판 } = useSavedControls("성능(공통)", {
    계기판: false,
  });
  const [near, setNear] = useState("");
  // GPU가 그래픽 컨텍스트를 회수해 갔는지. 회수되면 캔버스가 통째로 검게 된다.
  const [GPU끊김, setGPU끊김] = useState(false);
  // 블랙박스는 그냥 객체라서 값이 바뀌어도 React가 모른다.
  //   1초에 한 번만 확인해서 상태로 옮긴다(매 프레임 확인하면 그게 더 비싸다).
  const [씬꺼짐, set씬꺼짐] = useState(false);
  // 지난번에 남은 기록이 있으면 처음 한 번만 띄운다
  // ★ '지난번 종료 직전 기록' 팝업은 자동으로 띄우지 않는다.
  //   블랙박스는 0.5초마다 저장하므로 정상 종료여도 기록이 남고,
  //   그러면 접속할 때마다 이 팝업이 떠서 거슬린다.
  //   기록 자체는 그대로 남겨 둔다 — 진짜 크래시(GPU 끊김 · 씬 꺼짐)가 나면
  //   그때 뜨는 경고 오버레이가 이 데이터를 쓴다.
  //   지난 기록을 직접 보고 싶으면 콘솔에서 __블랙박스.지난기록 을 치면 된다.
  const [지난기록보임, set지난기록보임] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      // 컨텍스트가 죽었으면 이벤트를 놓쳤더라도 여기서 잡는다
      if (블랙박스.컨텍스트손실) setGPU끊김(true);
      if (블랙박스.씬꺼짐) { set씬꺼짐(true); clearInterval(id); }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  // ── 씬 전환 (페이드 인·아웃) ────────────────────────────────
  // [왜 페이드를 넣나]
  //   씬이 통째로 바뀌는 순간 화면이 뚝 끊긴다. 사이에 검은 화면을 한 번 끼우면
  //   '문을 통과했다'로 읽히고, 새 씬이 첫 프레임을 그리는 짧은 시간도 가려진다.
  //   (PRD 전역-006 「세션 전환 연출 — 페이드로 로딩을 가린다 · 1초 이내」)
  //   여기 합계 = 어두워지기 260ms + 밝아지기 시작까지 120ms ≈ 0.4초.
  const [어둠, set어둠] = useState(0); // 0 = 투명, 1 = 완전 검정
  const 전환중 = useRef(false); // 연타로 두 번 전환되는 것을 막는다
  /**
   * 씬을 바꾼다.
   * @param 페이드 검은 막을 끼울지. **기차는 끼우지 않는다** — 아래 설명 참고.
   */
  const 씬전환 = useCallback(
    (경로, 준비, 페이드 = true) => {
      if (전환중.current) return;
      전환중.current = true;

      // ★ 페이드 없는 길 — 문을 통과하듯 그 자리에서 바로 바뀐다.
      //   Canvas 는 하나뿐이고 '안에 그릴 것'만 갈아 끼우므로(아래 씬 교체 주석)
      //   WebGL 컨텍스트가 다시 만들어지지 않는다 → 가릴 로딩이 애초에 없다.
      //   전환중 잠금만 남긴다. 문 앞에 서 있으면 near 가 계속 'train진입'이라
      //   잠금이 없으면 같은 프레임에 두 번 걸릴 수 있다.
      if (!페이드) {
        준비?.();
        이동하기(경로);
        setTimeout(() => {
          전환중.current = false;
        }, 250);
        return;
      }

      set어둠(1);
      setTimeout(() => {
        준비?.(); // 씬을 바꾸기 직전에 해 둘 일(잠금 걸기 등)
        이동하기(경로);
        setTimeout(() => {
          set어둠(0);
          전환중.current = false;
        }, 120);
      }, 260);
    },
    [이동하기],
  );
  // ── 기차는 페이드 없이 바로 넘어간다 ──────────────────────
  //   기차 문은 '문을 열고 들어가는' 동작이라 화면이 한 번 검어지면
  //   걸어 들어가던 흐름이 끊긴다. 로딩을 가릴 필요도 없다(같은 번들·같은 Canvas).
  //   ※ 페이드 자체는 남겨 뒀다 — 나중에 세션이 통째로 바뀌는 자리
  //     (PRD 전역-006)에서는 세 번째 인자를 빼고 부르면 그대로 쓸 수 있다.
  const 기차타기 = useCallback(
    () =>
      씬전환(
        "/train",
        () => {
          // 들고 있던 물건은 원래 자리에 두고 간다(GRD-01 되돌릴 수 있음).
          제자리로();
          // 끌던 의자도 그 자리에 두고 간다. 안 놓으면 기차에서 돌아왔을 때
          //   갑자기 의자가 다시 따라붙는다.
          의자놓기(끌기위치.x, 끌기위치.z);
        },
        false,
      ),
    [씬전환],
  );

  // 지금 보고 있는 자리에 내려놓는다. 겹치거나 면이 아니면 아무 일도 안 한다.
  const 놓기시도 = useCallback(() => {
    const r = 최근자리값();
    if (!r?.됨) return false;
    // 걸이 = 제자리로 되돌리기. 좌표를 적는 대신 덮어쓴 자리를 지운다 →
    //   그래야 옷걸이에 걸린 원래 모습(기울기까지)이 그대로 돌아온다.
    if (r.걸이) {
      제자리로();
      return true;
    }
    return 놓기({ x: r.x, y: r.y, z: r.z, rot: r.rot });
  }, []);
  const 기차내리기 = useCallback(
    () =>
      씬전환(
        "/",
        () => {
          // 내리자마자 다시 빨려 들어가지 않게 잠그고,
          // 역 씬이 '문 앞'에서 시작하도록 표시해 둔다.
          진입잠금.켬 = true;
          기차에서나옴.켬 = true;
        },
        false,
      ),
    [씬전환],
  );

  // 문 안으로 걸어 들어가면 키를 누르지 않아도 넘어간다.
  //   near 는 값이 바뀔 때만 갱신되므로 매 프레임 돌지 않는다.
  useEffect(() => {
    if (near === "train진입" && !기차안) 기차타기();
  }, [near, 기차안, 기차타기]);

  // ── 화면 위 창(소지품 등) ────────────────────────────────
  //   창을 열면 **마우스 잠금을 푼다** — 안 그러면 커서가 없어 칸을 못 고른다.
  //   닫으면 다시 잠가서 1인칭으로 돌아온다.
  const 열린창 = use열린층();
  // 창을 열기 직전에 마우스가 잠겨 있었나. 닫을 때 그 상태로 되돌린다.
  //   ★ 무조건 다시 잠그면 안 된다 — T 를 누른 적 없는 사람이 소지품만 열어 봤다가
  //     닫는 순간 갑자기 1인칭에 갇힌다.
  const 잠금복귀 = useRef(false);
  const 창열기 = useCallback((이름) => {
    잠금복귀.current = !!document.pointerLockElement;
    화면층.열기(이름);
    controlsRef.current?.unlock();
  }, []);
  const 창닫기 = useCallback(() => {
    화면층.닫기();
    if (잠금복귀.current) controlsRef.current?.lock();
  }, []);

  // ★★ 개발용 임시 물건 — **서버가 붙으면 지운다.** ★★
  //   지울 때는 `개발용_소지품씨앗` 으로 검색하면 관련 부분이 전부 나온다.
  //   실제로는 계약(v0.3.1)의 `clue_acquired` 상태 변경이 왔을 때 소지품.넣기() 를 부른다.
  //   조용히:true — 접속하자마자 창이 튀어나오지 않게. 서버 복원분도 이 길로 들어온다.
  useEffect(() => {
    소지품.넣기여러개(개발용_소지품씨앗, { 조용히: true });
  }, []);

  useEffect(() => {
    // Leva 숫자칸·색칸에 타이핑하는 중이면 게임 키로 먹지 않는다.
    //   ★ 이게 없으면 Leva 에서 색 코드에 'i' 를 치는 순간 소지품이 열린다.
    //     T·E 도 같은 문제라 여기서 한꺼번에 막는다.
    const 글씨입력중 = (t) =>
      !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

    const onKey = (e) => {
      if (글씨입력중(e.target)) return;

      // ESC — 열린 창이 있으면 그것부터 닫는다(CMN-035 우선순위).
      //   ※ 브라우저가 ESC 로 마우스 잠금을 먼저 푸는 건 막을 수 없다.
      //     창이 열려 있을 땐 이미 풀어 둔 상태라 부딪히지 않는다.
      if (e.code === "Escape") {
        if (열린창) 창닫기();
        return;
      }

      // I키 — 소지품. 열려 있으면 닫힌다.
      //   ★ **마우스 잠금(T)과 무관하게 연다.** 소지품은 월드 상호작용이 아니라
      //     화면 창이다. `locked` 를 조건으로 걸었더니 페이지를 열고 바로 I 를 누른
      //     사람에게는 아무 일도 안 일어났다(실제로 그렇게 막혔다).
      //     닫을 때도 마찬가지 — 창을 열며 잠금을 풀었으므로 그때 locked 는 이미 false 다.
      if (e.code === "KeyI") {
        if (열린창 === 층.소지품) 창닫기();
        else if (!열린창) 창열기(층.소지품);
        return;
      }

      // 창이 열려 있는 동안은 아래 게임 조작을 전부 막는다(입력 우선순위: 창 > 게임)
      if (열린창) return;

      if (e.code === "KeyV" && 로비아바타테스트 && !기차안) {
        set삼인칭((현재) => !현재);
        return;
      }

      // T키 — 1인칭 시작(마우스 잠금). 클릭 대신 키로 시작해 Leva를 자유롭게 만진다.
      if (e.code === "KeyT" && !locked) {
        controlsRef.current?.lock();
        return;
      }
      if (e.code !== "KeyE" || !locked) return;
      // ★ 순서는 화면 아래 안내문과 반드시 같아야 한다.
      //   ① 정면으로 겨냥한 것  ② 들고 있으면 놓기  ③ 문
      // 의자를 끌고 있으면 E 는 '놓기'다. 조준과 무관하게 우선한다 —
      //   끌던 의자가 화면 밖으로 나가 조준이 안 될 수도 있기 때문이다.
      if (끄는의자()) {
        의자놓기(끌기위치.x, 끌기위치.z);
        return;
      }
      if (상호실행()) return;
      if (놓기시도()) return;
      if (near === "train") 기차타기(); // 역 → 기차 안 ([E] 백업 경로)
      else if (near === "기차나가기") 기차내리기(); // 기차 안 → 역
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    near,
    locked,
    열린창,
    창열기,
    창닫기,
    기차타기,
    기차내리기,
    놓기시도,
    기차안,
  ]);

  useEffect(() => {
    if (!로비아바타테스트) return undefined;
    let 다음펀치 = "Punch_Jab";
    const 공격 = (e) => {
      if (e.button !== 0 || !locked || !삼인칭 || 기차안 || 열린창) return;
      const 상태 = 플레이어참조.current;
      상태.attackMotion = 다음펀치;
      상태.attackSerial += 1;
      다음펀치 = 다음펀치 === "Punch_Jab" ? "Punch_Cross" : "Punch_Jab";
    };
    window.addEventListener("mousedown", 공격);
    return () => window.removeEventListener("mousedown", 공격);
  }, [locked, 삼인칭, 기차안, 열린창]);

  // 창이 열려 있으면 이동·조준을 멈춘다.
  //   ※ 여기에 나중에 **타이머 정지**(GRD-07)도 같이 걸린다.
  const active = locked && !열린창;
  // 화면 안내 문구. 지금 남은 건 기차에서 내리기 하나뿐이다.
  // ── 화면 아래 안내문 ────────────────────────────────────
  // ★ 물건 조작 안내는 **글자를 쓰지 않는다.**
  //   겨냥한 물건이 스스로 살짝 커지고 빛나며(강조.jsx), 들고 있을 때는 놓일 자리에
  //   초록/빨강 유령이 뜬다. 시선이 물건에 가 있는데 화면 구석 글씨를 읽게 만들
  //   이유가 없다. 여기 남은 건 씬을 옮기는 안내 하나뿐이다 —
  //   그건 물건이 아니라 이동이라 빛낼 대상이 없다.
  // ★ 여기서 use로비상태() 를 부르면 안 된다.
  //   안내문이 로비 상태를 읽던 시절의 잔재였다. 값을 쓰지 않는데 구독만 남아 있어서,
  //   서랍을 한 번 열 때마다(4단계) App 이 통째로 다시 그려졌다 — Canvas 자식
  //   전체가 다시 조정되니 그 순간 프레임이 끊긴다. 씬(Scene)은 자기가 따로
  //   구독하고 있으므로 여기서는 구독하지 않는다.
  const hint = near === "기차나가기" ? "[E] 기차에서 내리기" : "";
  const 안내경고 = false;

  return (
    <div className="stage" style={{ position: "relative" }}>
      {/* Leva 패널 — 숫자 입력칸을 넓힌다.
          기본값(numberInputMinWidth 38px)은 '−12.3' 같은 값에서 뒷자리가 잘려
          캡처로 값을 옮길 때 소수점을 못 읽는다. 68px로 늘려 항상 다 보이게 한다. */}
      <Leva
        hidden={!LEVA보임}
        theme={{ sizes: { numberInputMinWidth: "68px" } }}
      />
      <Canvas
        /* 그림자 = 씬을 광원 시점에서 한 번 더 그리는 작업.
           끄면 드로우콜이 사실상 절반이 된다. 저사양에서 가장 큰 절약. */
        shadows={저사양 ? false : "percentage"}
        /* dpr = 픽셀 밀도. 2면 가로세로 2배 → 그릴 픽셀이 4배다.
           내장 GPU가 검게 죽는 원인 1순위가 이것. */
        dpr={저사양 ? 1 : [1, 2]}
        gl={{
          /* ★ 후처리(EffectComposer)를 쓰면 실제 그림은 컴포저의 렌더타깃에 그려지고
             캔버스는 그 결과를 받기만 한다. 그래서 캔버스 자체 MSAA는 효과가 없으면서
             메모리만 한 장 더 먹는다(3.6MP 기준 약 58MB). 중복이라 끈다.
             계단현상 제거는 컴포저의 multisampling 이 담당한다.
             후처리를 끈 경우(?fx=off)에만 캔버스 MSAA가 필요하다. */
          antialias: !저사양 && 후처리끄기,
          toneMappingExposure: 1.15,
          powerPreference: "high-performance", // 외장 GPU가 있으면 그쪽을 쓰게
        }}
        /* GPU가 컨텍스트를 회수하면 캔버스가 검게 죽는다.
           preventDefault() 를 불러야 브라우저가 '복구 가능'으로 처리한다.
           맥처럼 여유 있는 기기에서는 이 이벤트 자체가 안 일어난다. */
        onCreated={({ gl }) => {
          const 캔버스 = gl.domElement;
          캔버스.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setGPU끊김(true);
          });
          /* ★ 여기서 setGPU끊김(false) 를 하면 안 된다.
             브라우저는 컨텍스트가 끊기면 곧바로 'restored' 신호를 보내지만,
             three.js/R3F 는 그 시점에 씬을 다시 못 올린다 —
             텍스처·셰이더·버퍼가 전부 GPU에서 사라진 상태라 새로 만들어야 하는데
             R3F 는 그 재구축을 자동으로 해주지 않는다.
             그래서 '복구됐다'며 경고창을 지우면 검은 화면만 남는다.
             (실제로 팀원 컴퓨터에서 이 증상이 나왔다: 화면은 검은데 계기판은 멀쩡.
              드로우콜 숫자는 자바스크립트가 세는 값이라 GPU가 죽어도 계속 오른다.)
             → 복구 신호가 와도 경고창을 유지하고, 새로고침을 안내한다. */
          캔버스.addEventListener("webglcontextrestored", () => {
            블랙박스.복구시도 = true;
          });
        }}
        /* near/far 비율이 클수록 깊이 정밀도가 떨어져 면이 지글거린다.
           제일 먼 우주 판이 약 200 유닛이라 far는 400이면 충분하고, 플레이어 반경이
           0.6이라 near 0.25로 올려도 벽에 붙어서 잘리지 않는다.
           1:10000 → 1:1600 으로 좁혀 정밀도를 확보한다. */
        camera={{
          position: TOP_VIEW ? [-5, 34, 2] : [0, EYE, 12],
          fov: 60,
          near: 0.25,
          far: 400,
        }}
      >
        {/* 배경색은 Scene 안으로 옮겼다 — Leva 「기차 저편 공간 → 배경색」에서 조절.
            attach="background" 는 부모가 아니라 씬에 붙으므로 어디서 그려도 같다. */}
        {/* 계기판·선컴파일은 씬이 바뀌어도 살아 있어야 한다 → 껍데기 쪽에 둔다.
            (충돌 박스 보기는 역 씬 전용이라 Scene 안에 남겨 두었다) */}
        <Preload all />
        <성능계기판 보이기={PF계기판} />

        {/* ★ 씬 교체 — Canvas 는 하나만 두고 '안에 그릴 것'만 바꾼다.
               Canvas 를 통째로 갈아치우면 WebGL 컨텍스트가 새로 만들어져
               화면이 한 번 하얗게 번쩍이고 모델을 다시 올린다.
               내용만 바꾸면 그런 일이 없어서 '바로' 전환된 것처럼 보인다. */}
        {기차안 ? (
          <기차내부
            active={active}
            onNear={setNear}
            controlsRef={controlsRef}
            onLockChange={setLocked}
          />
        ) : (
          <Scene
            active={active}
            onNear={setNear}
            controlsRef={controlsRef}
            onLockChange={setLocked}
            삼인칭={로비아바타테스트 && 삼인칭}
            플레이어참조={로비아바타테스트 ? 플레이어참조 : null}
            사이드킥설정={사이드킥설정 ?? undefined}
            치비설정={치비설정 ?? undefined}
            툰설정={툰설정}
            외곽선설정={외곽선설정}
          />
        )}

        {/* 겨냥 판정 — 로비에서만 돈다. */}
        <겨냥판정 켬={active && !기차안} />

        {/* ═══ 씬이 바뀌어도 살아 있어야 하는 것들 ═══
            여기 두면 역 ↔ 기차 안을 오갈 때 다시 만들어지지 않는다. */}

        {/* 후처리 — 블룸·비네트. 두 씬에 똑같이 걸려야 같은 게임처럼 보인다.
            ?fx=off 로 통째로 끌 수 있다(내장 GPU 문제를 의심할 때 첫 번째로 빼 보는 것).
            multisampling 8 → 2, HalfFloat → UnsignedByte 로 낮춰 둔 이유는
            기본값 그대로면 렌더타깃 메모리가 460MB 를 넘어 내장 GPU가 죽기 때문이다. */}
        {!후처리끄기 && (
          <EffectComposer
            autoClear={false}
            multisampling={저사양 ? 0 : 후처리고품질 ? 8 : 2}
            frameBufferType={
              후처리고품질 ? THREE.HalfFloatType : THREE.UnsignedByteType
            }
          >
            <Bloom intensity={0.45} luminanceThreshold={0.85} mipmapBlur />
            <Vignette offset={0.36} darkness={0.28} />
          </EffectComposer>
        )}

        {/* 시점 조작 — ★ 여기 있어야 씬이 바뀌어도 마우스 잠금이 안 풀린다.
            selector 를 없는 요소로 지정 → 화면 클릭으로는 잠기지 않는다.
            시작은 T 키(위 keydown 에서 controlsRef.lock())로만 이뤄진다. */}
        {TOP_VIEW ? (
          <OrbitControls makeDefault target={[-5, 0, 0]} />
        ) : (
          <PointerLockControls
            ref={controlsRef}
            selector="#__never__"
            onLock={() => setLocked(true)}
            onUnlock={() => setLocked(false)}
          />
        )}
      </Canvas>
      {/* 씬 전환용 검은 막.
          pointerEvents:none — 화면을 덮지만 클릭·마우스는 그대로 통과시킨다.
          transition 으로만 움직이므로 자바스크립트가 매 프레임 개입하지 않는다. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#000",
          opacity: 어둠,
          transition: "opacity 260ms ease",
          pointerEvents: "none",
          zIndex: 50,
        }}
      />
      {/* 가운데 안내 텍스트 제거(요청) — 필요하면 이 블록 되살리면 된다.
      {!locked && (
        <div style={S.center}>
          [T] 시작 · WASD 이동 · Shift 달리기 · Space 점프 · C 앉기 · ESC
        </div>
      )} */}
      {/* 조준점 — 1인칭은 커서가 없으니 화면 한가운데가 커서다 */}
      {active && <div style={S.조준점} />}
      {로비아바타테스트 && !기차안 && (
        <button
          type="button"
          onClick={() => set삼인칭((현재) => !현재)}
          style={{
            position: "fixed",
            top: 14,
            // Leva 개발 패널(우측 약 280px) 뒤에 가려지지 않게 둔다.
            right: 300,
            zIndex: 60,
            padding: "8px 12px",
            border: "1px solid rgba(255,255,255,.24)",
            borderRadius: 8,
            background: "rgba(13,17,24,.82)",
            color: "#f4f6fb",
            font: "600 12px/1 system-ui, sans-serif",
            cursor: "pointer",
          }}
        >
          [V] {삼인칭 ? "1인칭" : "3인칭"}
        </button>
      )}
      {로비치비테스트 && !기차안 && 치비설정 && (
        <Suspense fallback={null}>
          <LobbyChibiPanel
            설정={치비설정}
            set설정={set치비설정}
            저장키={로비메시저장키}
            툰설정={툰설정}
            set툰설정={set툰설정}
            외곽선설정={외곽선설정}
            set외곽선설정={set외곽선설정}
          />
        </Suspense>
      )}
      {로비아바타테스트 && !기차안 && 사이드킥설정 && (
        <Suspense fallback={null}>
          <LobbySidekickPanel
            설정={사이드킥설정}
            set설정={set사이드킥설정}
            저장키={로비외형저장키}
            위치="left"
            위여백={14}
          />
        </Suspense>
      )}
      {active && hint && (
        <div style={안내경고 ? { ...S.hint, color: "#ffb4a8" } : S.hint}>
          {hint}
        </div>
      )}
      {/* 소지품 — 화면층이 '지금 열린 창'을 정하므로 두 창이 겹칠 수 없다 */}
      <소지품UI 열림={열린창 === 층.소지품} 닫기={창닫기} />
      {/* GPU가 죽었을 때만 뜬다. 검은 화면만 남으면 원인을 알 수 없으니 안내한다. */}
      {GPU끊김 && (
        <div style={S.끊김}>
          <div style={{ font: "700 20px/1.4 system-ui, sans-serif", color: "#ffb4a8" }}>
            GPU 연결이 끊어졌습니다
          </div>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 8, marginBottom: 14 }}>
            그래픽 드라이버가 브라우저와의 연결을 끊었습니다(컨텍스트 손실).
            <br />
            <strong>아래 기록을 캡처하거나 「기록 복사」를 눌러 개발자에게 보내주세요.</strong>
            <br />
            사고 직전 20초가 그대로 남아 있습니다.
          </div>
          {/* 사고 직전 기록 — 이게 원인을 가른다 */}
          <pre style={S.끊김기록}>{블랙박스.보고서()}</pre>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
            <button
              style={S.끊김버튼}
              onClick={() => {
                navigator.clipboard
                  .writeText(블랙박스.보고서())
                  .then(() => alert("복사됐습니다. 붙여넣어 보내주세요."))
                  .catch(() => alert("복사 실패 — 화면을 캡처해 주세요."));
              }}
            >
              기록 복사
            </button>
            <button
              style={S.끊김버튼}
              onClick={() => location.reload()}
            >
              새로고침
            </button>
            <button
              style={S.끊김버튼}
              onClick={() => {
                const u = new URL(location.href);
                u.searchParams.set("q", "low");
                location.href = u.toString();
              }}
            >
              가벼운 모드로 다시 열기
            </button>
          </div>
        </div>
      )}
      {/* 지난번에 죽은 기록이 남아 있으면 띄운다.
          탭이 통째로 죽으면 그 자리에선 아무것도 못 보여주므로, 다시 열었을 때 보여준다. */}
      {지난기록보임 && 블랙박스.지난기록 && (
        <div style={S.지난기록}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#ffd0a8" }}>
            지난번 종료 직전 기록이 남아 있습니다 · {블랙박스.지난기록.시각}
          </div>
          <pre style={S.끊김기록}>{블랙박스.지난기록.표}</pre>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              style={S.끊김버튼}
              onClick={() =>
                navigator.clipboard
                  .writeText(블랙박스.지난기록.표)
                  .then(() => alert("복사됐습니다. 붙여넣어 보내주세요."))
                  .catch(() => alert("복사 실패 — 화면을 캡처해 주세요."))
              }
            >
              기록 복사
            </button>
            <button
              style={S.끊김버튼}
              onClick={() => { 블랙박스.지우기(); set지난기록보임(false); }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* GPU는 멀쩡한데 그릴 게 사라진 경우 — 원인이 완전히 다르므로 따로 알린다 */}
      {!GPU끊김 && 씬꺼짐 && (
        <div style={S.씬꺼짐}>
          ⚠ 장면이 꺼졌습니다 (GPU는 정상) — 이 문구를 캡처해 주세요
        </div>
      )}
    </div>
  );
}

// ===== 스타일 (쿨 블루그레이 + 웜 골드) =====
const S = {
  끊김: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeContent: "center",
    textAlign: "center",
    gap: 4,
    background: "rgba(10,12,16,.92)",
    color: "#e8edf5",
    font: "600 17px/1.6 system-ui, -apple-system, sans-serif",
    zIndex: 50,
  },
  끊김기록: {
    font: "12px/1.45 ui-monospace, Menlo, monospace",
    textAlign: "left",
    color: "#cfe0f5",
    background: "rgba(0,0,0,.5)",
    border: "1px solid #35405222",
    borderRadius: 6,
    padding: "10px 12px",
    margin: 0,
    maxWidth: "min(760px, 92vw)",
    maxHeight: "46vh",
    overflow: "auto",
    whiteSpace: "pre",
  },
  지난기록: {
    position: "absolute",
    left: 12,
    top: 12,
    zIndex: 70,
    maxWidth: "min(780px, 94vw)",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid #5a3a2a",
    background: "rgba(20,14,10,.95)",
    color: "#f0dcc8",
    font: "13px/1.5 system-ui, -apple-system, sans-serif",
  },
  씬꺼짐: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 60,
    padding: "8px 14px",
    borderRadius: 6,
    background: "rgba(140,40,32,.92)",
    color: "#ffe2dd",
    font: "600 13px/1.4 system-ui, sans-serif",
    pointerEvents: "none",
  },
  끊김버튼: {
    marginTop: 18,
    padding: "10px 18px",
    borderRadius: 8,
    border: "1px solid #3a4557",
    background: "#1b2230",
    color: "#cfe0f5",
    font: "600 14px system-ui, sans-serif",
    cursor: "pointer",
  },
  조준점: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 5,
    height: 5,
    marginLeft: -2.5,
    marginTop: -2.5,
    borderRadius: "50%",
    background: "rgba(240,244,250,.55)",
    pointerEvents: "none",
  },
  center: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%,-50%)",
    color: "#EEF2F8",
    font: "15px sans-serif",
    background: "rgba(20,28,46,.55)",
    padding: "10px 16px",
    borderRadius: 10,
    pointerEvents: "none",
    textAlign: "center",
  },
  hint: {
    position: "absolute",
    left: "50%",
    bottom: 40,
    transform: "translateX(-50%)",
    color: "#2C3444",
    font: "600 15px sans-serif",
    background: P.gold,
    padding: "8px 16px",
    borderRadius: 20,
    pointerEvents: "none",
  },
};
