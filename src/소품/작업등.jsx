// 작업등.jsx — 비밀 복도 끝 「어둠 속의 배선」 퍼즐의 그림
//
// ═══════════════════════════════════════════════════════════════
//  이 퍼즐이 무엇인가
// ═══════════════════════════════════════════════════════════════
//   복도는 길이 85 인데 퍼즐은 한쪽 끝 3 m 안에 다 몰려 있고, 반대쪽 끝
//   30 유닛은 **깜깜하기만 하다.** 이 퍼즐은 그 어둠을 분위기가 아니라
//   **규칙**으로 쓴다.
//
//     ① 복도 끝 잔해 사이에 케이지 작업등이 굴러다닌다 → [E] 로 집는다.
//        들면 약한 배터리 불빛이 따라온다 (첫 번째 '밝혀짐')
//     ② 벽에 분기함이 세 곳 있다 → [E] 로 꽂는다.
//        형광등처럼 두어 번 깜빡이다 확 켜진다 (두 번째 '밝혀짐')
//     ③ 그 구간 벽·문에 분필 자국이 드러난다. **꽂아야만** 보인다 —
//        손에 든 배터리 불빛은 약해서 안 읽힌다. 이게 유일한 규칙이다.
//     ④ 램프는 하나뿐이라 한 번에 한 곳만 밝다 → 복도를 실제로 오간다.
//     ⑤ 자국 셋이 세 자리 번호를 이룬다. 자국마다 **몇 번째 칸인지**가
//        같이 적혀 있어, 읽은 순서가 아니라 적힌 순서로 맞춰야 한다.
//     ⑥ 끝문 옆 차단기함의 3칸 자물쇠를 연다 → 레버를 올린다 →
//        **복도 끝 구간 천장등이 전부 들어온다.** (마지막 '밝혀짐')
//
// ═══════════════════════════════════════════════════════════════
//  기존 코드와의 관계 — 무엇을 건드리고 무엇을 안 건드리나
// ═══════════════════════════════════════════════════════════════
//   · 기존 퍼즐 사슬(동전 → 자판기 → 힌트 → 자물쇠 → 소화전 → 배전반 → 밸브)은
//     **한 줄도 안 건드린다.** 이 퍼즐은 반대쪽 끝에서 따로 돈다.
//   · 기존 복도등 3개도 안 건드린다. ⑥에서 켜지는 등은 **내가 새로 놓는 등**이고,
//     같은 `복도등` 컴포넌트를 쓰므로 생김새가 완전히 같다.
//   · 자물쇠는 기존 `번호자물쇠`(자물쇠.jsx)를 그대로 쓴다. 번호잠금.js 의
//     자물쇠 상자는 Map(id별)이라 두 번째 자물쇠를 놓아도 첫 번째와 안 엉킨다.
//   · 문 여닫이도 기존 `여닫이.js` 를 id 로 쓴다.
//
//   되돌리기: `docs/비밀복도_구조와_되돌리기.md`

import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  TOON_GRADIENT,
  색밝기,
  만화선,
  makeRandom,
  그림자흔들기,
  상자합치기,
} from "../공용.jsx";
import { 상호대상, 손에든것 } from "../로비/겨냥판정.jsx";
import { 강조 } from "../로비/강조.jsx";
import { 여닫기, use열렸나, 덜컹값 } from "./여닫이.js";
import { 번호자물쇠 } from "./자물쇠.jsx";
import { use풀림 } from "./번호잠금.js";
import { 플레이어시점 } from "../공용.jsx";
import {
  분기함칸,
  작업등바닥자리,
  작업등집기,
  작업등꽂기,
  작업등놓기,
  차단기올리기,
  작업등곳,
  끝문해제하기,
  use작업등곳,
  use복도전원,
  use끝문해제,
  // ⟦스위치 안 퍼즐⟧ 선 연결
  선모양,
  선집기,
  선놓기,
  선꽂기,
  쥔선,
  선늘어짐,
  꽂힌선,
  꽂힌수,
  use쥔선,
  use꽂힘키,
  use배선맞나,
  작업등손찼나,
  // 비상 전원(절반) → 완전 전원
  완전전원,
  use완전전원,
  // ⟦분리수거 퍼즐⟧
  쓰레기목록,
  통이름,
  쓰레기곳,
  쓰레기줍기,
  쓰레기놓기,
  쓰레기버리기,
  든쓰레기,
  통에든수,
  쓰레기튄때,
  튄통,
  use든쓰레기,
  use쓰레기키,
  // ⟦그림 퍼즐⟧
  창스위치,
  창스위치토글,
  분리수거끝났나,
  통완료,
  흐른때,
  그림전원,
  use그림전원,
  use창스위치키,
  창수,
  막차사람,
} from "./작업등.js";

// ═══════════════════════════════════════════════════════════════
//  0. 자잘한 도구
// ═══════════════════════════════════════════════════════════════

// 여러 원시 지오메트리를 하나로 합친다.
//   ★ `상자합치기`(공용.jsx)는 박스 전용이다. 여기는 원통·토러스·구가 섞이므로
//     직접 합친다. 셋 다 **인덱스가 있는** 지오메트리라 섞어도 안전하다 —
//     인덱스 있는 것과 없는 것을 섞으면 mergeGeometries 가 null 을 돌려주고,
//     그 null 이 그대로 <mesh geometry> 에 들어가 화면이 통째로 검어진다
//     (자판기.jsx 에서 실제로 겪은 사고다).
function 쇠합치기(조각들) {
  const 것들 = [];
  for (const { 지오, 위치 = [0, 0, 0], 회전 = [0, 0, 0], 크기 } of 조각들) {
    if (!지오) continue;
    const g = 지오.clone();
    if (크기) g.scale(크기[0], 크기[1], 크기[2]);
    if (회전[0]) g.rotateX(회전[0]);
    if (회전[1]) g.rotateY(회전[1]);
    if (회전[2]) g.rotateZ(회전[2]);
    g.translate(위치[0], 위치[1], 위치[2]);
    것들.push(g);
  }
  if (!것들.length) return null;
  const 합 = 것들.length === 1 ? 것들[0] : mergeGeometries(것들, false);
  if (합 !== 것들[0]) for (const g of 것들) g.dispose();
  // ★ 합치기가 실패하면(null) 그대로 넘기지 않는다. 위 사고의 재발 방지.
  return 합 ?? null;
}

// ── 앞이 뚫린 함 몸통 ───────────────────────────────────────
// [★ 이것이 「그냥 네모 상자」·「안이 검정」의 진짜 원인이었다]
//   전에는 몸통을 **속 찬 상자 하나**(BoxGeometry)로 두고, 콘센트·차단기·
//   스위치를 그 상자 **안쪽 좌표**에 넣었다. 속 찬 상자 안에 든 것은
//   당연히 **하나도 안 보인다.** 그래서 분기함은 검은 덩어리였고(사용자:
//   「그냥 네모 상자라 이상해」), 차단기함은 열어도 캄캄했다(「안에 열었는데
//   그냥 검정으로만 보이고 스위치도 안 보이고」). 부품이 보였던 것은
//   상자 앞면을 **뚫고 나온 것들**뿐이었다.
//
// [고침]  뒤판 + 테두리 네 벽을 **한 덩어리로 합쳐** 앞이 뚫린 함을 만든다.
//   속에 넣은 것이 그대로 보이고, 벽 두께가 개구부에 드러나 「깊이 있는 함」이 된다.
//
// [왜 합치나]  얇은 판 다섯 장을 따로 두고 `<Outlines>`(뒤집힌 껍데기)를 두르면
//   껍데기가 판보다 두꺼워져 **보는 각도마다 테두리가 따로 떠 보인다.**
//   한 덩어리로 합치면 실루엣이 하나라 그 일이 없다.
//
// [좌표]  뒤판이 x=0, 개구부가 x = 방향·깊이 다. 속 부품은 **뒤판에서부터** 잰다.
function 함몸통지오({ 깊이, 높이, 폭, 벽두께 = 0.05, 방향 = 1 }) {
  const d = 방향;
  const 안높이 = Math.max(0.02, 높이 - 벽두께 * 2);
  return 쇠합치기([
    { 지오: new THREE.BoxGeometry(벽두께, 높이, 폭), 위치: [d * (벽두께 / 2), 0, 0] },
    { 지오: new THREE.BoxGeometry(깊이, 벽두께, 폭), 위치: [d * (깊이 / 2), (높이 - 벽두께) / 2, 0] },
    { 지오: new THREE.BoxGeometry(깊이, 벽두께, 폭), 위치: [d * (깊이 / 2), -(높이 - 벽두께) / 2, 0] },
    { 지오: new THREE.BoxGeometry(깊이, 안높이, 벽두께), 위치: [d * (깊이 / 2), 0, (폭 - 벽두께) / 2] },
    { 지오: new THREE.BoxGeometry(깊이, 안높이, 벽두께), 위치: [d * (깊이 / 2), 0, -(폭 - 벽두께) / 2] },
  ]);
}

// ── 형광등이 켜지는 모양 ────────────────────────────────────
// [왜 그냥 켜면 안 되나]
//   전원을 넣자마자 100% 로 켜면 「스위치」지 「오래 방치된 폐역의 전기」가 아니다.
//   실제 형광등은 방전이 잡힐 때까지 두어 번 껌뻑인다. 그 1초가 이 퍼즐에서
//   가장 기분 좋은 1초라, 값을 아껴 쓰지 않고 곡선으로 적어 둔다.
// [값의 뜻]  [시각(초), 밝기] — 그 사이는 계단이다(형광등은 서서히 안 밝아진다).
const 점등곡선 = [
  [0.0, 0],
  [0.08, 0.85],
  [0.16, 0.05],
  [0.3, 0],
  [0.42, 1],
  [0.52, 0.1],
  [0.6, 0.35],
  [0.72, 1],
];
const 점등밝기 = (t) => {
  if (t >= 점등곡선[점등곡선.length - 1][0]) return 1;
  for (let i = 점등곡선.length - 1; i >= 0; i--)
    if (t >= 점등곡선[i][0]) return 점등곡선[i][1];
  return 0;
};

// ═══════════════════════════════════════════════════════════════
//  1. 캔버스 그림 — 분기함 라벨 · 분필 자국
// ═══════════════════════════════════════════════════════════════
// 글자는 폴리곤으로 깎지 않는다. 비싸기만 하고 안 예쁘다(벽함 라벨과 같은 원칙).
const 표지폰트 = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
const _라벨캐시 = new Map();
const _자국캐시 = new Map();

/** 분기함에 붙은 작은 명판 — 「A-1 / 조명분기」 */
function 분기라벨텍스처(글 = "A-1", 바탕 = "#aeb6bd", 선색 = "#131314", 때 = 1) {
  const 키 = `${글}|${바탕}|${선색}|${때}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 256,
    H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = 바탕;
  g.fillRect(0, 0, W, H);
  // 툰 테두리를 **그림 안에** 그린다 — 주변 물체의 외곽선과 굵기가 맞아야 한다
  g.strokeStyle = 선색;
  g.lineWidth = 9;
  g.strokeRect(4.5, 4.5, W - 9, H - 9);
  g.fillStyle = 선색;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold 62px ${표지폰트}`;
  g.fillText(글, W / 2, H * 0.38);
  g.font = `26px ${표지폰트}`;
  g.fillText("조명분기", W / 2, H * 0.76);
  // 낡음 — 새 표지판은 이 세계에 없다
  const rnd = makeRandom(글.charCodeAt(0) * 31 + 7);
  g.globalAlpha = 0.25 * 때;
  for (let i = 0; i < 26 * 때; i++) {
    g.fillStyle = rnd() > 0.5 ? "#2b2a25" : "#efe6c8";
    const x = rnd() * W,
      y = rnd() * H,
      w = 2 + rnd() * 26,
      h = 1 + rnd() * 4;
    g.fillRect(x, y, w, h);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _라벨캐시.set(키, t);
  return t;
}

/** 비상문 해제 버튼 명판 — 「무엇을 누르는 것인가」를 글자로 적는다.
 *
 * [왜 글자를 넣나]
 *   붉은 버튼만 벽에 붙여 두면 「이 빨간 스위치는 뭐야」가 된다(사용자 지적).
 *   복도의 다른 함들(소화전·배전반)은 전부 라벨이 있어서, 이것만 없으면
 *   같은 세계의 물건으로도 안 읽힌다. 실물 비상문 개방 버튼도 반드시 명판이 있다. */
function 해제라벨텍스처(바탕 = "#b5443a", 글자색 = "#f4f6f8", 때 = 1) {
  const 키 = `해제|${바탕}|${글자색}|${때}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 256, H = 96;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = 바탕;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#131314";
  g.lineWidth = 7;
  g.strokeRect(3.5, 3.5, W - 7, H - 7);
  g.fillStyle = 글자색;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold 46px ${표지폰트}`;
  g.fillText("비상문 개방", W / 2, H * 0.44);
  g.font = `22px ${표지폰트}`;
  g.fillText("EMERGENCY DOOR RELEASE", W / 2, H * 0.79);
  const rnd = makeRandom(41);
  g.globalAlpha = 0.22 * 때;
  for (let i = 0; i < 20 * 때; i++) {
    g.fillStyle = rnd() > 0.5 ? "#2b2a25" : "#efe6c8";
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 18, 1 + rnd() * 3);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _라벨캐시.set(키, t);
  return t;
}

/** 차단기함 속 회로 표찰 — 칸마다 무슨 회로인지 적힌 흰 띠 */
function 회로표찰텍스처(때 = 1) {
  const 키 = `회로띠|${때}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 512, H = 44;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#d8dce0";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#2a2d31";
  g.lineWidth = 2;
  g.fillStyle = "#1b1d21";
  // 실물 회로 명판의 글씨는 **띠 높이의 절반**쯤이다. 꽉 채우면 표지판이 된다.
  g.font = `bold 20px ${표지폰트}`;
  g.textBaseline = "middle";
  const 칸 = ["조명", "동력", "예비", "본선", "접지", "예비"];
  const N = 칸.length;
  for (let i = 0; i < N; i++) {
    const x = (W / N) * i;
    g.strokeRect(x + 1, 1, W / N - 2, H - 2);
    g.textAlign = "center";
    g.fillText(칸[i], x + W / N / 2, H / 2 + 1);
  }
  const rnd = makeRandom(77);
  g.globalAlpha = 0.2 * 때;
  for (let i = 0; i < 16 * 때; i++) {
    g.fillStyle = "#4a443a";
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 14, 1 + rnd() * 2);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _라벨캐시.set(키, t);
  return t;
}

/**
 * 분필 자국 — 「칸 번호」와 「글자」를 같이 적는다.
 *
 * [왜 칸 번호를 같이 적나]
 *   자국 셋을 **읽은 순서대로** 넣으면 되는 퍼즐은 사실 퍼즐이 아니다
 *   (어느 분기함부터 꽂든 답이 되니까). 자국마다 「몇 번째 칸」인지가 적혀
 *   있어야 플레이어가 **읽고 판단**한다. 관찰형 퍼즐의 최소 조건이다.
 *
 * [왜 알파(투명) 텍스처인가]
 *   벽에 판을 덧대는 게 아니라 **벽에 그려진 것**으로 보여야 한다.
 *   바탕을 투명하게 두고 자국만 남긴다.
 */
function 분필자국텍스처(칸번호 = 1, 글자 = "V", 색 = "#dfe6ea", 씨 = 3) {
  const 키 = `${칸번호}|${글자}|${색}|${씨}`;
  if (_자국캐시.has(키)) return _자국캐시.get(키);
  const W = 256,
    H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const rnd = makeRandom(씨 * 977 + 칸번호);

  // ── 분필은 선이 고르지 않다 ──
  //   같은 글자를 **조금씩 어긋나게 여러 번** 겹쳐 그으면 손으로 그은 티가 난다.
  //   한 번만 그으면 폰트를 찍어 놓은 것으로 보인다.
  const 겹쳐쓰기 = (그리기, 번 = 3) => {
    for (let i = 0; i < 번; i++) {
      g.save();
      g.translate((rnd() - 0.5) * 3.2, (rnd() - 0.5) * 3.2);
      g.rotate((rnd() - 0.5) * 0.012);
      g.globalAlpha = 0.34 + rnd() * 0.3;
      그리기();
      g.restore();
    }
  };

  g.strokeStyle = 색;
  g.fillStyle = 색;
  g.lineCap = "round";
  g.lineJoin = "round";

  // 글자 — 크게, 가운데
  겹쳐쓰기(() => {
    g.font = `bold 150px ${표지폰트}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(글자, W / 2, H * 0.44);
  }, 4);

  // 칸 번호 — 글자 아래 작은 네모 안에. 「몇 번째 칸」이라는 뜻이 읽혀야 한다
  겹쳐쓰기(() => {
    g.lineWidth = 5;
    g.strokeRect(W / 2 - 34, H * 0.7 - 26, 68, 52);
    g.font = `bold 44px ${표지폰트}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(칸번호), W / 2, H * 0.7);
  }, 3);

  // 분필 가루 — 자국 둘레에 흩뿌린다. 이게 있어야 '그은 것'으로 보인다
  g.globalAlpha = 1;
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 50 + rnd() * 90;
    g.globalAlpha = 0.05 + rnd() * 0.16;
    g.fillRect(
      W / 2 + Math.cos(a) * r,
      H * 0.5 + Math.sin(a) * r,
      1 + rnd() * 2,
      1 + rnd() * 2,
    );
  }
  g.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _자국캐시.set(키, t);
  return t;
}

// ═══════════════════════════════════════════════════════════════
//  2. 케이지 작업등
// ═══════════════════════════════════════════════════════════════
// [치수]  복도 눈높이가 4.15 유닛 ≈ 1.25 m 이므로 **1 m ≈ 3.32 유닛**이다.
//   실물 작업등이 길이 35 cm · 지름 12 cm 이니 여기서는 길이 1.16 · 지름 0.4.
//   원점은 **전구 한가운데**에 둔다 — 빛이 나오는 자리가 원점이어야
//   손에 들 때도 꽂을 때도 「빛의 위치」를 따로 계산하지 않는다.
export function 작업등모양({
  크기 = 1,
  쇠색 = "#8d949c",
  고무색 = "#2b2e33",
  전구색 = "#fff6d8",
  켜짐 = 0, // 0~1. 전구의 발광 세기
  // 꺼져 있을 때 유리알이 남기는 아주 작은 반짝임. 깜깜한 복도에서
  //   「저기 뭔가 있다」를 만드는 유일한 단서라, 0 이면 램프를 못 찾는다.
  바닥반짝 = 0,
  선,
}) {
  const 쇠 = useMemo(() => {
    const 조각 = [];
    // ① 걸이 고리 — 분기함 고리에 걸리는 부분
    조각.push({
      지오: new THREE.TorusGeometry(0.085, 0.017, 8, 20),
      위치: [0, 0.62, 0],
      회전: [Math.PI / 2, 0, 0],
    });
    // ② 갓(반사판) — 아래로 벌어진 원뿔대. 이게 램프의 실루엣을 만든다
    조각.push({
      지오: new THREE.CylinderGeometry(0.1, 0.22, 0.26, 20, 1, true),
      위치: [0, 0.2, 0],
    });
    // ②-1 갓 테두리 — 얇은 링 하나로 아가리를 닫는다(뚫린 원뿔은 종이처럼 보인다)
    조각.push({
      지오: new THREE.TorusGeometry(0.22, 0.014, 6, 24),
      위치: [0, 0.07, 0],
      회전: [Math.PI / 2, 0, 0],
    });
    // ③ 케이지 링 2개
    조각.push({
      지오: new THREE.TorusGeometry(0.2, 0.012, 6, 22),
      위치: [0, -0.1, 0],
      회전: [Math.PI / 2, 0, 0],
    });
    조각.push({
      지오: new THREE.TorusGeometry(0.15, 0.012, 6, 22),
      위치: [0, -0.3, 0],
      회전: [Math.PI / 2, 0, 0],
    });
    // ④ 세로살 6개 — 갓 테두리에서 밑 캡까지, 안쪽으로 조금 기울여 건다
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r0 = 0.215,
        r1 = 0.1;
      const x0 = Math.cos(a) * r0,
        z0 = Math.sin(a) * r0;
      const x1 = Math.cos(a) * r1,
        z1 = Math.sin(a) * r1;
      const 시작 = new THREE.Vector3(x0, 0.07, z0);
      const 끝 = new THREE.Vector3(x1, -0.4, z1);
      const 길 = new THREE.Vector3().subVectors(끝, 시작);
      const g = new THREE.CylinderGeometry(0.011, 0.011, 길.length(), 5, 1);
      // 원통은 Y축이라, 방향 벡터에 맞춰 눕힌다
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        길.clone().normalize(),
      );
      g.applyQuaternion(q);
      g.translate(
        (시작.x + 끝.x) / 2,
        (시작.y + 끝.y) / 2,
        (시작.z + 끝.z) / 2,
      );
      조각.push({ 지오: g });
    }
    // ⑤ 밑 캡 — 살 여섯 개가 모이는 자리
    조각.push({
      지오: new THREE.SphereGeometry(0.075, 12, 8),
      위치: [0, -0.42, 0],
      크기: [1, 0.6, 1],
    });
    return 쇠합치기(조각);
  }, []);
  useEffect(() => () => 쇠 && 쇠.dispose(), [쇠]);

  // ★ 고무 코드는 **없앴다.**
  //   전에는 갓 옆에서 코드가 늘어져 나왔다. 「꽂아 쓰는 물건」을 말하려던 것인데,
  //   실제로는 바닥에 굴러다닐 때도 들고 다닐 때도 선이 허공에 떠서 지저분했다
  //   (사용자 지적: 「전등 그냥 선은 없이 전등만 있어야 돼」).
  //   충전식 케이지 램프로 읽히면 되고, 꽂는 자리는 분기함의 콘센트가 말해 준다.

  return (
    <group scale={크기}>
      {쇠 && (
        <mesh geometry={쇠} castShadow>
          <meshToonMaterial color={쇠색} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={쇠} 선={선} /> : null}
          <Outlines thickness={3} color="#141518" />
        </mesh>
      )}
      {/* ⑥ 고무 손잡이 — 쇠와 색이 달라 따로 둔다(합치면 한 색이 된다) */}
      <mesh position={[0, 0.44, 0]} castShadow>
        <cylinderGeometry args={[0.072, 0.078, 0.3, 14]} />
        <meshToonMaterial color={고무색} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={3} color="#141518" />
      </mesh>
      {/* ⑦ 전구 — 원점. toneMapped=false 라 1을 넘기면 화면에서 하얗게 탄다.
             꺼져 있을 때도 유리 알맹이는 보여야 한다(아주 어두운 회백색). */}
      <mesh>
        <sphereGeometry args={[0.115, 16, 12]} />
        <meshBasicMaterial
          color={new THREE.Color(전구색).multiplyScalar(
            0.18 + 바닥반짝 + 켜짐 * 1.5,
          )}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  3. 벽에 붙은 분기함 — **꽂는 자리**로 읽혀야 한다
// ═══════════════════════════════════════════════════════════════
// [무엇이 잘못됐었나 — 사용자 지적 「그냥 네모 상자라 이상해」]
//   전에는 상자 + 안쪽 어두운 판 + 작은 구멍 둘이 전부였다. 어두운 복도에서
//   보면 **검은 상자 하나**다. 「여기에 뭘 꽂는다」가 어디에도 없었다.
//
// [무엇을 바꿨나 — 꽂는 자리의 세 가지 신호]
//   ① 테두리   개구부 둘레에 밝은 금속 테를 두른다. 「열린 구멍」이 생긴다.
//   ② 콘센트   밝은 면판 위에 **원형 산업용 콘센트**(구멍 셋)를 앉힌다.
//              네모 슬롯 둘은 몇 m 밖에서 얼룩으로 뭉개진다 — 둥근 것이 읽힌다.
//   ③ 걸이 고리 램프가 **실제로 걸리는** 자리라 크고 밝게, 앞으로 내민다.
//              램프가 이 고리에 매달리므로 자리는 예전 값 그대로 둔다
//              (`깊이*0.62`, `높이*0.34` — 작업등퍼즐의 램프자리 계산과 짝이다).
//   ④ 전선관   함 위에서 천장 트레이로 올라가는 관. 「전기가 들어오는 함」이
//              한눈에 읽히고, 복도 천장 배관과 같은 계열이라 따로 놀지 않는다.
//
// [★ 속은 어둠에 묻히면 안 된다]
//   구간 어둠(어둠계수 0.14)을 그대로 곱하면 콘센트가 새까매서 못 찾는다.
//   **꽂는 자리에만** 밝기 하한을 둔다 — 상용 게임이 상호작용 지점을 늘
//   읽히게 두는 것과 같다. 벽은 그대로 어둡다.
function 분기함({
  위치,
  방향 = 1, // +1 이면 함이 +x(복도 안)를 향한다
  폭 = 0.5,
  높이 = 0.66,
  깊이 = 0.24,
  몸통색 = "#3f444b",
  뚜껑색 = "#565c64",
  면판색 = "#8d959e", // ★ 밝은 강철 — 어두운 속에서 콘센트가 읽히려면 여기가 밝아야 한다
  라벨색 = "#aeb6bd", // ★ 놋쇠/노랑 금지 — 무광 강철 명판
  글 = "A-1",
  때 = 1,
  밝기 = 1,
  꽂힘 = false, // 지금 이 함에 램프가 꽂혀 있나 — 표시등이 초록으로 산다
  천장높이 = null, // 주면 전선관이 천장까지 올라간다
  선,
}) {
  const d = 방향;
  const 라벨텍 = 분기라벨텍스처(글, 라벨색, "#131314", 때);
  // 꽂는 자리는 어둠에 안 묻힌다(위 머리말)
  const 속밝기 = Math.max(0.6, 밝기);
  const 벽두께 = 0.04;
  // 속 부품 자리 — 전부 **뒤판(x=0)에서부터** 잰다(함몸통지오 주석)
  const 면판x = 벽두께 + 0.035;
  const 콘센트x = 벽두께 + 0.075;

  // ★ 뚜껑은 **두께 0.08 + 모서리 선(만화선)**이다. 얇은 판에 `<Outlines>` 를
  //   두르면 보는 각도마다 테두리가 따로 떠 보인다(함몸통지오 주석과 같은 이유).
  const 뚜껑지오 = useMemo(() => new THREE.BoxGeometry(0.08, 높이, 폭), [높이, 폭]);
  const 몸통지오 = useMemo(
    () => 함몸통지오({ 깊이, 높이, 폭, 벽두께, 방향: d }),
    [깊이, 높이, 폭, d],
  );
  useEffect(
    () => () => {
      뚜껑지오.dispose();
      몸통지오?.dispose();
    },
    [뚜껑지오, 몸통지오],
  );

  // 전선관 — 함 위에서 천장으로. 길이를 모르면 안 그린다.
  const 관길이 = 천장높이 != null ? Math.max(0.3, 천장높이 - (위치[1] + 높이 / 2) - 0.1) : 0;

  return (
    <group position={위치}>
      {/* ① 몸통 — **앞이 뚫린 함.** 속에 넣은 것이 그대로 보인다 */}
      {몸통지오 && (
        <mesh geometry={몸통지오} castShadow receiveShadow>
          <meshToonMaterial color={색밝기(몸통색, 밝기)} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={몸통지오} 선={선} /> : null}
          <Outlines thickness={3} color="#131416" />
        </mesh>
      )}

      {/* ② 뒤판 위의 면판 — 밝은 강철판. 콘센트가 여기 앉는다 */}
      <mesh position={[d * 면판x, -높이 * 0.06, 0]}>
        <boxGeometry args={[0.022, 높이 * 0.52, 폭 * 0.68]} />
        <meshToonMaterial color={색밝기(면판색, 속밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 면판 나사 네 개 — '붙여 놓은 판'으로 읽히게 */}
      {[-1, 1].map((sy) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`나사${sy}${sz}`}
            position={[d * (면판x + 0.014), -높이 * 0.06 + sy * 높이 * 0.2, sz * 폭 * 0.27]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.013, 0.013, 0.012, 8]} />
            <meshToonMaterial color={색밝기("#5f666e", 속밝기)} gradientMap={TOON_GRADIENT} />
          </mesh>
        )),
      )}

      {/* ③ 원형 산업용 콘센트 — **꽂는 자리 그 자체.**
             어두운 테 + 밝은 속 + 구멍 셋. 멀리서도 '콘센트'로 읽힌다. */}
      <group position={[d * 콘센트x, -높이 * 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.094, 0.094, 0.028, 20]} />
          <meshToonMaterial color={색밝기("#23262b", 속밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0f1012" />
        </mesh>
        <mesh position={[0, d * 0.017, 0]}>
          <cylinderGeometry args={[0.073, 0.073, 0.01, 20]} />
          <meshToonMaterial color={색밝기("#c2cad2", 속밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
        {/* 구멍 셋 — 위 둘(전원) + 아래 하나(접지). 실물 3P 배치다 */}
        {[
          [0.033, 0.027],
          [-0.033, 0.027],
          [0, -0.039],
        ].map(([hx, hz], i) => (
          <mesh key={`구멍${i}`} position={[hx, d * 0.023, hz]}>
            <cylinderGeometry args={[0.016, 0.016, 0.012, 10]} />
            <meshBasicMaterial color="#07080a" toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* ④ 표시등 — 전기가 흐르면 초록. 꽂기 전에는 죽은 회색 */}
      <mesh position={[d * (벽두께 + 0.05), 높이 * 0.31, 폭 * 0.26]}>
        <sphereGeometry args={[0.026, 10, 8]} />
        <meshBasicMaterial color={꽂힘 ? "#7dffa8" : "#39413c"} toneMapped={false} />
      </mesh>

      {/* ⑤ 걸이 고리 — 램프가 **여기 걸린다.** 함 **앞으로 내밀어** 단다.
             속에 두면 램프가 함 벽에 끼어 반쯤 파묻힌다(실제로 그랬다). */}
      <group position={[d * (깊이 + 0.05), 높이 * 0.34, 0]}>
        {/* 고리를 함에 붙드는 팔 */}
        <mesh position={[-d * 0.035, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.026, 0.09, 10]} />
          <meshToonMaterial color={색밝기("#7f878f", 속밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <torusGeometry args={[0.058, 0.015, 8, 20]} />
          <meshToonMaterial color={색밝기("#aab2ba", 속밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#131416" />
        </mesh>
      </group>

      {/* ⑧ 뚜껑 — 옆으로 젖혀져 열려 있다. 닫힌 함은 「꽂는 자리」로 안 읽힌다.
             ★ 명판은 **뚜껑 바깥면 한가운데**에 여백을 두고 붙인다. 전에는
               폭의 0.72 배를 함 모서리 가까이 붙여서 **글자가 잘려 보였다**
               (사용자 지적 「옆에 글씨가 잘려있어」). 0.56 배로 줄이고 가운데로. */}
      <group position={[d * (깊이 + 0.01), 0, -폭 / 2]} rotation={[0, d * -1.9, 0]}>
        <mesh geometry={뚜껑지오} position={[0, 0, 폭 / 2]} castShadow>
          <meshToonMaterial color={색밝기(뚜껑색, 밝기)} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={뚜껑지오} 선={선} /> : null}
        </mesh>
        <mesh
          position={[-0.042 * d, 0, 폭 / 2]}
          rotation={[0, d > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
        >
          <planeGeometry args={[폭 * 0.56, 폭 * 0.56 * (128 / 256)]} />
          <meshBasicMaterial map={라벨텍} toneMapped={false} transparent />
        </mesh>
      </group>

      {/* ⑨ 전선관 — 함 위에서 천장 트레이로. 「전기가 들어온다」를 말한다 */}
      {관길이 > 0 && (
        <>
          <mesh position={[d * (깊이 * 0.5), 높이 / 2 + 관길이 / 2, 0]}>
            <cylinderGeometry args={[0.032, 0.032, 관길이, 8]} />
            <meshToonMaterial color={색밝기("#4a4f56", 밝기)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
          {/* 관이 함으로 들어가는 자리의 조임쇠 */}
          <mesh position={[d * (깊이 * 0.5), 높이 / 2 + 0.03, 0]}>
            <cylinderGeometry args={[0.046, 0.046, 0.05, 8]} />
            <meshToonMaterial color={색밝기("#666d75", 밝기)} gradientMap={TOON_GRADIENT} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  4. 드러나는 분필 자국
// ═══════════════════════════════════════════════════════════════
//   벽·문에 그려진 것처럼 보여야 하므로 **벽에서 아주 살짝 띄운 평면**이다.
//   `세기`(0~1)가 곧 투명도다 — 그 구간이 밝을 때만 읽힌다.
function 분필자국({ 위치, 회전, 크기 = 0.9, 칸번호, 글자, 색, 씨, 세기참조 }) {
  const 메시 = useRef(null);
  const 텍 = 분필자국텍스처(칸번호, 글자, 색, 씨);
  useFrame(() => {
    const o = 메시.current;
    if (!o) return;
    const v = 세기참조.current;
    o.material.opacity = v;
    // ★ 안 보일 때는 **메시째** 끈다. 투명 재질은 그릴 때 정렬 비용이 붙으므로,
    //   opacity 0 으로 두고 계속 그리는 것보다 아예 빼는 쪽이 싸다.
    o.visible = v > 0.01;
  });
  return (
    <mesh ref={메시} position={위치} rotation={회전} visible={false}>
      <planeGeometry args={[크기, 크기]} />
      <meshBasicMaterial
        map={텍}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── 한 단어 힌트 — 누가 매직으로 휘갈겨 둔 낙서 ─────────────────
// [왜 한 단어인가 — 사용자 지적 「시험반 이런 거 빼고 단어로 힌트 주듯이」]
//   「객차 조명 시험반 · 창 1·2·3·4·5」「끝 모양에 맞는 자리에 꽂아라」처럼 **하라는 것을
//   다 적어 두면** 퍼즐이 설명서가 된다. 먼저 이곳을 지나간 누군가가 남긴 한 단어면
//   충분하다 — 무엇을 봐야 하는지만 던지고, 어떻게 하는지는 플레이어가 잇는다.
// [글꼴]  나눔손글씨 엉겅퀴(fonts.css). 캔버스는 글꼴이 **다 받아진 뒤에** 그려야
//   손글씨가 된다 — 먼저 대체 글꼴로 그려 두고, 받아지면 다시 그린다.
const _힌트캐시 = new Map();
function 손글씨텍스처(글, 색 = "#e9e2cf") {
  const 키 = `${글}|${색}`;
  if (_힌트캐시.has(키)) return _힌트캐시.get(키);
  const W = 512, H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const 그리기 = () => {
    g.clearRect(0, 0, W, H);
    const rnd = makeRandom(글.length * 131 + 글.charCodeAt(0));
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.06);
    g.fillStyle = 색;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `170px "엉겅퀴", ${표지폰트}`;
    // 두 번 겹쳐 쓴다 — 매직이 한 번에 고르게 안 나온 자국
    for (let i = 0; i < 2; i++) {
      g.globalAlpha = i ? 0.45 : 0.9;
      g.fillText(글, (rnd() - 0.5) * 4, (rnd() - 0.5) * 4);
    }
    // 밑줄 — 휙 긋는다
    g.globalAlpha = 0.7;
    g.strokeStyle = 색;
    g.lineWidth = 6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-글.length * 60, 78);
    g.quadraticCurveTo(0, 92, 글.length * 64, 70);
    g.stroke();
    g.restore();
    t.needsUpdate = true;
  };
  그리기();
  if (typeof document !== "undefined" && document.fonts?.load)
    document.fonts.load(`170px "엉겅퀴"`, 글).then(그리기).catch(() => {});
  _힌트캐시.set(키, t);
  return t;
}

/** 벽·판에 휘갈겨 둔 한 단어. 밝기를 따라 어두워진다(어둠 속에서 혼자 뜨지 않게) */
function 힌트글({ 글, 위치, 회전, 크기 = 0.9, 색, 밝기 = 1 }) {
  const 텍 = 손글씨텍스처(글, 색);
  return (
    <mesh position={위치} rotation={회전}>
      <planeGeometry args={[크기, 크기 / 2]} />
      <meshBasicMaterial
        map={텍}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        color={색밝기("#ffffff", Math.min(1, 밝기))}
      />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
//  4-b. ⟦스위치 안 퍼즐⟧ 선과 접속 모양
// ═══════════════════════════════════════════════════════════════
// [★ 배전반 퍼즐과 무엇이 다른가]
//   배전반(배전반배선.js)은 **색**으로 맞춘다. 여기서 또 색을 쓰면 같은 퍼즐을
//   두 번 하는 것이다. 그래서 이 선들은 **전부 같은 회색**이고, 끝에 달린
//   **접속 모양**(둥근 · 네모 · 세모)으로 맞춘다. 꽂는 자리에도 같은 모양이
//   파여 있다. 실물 산업용 커넥터가 모양으로 오결선을 막는 방식 그대로다.

/**
 * 접속 모양 한 조각 — **넓은 면이 +x(앞)를 본다.**
 *
 * [★ 「밑에 게 원인지 네모인지 안 보여」의 원인]
 *   전에는 원통·상자를 **Y 축 그대로**(얇은 면이 위아래) 두었다. 함 앞에 서서
 *   보면 두께 0.028 짜리 **옆면만** 보여서, 동그라미·네모·세모가 전부 같은
 *   납작한 띠로 뭉갰다. 모양을 읽어야 하는 퍼즐인데 모양이 안 보였던 것이다.
 *   지금은 면을 앞으로 세운다. 세모는 **꼭짓점이 위**로 오게 돌린다 — 눕혀 두면
 *   옆을 가리키는 화살표처럼 읽힌다.
 * [방향]  +x 를 본다. −x 를 보는 함은 부르는 쪽에서 y 축으로 π 돌린다.
 */
function 모양지오(이름, 크기 = 1, 두께 = 0.028) {
  let g;
  if (이름 === "원") g = new THREE.CylinderGeometry(0.042 * 크기, 0.042 * 크기, 두께, 20);
  else if (이름 === "사") g = new THREE.BoxGeometry(0.074 * 크기, 두께, 0.074 * 크기);
  else {
    // 세모 — 원기둥 면을 셋으로 줄이면 정삼각 기둥이 된다.
    //   면이 셋이면 첫 꼭짓점이 +z 에 선다. y 축으로 −90° 돌려 −x 로 보내면,
    //   아래 z 축 회전 뒤 그 꼭짓점이 **위(+y)** 로 간다.
    g = new THREE.CylinderGeometry(0.054 * 크기, 0.054 * 크기, 두께, 3);
    g.rotateY(-Math.PI / 2);
  }
  g.rotateZ(-Math.PI / 2); // 원통 축(Y)을 +x 로 눕힌다 = 면이 앞을 본다
  return g;
}

/**
 * 전선 한 가닥 — 곡선을 관으로 훑고, 끝에 접속 모양을 단다.
 *   [왜 곡선인가]  직선 원통을 이어 붙이면 마디가 각져 **철사**로 보인다.
 *     전선은 늘어져야 전선으로 읽힌다(소화전 호스와 같은 원칙).
 *   점들  뿌리 → 끝(로컬). 끝에 모양이 앉는다.
 *   방향  모양의 면이 볼 쪽(+1 = +x). 함 방향 d 를 그대로 넘긴다.
 */
const 늘어진점들 = [
  [0, 0, 0],
  [0.014, -0.075, 0.018],
  [-0.01, -0.15, 0.042],
  [0.008, -0.21, 0.026],
];
function 전선가닥({ 모양, 점들 = 늘어진점들, 방향 = 1, 밝기 = 1, 크기 = 1 }) {
  const 키 = 점들.map((p) => p.map((v) => v.toFixed(3)).join(",")).join("|");
  const 관 = useMemo(() => {
    const 길 = new THREE.CatmullRomCurve3(
      점들.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      "catmullrom",
      0.4,
    );
    return new THREE.TubeGeometry(길, 20, 0.015 * 크기, 6, false);
  }, [키, 크기]); // eslint-disable-line react-hooks/exhaustive-deps
  const 끝모양 = useMemo(() => 모양지오(모양, 크기), [모양, 크기]);
  useEffect(
    () => () => {
      관?.dispose();
      끝모양?.dispose();
    },
    [관, 끝모양],
  );
  if (!관) return null;
  const 끝 = 점들[점들.length - 1];
  return (
    <>
      <mesh geometry={관} castShadow>
        {/* ★ 셋 다 **같은 회색**이다 — 색으로는 못 가른다 */}
        <meshToonMaterial color={색밝기("#3f444b", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <group position={끝} rotation={[0, 방향 > 0 ? 0 : Math.PI, 0]}>
        <mesh geometry={끝모양} castShadow>
          <meshToonMaterial color={색밝기("#dfe5ea", 밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#131416" />
        </mesh>
      </group>
    </>
  );
}

/**
 * 쥐고 있는 전선 — **뿌리(바닥 구멍)에서 늘어나 시선을 따라온다.**
 *
 * [왜 손에 안 드나 — 사용자 지적 「배전반 선처럼 늘어나게」]
 *   전에는 잡는 순간 선이 **통째로 카메라 앞에 떠서** 손에 든 물건이 됐다.
 *   전선은 한쪽 끝이 함에 물려 있어야 전선이다. 배전반(배전반내부.jsx 끌리는선)과
 *   같은 방식으로, 뿌리는 그대로 두고 **끝만 보는 쪽으로 끌려온다.**
 *   꽂을 자리를 쳐다보면 끝이 그 자리까지 따라오고, 거기서 [E] 를 누르면 들어간다.
 *
 * [어디로 따라오나]  카메라 광선을 **꽂는 자리가 놓인 깊이(로컬 x)** 평면과 만나게 한다.
 *   그래야 끝이 함 앞 허공에 뜨지 않고 단자대 위를 미끄러진다.
 * [함에서 멀어지면]  선이 끝없이 늘어나면 안 된다. 일정 거리 밖으로 나가면 놓는다.
 */
const _눈 = new THREE.Vector3();
const _앞 = new THREE.Vector3();
const _겨냥 = new THREE.Vector3();
const _함원점 = new THREE.Vector3();
const 끌기주기 = 1 / 30;
function 끌리는전선({ 모양, 뿌리, 평면x, 한계, 방향 = 1, 밝기 = 1, 놓는거리 = 8 }) {
  const { camera } = useThree();
  const 기준 = useRef(null);
  const 관 = useRef(null);
  const 끝ref = useRef(null);
  // 처음엔 뿌리 조금 위에서 시작한다 — 잡는 순간 **살짝 늘어나는** 그림이 된다
  const 끝 = useRef(new THREE.Vector3(뿌리[0], 뿌리[1] + 0.12, 뿌리[2]));
  const 지오 = useRef(null);
  const 누적 = useRef(끌기주기);
  const 끝모양 = useMemo(() => 모양지오(모양, 1), [모양]);
  useEffect(
    () => () => {
      지오.current?.dispose();
      끝모양.dispose();
    },
    [끝모양],
  );
  useFrame((_, dt) => {
    const g = 기준.current;
    if (!g) return;
    camera.getWorldPosition(_눈);
    // 너무 멀리 가면 놓는다(선이 복도 끝까지 늘어나지 않게)
    g.getWorldPosition(_함원점);
    if (_눈.distanceTo(_함원점) > 놓는거리) {
      선놓기();
      return;
    }
    camera.getWorldDirection(_앞);
    _앞.add(_눈);
    g.worldToLocal(_눈);
    g.worldToLocal(_앞);
    _앞.sub(_눈);
    if (Math.abs(_앞.x) > 1e-4) {
      const k = (평면x - _눈.x) / _앞.x;
      if (k > 0) {
        _겨냥.copy(_눈).addScaledVector(_앞, k);
        _겨냥.y = Math.max(한계.y[0], Math.min(한계.y[1], _겨냥.y));
        _겨냥.z = Math.max(-한계.z, Math.min(한계.z, _겨냥.z));
        // 스르르 따라온다 — 딱 붙으면 시선이 떨릴 때 선이 같이 떤다
        끝.current.lerp(_겨냥, 1 - Math.exp(-dt * 10));
      }
    }
    const e = 끝.current;
    if (끝ref.current) 끝ref.current.position.copy(e);
    누적.current += dt;
    if (누적.current < 끌기주기) return;
    누적.current = 0;
    // 뿌리에서 곧게 위로 조금 올라왔다가, 가운데가 살짝 처지며 끝으로 간다
    const 길이 = Math.hypot(e.x - 뿌리[0], e.y - 뿌리[1], e.z - 뿌리[2]);
    const 처짐 = Math.min(0.08, 길이 * 0.18);
    const 점들 = [
      new THREE.Vector3(뿌리[0], 뿌리[1], 뿌리[2]),
      new THREE.Vector3(뿌리[0] + 방향 * 0.03, 뿌리[1] + 0.08, 뿌리[2]),
      new THREE.Vector3(
        (뿌리[0] + e.x) / 2 + 방향 * 0.04,
        (뿌리[1] + 0.08 + e.y) / 2 - 처짐,
        (뿌리[2] + e.z) / 2,
      ),
      new THREE.Vector3(e.x + 방향 * 0.015, e.y - 0.04, e.z),
      e.clone(),
    ];
    const 새 = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(점들, false, "catmullrom", 0.4),
      24,
      0.015,
      6,
      false,
    );
    지오.current?.dispose();
    지오.current = 새;
    if (관.current) 관.current.geometry = 새;
  });
  return (
    <group ref={기준}>
      <mesh ref={관} castShadow>
        <meshToonMaterial color={색밝기("#3f444b", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <group ref={끝ref} position={끝.current}>
        <group rotation={[0, 방향 > 0 ? 0 : Math.PI, 0]}>
          <mesh geometry={끝모양} castShadow>
            <meshToonMaterial color={색밝기("#dfe5ea", 밝기)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  5. 차단기함(분전반) — 자물쇠가 지키는 마지막 문
// ═══════════════════════════════════════════════════════════════
// [무엇이 잘못됐었나 — 사용자 지적]
//   「소화전 따라 한 건데 느낌 너무 다르고 어색해」
//   「안에 열었는데 그냥 검정으로만 보이고 스위치도 안 보이고」
//   맞다. 소화전함의 구성(넓은 민짜 문 + 라벨 띠)을 그대로 베껴 놓으니
//   **같은 물건의 색만 바꾼 것**으로 보였고, 속은 #191b1f 짜리 검은 판이라
//   구간 어둠(0.14)을 곱하면 **완전한 검정**이었다.
//
// [분전반을 분전반으로 보이게 하는 것 — 실물에서 가져온 넷]
//   ① 루버(환기 슬릿)  문 위쪽의 가로 홈 여러 줄. 열이 나는 함에만 있다.
//                      소화전 문에는 절대 없는 것이라, 이것 하나로 갈린다.
//   ② 매립 손잡이      튀어나온 손잡이가 아니라 **파인 홈**. 통로에서 옷이
//                      걸리면 안 되는 함은 전부 이렇다.
//   ③ 걸쇠 + 맹꽁이자물쇠  문틀과 문짝을 잇는 철물. 「잠긴다」가 눈에 보인다.
//   ④ 속                밝은 뒤판 + DIN 레일 위의 소형 차단기 줄 + 회로 표찰
//                      + 가운데 큰 나이프 스위치. **밝은 판 위의 검은 부품**이라
//                      어두운 복도에서도 실루엣이 읽힌다.
//
// [★ 속에는 밝기 하한을 둔다]
//   구간 어둠을 그대로 곱하면 열어도 검다. 「열어서 보는 것」에만 하한을 준다 —
//   벽은 그대로 어둡고, 함 속만 읽힌다. 상용 게임이 상호작용 지점을 늘 읽히게
//   두는 것과 같은 처리다.
//
// [몸통·문짝을 왜 **속 찬 상자**로 두나 — 「테두리가 시점 따라 움직인다」]
//   얇은 판을 합쳐 만들고 `<Outlines>`(뒤집힌 껍데기)를 두르면, 껍데기가 각 면의
//   법선 방향으로 밀려 나간다. 앞뒤 법선이 정반대인 얇은 판에서는 껍데기가 판보다
//   두꺼워지고, 보는 각도마다 그 두께가 **테두리가 따로 떠서 움직이는 것처럼**
//   보인다. 상자를 속 찬 하나로 만들면 실루엣이 하나라 그 일이 없다.
//   문짝은 두께를 주고 `만화선`(진짜 모서리 선)을 긋는다.
export const 차단기문두께 = 0.1;

function 차단기함({
  위치,
  방향 = 1,
  폭 = 1.5,
  높이 = 2.0,
  깊이 = 0.45,
  몸통색 = "#464b52",
  문색 = "#565d66",
  속색 = "#6a7079", // ★ 밝은 뒤판 — 검정이면 열어도 아무것도 안 보인다
  라벨색 = "#b5443a",
  밝기 = 1,
  문id,
  올려짐,
  onLever,
  선,
}) {
  const d = 방향;
  const 열림 = use열렸나(문id);
  const 풀림 = use풀림(문id);
  // ⟦스위치 안 퍼즐⟧ 꽂힌 상태가 바뀌면 다시 그린다(값은 아래에서 직접 읽는다)
  void use꽂힘키();
  const 배선됨 = use배선맞나();
  const 꽂힘 = 꽂힌선();
  const 쥔 = use쥔선(); // 쥐고 있는 가닥 — 함 속에서 늘어나며 따라온다
  const 문ref = useRef(null);
  const 레버ref = useRef(null);
  const 점 = useMemo(() => new THREE.Vector3(), []);
  // 열어서 보는 것에만 밝기 하한(위 머리말)
  const 속밝기 = Math.max(0.55, 밝기);
  const 표찰텍 = 회로표찰텍스처(1);

  const 벽두께 = 0.05;
  // ★ **앞이 뚫린 함**이어야 속이 보인다(함몸통지오 주석). 속 찬 상자였을 때는
  //   열어도 캄캄했다 — 차단기도 스위치도 전부 상자 속에 파묻혀 있었다.
  const 몸통지오 = useMemo(
    () => 함몸통지오({ 깊이, 높이, 폭, 벽두께, 방향: d }),
    [깊이, 높이, 폭, d],
  );
  // ★ 문짝을 **함보다 작게** 만든다(소화전함과 같은 규칙: 높이−0.16 · 폭−0.14).
  //   함과 똑같은 크기면 열릴 때 모서리가 함 테두리와 겹쳐 잘려 보인다.
  const 문폭 = 폭 - 0.14;
  const 문높이 = 높이 - 0.16;
  const 문지오 = useMemo(
    () => new THREE.BoxGeometry(차단기문두께, 문높이, 문폭),
    [문높이, 문폭],
  );
  useEffect(
    () => () => {
      몸통지오?.dispose();
      문지오.dispose();
    },
    [몸통지오, 문지오],
  );

  // 문 여닫힘 · 레버 — 부드럽게 따라간다(소화전·배전반 문과 같은 감각)
  const 각 = useRef(0);
  useFrame((_, dt) => {
    // ★★ 부호가 **거꾸로**였다(−d). 이 함은 d = −1 로 복도(−x)를 보는데,
    //   −d 면 문이 **벽 속(+x)으로** 젖혀져 벽에 잘려 보였다(사용자 지적
    //   「문 열리고 열린 문 짤리고 이상해」). 소화전함(벽부착함)은 `d * 각`
    //   을 쓴다 — 같은 규칙으로 맞춘다. 이제 문이 복도 쪽으로 열린다.
    const 목표 = 열림 ? (d * 104 * Math.PI) / 180 : 0;
    각.current += (목표 - 각.current) * Math.min(1, dt * 9);
    // 잠긴 채 당기면 덜컹 — 자물쇠도 같은 id 라 같이 흔들린다
    if (문ref.current) 문ref.current.rotation.y = 각.current + 덜컹값(문id) * 0.05 * -d;
    if (레버ref.current) {
      const t = 올려짐 ? -젖힘각 : 젖힘각;
      레버ref.current.rotation.z +=
        (t - 레버ref.current.rotation.z) * Math.min(1, dt * 12);
    }
  });

  // ── ⟦스위치 안 퍼즐⟧ 선 자리 ────────────────────────────────
  //   전부 **뒤판(x=0)에서 앞으로** 잰 깊이 · 함 가운데에서 잰 높이다.
  const 선x = {
    단자대: 벽두께 + 0.05,
    앞: 벽두께 + 0.05 + 0.03 + 0.022, // 꽂힌 모양이 앉는 깊이(단자대 앞면 바로 앞)
    뿌리: 벽두께 + 0.12,
    끝: 벽두께 + 0.21,
  };
  const 바닥면 = -(높이 / 2 - 벽두께);
  const 선y = {
    자리: -높이 * 0.3,
    뿌리: 바닥면 + 0.012,
    // ★ 끝은 바닥에서 **0.2 위**. 단자대 밑(자리 − 0.065)과는 넉넉히 떨어진다.
    끝: 바닥면 + 0.2,
  };
  const 자리z = (자리) => ({ 원: -1, 사: 0, 삼: 1 })[자리] * 폭 * 0.21;
  // 뿌리 순서는 **섞는다**(위 ⑤ 주석) — 원·사·삼 자리 밑에 삼·원·사가 나온다
  const 뿌리z = (이름) => ({ 삼: -1, 원: 0, 사: 1 })[이름] * 폭 * 0.24;
  const 꽂힌자리 = (이름) =>
    ["원", "사", "삼"].find((k) => 꽂힘[k] === 이름) ?? null;
  // 늘어진 선 — 바닥 구멍에서 앞으로 휘어 올라와 고개를 든다
  const 늘어진선점들 = (이름) => {
    const z = 뿌리z(이름);
    return [
      [d * 선x.뿌리, 선y.뿌리, z],
      [d * (선x.뿌리 + 0.02), 선y.뿌리 + 0.07, z + 0.02],
      [d * (선x.끝 - 0.03), 선y.끝 - 0.04, z + 0.012],
      [d * 선x.끝, 선y.끝, z],
    ];
  };
  // 꽂힌 선 — 바닥 구멍에서 올라와 **자리에 꽂힌 모양**으로 끝난다
  const 꽂힌점들 = (이름, 자리) => {
    const zg = 뿌리z(이름);
    const zs = 자리z(자리);
    return [
      [d * 선x.뿌리, 선y.뿌리, zg],
      [d * (선x.뿌리 + 0.05), 선y.뿌리 + 0.12, zg * 0.7 + zs * 0.3],
      [d * (선x.앞 + 0.05), 선y.자리 - 0.13, zg * 0.2 + zs * 0.8],
      [d * (선x.앞 + 0.02), 선y.자리 - 0.035, zs],
      [d * 선x.앞, 선y.자리, zs],
    ];
  };
  // 자리 테·속 — 지오를 한 번만 만든다(모양지오 는 부를 때마다 새로 만든다)
  const 자리테지오 = useMemo(
    () => Object.fromEntries(["원", "사", "삼"].map((k) => [k, 모양지오(k, 1.5, 0.012)])),
    [],
  );
  const 자리속지오 = useMemo(
    () => Object.fromEntries(["원", "사", "삼"].map((k) => [k, 모양지오(k, 1.18, 0.012)])),
    [],
  );
  useEffect(
    () => () => {
      for (const g of [...Object.values(자리테지오), ...Object.values(자리속지오)]) g.dispose();
    },
    [자리테지오, 자리속지오],
  );

  // ── 스위치 치수 ──────────────────────────────────────────
  // ★ 레버는 z 축으로 젖혀지므로 날이 **x(함 밖)로 날길이·sin(각)** 만큼 나온다.
  //   처음엔 그 값이 문짝 앞면을 넘어서 **닫힌 문을 뚫고 나왔다**(실사로 확인).
  //   지금: 축 x = 깊이−0.30, 날 0.16·높이, 각 ±0.5
  //     → 가장 앞선 점 ≈ 깊이 − 0.079 < 문 앞면(깊이 + 0.06). 안전하다.
  const 본체h = 높이 * 0.26;
  const 본체w = 폭 * 0.3;
  const 날길이 = 높이 * 0.16;
  const 젖힘각 = 0.5;
  // ★ 레버는 z 축으로 젖혀져 **앞(개구부 쪽)으로 날길이·sin(각)** 만큼 나온다.
  //   뒤판에서 0.11 에 두면 가장 앞선 점이 ≈ 0.42 로, 개구부(깊이 0.45)와
  //   문 앞면(0.51) 안쪽에 머문다. 전에는 닫힌 문을 뚫고 나왔다(실사로 확인).
  const 스위치x = 벽두께 + 0.06;

  // 소형 차단기 한 줄 — DIN 레일 위에 나란히. 실물은 이 줄이 함의 얼굴이다.
  const 소형수 = 6;

  return (
    <group position={위치}>
      {/* ① 몸통 — **앞이 뚫린 함.** 벽 두께가 개구부에 드러나 깊이가 읽힌다 */}
      {/* ★ 몸통 강조는 **닫힌 문을 볼 때만** 켠다.
             [「다가가고 멀어질 때마다 노란 틀이 뜬다」의 원인]  전에는 몸통이 문·레버 두
             대상에 다 반응했다. 문을 연 뒤 함 앞에서 움직이면 겨냥이 레버 ↔ 선 ↔ 자리를
             오가는데, 레버가 잡힐 때마다 **함 테두리 전체**가 크림색으로 떴다 꺼졌다.
             이제 레버는 레버만, 선은 선만 빛난다. */}
      <강조 id={열림 ? "__없음" : 문id} 기준={() => null} 확대={0} 세기={0.16}>
        {몸통지오 && (
          <mesh geometry={몸통지오} castShadow receiveShadow>
            <meshToonMaterial color={색밝기(몸통색, 밝기)} gradientMap={TOON_GRADIENT} />
            {선 ? <만화선 geo={몸통지오} 선={선} /> : null}
            <Outlines thickness={4} color="#131416" />
          </mesh>
        )}
      </강조>

      {/* ①-b 개구부 안쪽 테 — 벽 두께가 드러나는 면을 **한 톤 어둡게**.
             이게 있어야 함이 벽에 박힌 상자로 읽힌다(없으면 그림 한 장이다). */}
      {[
        [0, (높이 - 벽두께) / 2 - 0.004, 0, [깊이 * 0.9, 0.012, 폭 - 벽두께 * 2]],
        [0, -(높이 - 벽두께) / 2 + 0.004, 0, [깊이 * 0.9, 0.012, 폭 - 벽두께 * 2]],
        [0, 0, (폭 - 벽두께) / 2 - 0.004, [깊이 * 0.9, 높이 - 벽두께 * 2, 0.012]],
        [0, 0, -(폭 - 벽두께) / 2 + 0.004, [깊이 * 0.9, 높이 - 벽두께 * 2, 0.012]],
      ].map(([tx, ty, tz, size], i) => (
        <mesh key={`리빌${i}`} position={[d * (깊이 * 0.55) + tx, ty, tz]}>
          <boxGeometry args={size} />
          <meshToonMaterial
            color={색밝기(몸통색, 밝기 * 0.6)}
            gradientMap={TOON_GRADIENT}
          />
        </mesh>
      ))}

      {/* ② 속 뒤판 — **밝은 판.** 이 위의 검은 부품들이 실루엣으로 읽힌다 */}
      <mesh position={[d * (벽두께 + 0.015), 0, 0]}>
        <boxGeometry args={[0.03, 높이 - 0.14, 폭 - 0.14]} />
        <meshToonMaterial color={색밝기(속색, 속밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 뒤판 나사 넷 — 「판을 대고 조인 것」이라는 신호 */}
      {[-1, 1].map((sy) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`뒤나사${sy}${sz}`}
            position={[d * (벽두께 + 0.032), sy * 높이 * 0.4, sz * 폭 * 0.4]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.018, 0.018, 0.014, 8]} />
            <meshToonMaterial color={색밝기("#5f666e", 속밝기)} gradientMap={TOON_GRADIENT} />
          </mesh>
        )),
      )}
      {/* 배선 — 차단기 줄에서 아래 단자대로 내려가는 굵은 선 둘.
             빈 회색 판이 아니라 **회로가 지나는 함**으로 읽히게 한다. */}
      {[-1, 1].map((sz) => (
        <mesh
          key={`배선${sz}`}
          position={[d * (벽두께 + 0.04), -높이 * 0.06, sz * 폭 * 0.3]}
        >
          <boxGeometry args={[0.03, 높이 * 0.34, 0.035]} />
          <meshToonMaterial
            color={색밝기(sz < 0 ? "#2b2e33" : "#7a4a3a", 속밝기)}
            gradientMap={TOON_GRADIENT}
          />
        </mesh>
      ))}

      {/* ③ 위 — DIN 레일 + 소형 차단기 줄 + 회로 표찰 */}
      <group position={[d * (벽두께 + 0.05), 높이 * 0.29, 0]}>
        {/* DIN 레일 — 부품이 올라앉는 은색 띠 */}
        <mesh>
          <boxGeometry args={[0.02, 0.06, 폭 * 0.78]} />
          <meshToonMaterial color={색밝기("#aeb5bd", 속밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
        {Array.from({ length: 소형수 }, (_, i) => {
          const z = (i - (소형수 - 1) / 2) * (폭 * 0.78 / 소형수);
          // 한 칸만 올라가 있다 — 「여기가 살아 있는 회로」라는 잔단서
          const 올림 = i === 2;
          return (
            <group key={`소형${i}`} position={[d * 0.05, 0, z]}>
              {/* 몸통 — 흰 몰드 */}
              <mesh castShadow>
                <boxGeometry args={[0.07, 0.17, 폭 * 0.78 / 소형수 - 0.012]} />
                <meshToonMaterial color={색밝기("#cfd4d9", 속밝기)} gradientMap={TOON_GRADIENT} />
                <Outlines thickness={2} color="#22252a" />
              </mesh>
              {/* 토글 — 작은 검은 손잡이. 위/아래가 갈려 보여야 '스위치'다 */}
              <mesh position={[d * 0.045, 올림 ? 0.045 : -0.045, 0]}>
                <boxGeometry args={[0.03, 0.055, 0.022]} />
                <meshToonMaterial color="#1b1d21" gradientMap={TOON_GRADIENT} />
              </mesh>
            </group>
          );
        })}
        {/* 회로 표찰 — 레일 아래 흰 띠. 글자가 있으면 '전기 함'이 확정된다 */}
        {/* ★ 차단기 줄(높이 0.17)과 **안 겹치게** 충분히 내린다.
               전에는 −0.14 에 두께 0.29 라 줄을 통째로 덮었다. */}
        <mesh
          position={[d * 0.1, -0.175, 0]}
          rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          <planeGeometry args={[폭 * 0.8, 폭 * 0.8 * (44 / 512)]} />
          <meshBasicMaterial map={표찰텍} toneMapped={false} transparent />
        </mesh>
      </group>

      {/* ④ 가운데 — 주 차단기(나이프 스위치). **이것을 올린다.** */}
      <group position={[d * 스위치x, -높이 * 0.04, 0]}>
        {/* 절연 몰드 본체 */}
        <mesh position={[d * 0.04, 0, 0]} castShadow>
          <boxGeometry args={[0.08, 본체h, 본체w]} />
          <meshToonMaterial color="#1c1e22" gradientMap={TOON_GRADIENT} />
          <Outlines thickness={3} color="#0d0e10" />
        </mesh>
        {/* 손잡이가 지나는 홈 */}
        <mesh position={[d * 0.081, 0, 0]}>
          <boxGeometry args={[0.006, 본체h * 0.86, 본체w * 0.26]} />
          <meshBasicMaterial color="#08090b" toneMapped={false} />
        </mesh>
        {/* ON(위) 초록 · OFF(아래) 붉은 띠 — 글자 대신 색으로 읽힌다.
               ★ 노란색은 쓰지 않는다(이 복도의 금속 톤과 어긋난다). */}
        <mesh position={[d * 0.081, 본체h * 0.36, 0]}>
          <boxGeometry args={[0.005, 본체h * 0.12, 본체w * 0.52]} />
          <meshBasicMaterial color={올려짐 ? "#5fd58a" : "#2f5a3d"} toneMapped={false} />
        </mesh>
        <mesh position={[d * 0.081, -본체h * 0.36, 0]}>
          <boxGeometry args={[0.005, 본체h * 0.12, 본체w * 0.52]} />
          <meshBasicMaterial color={올려짐 ? "#5a2a26" : "#c5463a"} toneMapped={false} />
        </mesh>
        {/* 강철 접점 두 개 — 본체 좌우, 무광 */}
        {[-1, 1].map((sz) => (
          <mesh key={sz} position={[d * 0.05, 0, sz * 본체w * 0.66]} castShadow>
            <boxGeometry args={[0.06, 본체h * 0.4, 0.09]} />
            <meshToonMaterial color={색밝기("#9aa3ad", 속밝기)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
        ))}
        {/* 레버 — 강철 날 + 검은 고무 손잡이 */}
        {/* 레버만 빛난다 — 겨냥했을 때 「이것을 올린다」가 읽히게 */}
        <강조 id={`${문id}:레버`} 기준={() => null} 확대={0} 세기={0.35}>
        <group ref={레버ref} position={[d * 0.09, 0, 0]} rotation={[0, 0, 젖힘각]}>
          <mesh position={[0, 날길이 * 0.5, 0]} castShadow>
            <boxGeometry args={[0.032, 날길이, 0.07]} />
            <meshToonMaterial color={색밝기("#b4bcc4", 속밝기)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
          <mesh position={[d * 0.026, 날길이 * 0.98, 0]} castShadow>
            <cylinderGeometry args={[0.062, 0.07, 0.16, 14]} />
            <meshToonMaterial color="#202226" gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#0d0e10" />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.1, 10]} />
            <meshToonMaterial color={색밝기("#6e767e", 속밝기)} gradientMap={TOON_GRADIENT} />
          </mesh>
        </group>
        </강조>
        {/* 표시등 — 전기가 오면 초록 */}
        <mesh position={[d * 0.085, 본체h * 0.62, -본체w * 0.68]}>
          <sphereGeometry args={[0.032, 12, 8]} />
          <meshBasicMaterial color={올려짐 ? "#7dffa8" : "#3a413d"} toneMapped={false} />
        </mesh>
      </group>

      {/* ⑤ 아래 — ⟦스위치 안 퍼즐⟧ **꽂는 자리 셋 + 빠져 있는 선 셋**
             [규칙]  선 끝의 모양(둥근·네모·세모)과 **같은 모양이 파인 자리**에
               꽂아야 한다. 선은 셋 다 같은 회색이라 색으로는 못 가른다.
             [자리]  주 차단기 바로 아래 — 「이 선들이 저 스위치로 들어간다」가
               한눈에 보여야 레버를 올리기 전에 할 일이 무엇인지 읽힌다.
             [★ 선은 함 **바닥 구멍**에서 올라온다]
               전에는 늘어진 선을 −높이·0.42 에서 아래로 늘어뜨려, 끝(모양)이 함
               바닥(−높이·0.475)을 **뚫고 밑으로 빠졌다.** 세모 선은 통째로 안 보였고
               나머지도 모양이 바닥 테에 잘렸다(사용자 지적 「밑에 게 잘려서 안 보여」).
               이제 뿌리를 바닥 구멍에 박고, 끝을 **위·앞으로** 세워 모양을 보여 준다.
             [★ 뿌리 순서는 자리 순서와 다르다]
               둥근 자리 밑에 둥근 선이 있으면 모양을 볼 것도 없이 「바로 위에 꽂기」다.
               뿌리를 섞어 두면 끝 모양을 **보고** 골라야 하고, 꽂으면 선이 서로
               엇갈려 지나가서 「제 짝을 찾아 건너갔다」가 눈에 보인다. */}
      <group position={[d * 선x.단자대, 선y.자리, 0]}>
        {/* 단자대 몸통 */}
        <mesh>
          <boxGeometry args={[0.045, 0.13, 폭 * 0.66]} />
          <meshToonMaterial color={색밝기("#1c1e22", 속밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0f1012" />
        </mesh>
        {["원", "사", "삼"].map((자리) => {
          const 꽂힌 = 꽂힘[자리];
          const 맞음 = 꽂힌 === 자리;
          return (
            <group key={자리} position={[d * 0.03, 0, 자리z(자리)]} rotation={[0, d > 0 ? 0 : Math.PI, 0]}>
              {/* 테 — 파인 자리가 어디까지인지 알려 준다 */}
              <mesh geometry={자리테지오[자리]}>
                <meshToonMaterial color={색밝기("#9aa2aa", 속밝기)} gradientMap={TOON_GRADIENT} />
              </mesh>
              {/* 파인 자리 — **같은 모양**이 어둡게 들어가 있다(테보다 앞에 얹어야 보인다) */}
              <mesh geometry={자리속지오[자리]} position={[0.006, 0, 0]}>
                <meshBasicMaterial color="#07080a" toneMapped={false} />
              </mesh>
              {/* 꽂혔나 표시 — 제자리면 초록, 엉뚱하면 붉다 */}
              <mesh position={[0.02, 0.088, 0]}>
                <sphereGeometry args={[0.018, 10, 8]} />
                <meshBasicMaterial
                  color={!꽂힌 ? "#39413c" : 맞음 ? "#7dffa8" : "#ff5a4a"}
                  toneMapped={false}
                />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* 바닥 구멍(그로밋) 셋 — 선이 **어디서 나오는지**가 보여야 늘어진 선이 된다 */}
      {["원", "사", "삼"].map((이름) => (
        <mesh key={`구멍${이름}`} position={[d * 선x.뿌리, 선y.뿌리, 뿌리z(이름)]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.03, 0.012, 6, 14]} />
          <meshToonMaterial color={색밝기("#16181b", 속밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}

      {/* 선 셋 — 꽂혔으면 뿌리에서 자리까지 건너가고, 아니면 바닥에서 고개를 든다 */}
      {["원", "사", "삼"].map((이름) => {
        const 자리 = 꽂힌자리(이름);
        if (자리) {
          return (
            <전선가닥
              key={`꽂힌${이름}`}
              모양={이름}
              점들={꽂힌점들(이름, 자리)}
              방향={d}
              밝기={속밝기}
            />
          );
        }
        if (쥔 === 이름) {
          // 쥔 가닥 — 뿌리에서 늘어나 시선을 따라온다(문이 닫히면 그리지 않는다)
          if (!열림) return null;
          return (
            <끌리는전선
              key={`쥔${이름}`}
              모양={이름}
              뿌리={[d * 선x.뿌리, 선y.뿌리, 뿌리z(이름)]}
              평면x={d * 선x.앞}
              한계={{ y: [선y.뿌리 + 0.06, 선y.자리 + 0.25], z: 폭 / 2 - 0.12 }}
              방향={d}
              밝기={속밝기}
            />
          );
        }
        if (!선늘어짐(이름)) return null;
        return (
          <강조 key={`늘어${이름}`} id={`배선:${이름}`} 기준={() => null} 확대={0} 세기={0.3}>
            <group>
              <전선가닥 모양={이름} 점들={늘어진선점들(이름)} 방향={d} 밝기={속밝기} />
            </group>
          </강조>
        );
      })}

      {/* ⑥ 문짝 — 경첩은 −z 쪽, 걸쇠·자물쇠는 +z 쪽 */}
      {/* 경첩은 −z 쪽 모서리. 문짝은 그 축에서 +z 로 뻗는다 */}
      <group ref={문ref} position={[d * (깊이 + 0.01), 0, -문폭 / 2]}>
        <mesh geometry={문지오} position={[0, 0, 문폭 / 2]} castShadow receiveShadow>
          <meshToonMaterial color={색밝기(문색, 밝기)} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={문지오} 선={선} /> : null}
        </mesh>

        {/* ⑥-a 루버(환기 슬릿) — **분전반의 얼굴.** 소화전 문에는 없는 것이다 */}
        {Array.from({ length: 5 }, (_, i) => (
          <mesh
            key={`루버${i}`}
            position={[
              d * (차단기문두께 / 2 + 0.006),
              높이 * 0.3 - i * 0.075,
              폭 / 2,
            ]}
          >
            <boxGeometry args={[0.014, 0.028, 폭 * 0.52]} />
            <meshToonMaterial
              color={색밝기("#2b2f35", 밝기)}
              gradientMap={TOON_GRADIENT}
            />
          </mesh>
        ))}

        {/* ⑥-b 붉은 경고 명판 — 작게. 노란색은 안 쓴다 */}
        <mesh
          position={[d * (차단기문두께 / 2 + 0.005), -높이 * 0.06, 폭 / 2]}
          rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          <planeGeometry args={[폭 * 0.46, 높이 * 0.075]} />
          <meshBasicMaterial color={라벨색} toneMapped={false} />
        </mesh>

        {/* ⑥-c 매립 손잡이 — 파인 홈 + 그 안의 밝은 레버.
               튀어나온 손잡이를 달면 소화전 문이 된다. 통로 함은 늘 매립이다. */}
        <mesh position={[d * (차단기문두께 / 2 + 0.004), -높이 * 0.2, 폭 - 0.17]}>
          <boxGeometry args={[0.01, 높이 * 0.17, 0.085]} />
          <meshToonMaterial color={색밝기(문색, 밝기 * 0.3)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh position={[d * (차단기문두께 / 2 + 0.012), -높이 * 0.2, 폭 - 0.17]}>
          <boxGeometry args={[0.018, 높이 * 0.1, 0.04]} />
          <meshToonMaterial color={색밝기("#9aa2ab", 밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>

        {/* ⑥-c2 문 **안쪽** — 열었을 때 보이는 면.
               보강 리브 둘 + 회로도 주머니. 이게 없으면 문이 종이 한 장이다. */}
        <mesh position={[-d * (차단기문두께 / 2 + 0.004), 0, 폭 / 2]}>
          <boxGeometry args={[0.006, 높이 - 0.08, 폭 - 0.08]} />
          <meshToonMaterial color={색밝기(문색, 밝기 * 1.35)} gradientMap={TOON_GRADIENT} />
        </mesh>
        {[-1, 1].map((sy) => (
          <mesh
            key={`리브${sy}`}
            position={[-d * (차단기문두께 / 2 + 0.012), sy * 높이 * 0.26, 폭 / 2]}
          >
            <boxGeometry args={[0.016, 0.05, 폭 - 0.18]} />
            <meshToonMaterial color={색밝기(문색, 밝기 * 0.8)} gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
        {/* 회로도 주머니 — 누렇게 바랜 종이 한 장이 끼워져 있다 */}
        <mesh position={[-d * (차단기문두께 / 2 + 0.014), -높이 * 0.04, 폭 / 2]}>
          <boxGeometry args={[0.01, 높이 * 0.3, 폭 * 0.52]} />
          {/* 열어서 보는 종이 — 속과 같은 밝기 하한(위 머리말). 힌트가 여기 적혀 있다 */}
          <meshToonMaterial color={색밝기("#cdc6ad", Math.max(0.6, 밝기))} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#2a2720" />
        </mesh>
        {/* 한 단어 힌트 — 회로도 위에 누가 매직으로 「모양」 이라고 휘갈겨 두었다 */}
        <힌트글
          글="모양"
          색="#2a2622"
          크기={폭 * 0.46}
          위치={[-d * (차단기문두께 / 2 + 0.021), -높이 * 0.04, 폭 / 2]}
          회전={[0, d > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
          밝기={Math.max(0.55, 밝기)}
        />

        {/* ⑥-d 경첩 두 개 */}
        {[0.28, 0.72].map((t) => (
          <mesh
            key={t}
            position={[d * (차단기문두께 / 2 + 0.01), (t - 0.5) * 높이 * 0.86, 0.07]}
          >
            <boxGeometry args={[0.035, 0.18, 0.08]} />
            <meshToonMaterial color={색밝기("#7a828a", 밝기)} gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
      </group>

      {/* [E] — 문 열기.
             ★ 잠겨 있는 동안은 **끈다.** 그러면 겨냥이 자물쇠로 간다(자물쇠.jsx 가
               제 상호대상을 갖는다). 전에는 이 대상이 라벨도 없이 늘 켜져 있어서,
               자물쇠를 보고 E 를 눌러도 문 쪽이 잡혀 **덜컹거리기만** 했다
               (사용자 지적 「열리는 동작 들어가고」). */}
      <상호대상
        id={문id}
        반경={1.2}
        거리={6}
        위치={() => {
          const o = 문ref.current;
          if (!o) return null;
          o.getWorldPosition(점);
          return [점.x, 점.y, 점.z];
        }}
        라벨={열림 ? "[E] 차단기함 닫기" : "[E] 차단기함 열기"}
        끔={() => !풀림}
        실행={() => 여닫기(문id)}
      />

      {/* [E] — 레버 올리기. 문이 열려 있고 아직 안 올렸을 때만 */}
      <상호대상
        id={`${문id}:레버`}
        반경={1.0}
        거리={6}
        위치={() => [위치[0] + d * (깊이 + 0.1), 위치[1] - 높이 * 0.04, 위치[2]]}
        /* ★ 선 셋을 다 꽂기 전에는 **무엇을 해야 하는지**를 말한다.
             레버만 덩그러니 두면 「눌러도 안 되는데?」가 된다. */
        라벨={
          배선됨
            ? "[E] 주 차단기 올리기"
            : `모양 (${꽂힌수()}/3)`
        }
        끔={() => !열림 || 올려짐}
        실행={() => 배선됨 && onLever()}
      />

      {/* ⟦스위치 안 퍼즐⟧ 전선 집기 셋 · 꽂는 자리 셋 */}
      {["원", "사", "삼"].map((이름) => (
        <상호대상
          key={`선집기${이름}`}
          id={`배선:${이름}`}
          반경={0.9}
          거리={6}
          위치={() => {
            const 끝 = 늘어진선점들(이름).at(-1);
            return [위치[0] + 끝[0], 위치[1] + 끝[1], 위치[2] + 끝[2]];
          }}
          라벨={`[E] ${선모양[이름]} 끝 전선 잡기`}
          끔={() => !열림 || !!쥔선() || !선늘어짐(이름)}
          실행={() => 선집기(이름)}
        />
      ))}
      {["원", "사", "삼"].map((자리) => (
        <상호대상
          key={`자리${자리}`}
          id={`배선:자리${자리}`}
          /* ★ 반경을 줄였다(0.8 → 0.5). 자리끼리 0.315 떨어져 있는데 0.8 이면
               옆 자리가 겨냥을 가로챈다. 이제 **보는 모양 그 자리**가 잡힌다. */
          반경={0.5}
          거리={6}
          위치={() => [위치[0] + d * 선x.앞, 위치[1] + 선y.자리, 위치[2] + 자리z(자리)]}
          라벨={
            꽂힘[자리]
              ? `[E] ${선모양[자리]} 자리에서 빼기`
              : `[E] ${선모양[자리]} 자리에 꽂기`
          }
          끔={() => !열림 || (꽂힘[자리] ? !!쥔선() : !쥔선())}
          실행={() => (꽂힘[자리] ? 선집기(꽂힘[자리]) : 선꽂기(자리))}
        />
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  5-b. 비상문 해제 버튼 — 이어지는 퍼즐
// ═══════════════════════════════════════════════════════════════
// [무엇인가]
//   차단기를 올리면 복도 끝 구간에 전기가 온다. 그 전기가 **끝문(비상계단) 전기
//   잠금**에도 간다 — 그래서 문 옆 강철 상자의 표시등이 붉게 살아난다.
//   버튼을 누르면 잠금이 풀리고(초록), 그제야 [E] 로 문이 열린다.
//
// [★ 명판을 반드시 단다 — 「이 빨간 스위치는 뭐야」]
//   붉은 버튼만 벽에 붙여 두면 정체를 알 수 없다(사용자 지적). 복도의 다른
//   함들은 전부 라벨이 있어서, 이것만 없으면 같은 세계의 물건으로도 안 읽힌다.
//   실물 비상문 개방 버튼도 반드시 명판과 **유리 덮개 테**가 같이 있다.
function 해제버튼({ 위치, 방향 = 1, 전원, 해제됨, 밝기 = 1, 선 }) {
  const d = 방향;
  const 상자지오 = useMemo(() => new THREE.BoxGeometry(0.18, 0.62, 0.46), []);
  useEffect(() => () => 상자지오.dispose(), [상자지오]);
  const 라벨텍 = 해제라벨텍스처("#b5443a", "#f4f6f8", 1);
  const 눌림 = useRef(0);
  const 버튼ref = useRef(null);
  // 전기가 오기 전에는 죽은 회색, 오면 붉음(잠김), 풀리면 초록
  const 등색 = !전원 ? "#3a3d40" : 해제됨 ? "#7dffa8" : "#ff5a4a";
  useFrame((_, dt) => {
    const 목표 = 해제됨 ? 0.035 : 0;
    눌림.current += (목표 - 눌림.current) * Math.min(1, dt * 10);
    if (버튼ref.current) 버튼ref.current.position.x = d * (0.2 + 0.05 - 눌림.current);
  });
  // 버튼 자체도 어둠에 묻히면 안 된다 — 누를 것은 보여야 한다
  const 속밝기 = Math.max(0.5, 밝기);
  return (
    <group position={위치}>
      <강조 id="작업등:해제버튼" 기준={() => null} 확대={0} 세기={0.2}>
        <mesh geometry={상자지오} position={[d * 0.09, 0, 0]} castShadow receiveShadow>
          {/* 벽(#525b69 계열)보다 확실히 어둡게 — 전원이 와서 벽이 밝아지면
                 함 색이 벽에 묻혀 버튼만 허공에 떠 보였다(실사로 확인) */}
          <meshToonMaterial color={색밝기("#2c3036", 밝기)} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={상자지오} 선={선} /> : null}
          <Outlines thickness={3} color="#0f1012" />
        </mesh>
      </강조>

      {/* 명판 — 「비상문 개방」. 이게 있어야 정체를 안다 */}
      <mesh
        position={[d * 0.185, 0.2, 0]}
        rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
      >
        <planeGeometry args={[0.38, 0.38 * (96 / 256)]} />
        <meshBasicMaterial map={라벨텍} toneMapped={false} transparent />
      </mesh>

      {/* 버튼 둘레의 테 — 실물은 잘못 누르지 않게 테가 둘러 있다 */}
      <mesh position={[d * 0.19, -0.08, 0]} rotation={[0, 0, (d * -Math.PI) / 2]}>
        <cylinderGeometry args={[0.125, 0.125, 0.035, 20]} />
        <meshToonMaterial color={색밝기("#1c1e22", 속밝기)} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={2} color="#0f1012" />
      </mesh>
      {/* 버튼 — 붉은 버섯형 */}
      <mesh
        ref={버튼ref}
        position={[d * 0.25, -0.08, 0]}
        rotation={[0, 0, (d * -Math.PI) / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.095, 0.082, 0.085, 20]} />
        <meshToonMaterial color={색밝기("#b0362c", 속밝기)} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={2} color="#131416" />
      </mesh>

      {/* 표시등 — 전기 없음: 죽음 · 전기 옴: 붉음(잠김) · 해제: 초록 */}
      <mesh position={[d * 0.185, -0.235, -0.15]}>
        <sphereGeometry args={[0.032, 12, 8]} />
        <meshBasicMaterial color={등색} toneMapped={false} />
      </mesh>

      <상호대상
        id="작업등:해제버튼"
        반경={1.1}
        거리={6}
        위치={() => [위치[0] + d * 0.24, 위치[1] - 0.08, 위치[2]]}
        라벨={!전원 ? "" : 해제됨 ? "" : "[E] 비상문 잠금 해제"}
        끔={() => !전원 || 해제됨}
        실행={() => 끝문해제하기()}
      />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  5-c. ⟦분리수거 퍼즐⟧ 쓰레기통 둘 + 널린 쓰레기 여덟
// ═══════════════════════════════════════════════════════════════
// [흐름]
//   ① 주 차단기를 올리면 퍼즐 쪽 절반만 불이 든다(비상 전원).
//   ② 널빤지로 막힌 옆문 옆에 분리수거함 둘이 서 있고, 둘레에 쓰레기가 널려 있다.
//      통마다 **전선이 벽을 타고 천장을 건너 맞은편 벽의 그림 액자로** 간다.
//   ③ 한 통의 몫(넷)을 다 채우면 그 통의 선에 **전류가 흘러** 액자까지 간다.
//   ④ 두 선이 다 닿으면 전류가 액자 테를 한 바퀴 돌고, 그림 속 객차 창에 불이 든다.
//   ⑤ 액자 옆 시험반 스위치 여섯 = 창 여섯의 불. 사람 있는 창은 켜고 빈 창은 끄면 **완전 전원.**
// [통 앞 칸 넷]  통마다 제 몫이 몇 개인지를 **칸 수로** 말해 준다(넷·넷).

/** 원통을 돌려 깎는다 — [반지름, 높이] 윤곽을 받는다 */
function 돌림지오(윤곽, 마디 = 20) {
  return new THREE.LatheGeometry(
    윤곽.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)),
    마디,
  );
}

/** 위가 조금 넓은 상자 — 실물 분리수거함은 겹쳐 쌓으려고 아래가 좁다 */
function 테이퍼상자지오(가로x, 높이, 세로z, 아래배 = 0.9) {
  const g = new THREE.BoxGeometry(가로x, 높이, 세로z, 1, 4, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + 높이 / 2) / 높이; // 0 = 바닥, 1 = 윗면
    const k = 아래배 + (1 - 아래배) * t;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** 통 몸통의 결 — 긁힘 · 바닥 때 · 흘러내린 얼룩 · 구청 스티커 */
function 통몸텍스처(종류) {
  const 키 = `통몸|${종류}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 256, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const 플 = 종류 === "플라";
  const 바탕 = 플 ? "#2d64a8" : "#50574d";
  g.fillStyle = 바탕;
  g.fillRect(0, 0, W, H);
  const rnd = makeRandom(플 ? 311 : 313);
  // 사출 성형 세로 결 — 아주 옅게
  for (let x = 0; x < W; x += 6) {
    g.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.02})`;
    g.fillRect(x, 0, 2, H);
  }
  // 흘러내린 얼룩 — 위에서 아래로 가늘게
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W, y0 = rnd() * H * 0.5, 길 = 60 + rnd() * 220;
    const gr = g.createLinearGradient(0, y0, 0, y0 + 길);
    gr.addColorStop(0, "rgba(20,18,12,0)");
    gr.addColorStop(0.3, "rgba(20,18,12,0.22)");
    gr.addColorStop(1, "rgba(20,18,12,0)");
    g.fillStyle = gr;
    g.fillRect(x, y0, 2 + rnd() * 4, 길);
  }
  // 바닥 때 — 발에 차이고 물걸레에 젖은 아랫단
  const 때 = g.createLinearGradient(0, H * 0.72, 0, H);
  때.addColorStop(0, "rgba(28,24,18,0)");
  때.addColorStop(1, "rgba(28,24,18,0.55)");
  g.fillStyle = 때;
  g.fillRect(0, H * 0.72, W, H * 0.28);
  // 긁힘
  g.strokeStyle = "rgba(230,235,240,0.18)";
  g.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, y = rnd() * H, l = 6 + rnd() * 30, a = (rnd() - 0.5) * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // 구청 관리 스티커 — 반쯤 뜯겨 있다
  g.save();
  g.translate(W * 0.72, H * 0.1);
  g.rotate(-0.06);
  g.fillStyle = "#e9e4d2";
  g.fillRect(-40, -14, 80, 28);
  g.fillStyle = "#b8b19a";
  g.beginPath(); g.moveTo(22, -14); g.lineTo(40, -14); g.lineTo(40, 6); g.closePath(); g.fill();
  g.fillStyle = "#3a3a36";
  g.font = `bold 12px ${표지폰트}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("왜곡역 관리", -4, -3);
  g.font = `9px ${표지폰트}`;
  g.fillText("No. 0" + (플 ? "7" : "6"), -4, 9);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _라벨캐시.set(키, t);
  return t;
}

/** 통 앞에 붙는 표지 — 색 띠 · 그림 기호 · 배출 요령 */
function 통표지텍스처(종류) {
  const 키 = `통표지2|${종류}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 512, H = 640;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const 플 = 종류 === "플라";
  const 띠색 = 플 ? "#1f5fae" : "#3d4439";
  // 바탕 — 살짝 누렇게 바랜 흰 판
  g.fillStyle = "#ecebe4";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#171819";
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  // 윗단 띠 — 멀리서도 통이 갈린다
  g.fillStyle = 띠색;
  g.fillRect(10, 10, W - 20, 150);
  g.fillStyle = "#f7f8f9";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${플 ? 86 : 74}px ${표지폰트}`;
  g.fillText(플 ? "플라스틱" : "일반쓰레기", W / 2, 72);
  g.font = `bold 26px ${표지폰트}`;
  g.fillText(플 ? "PLASTIC · 재활용" : "GENERAL WASTE · 종량제", W / 2, 132);
  // 기호 — 동그라미 안에
  g.save();
  g.translate(W / 2, 330);
  g.fillStyle = 플 ? "#dbe6f4" : "#dcdfd6";
  g.beginPath(); g.arc(0, 0, 130, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 띠색;
  g.lineWidth = 12;
  g.stroke();
  g.fillStyle = 띠색;
  g.strokeStyle = 띠색;
  g.lineJoin = "round";
  g.lineCap = "round";
  if (플) {
    // 순환 화살표 셋 — 삼각형 둘레를 도는 모양
    for (let k = 0; k < 3; k++) {
      g.save();
      g.rotate((k * Math.PI * 2) / 3);
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(-58, 38); g.lineTo(0, -62);
      g.stroke();
      g.beginPath();
      g.moveTo(-18, -66); g.lineTo(14, -48); g.lineTo(-8, -30);
      g.fill();
      g.restore();
    }
    g.font = `900 40px ${표지폰트}`;
    g.fillText("PET", 0, 8);
  } else {
    // 종량제 봉투 — 묶은 매듭까지
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(-62, -20); g.quadraticCurveTo(-72, 70, -40, 86); g.lineTo(40, 86);
    g.quadraticCurveTo(72, 70, 62, -20); g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(-30, -20); g.quadraticCurveTo(-34, -70, 0, -58); g.quadraticCurveTo(34, -70, 30, -20);
    g.stroke();
    g.font = `900 34px ${표지폰트}`;
    g.fillText("종량제", 0, 36);
  }
  g.restore();
  // 배출 요령 — 작은 글씨 두 줄
  g.fillStyle = "#1b1d21";
  g.font = `bold 30px ${표지폰트}`;
  g.fillText(플 ? "비우고 · 헹구고 · 뚜껑 닫아서" : "재활용 안 되는 것만", W / 2, 510);
  g.font = `24px ${표지폰트}`;
  g.fillStyle = "#3a3d42";
  g.fillText(플 ? "PET · PP · PE 용기류" : "여러 재질 · 이물질 · 감열지", W / 2, 556);
  // 낡음
  const rnd = makeRandom(플 ? 91 : 93);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = rnd() > 0.5 ? "#2b2a25" : "#efe6c8";
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _라벨캐시.set(키, t);
  return t;
}

/** 작은 인쇄물 텍스처 — 상표 띠 · 영수증 · 세제 라벨 · 빨대 줄무늬 */
function 인쇄텍스처(종류) {
  const 키 = `인쇄|${종류}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  if (종류 === "생수") {
    c.width = 256; c.height = 64;
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, "#1f78c9"); gr.addColorStop(1, "#0f4f93");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#ffffff"; g.fillRect(0, 44, 256, 5);
    g.font = `900 30px ${표지폰트}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("맑은샘물", 70, 24); g.fillText("맑은샘물", 196, 24);
    g.font = `12px ${표지폰트}`; g.fillText("500mL · 먹는샘물", 128, 56);
  } else if (종류 === "영수증") {
    c.width = 128; c.height = 360;
    g.fillStyle = "#f4f2ea"; g.fillRect(0, 0, 128, 360);
    g.fillStyle = "#4b4f55";
    g.textAlign = "center"; g.font = `bold 13px ${표지폰트}`;
    g.fillText("왜곡역 매점", 64, 22);
    g.font = `9px ${표지폰트}`; g.fillText("1987-11-21  23:52", 64, 38);
    g.textAlign = "left";
    const 줄 = [["삼각김밥", "700"], ["바나나우유", "500"], ["건전지 AA", "1,200"], ["껌", "200"]];
    줄.forEach(([a, b], i) => { g.fillText(a, 10, 66 + i * 18); g.textAlign = "right"; g.fillText(b, 118, 66 + i * 18); g.textAlign = "left"; });
    g.fillRect(10, 144, 108, 1);
    g.font = `bold 11px ${표지폰트}`; g.fillText("합계", 10, 162); g.textAlign = "right"; g.fillText("2,600", 118, 162);
    g.textAlign = "center"; g.font = `9px ${표지폰트}`;
    g.fillText("막차 이용 감사합니다", 64, 196);
    for (let i = 0; i < 30; i++) g.fillRect(24 + i * 2.7, 214, (i * 7) % 3 === 0 ? 2 : 1, 26);
    // 감열지가 바래 글자가 군데군데 날아갔다
    const rnd = makeRandom(55);
    g.fillStyle = "rgba(244,242,234,0.7)";
    for (let i = 0; i < 26; i++) g.fillRect(rnd() * 128, rnd() * 260, 10 + rnd() * 30, 4 + rnd() * 8);
  } else if (종류 === "세제") {
    c.width = 256; c.height = 256;
    g.fillStyle = "#f6f7f9"; g.beginPath(); g.ellipse(128, 128, 118, 100, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e8452f"; g.font = `900 52px ${표지폰트}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("싹싹", 128, 104);
    g.fillStyle = "#1d4f9c"; g.font = `bold 30px ${표지폰트}`; g.fillText("액체세제", 128, 152);
    g.font = `16px ${표지폰트}`; g.fillText("2.5L · 드럼 겸용", 128, 186);
  } else if (종류 === "빨대") {
    c.width = 64; c.height = 256;
    g.fillStyle = "#f4f4f2"; g.fillRect(0, 0, 64, 256);
    g.fillStyle = "#d8363a";
    for (let y = -64; y < 256; y += 32) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 24); g.lineTo(64, y + 36); g.lineTo(0, y + 12); g.fill();
    }
  } else {
    // 요구르트 병 몸 글씨
    c.width = 256; c.height = 64;
    g.fillStyle = "#f3efe6"; g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#d8233b"; g.font = `900 26px ${표지폰트}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("요구르트", 64, 30); g.fillText("요구르트", 192, 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _라벨캐시.set(키, t);
  return t;
}

/** 구겨진 휴지 한 뭉치 — 정이십면체를 흔들고 **면을 쪼개** 각진 주름을 낸다 */
function 구김지오(반지름, 씨) {
  const g = new THREE.IcosahedronGeometry(반지름, 2);
  const rnd = makeRandom(씨);
  const pos = g.attributes.position;
  const 맵 = new Map();
  for (let i = 0; i < pos.count; i++) {
    const 키 = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!맵.has(키)) 맵.set(키, 0.72 + rnd() * 0.5);
    const k = 맵.get(키);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.78, pos.getZ(i) * k);
  }
  const 쪼갠 = g.toNonIndexed();
  g.dispose();
  쪼갠.computeVertexNormals();
  return 쪼갠;
}

/** 쓰레기 한 점의 생김새 — 원점이 바닥에 닿는 자리다 */
function 쓰레기모양({ id, 밝기 = 1 }) {
  const 지오 = useMemo(() => {
    const o = {};
    if (id === "페트병") {
      // 500 mL 생수병 — 꽃 모양 바닥 · 허리 홈 · 어깨 · 목
      o.병 = 돌림지오([
        [0, 0], [0.07, 0.004], [0.1, 0.02], [0.108, 0.05], [0.108, 0.22], [0.098, 0.245],
        [0.108, 0.27], [0.108, 0.46], [0.1, 0.52], [0.07, 0.6], [0.045, 0.64], [0.04, 0.68],
      ], 22);
      o.병.scale(1, 1, 0.82); // 한쪽이 밟혀 찌그러졌다
      o.띠 = new THREE.CylinderGeometry(0.11, 0.11, 0.13, 22, 1, true);
      o.띠.scale(1, 1, 0.82);
      o.마개 = new THREE.CylinderGeometry(0.044, 0.044, 0.05, 18);
      o.고리 = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 18);
    } else if (id === "요구르트병") {
      o.병 = 돌림지오([
        [0, 0], [0.05, 0], [0.062, 0.015], [0.066, 0.07], [0.052, 0.11], [0.06, 0.15],
        [0.066, 0.2], [0.058, 0.235], [0.046, 0.25], [0.046, 0.26],
      ], 18);
      o.뚜껑 = new THREE.CylinderGeometry(0.05, 0.05, 0.006, 18);
    } else if (id === "테이크아웃컵") {
      // 16 oz 투명 컵 — 아래가 좁다. 바닥에 남은 커피 · 돔 뚜껑
      o.컵 = new THREE.CylinderGeometry(0.15, 0.105, 0.46, 24, 1, true);
      o.바닥 = new THREE.CircleGeometry(0.105, 24);
      o.커피 = new THREE.CylinderGeometry(0.118, 0.103, 0.1, 24);
      o.뚜껑 = new THREE.CylinderGeometry(0.157, 0.157, 0.025, 24);
      o.돔 = new THREE.SphereGeometry(0.13, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    } else if (id === "세제통") {
      // 옆모습 — 손잡이 구멍이 뚫린 세제통. 눕혀 두어 라벨이 위를 본다
      const 판 = new THREE.Shape();
      판.moveTo(-0.2, 0); 판.lineTo(0.2, 0); 판.quadraticCurveTo(0.23, 0, 0.23, 0.04);
      판.lineTo(0.23, 0.56); 판.quadraticCurveTo(0.23, 0.66, 0.12, 0.7); 판.lineTo(0.02, 0.7);
      판.lineTo(-0.06, 0.62); 판.lineTo(-0.2, 0.62); 판.quadraticCurveTo(-0.23, 0.62, -0.23, 0.58);
      판.lineTo(-0.23, 0.04); 판.quadraticCurveTo(-0.23, 0, -0.2, 0);
      const 구멍 = new THREE.Path();
      구멍.moveTo(0.06, 0.4); 구멍.lineTo(0.17, 0.4); 구멍.quadraticCurveTo(0.19, 0.4, 0.19, 0.44);
      구멍.lineTo(0.19, 0.56); 구멍.quadraticCurveTo(0.15, 0.62, 0.1, 0.6); 구멍.lineTo(0.06, 0.52);
      구멍.closePath();
      판.holes.push(구멍);
      o.통 = new THREE.ExtrudeGeometry(판, { depth: 0.16, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 8 });
      o.통.translate(0, 0, -0.08);
      o.마개 = new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16);
    } else if (id === "칫솔") {
      const 판 = new THREE.Shape();
      판.moveTo(-0.3, -0.018); 판.quadraticCurveTo(-0.32, 0, -0.3, 0.02);
      판.quadraticCurveTo(-0.1, 0.032, 0.06, 0.012); 판.lineTo(0.2, 0.012);
      판.quadraticCurveTo(0.29, 0.016, 0.29, 0); 판.quadraticCurveTo(0.29, -0.016, 0.2, -0.012);
      판.lineTo(0.06, -0.012); 판.quadraticCurveTo(-0.1, -0.03, -0.3, -0.018);
      o.손잡이 = new THREE.ExtrudeGeometry(판, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
      o.손잡이.rotateX(-Math.PI / 2);
      o.털 = new THREE.BoxGeometry(0.013, 0.05, 0.013);
    } else if (id === "빨대") {
      const 길 = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.3, 0, 0), new THREE.Vector3(0.12, 0, 0),
        new THREE.Vector3(0.2, 0.02, 0.05), new THREE.Vector3(0.24, 0.03, 0.16),
      ]);
      o.빨대 = new THREE.TubeGeometry(길, 40, 0.014, 8, false);
    } else if (id === "영수증") {
      // 감열지 한 장 — 한쪽 끝이 **돌돌 말려** 올라간다
      const g = new THREE.PlaneGeometry(0.2, 0.62, 1, 40);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i); // −0.31 ~ 0.31
        const t = Math.max(0, (y - 0.06) / 0.25); // 위쪽 끝만 말린다
        const 각 = t * Math.PI * 1.5;
        const r = 0.045;
        const ny = t > 0 ? 0.06 + Math.sin(각) * r : y;
        const nz = t > 0 ? (1 - Math.cos(각)) * r : 0;
        pos.setXYZ(i, pos.getX(i), ny, nz + Math.sin(y * 9) * 0.004);
      }
      g.computeVertexNormals();
      g.rotateX(-Math.PI / 2);
      o.종이 = g;
    } else {
      o.큰 = 구김지오(0.13, 7);
      o.작은 = 구김지오(0.09, 13);
    }
    return o;
  }, [id]);
  useEffect(() => () => Object.values(지오).forEach((g) => g.dispose()), [지오]);

  const 툰 = (색, 배 = 1, 덧 = {}) => (
    <meshToonMaterial color={색밝기(색, 밝기 * 배)} gradientMap={TOON_GRADIENT} {...덧} />
  );
  const 테 = <Outlines thickness={2} color="#131416" />;
  const 투명 = { transparent: true, opacity: 0.62, depthWrite: false };

  if (id === "페트병")
    return (
      <group rotation={[0, 0, Math.PI / 2]} position={[0.34, 0.09, 0]}>
        <mesh geometry={지오.병} castShadow>{툰("#bfe3f2", 1.05, 투명)}{테}</mesh>
        <mesh geometry={지오.띠} position={[0, 0.36, 0]}>
          <meshToonMaterial map={인쇄텍스처("생수")} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh geometry={지오.고리} position={[0, 0.655, 0]}>{툰("#2f7ad8")}</mesh>
        <mesh geometry={지오.마개} position={[0, 0.69, 0]} castShadow>{툰("#2f7ad8")}{테}</mesh>
      </group>
    );
  if (id === "요구르트병")
    return (
      <group rotation={[0, 0, 1.3]} position={[0.1, 0.06, 0]}>
        <mesh geometry={지오.병} castShadow>
          <meshToonMaterial map={인쇄텍스처("요구르트")} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} />
          {테}
        </mesh>
        {/* 반쯤 뜯긴 은박 뚜껑 */}
        <mesh geometry={지오.뚜껑} position={[0.01, 0.264, 0.012]} rotation={[0.5, 0, 0.2]}>{툰("#d8233b", 1.1)}</mesh>
      </group>
    );
  if (id === "테이크아웃컵")
    return (
      <group rotation={[0, 0, Math.PI / 2 - 0.06]} position={[0.22, 0.14, 0]}>
        <mesh geometry={지오.컵} position={[0, 0.23, 0]} castShadow>{툰("#e6f2f6", 1.05, { ...투명, side: THREE.DoubleSide })}{테}</mesh>
        <mesh geometry={지오.바닥} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>{툰("#e6f2f6", 1, 투명)}</mesh>
        {/* 다 못 마신 커피 — 이물질 묻은 채로 버리면 원래는 안 된다(힌트는 여기까지) */}
        <mesh geometry={지오.커피} position={[0, 0.05, 0]}>{툰("#5a3520", 1, { transparent: true, opacity: 0.85 })}</mesh>
        <mesh geometry={지오.뚜껑} position={[0, 0.47, 0]}>{툰("#f1f5f7", 1, 투명)}</mesh>
        <mesh geometry={지오.돔} position={[0, 0.482, 0]} scale={[1, 0.45, 1]}>{툰("#f1f5f7", 1, 투명)}</mesh>
      </group>
    );
  if (id === "세제통")
    return (
      <group rotation={[-Math.PI / 2, 0, 0.3]} position={[0, 0.1, 0]}>
        <mesh geometry={지오.통} castShadow>{툰("#1f63c9")}{테}</mesh>
        <mesh position={[-0.02, 0.3, 0.101]}>
          <planeGeometry args={[0.36, 0.34]} />
          <meshToonMaterial map={인쇄텍스처("세제")} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} transparent />
        </mesh>
        <mesh geometry={지오.마개} position={[0.07, 0.73, 0]}>{툰("#f07a1a")}{테}</mesh>
      </group>
    );
  if (id === "칫솔")
    return (
      <group position={[0, 0.025, 0]} rotation={[0, 0.2, 0]}>
        <mesh geometry={지오.손잡이} castShadow>{툰("#2fb3a2")}{테}</mesh>
        {/* 손잡이 고무 — 흰 띠 */}
        <mesh position={[-0.2, 0.02, 0]}>
          <boxGeometry args={[0.1, 0.04, 0.045]} />
          {툰("#e9f1ef")}
        </mesh>
        {/* 솔 — 털 뭉치 스물넷, 끝이 벌어졌다(다 쓴 칫솔이다) */}
        {Array.from({ length: 24 }, (_, i) => {
          const 줄 = i % 3, 칸 = Math.floor(i / 3);
          return (
            <mesh
              key={i}
              geometry={지오.털}
              position={[0.14 + 칸 * 0.018, 0.058, (줄 - 1) * 0.016]}
              rotation={[(줄 - 1) * 0.35, 0, (칸 - 3.5) * 0.06]}
            >
              {툰(칸 % 3 === 0 ? "#6fb9e8" : "#f4f6f8")}
            </mesh>
          );
        })}
      </group>
    );
  if (id === "빨대")
    return (
      <group position={[0, 0.016, 0]}>
        <mesh geometry={지오.빨대} castShadow>
          <meshToonMaterial map={인쇄텍스처("빨대")} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} />
          {테}
        </mesh>
      </group>
    );
  if (id === "영수증")
    return (
      <group position={[0, 0.012, 0]}>
        <mesh geometry={지오.종이} castShadow>
          <meshToonMaterial map={인쇄텍스처("영수증")} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  return (
    <group position={[0, 0.1, 0]}>
      <mesh geometry={지오.큰} castShadow>{툰("#f3f4f1")}{테}</mesh>
      <mesh geometry={지오.작은} position={[0.18, -0.03, 0.07]} rotation={[0.6, 0.3, 0]}>{툰("#e8eae5")}{테}</mesh>
    </group>
  );
}

/** 통 하나 — 벽에 등을 대고 선 분리수거함 (실척 약 90 cm) */
const 통치수 = { 깊이: 1.25, 폭: 1.5, 몸높이: 2.72 };
function 쓰레기통({ 종류, 위치, 방향 = 1, 밝기 = 1, 칸수 = 4, 든수 = 0, 선 }) {
  const d = 방향;
  const 플 = 종류 === "플라";
  const { 깊이, 폭, 몸높이 } = 통치수;
  const 몸색 = 플 ? "#2d64a8" : "#50574d";
  const 뚜껑색 = 플 ? "#3b77c0" : "#5f675b";
  const 표지 = 통표지텍스처(종류);
  const 몸텍 = 통몸텍스처(종류);
  const 튐ref = useRef(null);
  const 몸지오 = useMemo(() => 테이퍼상자지오(깊이, 몸높이, 폭, 0.9), [깊이, 몸높이, 폭]);
  const 뚜껑지오 = useMemo(() => new THREE.BoxGeometry(깊이 + 0.1, 0.16, 폭 + 0.1), [깊이, 폭]);
  useEffect(() => () => { 몸지오.dispose(); 뚜껑지오.dispose(); }, [몸지오, 뚜껑지오]);
  // 틀린 것을 받으면 투입구 둘레가 0.6 초 붉게 튄다
  useFrame(() => {
    const m = 튐ref.current?.material;
    if (!m) return;
    const 지남 = performance.now() / 1000 - 쓰레기튄때();
    const 튐 = 튄통() === 종류 && 지남 < 0.6 && Math.floor(지남 * 10) % 2 === 0;
    m.color.set(튐 ? "#ff3b2f" : "#0a0b0d");
  });
  // 앞면이 비스듬하다(테이퍼) — 표지를 그 면에 붙인다
  // ★ 몸통 **가운데(깊이/2)** 에서 반 깊이만큼 앞이 앞면이다. 반 깊이만 쓰면 표지가
  //   몸통 속에 파묻힌다(실제로 그렇게 안 보였다).
  //   ★ 위가 넓은 통이라 표지 **윗단**에서 앞면이 더 나와 있다 — 가운데 기준으로
  //     0.008 만 띄우면 윗단(제목 띠)이 몸통 속에 묻힌다. 표지 윗단 높이로 잰다.
  const 앞x = (y) => 깊이 / 2 + (깊이 / 2) * (0.9 + 0.1 * ((y + 0.7 - 0.06) / 몸높이)) + 0.012;
  const 돌 = d > 0 ? Math.PI / 2 : -Math.PI / 2;
  const 윗면 = 몸높이 + 0.2;
  return (
    <group position={위치}>
      {/* 몸통 */}
      <mesh geometry={몸지오} position={[d * (깊이 / 2), 몸높이 / 2 + 0.06, 0]} castShadow receiveShadow>
        <meshToonMaterial map={몸텍} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} />
        {선 ? <만화선 geo={몸지오} 선={선} /> : null}
        <Outlines thickness={3} color="#111214" />
      </mesh>
      {/* 아랫단 받침 — 어두운 띠. 통이 바닥에 **앉은** 것으로 보인다 */}
      <mesh position={[d * (깊이 / 2), 0.07, 0]}>
        <boxGeometry args={[깊이 * 0.93, 0.14, 폭 * 0.93]} />
        <meshToonMaterial color={색밝기("#1c1e21", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 허리 보강대 두 줄 — 사출 통 특유의 두꺼운 띠 */}
      {/* ★ 표지(1.55 ± 0.65) 위아래로 비켜 둔다 — 겹치면 표지 제목 띠를 가린다 */}
      {[0.5, 2.4].map((y) => {
        const k = 0.9 + 0.1 * (y / 몸높이);
        return (
          <mesh key={y} position={[d * (깊이 / 2), y + 0.06, 0]}>
            <boxGeometry args={[깊이 * k + 0.04, 0.07, 폭 * k + 0.04]} />
            <meshToonMaterial color={색밝기(몸색, 밝기 * 0.85)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#111214" />
          </mesh>
        );
      })}
      {/* 뚜껑 — 두 단. 아래는 테, 위는 살짝 좁은 판 */}
      <mesh geometry={뚜껑지오} position={[d * (깊이 / 2), 몸높이 + 0.11, 0]} castShadow>
        <meshToonMaterial color={색밝기(뚜껑색, 밝기)} gradientMap={TOON_GRADIENT} />
        {선 ? <만화선 geo={뚜껑지오} 선={선} /> : null}
        <Outlines thickness={3} color="#111214" />
      </mesh>
      <mesh position={[d * (깊이 / 2 - 0.04), 몸높이 + 0.2, 0]}>
        <boxGeometry args={[깊이 * 0.86, 0.04, 폭 * 0.88]} />
        <meshToonMaterial color={색밝기(뚜껑색, 밝기 * 1.12)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 뒤쪽 경첩 봉 */}
      <mesh position={[d * 0.06, 몸높이 + 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 폭 * 0.8, 10]} />
        <meshToonMaterial color={색밝기("#2a2d31", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 투입구 — 플라스틱은 **둥근 구멍**(병이 들어가는 모양), 일반은 **여닫이 날개** */}
      {플 ? (
        <group position={[d * (깊이 * 0.62), 윗면 + 0.012, 0]}>
          <mesh ref={튐ref} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.3, 28]} />
            <meshBasicMaterial color="#0a0b0d" toneMapped={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.31, 0.035, 8, 28]} />
            <meshToonMaterial color={색밝기("#1c4f8e", 밝기)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#111214" />
          </mesh>
        </group>
      ) : (
        <group position={[d * (깊이 * 0.62), 윗면 + 0.012, 0]}>
          <mesh ref={튐ref} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.46, 폭 * 0.62]} />
            <meshBasicMaterial color="#0a0b0d" toneMapped={false} />
          </mesh>
          {/* 날개 — 안쪽으로 조금 밀려 들어가 있다(방금 누가 넣은 것처럼) */}
          <mesh position={[d * 0.02, -0.03, 0]} rotation={[0, 0, d * 0.35]}>
            <boxGeometry args={[0.46, 0.025, 폭 * 0.6]} />
            <meshToonMaterial color={색밝기(뚜껑색, 밝기 * 0.9)} gradientMap={TOON_GRADIENT} />
          </mesh>
        </group>
      )}
      {/* 표지 — 비스듬한 앞면에 붙인다 */}
      <mesh position={[d * 앞x(1.55), 1.55, 0]} rotation={[0, 돌, 0]}>
        <planeGeometry args={[폭 * 0.72, 폭 * 0.9]} />
        <meshToonMaterial map={표지} color={색밝기("#ffffff", Math.max(0.4, 밝기))} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 칸 표시 — 제 몫의 수만큼. 제대로 들어갈 때마다 하나씩 초록으로 찬다 */}
      <mesh position={[d * (깊이 + 0.056), 몸높이 + 0.11, 0]}>
        <boxGeometry args={[0.012, 0.1, 폭 * 0.7]} />
        <meshToonMaterial color={색밝기("#1a1c1f", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {Array.from({ length: 칸수 }, (_, i) => (
        <mesh key={i} position={[d * (깊이 + 0.064), 몸높이 + 0.11, (i - (칸수 - 1) / 2) * 0.24]}>
          <boxGeometry args={[0.012, 0.06, 0.17]} />
          <meshBasicMaterial color={i < 든수 ? "#7dffa8" : "#2a302c"} toneMapped={false} />
        </mesh>
      ))}
      {/* 일반쓰레기 통 — 발판. 뚜껑을 발로 여는 통이라는 신호 */}
      {!플 && (
        <mesh position={[d * (깊이 * 0.95 + 0.08), 0.1, 0]}>
          <boxGeometry args={[0.2, 0.06, 0.42]} />
          <meshToonMaterial color={색밝기("#23262a", 밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#111214" />
        </mesh>
      )}
      {/* 뒷바퀴 둘 */}
      {[-1, 1].map((sz) => (
        <mesh key={sz} position={[d * 0.12, 0.13, sz * 폭 * 0.42]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.1, 16]} />
          <meshToonMaterial color={색밝기("#141517", 밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0b0c0d" />
        </mesh>
      ))}
      {/* 전선이 통에서 나가는 자리 — 뒤쪽 위 고무 부싱 */}
      <mesh position={[d * 0.08, 몸높이 - 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.1, 12]} />
        <meshToonMaterial color={색밝기("#1a1b1d", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
    </group>
  );
}

/** 바닥 얼룩 — 통 둘레에 흘러 말라붙은 자국 */
function 얼룩텍스처() {
  const 키 = "통얼룩";
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  const rnd = makeRandom(404);
  for (let i = 0; i < 9; i++) {
    const x = 60 + rnd() * 136, y = 60 + rnd() * 136, r = 20 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(22,18,12,0.5)");
    gr.addColorStop(0.7, "rgba(22,18,12,0.28)");
    gr.addColorStop(1, "rgba(22,18,12,0)");
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _라벨캐시.set(키, t);
  return t;
}

// ── 전류가 흐르는 전선 ─────────────────────────────────────────
// [그림]  고무 피복 전선 위에 **한 겹 더 굵은 빛의 관**을 씌운다. 관은 셰이더로
//   「앞머리까지만」 보이고, 그 안에서 빛 덩이가 액자 쪽으로 줄지어 흘러간다.
//   값이 1 을 넘는 만큼 Bloom 이 번지게 해 **전기가 흐르는 것**처럼 읽힌다.
// [왜 셰이더인가]  빛 덩이를 메시로 수십 개 굴리면 매 프레임 자리를 다 옮겨야 한다.
//   관 하나에 시간만 넘기면 GPU 가 알아서 흘린다.
const 전류버텍스 = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const 전류프래그 = /* glsl */ `
  uniform float uProg;   // 앞머리 자리 0~1
  uniform float uTime;
  uniform float uLen;    // 선 길이(유닛) — 빛 덩이 간격을 길이와 무관하게 맞춘다
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float u = vUv.x;
    if (u > uProg) discard;
    float d = u * uLen;
    float pulse = pow(fract(d / 0.9 - uTime * 2.2), 10.0);
    float ripple = 0.5 + 0.5 * sin(d * 7.0 - uTime * 11.0);
    float head = smoothstep(uProg - 0.6 / uLen, uProg, u);
    float a = 0.18 + 0.2 * ripple + pulse * 1.6 + head * 2.4;
    gl_FragColor = vec4(uColor * a, clamp(a, 0.0, 1.0));
  }
`;
function 전류재질() {
  return new THREE.ShaderMaterial({
    vertexShader: 전류버텍스,
    fragmentShader: 전류프래그,
    uniforms: {
      uProg: { value: 0 },
      uTime: { value: 0 },
      uLen: { value: 10 },
      uColor: { value: new THREE.Color("#8fe6ff") },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** 꺾이는 데를 둥글린 꺾은선 — 벽·천장을 타는 전선은 직각으로 붙어 가다 모서리에서 휜다 */
function 둥근꺾은선(점들, 반경 = 0.25) {
  const v = 점들.map((p) => new THREE.Vector3(...p));
  const 길 = new THREE.CurvePath();
  let 앞 = v[0].clone();
  for (let i = 1; i < v.length - 1; i++) {
    const 들어옴 = v[i].clone().sub(v[i - 1]);
    const 나감 = v[i + 1].clone().sub(v[i]);
    const r = Math.min(반경, 들어옴.length() / 2, 나감.length() / 2);
    const a = v[i].clone().addScaledVector(들어옴.normalize(), -r);
    const b = v[i].clone().addScaledVector(나감.normalize(), r);
    if (a.distanceTo(앞) > 1e-4) 길.add(new THREE.LineCurve3(앞, a));
    길.add(new THREE.QuadraticBezierCurve3(a, v[i].clone(), b));
    앞 = b;
  }
  길.add(new THREE.LineCurve3(앞, v[v.length - 1].clone()));
  return 길;
}

const 흐름시간 = 2.4; // 통에서 액자까지 전류가 가는 시간(초)
function 전류선({ 점들, 통, 밝기 = 1, 선 }) {
  const 키 = 점들.flat().map((v) => v.toFixed(2)).join(",");
  const { 관, 빛관, 길이, 길, 집게 } = useMemo(() => {
    const 길 = 둥근꺾은선(점들, 0.3);
    const 길이 = 길.getLength();
    const 마디 = Math.max(40, Math.round(길이 * 12));
    // 벽에 박힌 전선 집게 — 1.1 유닛마다
    const 집게 = [];
    for (let s = 0.6; s < 길이 - 0.4; s += 1.1) 집게.push(길.getPointAt(s / 길이));
    return {
      관: new THREE.TubeGeometry(길, 마디, 0.034, 8, false),
      빛관: new THREE.TubeGeometry(길, 마디, 0.058, 8, false),
      길이,
      길,
      집게,
    };
  }, [키]); // eslint-disable-line react-hooks/exhaustive-deps
  const 빛재질 = useMemo(() => 전류재질(), []);
  useEffect(() => () => { 관.dispose(); 빛관.dispose(); }, [관, 빛관]);
  useEffect(() => () => 빛재질.dispose(), [빛재질]);
  const 빛ref = useRef(null);
  const 머리ref = useRef(null);
  useFrame(() => {
    const 시작 = 흐른때(통);
    const 지금 = performance.now() / 1000;
    const 흐름 = 시작 > 0 && 통완료(통);
    const 진행 = 흐름 ? Math.min(1, (지금 - 시작) / 흐름시간) : 0;
    빛재질.uniforms.uProg.value = 진행;
    빛재질.uniforms.uTime.value = 지금;
    빛재질.uniforms.uLen.value = 길이;
    // ★ visible 은 **끄지 않는다.** 처음 보이는 순간 셰이더를 새로 컴파일하느라 화면이
    //   몇 초 멈췄다(그래서 액자 불이 한참 늦게 들었다). 진행 0 이면 셰이더가 전부 버린다.
    // 앞머리 불똥 — 가는 동안만. 파닥이며 튄다(안 쓸 때는 크기 0)
    const h = 머리ref.current;
    if (h) {
      const 감 = 진행 > 0 && 진행 < 1;
      if (감) h.position.copy(길.getPointAt(진행));
      h.scale.setScalar(감 ? 0.7 + Math.random() * 0.8 : 0.0001);
    }
  });
  return (
    <group>
      <mesh geometry={관} castShadow>
        <meshToonMaterial color={색밝기("#23262a", 밝기)} gradientMap={TOON_GRADIENT} />
        {선 ? <만화선 geo={관} 선={{ ...선, 외곽선: false, 주름선: false }} /> : null}
      </mesh>
      {집게.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshToonMaterial color={색밝기("#8b9097", 밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}
      <mesh ref={빛ref} geometry={빛관} material={빛재질} />
      <mesh ref={머리ref} scale={0.0001}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshBasicMaterial color={new THREE.Color("#dff8ff").multiplyScalar(4)} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** 쓰레기 자리 — 통 둘레 바닥. [x, z, 돌림] (통이 바깥벽 z −41.9 · −40.1 에 선다) */
const 쓰레기자리 = {
  페트병: [-28.6, -43.1, 0.35],
  세제통: [-27.4, -41.6, -0.4],
  요구르트병: [-29.3, -38.7, 0.2],
  테이크아웃컵: [-28.1, -39.3, 1.2],
  칫솔: [-26.8, -42.7, 0.9],
  빨대: [-29.2, -41.0, -0.5],
  영수증: [-26.5, -40.1, 0.25],
  휴지: [-28.5, -37.8, 0],
};

function 분리수거({ V, 바깥x, 밝기함수, 충돌등록, 선 }) {
  const 전원 = use복도전원();
  void use쓰레기키(); // 쓰레기 자리가 바뀌면 다시 그린다(값은 아래에서 직접 읽는다)
  const 통들 = [
    { 종류: "일반", z: V.통z일반 },
    { 종류: "플라", z: V.통z플라 },
  ];
  const 통x = 바깥x + V.통띄움;
  const 일반수 = 쓰레기목록.filter((t) => t.종류 === "일반").length;
  const 플라수 = 쓰레기목록.length - 일반수;
  // 통은 사람보다 크다 — 걸어서 뚫고 지나가면 안 된다
  useEffect(() => {
    if (!충돌등록) return;
    const 풀기 = 통들.map((t) =>
      충돌등록(`분리수거통:${t.종류}`, {
        minX: 통x,
        maxX: 통x + 통치수.깊이 + 0.1,
        minZ: t.z - 통치수.폭 / 2 - 0.05,
        maxZ: t.z + 통치수.폭 / 2 + 0.05,
      }),
    );
    return () => 풀기.forEach((f) => f && f());
  }, [충돌등록, 통x, V.통z일반, V.통z플라]); // eslint-disable-line react-hooks/exhaustive-deps
  const 얼룩 = 얼룩텍스처();
  const 중심z = (V.통z일반 + V.통z플라) / 2;
  return (
    <group>
      {/* 통 둘레 바닥 얼룩 */}
      <mesh position={[통x + 1.6, 0.02, 중심z]} rotation={[-Math.PI / 2, 0, 0.4]}>
        <planeGeometry args={[4.2, 5.2]} />
        <meshBasicMaterial map={얼룩} transparent depthWrite={false} opacity={0.9} />
      </mesh>
      {통들.map((t) => (
        <group key={t.종류}>
          <강조 id={`분리수거:통:${t.종류}`} 기준={() => null} 확대={0} 세기={0.14}>
            <쓰레기통
              종류={t.종류}
              위치={[통x, 0.01, t.z]}
              방향={1}
              밝기={밝기함수(t.z)}
              칸수={t.종류 === "일반" ? 일반수 : 플라수}
              든수={통에든수(t.종류)}
              선={선}
            />
          </강조>
          <상호대상
            id={`분리수거:통:${t.종류}`}
            반경={1.1}
            거리={6.5}
            위치={() => [통x + 통치수.깊이 * 0.62, 통치수.몸높이 + 0.2, t.z]}
            라벨={`[E] ${통이름[t.종류]}에 버리기`}
            끔={() => !든쓰레기()}
            실행={() => 쓰레기버리기(t.종류)}
          />
        </group>
      ))}

      {쓰레기목록.map((t) => {
        if (쓰레기곳(t.id) !== "바닥") return null;
        const [x, z, 돌림] = 쓰레기자리[t.id];
        return (
          <group key={t.id}>
            <강조 id={`분리수거:${t.id}`} 기준={() => [x, 0.1, z]} 확대={0.12} 세기={0.5}>
              <group position={[x, 0.01, z]} rotation={[0, 돌림, 0]} scale={V.쓰레기크기}>
                {/* 어둠 속에선 형체만 — 비상 전원이 들어와야 무엇인지 보인다 */}
                <쓰레기모양 id={t.id} 밝기={밝기함수(z)} />
              </group>
            </강조>
            <상호대상
              id={`분리수거:${t.id}`}
              반경={0.85}
              거리={6.5}
              위치={() => [x, 0.25, z]}
              라벨={`[E] ${t.이름} 줍기`}
              /* 비상 전원 전에는 어둠 속이라 못 줍는다. 다 끝난 뒤에도 할 일이 없다 */
              끔={() => !전원 || 분리수거끝났나() || 작업등손찼나()}
              실행={() => 쓰레기줍기(t.id)}
            />
          </group>
        );
      })}
    </group>
  );
}

/** 손에 든 쓰레기 — 카메라 앞(구역 그룹 밖) */
export function 손에든쓰레기({ V }) {
  const 든 = use든쓰레기();
  if (!든) return null;
  return (
    <손에든것 물건id="쓰레기" 앞={V.손앞} 아래={V.손아래} 옆={V.손옆}>
      <group scale={V.쓰레기크기 * 0.8} rotation={[0.3, 0.5, 0]}>
        <쓰레기모양 id={든} 밝기={1} />
      </group>
    </손에든것>
  );
}

// ═══════════════════════════════════════════════════════════════
//  5-d. ⟦그림 퍼즐⟧ 그림 「막차」 + 객차 조명 시험반
// ═══════════════════════════════════════════════════════════════
// [그림 두 장]  바탕(창이 전부 꺼진 밤 풍경)과 **창빛**(불 든 창 · 새어 나온 빛만 그린
//   투명한 한 장)을 따로 그린다. 전류가 닿기 전에는 바탕만 보이고, 닿으면 창빛이
//   형광등처럼 껌뻑이며 얹힌다. 그래서 「어느 창이 켜지나」는 **전기가 와야** 안다.
// [창 여섯]  시험반 스위치도 여섯이다. 스위치 하나 = 창 하나의 불(창빛이 스위치를 그대로 따른다).
//   사람은 **바탕에** 그린다 — 불이 꺼진 창에서도 달빛 속 실루엣으로 보여야 「사람 있는 창은 켠다」가 풀린다.
//   (2026-10-01 사용자 지시: 다섯 → 여섯, 사람 있으면 켜고 없으면 끈다)

const 그림W = 2048, 그림H = 1366;
// 객차 창 여섯의 자리(그림 픽셀). 바탕·창빛이 **같은 값**을 봐야 빛이 창에 맞는다.
//   양 끝 문(차.x0+50~150 · 차.x1-150~-50) 사이에 들어가게 폭을 줄였다.
const 막차창 = Array.from({ length: 창수 }, (_, i) => ({
  x: 384 + i * 222,
  y: 606,
  w: 180,
  h: 150,
}));
/** 창 안에 앉은 사람 하나 — 머리 · 어깨. 바탕(달빛 실루엣)과 창빛(불빛 속 그림자)이 같은 자리를 쓴다 */
function 앉은사람(g, w, i, 색) {
  // 가운데(0.5)는 창틀 살이 사람을 가른다 — 좌우로만 앉힌다
  const px = w.x + w.w * [0.3, 0.7, 0.27][i % 3];
  g.fillStyle = 색;
  g.beginPath(); g.arc(px, w.y + w.h * 0.44, 17, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(px - 30, w.y + w.h); g.lineTo(px - 24, w.y + w.h * 0.62);
  g.quadraticCurveTo(px, w.y + w.h * 0.54, px + 24, w.y + w.h * 0.62);
  g.lineTo(px + 30, w.y + w.h); g.closePath(); g.fill();
}

/** 그린 붓결 — 이미 그린 그림에서 색을 떠서 짧은 붓질로 다시 얹는다 */
function 붓결입히기(g, W, H, 씨, 수 = 36000) {
  const 원 = g.getImageData(0, 0, W, H).data;
  const rnd = makeRandom(씨);
  g.save();
  g.lineCap = "round";
  for (let i = 0; i < 수; i++) {
    const x = rnd() * W, y = rnd() * H;
    const k = ((y | 0) * W + (x | 0)) * 4;
    const 흔들 = (rnd() - 0.5) * 18;
    const r = Math.min(255, Math.max(0, 원[k] + 흔들));
    const gg = Math.min(255, Math.max(0, 원[k + 1] + 흔들));
    const b = Math.min(255, Math.max(0, 원[k + 2] + 흔들 * 1.2));
    // 붓은 대체로 가로로 — 하늘은 더 눕히고, 아래(승강장)는 원근을 따라 기운다
    const 각 = (rnd() - 0.5) * 0.7 + (y > H * 0.78 ? (x / W - 0.5) * 0.5 : 0);
    // ★ 짧게. 16 px 넘게 끌면 경계를 가로질러 **어두운 털**이 선다(차체 테두리에서 그랬다)
    const 길 = 4 + rnd() * 8;
    g.strokeStyle = `rgba(${r | 0},${gg | 0},${b | 0},${0.22 + rnd() * 0.25})`;
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(x - Math.cos(각) * 길 / 2, y - Math.sin(각) * 길 / 2);
    g.lineTo(x + Math.cos(각) * 길 / 2, y + Math.sin(각) * 길 / 2);
    g.stroke();
  }
  g.restore();
}

/** 그림 바탕 — 밤 승강장에 선 막차. 창은 **전부 꺼져** 있다 */
function 막차바탕텍스처() {
  const 키 = "막차바탕";
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 그림W, H = 그림H;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = makeRandom(1987);

  // ── 하늘 — 위는 먹색 남빛, 지평선은 먼 읍내 불빛에 탁한 자줏빛 ──
  const 하늘 = g.createLinearGradient(0, 0, 0, H * 0.62);
  하늘.addColorStop(0, "#070c1a");
  하늘.addColorStop(0.45, "#16233f");
  하늘.addColorStop(0.8, "#34405e");
  하늘.addColorStop(1, "#5b4f5e");
  g.fillStyle = 하늘;
  g.fillRect(0, 0, W, H);
  // 달무리
  const 달x = 1640, 달y = 210;
  const 무리 = g.createRadialGradient(달x, 달y, 40, 달x, 달y, 520);
  무리.addColorStop(0, "rgba(236,226,188,0.42)");
  무리.addColorStop(0.25, "rgba(160,170,190,0.16)");
  무리.addColorStop(1, "rgba(120,130,160,0)");
  g.fillStyle = 무리;
  g.fillRect(0, 0, W, H * 0.7);
  // 별 — 크기를 달리하고, 밝은 몇은 십자 반짝임
  for (let i = 0; i < 320; i++) {
    const x = rnd() * W, y = rnd() * H * 0.45;
    const 밝 = rnd();
    g.fillStyle = `rgba(225,232,248,${0.25 + 밝 * 0.6})`;
    const r = 밝 > 0.96 ? 2.6 : 밝 > 0.8 ? 1.6 : 1;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (밝 > 0.975) {
      g.strokeStyle = "rgba(225,232,248,0.5)";
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
    }
  }
  // 구름 — 달빛에 윗면만 밝다
  for (let b = 0; b < 9; b++) {
    const cx = rnd() * W, cy = 120 + rnd() * 330, 폭 = 260 + rnd() * 420;
    for (let k = 0; k < 26; k++) {
      const x = cx + (rnd() - 0.5) * 폭, y = cy + (rnd() - 0.5) * 50;
      const rx = 40 + rnd() * 90, ry = 14 + rnd() * 26;
      const gr = g.createLinearGradient(0, y - ry, 0, y + ry);
      gr.addColorStop(0, "rgba(120,132,160,0.22)");
      gr.addColorStop(1, "rgba(20,26,44,0.22)");
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
    }
  }
  // 달 — 표면 얼룩까지
  g.fillStyle = "#f2e9c6";
  g.beginPath(); g.arc(달x, 달y, 66, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(190,176,130,0.45)";
  for (const [dx, dy, r] of [[-18, -10, 16], [14, 18, 11], [22, -22, 8], [-8, 26, 7]]) {
    g.beginPath(); g.arc(달x + dx, 달y + dy, r, 0, Math.PI * 2); g.fill();
  }

  // ── 먼 산 세 겹 — 멀수록 하늘빛에 묻힌다 ──
  const 산 = (기준, 높, 색, 씨) => {
    g.fillStyle = 색;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = 기준 - 높 * (0.5 + 0.3 * Math.sin(x * 0.0021 + 씨) + 0.15 * Math.sin(x * 0.0063 + 씨 * 2) + 0.05 * Math.sin(x * 0.021 + 씨 * 3));
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.fill();
  };
  산(640, 190, "#2a3350", 1.2);
  산(700, 150, "#1d2640", 2.7);
  // 둘째 겹 산자락의 읍내 불빛
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = 660 + rnd() * 70;
    g.fillStyle = `rgba(255,${190 + (rnd() * 50) | 0},120,${0.35 + rnd() * 0.5})`;
    g.fillRect(x, y, 2 + rnd() * 3, 2);
  }
  산(760, 90, "#131a2c", 4.1);
  // 지평선 안개
  const 안개 = g.createLinearGradient(0, 700, 0, 1000);
  안개.addColorStop(0, "rgba(90,100,130,0)");
  안개.addColorStop(1, "rgba(90,100,130,0.22)");
  g.fillStyle = 안개;
  g.fillRect(0, 700, W, 300);

  // ── 선로 · 자갈 ──
  g.fillStyle = "#181b21";
  g.fillRect(0, 985, W, 70);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${90 + rnd() * 60 | 0},${90 + rnd() * 55 | 0},${95 + rnd() * 50 | 0},0.5)`;
    g.fillRect(rnd() * W, 990 + rnd() * 62, 2 + rnd() * 3, 2);
  }
  // 레일 — 달빛에 윗면이 빛난다
  for (const y of [1003, 1040]) {
    g.fillStyle = "#2c3038"; g.fillRect(0, y, W, 9);
    g.fillStyle = "#a8b3c6"; g.fillRect(0, y, W, 2);
  }

  // ── 객차 ──
  const 차 = { x0: 190, x1: 1880, 위: 540, 아래: 968 };
  // 지붕 — 둥근 등, 환기구
  g.fillStyle = "#3b4146";
  g.beginPath();
  g.moveTo(차.x0 - 8, 차.위 + 26);
  g.quadraticCurveTo(차.x0 + 20, 차.위 - 26, 차.x0 + 90, 차.위 - 30);
  g.lineTo(차.x1 - 90, 차.위 - 30);
  g.quadraticCurveTo(차.x1 - 20, 차.위 - 26, 차.x1 + 8, 차.위 + 26);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(170,180,200,0.35)"; // 지붕 모서리 달빛
  g.fillRect(차.x0 + 90, 차.위 - 30, 차.x1 - 차.x0 - 180, 4);
  for (let x = 차.x0 + 180; x < 차.x1 - 150; x += 230) {
    g.fillStyle = "#2a2f33"; g.fillRect(x, 차.위 - 52, 90, 24);
    g.fillStyle = "rgba(170,180,200,0.3)"; g.fillRect(x, 차.위 - 52, 90, 3);
  }
  // 몸통 — 윗단 크림 · 아랫단 짙은 청록 · 붉은 가는 띠 (옛 비둘기호 도색)
  const 윗몸 = g.createLinearGradient(0, 차.위, 0, 800);
  윗몸.addColorStop(0, "#d9cfae");
  윗몸.addColorStop(1, "#b7ab89");
  g.fillStyle = 윗몸;
  g.fillRect(차.x0, 차.위 + 10, 차.x1 - 차.x0, 790 - 차.위);
  const 아랫몸 = g.createLinearGradient(0, 800, 0, 차.아래);
  아랫몸.addColorStop(0, "#2f5e66");
  아랫몸.addColorStop(1, "#1a3439");
  g.fillStyle = 아랫몸;
  g.fillRect(차.x0, 800, 차.x1 - 차.x0, 차.아래 - 800);
  g.fillStyle = "#a8322b";
  g.fillRect(차.x0, 792, 차.x1 - 차.x0, 10);
  // 입체감 — 둥근 차체 윗단에 달빛이 비껴 앉고, 아랫단엔 가로로 긴 반사 띠
  const 윗빛 = g.createLinearGradient(0, 차.위 + 10, 0, 차.위 + 70);
  윗빛.addColorStop(0, "rgba(255,250,230,0.35)");
  윗빛.addColorStop(1, "rgba(255,250,230,0)");
  g.fillStyle = 윗빛;
  g.fillRect(차.x0, 차.위 + 10, 차.x1 - 차.x0, 60);
  g.fillStyle = "rgba(170,210,215,0.18)";
  g.fillRect(차.x0, 842, 차.x1 - 차.x0, 12);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(차.x0, 930, 차.x1 - 차.x0, 38);
  // 양 끝 — 둥글게 말려 들어가는 그늘
  for (const [x, 방] of [[차.x0, 1], [차.x1, -1]]) {
    const gr = g.createLinearGradient(x, 0, x + 방 * 70, 0);
    gr.addColorStop(0, "rgba(0,0,0,0.4)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(방 > 0 ? x : x - 70, 차.위 + 10, 70, 차.아래 - 차.위 - 10);
  }
  // 차체 이음새 · 리벳
  g.strokeStyle = "rgba(60,55,40,0.45)";
  g.lineWidth = 2;
  for (let x = 차.x0 + 125; x < 차.x1; x += 250) {
    g.beginPath(); g.moveTo(x + 202, 차.위 + 12); g.lineTo(x + 202, 차.아래); g.stroke();
  }
  g.fillStyle = "rgba(60,55,40,0.5)";
  for (let x = 차.x0 + 20; x < 차.x1 - 10; x += 26) {
    g.beginPath(); g.arc(x, 차.위 + 22, 2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x, 956, 2, 0, Math.PI * 2); g.fill();
  }
  // 녹물 — 창 밑에서 흘러내린 자국
  for (let i = 0; i < 40; i++) {
    const x = 차.x0 + rnd() * (차.x1 - 차.x0), y = 760 + rnd() * 20, 길 = 40 + rnd() * 140;
    const gr = g.createLinearGradient(0, y, 0, y + 길);
    gr.addColorStop(0, "rgba(120,70,40,0.35)");
    gr.addColorStop(1, "rgba(120,70,40,0)");
    g.fillStyle = gr;
    g.fillRect(x, y, 2 + rnd() * 3, 길);
  }
  // 문 둘 — 양 끝. 작은 창 · 손잡이
  for (const x of [차.x0 + 50, 차.x1 - 150]) {
    g.fillStyle = "#c6bb98"; g.fillRect(x, 차.위 + 30, 100, 차.아래 - 차.위 - 40);
    g.strokeStyle = "#2c2c26"; g.lineWidth = 4; g.strokeRect(x, 차.위 + 30, 100, 차.아래 - 차.위 - 40);
    g.beginPath(); g.moveTo(x + 50, 차.위 + 30); g.lineTo(x + 50, 차.아래 - 10); g.stroke();
    g.fillStyle = "#11151b"; g.fillRect(x + 12, 차.위 + 60, 30, 90); g.fillRect(x + 58, 차.위 + 60, 30, 90);
    g.fillStyle = "#8d8f8a"; g.fillRect(x - 6, 700, 5, 150); g.fillRect(x + 101, 700, 5, 150);
  }
  // 창 여섯 — **전부 꺼진** 창. 유리에 달빛이 비껴 든다
  for (const w of 막차창) {
    // 창 둘레 — 고무 패킹 그늘 한 겹 + 창틀
    g.fillStyle = "rgba(60,50,30,0.35)";
    g.fillRect(w.x - 16, w.y - 14, w.w + 32, w.h + 30);
    g.fillStyle = "#2b2b24";
    g.fillRect(w.x - 10, w.y - 10, w.w + 20, w.h + 20);
    const 유리 = g.createLinearGradient(w.x, w.y, w.x + w.w, w.y + w.h);
    유리.addColorStop(0, "#1a2130");
    유리.addColorStop(1, "#0b0e14");
    g.fillStyle = 유리;
    g.fillRect(w.x, w.y, w.w, w.h);
    // 속 — 좌석 등받이 실루엣
    g.fillStyle = "rgba(40,46,58,0.8)";
    g.fillRect(w.x + 12, w.y + 86, 62, 64);
    g.fillRect(w.x + 106, w.y + 86, 62, 64);
    // 사람 — 불이 꺼져도 보이게 달빛에 비친 푸른 회색 실루엣으로(창빛이 켜지면 그 위에 덮인다)
    if (막차사람[막차창.indexOf(w)] === "1") 앉은사람(g, w, 막차창.indexOf(w), "rgba(150,168,196,0.62)");
    // 반쯤 내린 커튼
    g.fillStyle = "rgba(120,96,70,0.55)";
    g.fillRect(w.x, w.y, w.w, 26 + ((w.x * 7) % 30));
    // 달빛 반사 — 비스듬한 흰 줄
    g.fillStyle = "rgba(200,215,240,0.14)";
    g.beginPath();
    g.moveTo(w.x + 30, w.y + w.h); g.lineTo(w.x + 70, w.y + w.h); g.lineTo(w.x + 150, w.y); g.lineTo(w.x + 110, w.y);
    g.fill();
    // 창틀 가운데 살
    g.fillStyle = "#2b2b24";
    g.fillRect(w.x + w.w / 2 - 4, w.y, 8, w.h);
  }
  // 행선판 · 차 번호
  g.fillStyle = "#f1ede0"; g.fillRect(990, 812, 150, 40);
  g.strokeStyle = "#1c1c1a"; g.lineWidth = 3; g.strokeRect(990, 812, 150, 40);
  g.fillStyle = "#1c1c1a"; g.font = `bold 26px ${표지폰트}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("막차 ▸ 왜곡", 1065, 833);
  g.fillStyle = "#d9cfae"; g.font = `bold 22px ${표지폰트}`;
  g.fillText("비둘기 1987", 차.x0 + 340, 900);
  // 대차 · 바퀴
  g.fillStyle = "#0f1115";
  g.fillRect(차.x0 + 10, 차.아래, 차.x1 - 차.x0 - 20, 22);
  for (const bx of [420, 1640]) {
    g.fillStyle = "#171a1f"; g.fillRect(bx - 130, 970, 260, 34);
    for (const wx of [bx - 80, bx + 80]) {
      g.fillStyle = "#0c0e11"; g.beginPath(); g.arc(wx, 1005, 40, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(160,170,190,0.45)"; g.lineWidth = 3; g.beginPath(); g.arc(wx, 1005, 32, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
      g.fillStyle = "#3a3f47"; g.beginPath(); g.arc(wx, 1005, 10, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = "#2d3239"; g.lineWidth = 5;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(bx - 20 + k * 12, 972); g.lineTo(bx - 14 + k * 12, 998); g.stroke(); }
  }
  // 차체 아래 그늘
  g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(차.x0, 차.아래 - 30, 차.x1 - 차.x0, 30);

  // ── 승강장 — 원근을 따라 모이는 타일 · 노란 점자 블록 · 물웅덩이 ──
  const 바닥 = g.createLinearGradient(0, 1055, 0, H);
  바닥.addColorStop(0, "#3f444c");
  바닥.addColorStop(1, "#23262c");
  g.fillStyle = 바닥;
  g.fillRect(0, 1055, W, H - 1055);
  g.strokeStyle = "rgba(20,22,26,0.6)";
  g.lineWidth = 2;
  const 소실x = W / 2;
  for (let x = -W; x < W * 2; x += 150) {
    g.beginPath(); g.moveTo(소실x + (x - 소실x) * 0.35, 1060); g.lineTo(x, H); g.stroke();
  }
  for (let k = 0; k < 7; k++) {
    const y = 1060 + Math.pow(k / 7, 1.7) * (H - 1060);
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  g.fillStyle = "#c9ad3e"; g.fillRect(0, 1060, W, 34);
  g.fillStyle = "rgba(90,70,20,0.55)";
  for (let x = 10; x < W; x += 22) for (const y of [1068, 1084]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#e6e0cc"; g.fillRect(0, 1055, W, 5); // 승강장 끝돌 모서리
  // 물웅덩이 — 객차를 거꾸로 비춘다
  g.save();
  g.beginPath(); g.ellipse(1180, 1230, 330, 52, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#1c2230"; g.fillRect(800, 1170, 760, 130);
  g.fillStyle = "rgba(200,190,160,0.25)"; g.fillRect(800, 1178, 760, 20);
  g.fillStyle = "rgba(47,94,102,0.4)"; g.fillRect(800, 1198, 760, 30);
  g.restore();
  g.strokeStyle = "rgba(180,190,210,0.25)"; g.lineWidth = 2;
  g.beginPath(); g.ellipse(1180, 1230, 330, 52, 0, 0, Math.PI * 2); g.stroke();

  // ── 앞쪽 — 승강장 지붕 기둥 둘 · 매달린 역 이름판 · 가로등 · 기다리는 사람 ──
  g.fillStyle = "#0d1016";
  g.fillRect(0, 0, W, 64); // 지붕 끝
  for (const x of [70, 1960]) {
    g.fillRect(x - 22, 0, 44, H);
    g.fillStyle = "rgba(160,170,190,0.18)"; g.fillRect(x + 14, 0, 5, H); g.fillStyle = "#0d1016";
  }
  // 역 이름판 — 오른쪽 기둥에 매달림
  g.fillStyle = "#0d1016"; g.fillRect(1790, 64, 4, 70); g.fillRect(1946, 64, 4, 70);
  g.fillStyle = "#e9ecef"; g.fillRect(1760, 134, 220, 96);
  g.strokeStyle = "#1a3a8c"; g.lineWidth = 8; g.strokeRect(1764, 138, 212, 88);
  g.fillStyle = "#172033"; g.font = `900 48px ${표지폰트}`; g.fillText("왜 곡", 1870, 176);
  g.font = `bold 18px ${표지폰트}`; g.fillText("WAEGOK", 1870, 212);
  // 가로등 — 왼쪽, 불빛 원뿔
  g.fillStyle = "#0d1016"; g.fillRect(170, 380, 10, 700);
  g.fillRect(140, 370, 70, 16);
  const 등빛 = g.createRadialGradient(175, 395, 4, 175, 395, 230);
  등빛.addColorStop(0, "rgba(255,236,190,0.9)");
  등빛.addColorStop(0.1, "rgba(255,226,170,0.4)");
  등빛.addColorStop(1, "rgba(255,226,170,0)");
  g.fillStyle = 등빛; g.fillRect(0, 160, 420, 500);
  g.fillStyle = "rgba(255,230,180,0.06)";
  g.beginPath(); g.moveTo(150, 392); g.lineTo(200, 392); g.lineTo(340, 1070); g.lineTo(40, 1070); g.fill();
  // 기다리는 사람 — 우산을 든 뒷모습
  g.fillStyle = "#0a0c11";
  g.beginPath(); g.ellipse(310, 1025, 28, 34, 0, 0, Math.PI * 2); g.fill(); // 머리
  g.beginPath(); g.moveTo(270, 1060); g.quadraticCurveTo(310, 1040, 350, 1060); g.lineTo(362, 1250); g.lineTo(258, 1250); g.fill();
  g.fillRect(272, 1250, 30, 70); g.fillRect(318, 1250, 30, 70);
  g.strokeStyle = "#0a0c11"; g.lineWidth = 5; g.beginPath(); g.moveTo(350, 1110); g.lineTo(390, 930); g.stroke();
  g.beginPath(); g.moveTo(310, 950); g.quadraticCurveTo(390, 860, 480, 945); g.closePath(); g.fill();
  g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(310, 1322, 70, 12, 0, 0, Math.PI * 2); g.fill();

  // ── 유화 마감 — 붓결 · 캔버스 결 · 가장자리 어둡게 · 니스 누런 기 ──
  붓결입히기(g, W, H, 1987);
  g.globalAlpha = 0.05;
  for (let y = 0; y < H; y += 3) { g.fillStyle = y % 6 ? "#000" : "#fff"; g.fillRect(0, y, W, 1); }
  for (let x = 0; x < W; x += 3) { g.fillStyle = x % 6 ? "#000" : "#fff"; g.fillRect(x, 0, 1, H); }
  g.globalAlpha = 1;
  const 비네트 = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  비네트.addColorStop(0, "rgba(0,0,0,0)");
  비네트.addColorStop(1, "rgba(0,0,0,0.5)");
  g.fillStyle = 비네트; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(200,170,90,0.07)"; g.fillRect(0, 0, W, H);
  // 서명
  g.fillStyle = "rgba(220,205,160,0.7)"; g.font = `italic 34px Georgia, serif`; g.textAlign = "right";
  g.fillText("H.Y. '87", W - 110, H - 40);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  _라벨캐시.set(키, t);
  return t;
}

/** 창빛 — 불 든 창 · 새어 나온 빛 · 웅덩이에 비친 빛만. 나머지는 투명 */
function 막차창빛텍스처(켠칸) {
  const 정답 = String(켠칸 ?? "").padStart(막차창.length, "0"); // 지금 켜진 창(스위치 그대로)
  const 키 = `막차창빛|${정답}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 그림W, H = 그림H;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const rnd = makeRandom(88);
  막차창.forEach((w, i) => {
    if (정답[i] !== "1") return;
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    // 번지는 빛
    const 번짐 = g.createRadialGradient(cx, cy, 20, cx, cy, 240);
    번짐.addColorStop(0, "rgba(255,200,110,0.55)");
    번짐.addColorStop(1, "rgba(255,200,110,0)");
    g.fillStyle = 번짐;
    g.fillRect(cx - 260, cy - 260, 520, 520);
    // 방 안 — 따뜻한 형광 빛
    const 방 = g.createLinearGradient(0, w.y, 0, w.y + w.h);
    방.addColorStop(0, "#fff1c4");
    방.addColorStop(1, "#ffc567");
    g.fillStyle = 방;
    g.fillRect(w.x, w.y, w.w, w.h);
    // 좌석 등받이 · 앉은 사람 — **사람은 막차사람에 적힌 창에만**(빈 창은 좌석만 환하다)
    g.fillStyle = "rgba(120,80,40,0.55)";
    g.fillRect(w.x + 12, w.y + 86, 62, 64);
    g.fillRect(w.x + 106, w.y + 86, 62, 64);
    if (막차사람[i] === "1") 앉은사람(g, w, i, "rgba(70,45,25,0.85)");
    // 손잡이 줄
    g.strokeStyle = "rgba(110,80,50,0.6)"; g.lineWidth = 3;
    for (let k = 0; k < 3; k++) { const x = w.x + 32 + k * 58; g.beginPath(); g.moveTo(x, w.y); g.lineTo(x, w.y + 30); g.stroke(); g.beginPath(); g.arc(x, w.y + 36, 6, 0, Math.PI * 2); g.stroke(); }
    // 커튼 — 빛에 비쳐 주황으로
    g.fillStyle = "rgba(210,120,60,0.6)";
    g.fillRect(w.x, w.y, w.w, 26 + ((w.x * 7) % 30));
    // 창틀 살
    g.fillStyle = "rgba(43,43,36,0.9)";
    g.fillRect(w.x + w.w / 2 - 4, w.y, 8, w.h);
    // 승강장으로 쏟아진 빛 — 창 모양이 비스듬히 늘어진다
    const 쏟 = g.createLinearGradient(0, 1060, 0, 1300);
    쏟.addColorStop(0, "rgba(255,205,120,0.38)");
    쏟.addColorStop(1, "rgba(255,205,120,0)");
    g.fillStyle = 쏟;
    g.beginPath();
    g.moveTo(w.x - 10, 1058); g.lineTo(w.x + w.w + 10, 1058);
    g.lineTo(w.x + w.w + 90, 1300); g.lineTo(w.x - 60, 1300);
    g.fill();
    // 차체에 번진 빛 — 창 아래 크림색 판이 데워진다
    g.fillStyle = "rgba(255,190,110,0.18)";
    g.fillRect(w.x - 20, w.y + w.h + 10, w.w + 40, 30);
  });
  // 웅덩이 속 불빛 — 켜진 창이 흔들리며 비친다
  g.save();
  g.beginPath(); g.ellipse(1180, 1230, 330, 52, 0, 0, Math.PI * 2); g.clip();
  막차창.forEach((w, i) => {
    if (정답[i] !== "1") return;
    for (let k = 0; k < 6; k++) {
      g.fillStyle = `rgba(255,205,120,${0.25 + rnd() * 0.25})`;
      g.fillRect(w.x + (rnd() - 0.5) * 10, 1196 + k * 7, w.w, 3);
    }
  });
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _라벨캐시.set(키, t);
  return t;
}

function 명판텍스처(윗글, 아랫글, 바탕 = "#b89b52") {
  const 키 = `명판|${윗글}|${아랫글}|${바탕}`;
  if (_라벨캐시.has(키)) return _라벨캐시.get(키);
  const W = 512, H = 128;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 바탕);
  gr.addColorStop(0.5, "#ffffff22");
  gr.addColorStop(1, 바탕);
  g.fillStyle = 바탕; g.fillRect(0, 0, W, H);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#2a2418"; g.lineWidth = 6; g.strokeRect(4, 4, W - 8, H - 8);
  g.strokeStyle = "rgba(42,36,24,0.5)"; g.lineWidth = 2; g.strokeRect(14, 14, W - 28, H - 28);
  g.fillStyle = "#1e1a12"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `bold 50px ${표지폰트}`; g.fillText(윗글, W / 2, H * 0.4);
  g.font = `24px ${표지폰트}`; g.fillText(아랫글, W / 2, H * 0.76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _라벨캐시.set(키, t);
  return t;
}

/** 형광등이 붙듯 — 두어 번 껌뻑이다 선다(0~1) */
const 창점등 = (t) => (t < 0 ? 0 : 점등밝기(t));

/**
 * 벽에 걸린 액자 — 안쪽벽(−x 를 본다).
 * @param 도착점들 전선이 액자에 닿는 자리(월드) — 액자 쪽 전류 연출의 출발점
 */
function 벽그림({ 위치, 폭 = 2.6, 방향 = -1, 밝기 = 1, 선 }) {
  const d = 방향;
  const 높 = 폭 * (그림H / 그림W);
  const 바탕 = 막차바탕텍스처();
  // 창빛은 시험반 스위치를 그대로 따른다 — 젖히는 순간 그 창 불이 켜지고 꺼진다(무늬마다 한 번 그려 캐시)
  const 창빛 = 막차창빛텍스처(use창스위치키());
  const 명판 = 명판텍스처("막차", "— 왜곡역 개통 기념 · 1987 —");
  const 테 = 0.24; // 틀 폭
  const 돌 = [0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0];
  const 창빛ref = useRef(null);
  const 빛ref = useRef(null);
  const 등ref = useRef(null);
  const 테전류재질 = useMemo(() => 전류재질(), []);
  // 액자 테를 한 바퀴 도는 길 — 위 가운데에서 출발해 양쪽으로 갈라져 아래에서 만난다
  const 테길 = useMemo(() => {
    const x = d * 0.19, 반w = 폭 / 2 + 테 * 0.5, 반h = 높 / 2 + 테 * 0.5;
    const 한쪽 = (s) =>
      둥근꺾은선([[x, 반h, 0], [x, 반h, s * 반w], [x, -반h, s * 반w], [x, -반h, 0]], 0.08);
    return [-1, 1].map((s) => new THREE.TubeGeometry(한쪽(s), 80, 0.03, 6, false));
  }, [폭, 높, d]);
  useEffect(() => () => { 테길.forEach((g) => g.dispose()); 테전류재질.dispose(); }, [테길, 테전류재질]);
  useFrame(() => {
    // 두 선이 **다 닿은 뒤**부터 잰다 — 테를 도는 1.2 초, 그 뒤 창에 불
    const 닿음 = 통완료("일반") && 통완료("플라")
      ? Math.max(흐른때("일반"), 흐른때("플라")) + 흐름시간
      : Infinity;
    const 지금 = performance.now() / 1000;
    const 테진행 = Math.min(1, Math.max(0, (지금 - 닿음) / 1.2));
    테전류재질.uniforms.uProg.value = 테진행;
    테전류재질.uniforms.uTime.value = 지금;
    테전류재질.uniforms.uLen.value = 폭 + 높;
    const 켬 = 창점등(지금 - 닿음 - 1.2);
    const m = 창빛ref.current?.material;
    // ★ 여기도 visible 을 끄지 않는다(위 전류선 주석 — 처음 켤 때 컴파일로 멈춘다)
    if (m) m.opacity = 켬;
    if (빛ref.current) 빛ref.current.intensity = 켬 * 6;
    if (등ref.current) 등ref.current.material.color.setScalar(0.25 + 켬 * 2.2);
  });
  // 틀 — 짙은 호두나무 바깥 + 금박 안쪽 턱 + 리넨 속틀
  const 틀조각 = (두께x, 굵기, 여유) => {
    const W2 = 폭 / 2 + 여유, H2 = 높 / 2 + 여유;
    return [
      { 위치: [0, H2 - 굵기 / 2, 0], 크기: [두께x, 굵기, W2 * 2] },
      { 위치: [0, -H2 + 굵기 / 2, 0], 크기: [두께x, 굵기, W2 * 2] },
      { 위치: [0, 0, W2 - 굵기 / 2], 크기: [두께x, H2 * 2 - 굵기 * 2, 굵기] },
      { 위치: [0, 0, -W2 + 굵기 / 2], 크기: [두께x, H2 * 2 - 굵기 * 2, 굵기] },
    ];
  };
  const 바깥틀 = useMemo(() => 상자합치기(틀조각(0.14, 테, 테)), [폭, 높]); // eslint-disable-line react-hooks/exhaustive-deps
  const 금테 = useMemo(() => 상자합치기(틀조각(0.18, 0.05, 0.05)), [폭, 높]); // eslint-disable-line react-hooks/exhaustive-deps
  const 속틀 = useMemo(() => 상자합치기(틀조각(0.12, 0.06, 0.01)), [폭, 높]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { 바깥틀.dispose(); 금테.dispose(); 속틀.dispose(); }, [바깥틀, 금테, 속틀]);
  return (
    <group position={위치}>
      <강조 id="그림:막차" 기준={() => null} 확대={0} 세기={0.1}>
        <mesh geometry={바깥틀} position={[d * 0.07, 0, 0]} castShadow>
          <meshToonMaterial color={색밝기("#3e2616", 밝기)} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={바깥틀} 선={선} /> : null}
          <Outlines thickness={3} color="#0f0c09" />
        </mesh>
        <mesh geometry={금테} position={[d * 0.09, 0, 0]}>
          <meshToonMaterial color={색밝기("#b08a3e", 밝기 * 1.1)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh geometry={속틀} position={[d * 0.06, 0, 0]}>
          <meshToonMaterial color={색밝기("#cfc6ad", 밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
      </강조>
      {/* ★ 그림은 toon 재질에 **복도 밝기**를 곱한다. basic 으로 두면 어둠 속에서도
             그림만 환하게 떠 버린다. */}
      <mesh position={[d * 0.125, 0, 0]} rotation={돌}>
        <planeGeometry args={[폭, 높]} />
        <meshToonMaterial map={바탕} color={색밝기("#ffffff", 밝기 * 1.08)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 창빛 — 전류가 닿으면 껌뻑이며 얹힌다(더하기 섞기라 어두운 바탕 위에서만 빛난다) */}
      {/* ★ 바탕과 겨우 0.003 떨어져 있으면 **멀리서 깊이 싸움에 져서** 창빛이 안 보였다
             (가까이선 보이고 두세 걸음 물러서면 사라졌다). 띄우고 깊이 보정까지 건다. */}
      <mesh ref={창빛ref} position={[d * 0.14, 0, 0]} rotation={돌} renderOrder={2}>
        <planeGeometry args={[폭, 높]} />
        <meshBasicMaterial
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
          map={창빛}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          color={new THREE.Color(1.6, 1.45, 1.2)}
        />
      </mesh>
      {/* 액자 테를 도는 전류 — 양쪽으로 갈라져 한 바퀴 */}
      {테길.map((g, i) => (
        <mesh key={i} geometry={g} material={테전류재질} />
      ))}
      {/* 액자 위 그림등 — 창에 불이 들면 같이 켜진다 */}
      <group position={[0, 높 / 2 + 테 + 0.12, 0]}>
        <mesh position={[d * 0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.24, 8]} />
          <meshToonMaterial color={색밝기("#8a6c34", 밝기)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh position={[d * 0.26, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 폭 * 0.5, 14]} />
          <meshToonMaterial color={색밝기("#8a6c34", 밝기)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0f0c09" />
        </mesh>
        <mesh ref={등ref} position={[d * 0.26, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 폭 * 0.46, 10]} />
          <meshBasicMaterial color="#fff0c8" toneMapped={false} />
        </mesh>
      </group>
      {/* 창빛이 벽·바닥을 적시는 빛. ★ 처음부터 놓아 둔다(세기만 바꾼다) —
             빛 개수가 바뀌면 셰이더가 통째로 다시 컴파일돼 화면이 멈춘다(App 복도등 주석) */}
      <pointLight
        ref={빛ref}
        position={[d * 1.3, 0, 0]}
        color="#ffd79a"
        intensity={0}
        distance={9}
        decay={2}
      />
      {/* 놋쇠 명판 — 액자 아래 */}
      <mesh position={[d * 0.02, -높 / 2 - 테 - 0.2, 0]} rotation={돌}>
        <planeGeometry args={[1.0, 0.25]} />
        <meshToonMaterial map={명판} color={색밝기("#ffffff", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
    </group>
  );
}

/** 스위치 여섯 — 하나가 그림 속 창 하나의 불이다. 사람 있는 창은 켜고, 빈 창은 끈다.
 *  ★ 이름판(「객차 조명 시험반 · 창 1~6」)은 뺐다. 판 위에 휘갈긴 「창」 한 글자뿐이다. */
function 시험반({ 위치, 방향 = -1, 밝기 = 1, 선 }) {
  const d = 방향;
  const 산 = use그림전원();
  const 완전 = use완전전원();
  void use창스위치키();
  const 수 = 창수;
  const 간격 = 0.24;
  const 몸지오 = useMemo(() => new THREE.BoxGeometry(0.14, 0.66, 간격 * 수 + 0.3), []);
  useEffect(() => () => 몸지오.dispose(), [몸지오]);
  const 속밝기 = Math.max(0.35, 밝기);
  const 손잡이ref = useRef([]);
  useFrame((_, dt) => {
    for (let i = 0; i < 수; i++) {
      const o = 손잡이ref.current[i];
      if (!o) continue;
      // 위 = 켬. d 에 따라 같은 각이 위/아래로 갈린다(레버가 ±x 로 뻗으므로)
      const 목표 = (창스위치(i) ? 0.45 : -0.45) * d;
      o.rotation.z += (목표 - o.rotation.z) * Math.min(1, dt * 14);
    }
  });
  return (
    <group position={위치}>
      <강조 id={Array.from({ length: 수 }, (_, i) => `시험반:${i}`)} 기준={() => null} 확대={0} 세기={0.12}>
        <mesh geometry={몸지오} position={[d * 0.07, 0, 0]} castShadow receiveShadow>
          <meshToonMaterial color={색밝기("#3a3f46", 밝기)} gradientMap={TOON_GRADIENT} />
          {선 ? <만화선 geo={몸지오} 선={선} /> : null}
          <Outlines thickness={3} color="#0f1012" />
        </mesh>
      </강조>
      <힌트글
        글="창"
        색="#e9e2cf"
        크기={0.5}
        위치={[d * 0.143, 0.2, 0]}
        회전={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        밝기={속밝기}
      />
      {/* 전원 표시 — 그림에 전기가 오면 초록, 다 맞추면 흰빛 */}
      <mesh position={[d * 0.145, 0.2, (간격 * 수) / 2 + 0.06]}>
        <sphereGeometry args={[0.03, 10, 8]} />
        <meshBasicMaterial color={완전 ? "#e8fff0" : 산 ? "#7dffa8" : "#2a302c"} toneMapped={false} />
      </mesh>
      {Array.from({ length: 수 }, (_, i) => {
        const z = (i - (수 - 1) / 2) * 간격 * -d; // 화면 왼쪽부터 1~6 (그림 창 순서와 같다)
        return (
          <group key={i} position={[d * 0.14, -0.12, z]}>
            {/* 창 모양 작은 등 — 켠 칸이 노랗게 산다(전기가 와야 산다) */}
            <mesh position={[d * 0.005, 0.18, 0]}>
              <boxGeometry args={[0.012, 0.07, 0.11]} />
              <meshBasicMaterial color={산 && 창스위치(i) ? "#ffd978" : "#22262b"} toneMapped={false} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.03, 14]} />
              <meshToonMaterial color={색밝기("#8e959d", 속밝기)} gradientMap={TOON_GRADIENT} />
            </mesh>
            <group ref={(o) => (손잡이ref.current[i] = o)} position={[d * 0.02, 0, 0]} rotation={[0, 0, -0.45 * d]}>
              <mesh position={[d * 0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.016, 0.022, 0.12, 10]} />
                <meshToonMaterial color={색밝기("#c9d0d8", 속밝기)} gradientMap={TOON_GRADIENT} />
                <Outlines thickness={2} color="#131416" />
              </mesh>
            </group>
            <상호대상
              id={`시험반:${i}`}
              반경={0.12}
              거리={6}
              위치={() => [위치[0] + d * 0.2, 위치[1] - 0.12, 위치[2] + z]}
              라벨={`[E] ${i + 1}`}
              끔={() => !그림전원() || 완전전원()}
              실행={() => 창스위치토글(i)}
            />
          </group>
        );
      })}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  6. 퍼즐 전체를 놓는 컴포넌트
// ═══════════════════════════════════════════════════════════════
/**
 * @param 자리들  분기함 3곳 [{ z, 벽: "안"|"바깥", 글, 자국: {z, y, 벽, 칸번호, 글자} }]
 * @param 복도    { 바깥x, 안쪽x, 높이 }
 */
export function 작업등퍼즐({
  복도,
  V, // Leva 값 묶음(App.jsx 「작업등 퍼즐」 폴더)
  밝기함수, // 복도밝기(z) — 소품을 복도와 같은 규칙으로 어둡게
  막힘, // (x,z) => 막혔나. 램프를 벽 속에 내려놓지 않으려고 쓴다
  문id, // 차단기함 문 = 자물쇠. 하나의 이름으로 묶는다
  충돌등록, // (이름, 박스) => 풀기 — 분리수거함이 길을 막게 한다
  선,
}) {
  const 곳 = use작업등곳();
  const 전원 = use복도전원();
  const 완전 = use완전전원();
  const 해제됨 = use끝문해제();
  // ★ 차단기함 문이 열려 있나 — 열리면 자물쇠·걸쇠를 통째로 감춘다(아래).
  const 차단기문열림 = use열렸나(문id);

  // 진단 — 「상자는 바뀌는데 화면이 안 따라온다」를 가릴 때 이 두 값을 나란히 본다
  if (typeof window !== "undefined") {
    window.__퍼즐렌더 = (window.__퍼즐렌더 ?? 0) + 1;
    window.__퍼즐이아는곳 = 곳;
  }

  const { 바깥x, 안쪽x, z시작 = -60, 높이: 복도높이 = null } = 복도;
  const 벽x = (벽) => (벽 === "바깥" ? 바깥x : 안쪽x);
  const 벽방향 = (벽) => (벽 === "바깥" ? 1 : -1); // 함이 향하는 +x/-x

  // ── 분기함 세 곳 ────────────────────────────────────────
  //   자리는 Leva 로 뺀다. 「벽」은 코드로 고정한다 — 바깥벽에는 측면문이
  //   줄지어 있어서, 셋 다 바깥벽에 두면 문과 겹친다.
  //   ★ 자국 자리는 **함 자리와 따로** 받는다. B 는 널빤지로 막힌 옆문 옆에
  //     세우고, 자국은 그 **문짝(널빤지) 위**에 그린다 — 그러면 「왜 저 문이
  //     막혀 있나」와 「왜 여기에 자국이 있나」가 한 화면에서 같이 읽힌다.
  //     문짝은 벽보다 앞으로 나와 있으므로 띄움값도 따로 받는다.
  const 함들 = useMemo(
    () => [
      { 칸: "A", z: V.A_z, 벽: "안", 글: "A-1", 칸번호: V.A_칸, 글자: V.A_글자,
        자국z: V.A_자국z, 자국띄움: V.자국띄움 },
      { 칸: "B", z: V.B_z, 벽: "바깥", 글: "A-2", 칸번호: V.B_칸, 글자: V.B_글자,
        자국z: V.B_자국z, 자국띄움: V.B_자국띄움 },
      { 칸: "C", z: V.C_z, 벽: "안", 글: "A-3", 칸번호: V.C_칸, 글자: V.C_글자,
        자국z: V.C_자국z, 자국띄움: V.자국띄움 },
    ],
    [
      V.A_z, V.B_z, V.C_z,
      V.A_칸, V.B_칸, V.C_칸,
      V.A_글자, V.B_글자, V.C_글자,
      V.A_자국z, V.B_자국z, V.C_자국z,
      V.자국띄움, V.B_자국띄움,
    ],
  );

  // ── 점등 애니메이션 ──────────────────────────────────────
  //   꽂힌 칸이 바뀌는 순간부터 시각을 재서 점등곡선을 따른다.
  const 점등시각 = useRef(-99);
  const 앞곳 = useRef(곳);
  const 세기 = useRef(0); // 지금 꽂힌 칸의 밝기 0~1
  const 자국세기 = useMemo(
    () => Object.fromEntries(분기함칸.map((k) => [k, { current: 0 }])),
    [],
  );
  useEffect(() => {
    if (앞곳.current !== 곳) {
      앞곳.current = 곳;
      // 분기함에 꽂은 그 순간만 형광등처럼 껌뻑인다. 손에 들 때는 바로 켜진다.
      점등시각.current = 분기함칸.includes(곳) ? performance.now() / 1000 : -99;
      // 빛이 확 바뀌므로 그림자를 한 번 따라오게 한다(공용.jsx 그림자관리)
      그림자흔들기(1.2);
    }
  }, [곳]);

  useFrame(() => {
    const 꽂힘 = 분기함칸.includes(곳);
    let v = 0;
    if (꽂힘) {
      const t = performance.now() / 1000 - 점등시각.current;
      v = 점등밝기(t);
    }
    세기.current = v;
    for (const k of 분기함칸) 자국세기[k].current = 곳 === k ? v : 0;
  });

  // ── 램프가 지금 어디 서 있나 ─────────────────────────────
  //   "손" 일 때는 여기서 안 그린다 — App 쪽 `손에든것` 이 카메라 앞에 그린다.
  const 놓인자리 = 작업등바닥자리();
  const 램프자리 = useMemo(() => {
    if (곳 === "바닥")
      return {
        // 내려놓은 자리가 있으면 거기, 없으면 처음 굴러다니던 자리
        위치: 놓인자리 ?? [V.바닥x, V.바닥y, V.바닥z],
        회전: [Math.PI * 0.5, 0, V.바닥기울기],
      };
    const 함 = 함들.find((h) => h.칸 === 곳);
    if (!함) return null;
    const d = 벽방향(함.벽);
    return {
      위치: [
        // ★ 고리를 함 **앞으로** 내밀어 달았으므로 램프도 그 자리에 매단다.
        //   함 속에 두면 램프가 함 벽에 끼어 반쯤 파묻힌다.
        벽x(함.벽) + d * (V.함깊이 + 0.05),
        V.함y + V.함높이 * 0.34 - 0.62 * V.램프크기,
        함.z,
      ],
      회전: [0, 0, 0],
    };
  }, [곳, 놓인자리, 함들, V.바닥x, V.바닥y, V.바닥z, V.바닥기울기, V.함깊이, V.함y, V.함높이, V.램프크기]);

  // ── 걸쇠 두 장 ────────────────────────────────────────
  //   `번호자물쇠` 가 받는 모양 그대로다(자물쇠.jsx). 소화전 자물쇠에서
  //   화면 보며 맞춰 둔 비율을 옮겨 왔고, 이 함이 더 작아서 **길이만** 줄였다.
  //   원점이 「큰 구멍 한가운데」라, 좌우·위아래·깊이만 맞추면 쇠막대 길에 얹힌다.
  const 걸쇠문쪽 = useMemo(
    () => ({
      보이기: true,
      좌우: 0, 쇠막대맞춤: false, 위아래: 0, 깊이: -0.03,
      회전x: 0, 회전y: 10, 회전z: -180,
      // ★ 판을 키웠다(판폭 2.6 → 3.6 · 두께 0.49 → 0.72). 전에는 고리굵기의
      //   2.6 배 = 3.5 cm 짜리 판이라 화면에서 **회색 얼룩 두 점**으로 뭉갰다
      //   (사용자 지적 「자물쇠 고리 부분 문쪽 퀄리티 떨어지고」).
      구멍: 1.6, 판폭: 3.6, 두께: 0.72, 길이: 4.6, 날개: 3.4,
      나사수: 2, 나사날개: true, 나사색: "#5d6166", 나사크기: 0.6,
      색: "#838689",
    }),
    [],
  );
  const 걸쇠틀쪽 = useMemo(
    () => ({
      보이기: true,
      좌우: 0.03, 쇠막대맞춤: false, 위아래: 0, 깊이: -0.03,
      회전x: 0, 회전y: 0, 회전z: 0,
      // ★ 길이를 늘였다(9 → 20). 자물쇠를 문짝 안쪽으로 옮겼으므로 틀쪽 판이
      //   함 테두리에서 자물쇠 구멍까지 **건너와야** 「구멍에 꿴 것」이 된다.
      구멍: 1.6, 판폭: 3.6, 두께: 0.42, 길이: 18.0, 날개: 0,
      나사수: 2, 나사날개: false, 나사색: "#5d6166", 나사크기: 0.55,
      색: "#838689",
    }),
    [],
  );

  // 내려놓을 자리 — 사람 앞 바닥 한 점. 몸이 보는 쪽으로 `놓는거리` 만큼.
  const _놓기 = useMemo(() => [0, 0, 0], []);
  const 놓을자리 = () => {
    const 눈 = 플레이어시점.눈;
    const 각 = 플레이어시점.몸각 ?? 0;
    const dx = Math.sin(각);
    const dz = Math.cos(각);
    // ★ 벽 안에 놓이지 않게 **앞에서부터 물러나며** 빈 자리를 찾는다.
    //   벽을 마주 보고 내려놓으면 램프가 벽 속에 박히고, 그러면 다시 주울
    //   수도 없다(겨냥 대상이 벽 너머가 된다).
    let d = V.놓는거리;
    for (; d > 0.35; d -= 0.4) {
      const x = 눈.x + dx * d;
      const z = 눈.z + dz * d;
      if (!막힘 || !막힘(x, z)) break;
    }
    _놓기[0] = 눈.x + dx * d;
    _놓기[1] = V.바닥y;
    _놓기[2] = 눈.z + dz * d;
    return _놓기;
  };

  // ── [F] — 어디를 보고 있든 그냥 내려놓는다 ─────────────────
  // [왜 F 도 두나]
  //   [E] 내려놓기는 「바닥을 내려다볼 때만」 잡힌다(아래 상호대상 주석). 그게
  //   몸짓으로는 맞는데, 발표 중에 「E 눌렀는데 안 놓인다」가 나왔다 — 분기함이나
  //   문을 보고 있으면 그쪽이 먼저 잡히기 때문이다. F 는 겨냥과 상관없이 **손에
  //   든 램프를 앞 바닥에 놓는다.** 조작 안내에도 [F] 로 적는다.
  const 놓을자리ref = useRef(놓을자리);
  놓을자리ref.current = 놓을자리;
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "KeyF" || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 손에 든 것이 램프든 퓨즈든 **앞 바닥에** 내려놓는다
      if (쥔선()) {
        선놓기(); // 전선은 제자리(늘어진 상태)로 돌아간다 — 바닥에 두지 않는다
        return;
      }
      if (든쓰레기()) {
        쓰레기놓기(); // 쓰레기도 제자리 바닥으로 돌아간다
        return;
      }
      if (작업등곳() !== "손") return;
      작업등놓기(놓을자리ref.current());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 빛 — 손에 들었을 때(약함)와 꽂았을 때(셈)를 크게 벌린다. 그게 규칙이다.
  const 빛ref = useRef(null);
  useFrame(() => {
    const L = 빛ref.current;
    if (!L) return;
    // 콘솔·시험에서 「컴포넌트가 지금 어디로 알고 있나」를 바로 읽으려고 적어 둔다
    //   (상자의 값과 화면의 값이 어긋나는지 가리는 데 이것만 한 게 없다)
    L.userData.곳 = 곳;
    if (곳 === "손") {
      // 들고 다니는 동안 — **사람을 따라온다.** 눈보다 조금 아래·앞에 둬야
      //   손에 든 등처럼 읽히고, 발밑이 밝아져 걸어 다닐 수 있다.
      const 눈 = 플레이어시점.눈;
      const 각 = 플레이어시점.몸각 ?? 0;
      L.position.set(
        눈.x + Math.sin(각) * V.손빛앞,
        눈.y - V.손빛아래,
        눈.z + Math.cos(각) * V.손빛앞,
      );
      L.intensity = V.손세기;
      L.distance = V.손거리;
    } else if (분기함칸.includes(곳)) {
      if (램프자리) L.position.set(...램프자리.위치);
      L.intensity = V.꽂힘세기 * 세기.current;
      L.distance = V.꽂힘거리;
    } else {
      // ★ 바닥에 있어도 **켜져 있다.** 깜깜한 복도 끝에서 이 불빛 하나가
      //   「저기 뭔가 있다」의 전부고, 주우러 가는 이유 자체다.
      //   꺼진 램프를 어둠 속에서 찾으라고 하면 그건 퍼즐이 아니라 숨바꼭질이다.
      if (램프자리) L.position.set(...램프자리.위치);
      L.intensity = V.바닥세기;
      L.distance = V.바닥거리;
    }
  });

  return (
    <group>
      {/* ── 분기함 3개 ── */}
      {함들.map((h) => {
        const d = 벽방향(h.벽);
        const x = 벽x(h.벽);
        const 겨냥점 = [x + d * 0.35, V.함y, h.z];
        return (
          <group key={h.칸}>
            {/* 겨냥하면 함이 살짝 커지고 스스로 빛난다 —
                   글자를 읽지 않아도 「이게 만질 것」이 그 자리에서 보인다.
                   복도 소품이 전부 쓰는 방식이라 여기만 따로 놀지 않는다. */}
            <강조 id={`작업등:${h.칸}`} 기준={() => null} 확대={0} 세기={0.22}>
              <분기함
                위치={[x, V.함y, h.z]}
                방향={d}
                폭={V.함폭}
                높이={V.함높이}
                깊이={V.함깊이}
                글={h.글}
                때={V.함때}
                밝기={밝기함수(h.z) * V.함밝기}
                꽂힘={곳 === h.칸}
                천장높이={복도높이}
                선={선}
              />
            </강조>
            {/* [E] — 꽂기 / 뽑기
                   ★ 거리는 **사람 자리에서 잰 진짜 거리**다(상호작용.js).
                     함은 벽에 붙어 있고 사람은 복도 한가운데(폭 11)를 걷는다.
                     예전 값 3.2 로는 벽에 바짝 붙어도 5 유닛이라 **닿을 수가
                     없었다** — 그래서 E 를 눌러도 아무 일도 안 일어났다.
                     기본 손닿는거리(6)로 맞춘다. */}
            <상호대상
              id={`작업등:${h.칸}`}
              /* ★ 반경을 넉넉히 준 이유 — **3인칭 때문이다.**
                   반경은 「카메라 광선에서 옆으로 얼마나 벗어났나」의 절대
                   거리다(상호작용.js). 1인칭은 카메라가 눈에 있어 대상까지
                   2~3 유닛이지만, 3인칭은 카메라가 6~7 유닛 더 뒤다. 같은
                   반경이 화면에서는 **절반 이하 각도**로 줄어 조준이 깐깐해진다.
                   이 퍼즐은 30 유닛짜리 빈 구간에 혼자 있어서, 넉넉히 줘도
                   옆 대상을 가로챌 일이 없다. */
              반경={1.2}
              거리={6}
              위치={() => 겨냥점}
              라벨={곳 === h.칸 ? "[E] 작업등 빼기" : "[E] 작업등 꽂기"}
              끔={() => 곳 !== "손" && 곳 !== h.칸}
              실행={() => (곳 === h.칸 ? 작업등집기() : 작업등꽂기(h.칸))}
            />
          </group>
        );
      })}

      {/* ── 드러나는 분필 자국 ── */}
      {함들.map((h) => {
        const d = 벽방향(h.벽);
        const x = 벽x(h.벽) + d * h.자국띄움; // 벽(또는 문짝)에서 살짝 띄운다
        return (
          <분필자국
            key={`자국${h.칸}`}
            위치={[x, V.자국y, h.자국z]}
            회전={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
            크기={V.자국크기}
            칸번호={h.칸번호}
            글자={h.글자}
            색={V.자국색}
            씨={V.자국씨}
            세기참조={자국세기[h.칸]}
          />
        );
      })}

      {/* ── 램프 ── (손에 들었을 때는 App 쪽에서 그린다) */}
      {곳 !== "손" && 램프자리 && (
        <강조
          id="작업등:집기"
          기준={() => 램프자리.위치}
          확대={0.12}
          세기={0.6}
        >
          <group position={램프자리.위치} rotation={램프자리.회전}>
            <작업등모양
              크기={V.램프크기}
              쇠색={V.쇠색}
              고무색={V.고무색}
              전구색={V.전구색}
              켜짐={분기함칸.includes(곳) ? 세기.current : V.바닥켜짐}
              바닥반짝={곳 === "바닥" ? V.바닥반짝 : 0}
              선={선}
            />
          </group>
        </강조>
      )}

      {/* 빛 — 램프가 어디 있든 그 자리에서 나온다.
             ★ castShadow 를 켜지 않는다. 이 씬에서 그림자 한 번 다시 그리는 값이
               12 ms 다(공용.jsx 그림자관리 주석). 손에 들고 걷는 동안 그걸 내면
               복도에서 걷는 내내 끊긴다. 빛만으로도 '밝아졌다'는 충분히 읽힌다. */}
      {/* 램프는 늘 켜져 있다 — 바닥에 있을 때도. 그래서 빛도 늘 있다.
             (세기·거리만 상태에 따라 다르다: 바닥·손 = 배터리 · 꽂힘 = 전원) */}
      {/* ★ 조건 없이 늘 놓는다. 전에는 `램프자리 &&` 였는데, 램프자리는
             **손에 들었을 때 null** 이다(손에 든 그림은 App 쪽이 그린다).
             그래서 정작 들고 다닐 때 불이 하나도 안 났다 — 이 퍼즐에서
             제일 중요한 「들고 다니며 더듬는다」가 통째로 빠져 있었다.
             자리는 아래 useFrame 이 상태에 맞춰 매 프레임 옮긴다. */}
      <pointLight
        ref={빛ref}
        name="작업등:빛"
        color={V.불색}
        intensity={0}
        distance={V.꽂힘거리}
        decay={2}
        castShadow={false}
      />

      {/* ── 바닥에 놓였을 때만 집을 수 있다 ── */}
      {/* ★ 바닥에 놓인 물건이라 **눈높이보다 멀다.** 눈은 4.15, 램프는 0.4 라
             발밑에 서도 세로로만 3.7 이다. 거리 3 으로는 어떻게 서도 안 닿았다
             (동전 줍기가 같은 함정에 빠졌던 자리다 — App.jsx 동전줍기 주석). */}
      <상호대상
        id="작업등:집기"
        반경={1.2}
        거리={6}
        위치={() => {
          const c = 램프자리?.위치 ?? [V.바닥x, V.바닥y, V.바닥z];
          return [c[0], c[1] + 0.2, c[2]];
        }}
        라벨="[E] 작업등 집기"
        끔={() => 곳 !== "바닥"}
        실행={() => 작업등집기()}
      />
      {/* ── 아무 데나 내려놓기 ──────────────────────────────
             [어디에 놓이나]  **지금 보고 있는 바닥**이다. 사람 앞 `놓는거리`
             만큼 앞의 바닥 한 점을 대상으로 둔다.
             [왜 그 자리인가]  겨냥은 「화면 가운데에서 얼마나 벗어났나」로 고른다.
             이 점을 사람 코앞에 두면 **뭘 보든 항상 잡혀서** 분기함·문 같은
             다른 대상을 전부 가로챈다. 바닥에 두면 「내려다볼 때만」 잡힌다 —
             물건을 내려놓는 몸짓 그대로다. */}
      <상호대상
        id="작업등:놓기"
        /* 반경을 넉넉히 — 3인칭은 카메라가 뒤라 같은 반경이 화면에선 절반이다 */
        반경={2.0}
        거리={7}
        위치={() => 놓을자리()}
        라벨="[E] 작업등 내려놓기  ([F] 도 됨)"
        끔={() => 곳 !== "손"}
        실행={() => 작업등놓기(놓을자리())}
      />

      {/* ── 차단기함 + 자물쇠 ── */}
      {V.차단기보이기 && (
        <>
          <차단기함
            위치={[안쪽x, V.차단기y, V.차단기z]}
            방향={-1}
            폭={V.차단기폭}
            높이={V.차단기높이}
            깊이={V.차단기깊이}
            밝기={밝기함수(V.차단기z) * V.함밝기}
            문id={문id}
            올려짐={전원}
            onLever={() => {
              차단기올리기();
              그림자흔들기(2);
            }}
            선={선}
          />
          {/* ── 이어지는 퍼즐: 끝문 전기 잠금 해제 버튼 ──
                 끝문 바로 옆 안쪽벽. 전기가 오면 붉게 살고, 누르면 초록 → 문이 열린다. */}
          {/* ⟦분리수거 퍼즐⟧ 막힌 옆문 옆 바깥벽 — 통 둘 + 널린 쓰레기 */}
          <분리수거 V={V} 바깥x={바깥x} 밝기함수={밝기함수} 충돌등록={충돌등록} 선={선} />
          {/* 한 단어 힌트 — 통 위 벽에 「재질」. 칫솔·빨대가 왜 플라스틱이 아닌지 */}
          <힌트글
            글="재질"
            위치={[바깥x + 0.04, 통치수.몸높이 + 1.15, (V.통z일반 + V.통z플라) / 2]}
            회전={[0, Math.PI / 2, 0]}
            크기={1.3}
            밝기={밝기함수((V.통z일반 + V.통z플라) / 2)}
          />
          {/* ⟦그림 퍼즐⟧ 맞은편 안쪽벽 — 그림 「막차」 + 그 옆 스위치 */}
          <벽그림
            위치={[안쪽x - 0.02, V.그림y, V.그림z]}
            방향={-1}
            폭={V.그림폭}
            밝기={밝기함수(V.그림z)}
            선={선}
          />
          <시험반
            위치={[안쪽x, V.시험반y, V.그림z + V.시험반옆]}
            방향={-1}
            밝기={밝기함수(V.그림z)}
            선={선}
          />
          {/* 액자 → 스위치 — 짧은 전선관. 스위치가 **그림에서 전기를 받는** 물건으로 읽힌다 */}
          {(() => {
            const 그림높 = V.그림폭 * (그림H / 그림W);
            const 액자끝 = V.그림z - (V.그림폭 / 2 + 0.24);
            const 판끝 = V.그림z + V.시험반옆 + (0.24 * 5 + 0.3) / 2;
            const x = 안쪽x - 0.06;
            return (
              <전류선
                통="없음"
                밝기={밝기함수(V.그림z)}
                선={선}
                점들={[
                  [x, V.그림y - 그림높 * 0.25, 액자끝 + 0.02],
                  [x, V.그림y - 그림높 * 0.25, (액자끝 + 판끝) / 2],
                  [x, V.시험반y + 0.2, (액자끝 + 판끝) / 2],
                  [x, V.시험반y + 0.2, 판끝 - 0.02],
                ]}
              />
            );
          })()}
          {/* 통 → 바깥벽 → 천장 → 안쪽벽 → 액자. 통마다 한 가닥 */}
          {[
            ["일반", V.통z일반, -1],
            ["플라", V.통z플라, 1],
          ].map(([통, z, 쪽]) => {
            const 천장 = (복도높이 ?? 8) - 0.28;
            const 바x = 바깥x + 0.06;
            const 안x = 안쪽x - 0.06;
            const 그림높 = V.그림폭 * (그림H / 그림W);
            const 액자위 = V.그림y + 그림높 / 2 + 0.24;
            const 액자z = V.그림z + 쪽 * (V.그림폭 / 2 - 0.1);
            return (
              <전류선
                key={통}
                통={통}
                밝기={밝기함수(z)}
                선={선}
                점들={[
                  [바깥x + V.통띄움 + 0.08, 통치수.몸높이 - 0.1, z],
                  [바x, 통치수.몸높이 - 0.1, z],
                  [바x, 천장, z],
                  [(바x + 안x) / 2, 천장, (z + 액자z) / 2],
                  [안x, 천장, 액자z],
                  [안x, 액자위, 액자z],
                  [안x - 0.12, 액자위 - 0.06, 액자z],
                ]}
              />
            );
          })}
          <해제버튼
            위치={[안쪽x, V.차단기y + 0.35, z시작 + 2.2]}
            방향={-1}
            /* ★ 비상 전원(절반)으로는 안 산다 — 시험반까지 맞춰야 전기가 온다 */
            전원={완전}
            해제됨={해제됨}
            밝기={밝기함수(z시작 + 2.2) * V.함밝기}
            선={선}
          />
          {/* ── 자물쇠 + 걸쇠 ────────────────────────────────
                 ★ **문이 열리면 통째로 감춘다.**
                 [왜]  이 자물쇠는 문에 매달린 게 아니라 **월드 좌표**에 서 있다
                   (소화전 자물쇠와 같은 구조다). 그래서 문이 젖혀지면 걸쇠 두
                   장이 **허공에 남아** 회색 덩어리로 떠 보였다(사용자 지적:
                   「자물쇠 고리도 열렸을 때 저런식이면 안 돼」).
                   실물이라면 문쪽 걸쇠는 문을 따라 젖혀지고 틀쪽만 남는데,
                   둘이 한 컴포넌트라 따로 움직일 수가 없다. 문이 열린 뒤에는
                   어차피 볼 일이 없으므로 **같이 치우는 쪽**이 깔끔하다.
                 ※ 자물쇠 본체는 풀리는 순간 제 열림 동작(2.5 초)으로 빠져
                   나가 사라진다 — 그 연출은 그대로 보인다. */}
          {/* 3칸 번호 자물쇠 — 기존 자물쇠를 그대로 쓴다.
                 번호잠금.js 는 id 별 Map 이라 소화전 자물쇠와 안 엉킨다. */}
          {/* ── 3칸 번호 자물쇠 + 걸쇠 두 장 ──────────────────
                 [전에 무엇이 잘못됐나]  자물쇠를 `안쪽x − 깊이*0.55` 에 뒀는데,
                 그 x 는 **함 몸통 속**이다(몸통이 안쪽x−깊이 ~ 안쪽x 를 차지한다).
                 그래서 자물쇠가 테두리에 파묻혀 반쯤 갈려 보였다.
                 이제 **문짝 앞면보다 더 앞**에 세우고, 걸쇠 두 장을 문과 몸통에
                 걸쳐 놓는다 — 소화전 자물쇠와 같은 구성이라 「구멍에 걸린 것」이
                 눈으로 읽힌다. */}
          {!차단기문열림 && (
          <번호자물쇠
            위치={[
              // 문짝 앞면(안쪽x − 깊이 − 0.01 − 문두께/2)보다 자물쇠깊이만큼 더 앞
              안쪽x - V.차단기깊이 - 0.01 - 차단기문두께 / 2 - V.자물쇠깊이,
              V.차단기y + V.자물쇠높이,
              V.차단기z + V.차단기폭 / 2 + V.자물쇠옆,
            ]}
            회전={[0, -Math.PI / 2, 0]}
            /* 걸쇠 — 소화전에서 맞춰 둔 비율을 그대로 쓴다(같은 세계의 같은 철물) */
            문걸쇠={걸쇠문쪽}
            틀걸쇠={걸쇠틀쪽}
            크기={V.자물쇠크기}
            칸수={3}
            /* ★ 문과 **같은 id**. 그래야 「이 자물쇠 때문에 안 열린다」가
                 눈으로 읽히고, 덜컹거릴 때 문과 자물쇠가 같이 흔들린다. */
            잠금id={문id}
            정답={V.정답}
            /* 처음 보이는 번호(씨앗). 정답과 같으면 자물쇠.jsx 가 한 칸 밀어 준다 */
            맞춤={[V.씨1, V.씨2, V.씨3]}
            조작거리={V.자물쇠조작거리}
            밝기={밝기함수(V.차단기z)}
            선={선}
          />
          )}
        </>
      )}
    </group>
  );
}

/**
 * 손에 들었을 때 카메라 앞에 그리는 그림.
 *
 * ★ **구역(복도) 그룹 바깥**에 놓아야 한다. 들고 로비로 나가면 구역 최적화가
 *   복도를 끄는데, 이 그림이 그 안에 있으면 손에 든 램프까지 같이 사라진다.
 *   (동전·관창도 같은 이유로 바깥에 있다.)
 */
export function 손에든작업등({ V, 선 }) {
  const 곳 = use작업등곳();
  if (곳 !== "손") return null;
  return (
    <손에든것 물건id="작업등" 앞={V.손앞} 아래={V.손아래} 옆={V.손옆}>
      <group rotation={[V.손기울기, 0, V.손비틀기]}>
        <작업등모양
          크기={V.램프크기 * V.손크기}
          쇠색={V.쇠색}
          고무색={V.고무색}
          전구색={V.전구색}
          /* 배터리라 약하게 빛난다. 이 약함이 「꽂아야 읽힌다」의 근거다 */
          켜짐={V.손켜짐}
          선={선}
        />
      </group>
    </손에든것>
  );
}
