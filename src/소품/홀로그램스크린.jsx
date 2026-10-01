// 홀로그램스크린.jsx — 텔레포트 장치가 쏘는 '목적지 선택' 홀로그램 UI.
//
// [왜 메쉬가 아니라 코드인가]
//   글자가 선명해야 하고(메쉬는 뭉갬), 클릭·선택 같은 상호작용이 되어야 하며,
//   깜빡임·스캔라인·발광 빔 같은 홀로그램 연출을 자유롭게 넣어야 한다.
//   그래서 씬의 다른 질감처럼 **캔버스에 그려 평면에 얹고**, 클릭은 평면의
//   UV 를 캔버스 좌표로 바꿔 영역 판정(hit-test)한다.
//
// [지금 범위] 목적지 = 나주(NAJU-01) 하나만 선택 가능. 나머지는 '잠금'.
//   SELECT/RESET 동작 + 나주 클릭 체크까지. (기차 빛남·안내봇 유도 연출은 이후 단계)
//
// [조작] 마우스 커서가 자유로울 때 클릭된다. 1인칭 잠금 중에는 커서가 없으므로,
//   다음 단계에서 'E 로 스크린 앞에서 커서 풀기'(소지품 창과 같은 방식)를 붙인다.

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useSavedControls, 플레이어시점 } from "../공용.jsx";

const 라디안 = (도) => (도 * Math.PI) / 180;

// ── 스크린을 4px 만큼만 위로 ───────────────────────────────
// [왜 Leva 의 Y 기본값을 안 고쳤나 — 두 가지가 다 걸린다]
//   ① Y 는 **저장값(localStorage)이 코드 기본값을 이긴다**(공용.jsx
//      useSavedControls). 슬라이더를 한 번이라도 만진 화면에서는 기본값을
//      올려 봐야 아무 일도 안 일어난다. 그리고 저장값은 덮어쓰지 않는다.
//   ② 슬라이더 step 이 0.1 인데, 스크린을 보는 거리에서 0.1 유닛은 **약 19px**
//      이다. 4px 은 애초에 슬라이더로 집을 수 없는 값이다.
//   그래서 저장값 위에 **코드에서 더하는 값**으로 뒀다. 슬라이더로 맞춰 둔
//   자리를 그대로 두고 그 위로 딱 이만큼만 올라간다.
// [4px 이 왜 0.03 유닛인가]
//   fov 60 · 스크린까지 5.5 유닛이면 화면에 보이는 세로가
//   2 × 5.5 × tan30° = 6.35 유닛이다. 창 세로가 1000px 이면 1 유닛 ≈ 157px
//   → 4px ≈ 0.025 유닛. 창 크기·보는 거리에 따라 0.02~0.035 사이라
//   가운데인 0.03 으로 둔다. 더/덜 올리려면 이 숫자 하나만 만지면 된다
//   (0.0075 유닛 ≈ 1px).
const 살짝올림 = 0.03;

// 캔버스 해상도(픽셀). 평면 비율도 이 가로세로를 따른다.
const W = 1024,
  H = 620;

// 목적지 목록 — 지금은 나주만 열려 있다.
const 목적지들 = [
  { id: "naju", 이름: "나주", 영문: "NAJU-01 · 앙암바위", 열림: true },
  { id: "lock1", 이름: "???", 영문: "LOCKED · 준비 중", 열림: false },
  { id: "lock2", 이름: "???", 영문: "LOCKED · 준비 중", 열림: false },
];

// 대한민국 본토 외곽선(간략화). [경도(동), 위도(북)] — 북서쪽에서 시계방향.
const 한국외곽 = [
  [126.6, 37.75], [126.9, 38.3], [128.0, 38.35], [128.6, 38.55],
  [129.1, 37.6], [129.45, 36.9], [129.57, 36.05], [129.42, 35.6],
  [129.1, 35.1], [128.7, 34.95], [128.0, 34.75], [127.6, 34.6],
  [127.2, 34.5], [126.9, 34.55], [126.55, 34.3], [126.38, 34.75],
  [126.6, 35.15], [126.45, 35.7], [126.6, 36.0], [126.45, 36.45],
  [126.15, 36.75], [126.75, 36.95], [126.5, 37.35], [126.6, 37.75],
];
const 제주좌표 = [126.5, 33.4]; // 제주도
const 나주좌표 = [126.72, 35.03]; // 나주(첫 케이스 위치)
// 지도 그릴 화면 범위(위도에 제주까지 포함)
const 최소경도 = 125.9, 최대경도 = 129.75, 최소위도 = 33.0, 최대위도 = 38.7;

// ── 레이아웃 좌표(캔버스 픽셀) — 클릭 판정과 그리기가 같은 값을 쓴다 ──
const 목록X = 560,
  목록W = W - 목록X - 60,
  행H = 78,
  행0Y = 170,
  행간 = 14;
const 행사각 = (i) => ({ x: 목록X, y: 행0Y + i * (행H + 행간), w: 목록W, h: 행H });
const 셀렉트 = { x: 목록X, y: H - 110, w: 목록W / 2 - 12, h: 66 };
const 리셋 = { x: 목록X + 목록W / 2 + 12, y: H - 110, w: 목록W / 2 - 12, h: 66 };

function 둥근사각(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 홀로그램 UI 한 장을 캔버스에 그린다.
function UI그리기(g, st) {
  const 청록 = "#8fe6ff",
    밝청록 = "#d6f4ff",
    흐림 = "rgba(120,210,245,0.45)";
  g.clearRect(0, 0, W, H);

  // 패널 바탕 + 테두리
  둥근사각(g, 10, 10, W - 20, H - 20, 22);
  g.fillStyle = "rgba(12,34,50,0.52)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 청록;
  g.stroke();

  // 모서리 브래킷(SF 느낌)
  g.strokeStyle = 밝청록;
  g.lineWidth = 5;
  const b = 46;
  for (const [cx, cy, sx, sy] of [
    [26, 26, 1, 1], [W - 26, 26, -1, 1], [26, H - 26, 1, -1], [W - 26, H - 26, -1, -1],
  ]) {
    g.beginPath();
    g.moveTo(cx + sx * b, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + sy * b);
    g.stroke();
  }

  // 제목
  g.textBaseline = "top";
  g.fillStyle = 밝청록;
  g.font = "bold 44px 'Apple SD Gothic Neo', sans-serif";
  g.fillText("DESTINATIONS", 56, 40);
  g.fillStyle = 흐림;
  g.font = "22px 'Apple SD Gothic Neo', sans-serif";
  g.fillText("목 적 지  선 택", 58, 96);

  // 세로 구분선
  g.strokeStyle = "rgba(120,210,245,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(목록X - 30, 60);
  g.lineTo(목록X - 30, H - 60);
  g.stroke();

  // 왼쪽: 대한민국 지도 + 나주 위치
  const bx = 150, by = 132, bw = 240, bh = 424;
  const 좌 = (lon, lat) => [
    bx + ((lon - 최소경도) / (최대경도 - 최소경도)) * bw,
    by + (1 - (lat - 최소위도) / (최대위도 - 최소위도)) * bh, // 북쪽이 위
  ];
  // 본토 외곽선
  g.beginPath();
  한국외곽.forEach(([lo, la], i) => {
    const [x, y] = 좌(lo, la);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fillStyle = "rgba(90,200,240,0.14)";
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "rgba(150,230,255,0.8)";
  g.stroke();
  // 제주도
  {
    const [jx, jy] = 좌(제주좌표[0], 제주좌표[1]);
    g.beginPath();
    g.ellipse(jx, jy, 19, 10, 0, 0, Math.PI * 2);
    g.fillStyle = "rgba(90,200,240,0.14)";
    g.fill();
    g.stroke();
  }
  // 나주 표식 — 링 + 빛나는 점 + 지시선 + 라벨
  const [nx, ny] = 좌(나주좌표[0], 나주좌표[1]);
  g.strokeStyle = "rgba(190,245,255,0.85)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(nx, ny, 15, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#eafcff";
  g.shadowColor = "#9be9ff";
  g.shadowBlur = 16;
  g.beginPath();
  g.arc(nx, ny, 7, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(190,245,255,0.6)";
  g.beginPath();
  g.moveTo(nx, ny);
  g.lineTo(nx + 44, ny + 30);
  g.stroke();
  g.textBaseline = "top";
  g.font = "bold 26px 'Apple SD Gothic Neo', sans-serif";
  g.fillStyle = 밝청록;
  g.fillText("나주", nx + 50, ny + 20);
  g.font = "15px 'Apple SD Gothic Neo', sans-serif";
  g.fillStyle = 흐림;
  g.fillText("NAJU-01", nx + 50, ny + 48);

  // 오른쪽: 목적지 목록
  목적지들.forEach((d, i) => {
    const r = 행사각(i);
    const 켜짐 = d.열림;
    const 뽑힘 = st.선택 === d.id;
    둥근사각(g, r.x, r.y, r.w, r.h, 12);
    g.fillStyle = 뽑힘 ? "rgba(120,225,255,0.22)" : "rgba(90,170,210,0.10)";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 켜짐 ? (뽑힘 ? 밝청록 : 청록) : "rgba(120,170,195,0.35)";
    g.stroke();
    // 라벨
    g.textBaseline = "middle";
    g.fillStyle = 켜짐 ? 밝청록 : "rgba(150,185,205,0.5)";
    g.font = "bold 30px 'Apple SD Gothic Neo', sans-serif";
    g.fillText(d.이름, r.x + 26, r.y + r.h * 0.38);
    g.fillStyle = 켜짐 ? 흐림 : "rgba(150,185,205,0.4)";
    g.font = "18px 'Apple SD Gothic Neo', sans-serif";
    g.fillText(d.영문, r.x + 26, r.y + r.h * 0.72);
    // 체크박스
    const bx = r.x + r.w - 54,
      by = r.y + r.h / 2 - 16;
    둥근사각(g, bx, by, 32, 32, 7);
    g.lineWidth = 2.5;
    g.strokeStyle = 켜짐 ? 청록 : "rgba(120,170,195,0.4)";
    g.stroke();
    if (뽑힘) {
      g.strokeStyle = 밝청록;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(bx + 7, by + 17);
      g.lineTo(bx + 14, by + 24);
      g.lineTo(bx + 26, by + 8);
      g.stroke();
    }
    g.textBaseline = "top";
  });

  // 버튼 (SELECT / RESET)
  for (const [rc, 글, 강조] of [[셀렉트, "SELECT", !!st.선택], [리셋, "RESET", false]]) {
    둥근사각(g, rc.x, rc.y, rc.w, rc.h, 12);
    g.fillStyle = 강조 ? "rgba(120,225,255,0.28)" : "rgba(90,170,210,0.10)";
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 강조 ? 밝청록 : 청록;
    g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillStyle = 강조 ? 밝청록 : 흐림;
    g.font = "bold 28px 'Apple SD Gothic Neo', sans-serif";
    g.fillText(글, rc.x + rc.w / 2, rc.y + rc.h / 2 + 2);
    g.textAlign = "left";
    g.textBaseline = "top";
  }

  // 안내/오류 바 (하나만 표시)
  {
    const hy = 셀렉트.y - 58;
    if (st.근처) {
      둥근사각(g, 목록X, hy, 목록W, 44, 11);
      g.fillStyle = "rgba(120,225,255,0.18)";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 밝청록;
      g.stroke();
      g.textBaseline = "middle";
      g.textAlign = "center";
      g.fillStyle = 밝청록;
      g.font = "bold 24px 'Apple SD Gothic Neo', sans-serif";
      g.fillText("[ E ]  나주로 이동", 목록X + 목록W / 2, hy + 23);
      g.textAlign = "left";
      g.textBaseline = "top";
    }
  }

  // 스캔라인
  g.globalAlpha = 0.06;
  g.fillStyle = "#bfefff";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  g.globalAlpha = 1;
}

const 안 = (rc, cx, cy) =>
  cx >= rc.x && cx <= rc.x + rc.w && cy >= rc.y && cy <= rc.y + rc.h;

// 켬 — 기차 씬이 **지금 켜져 있나**.
//   ★ 이 컴포넌트는 기차 씬이 숨겨져도(`<group visible={false}>`) 살아 있다.
//     씬을 버리지 않고 보임만 끄는 구조로 바꾼 뒤부터다. 그런데
//       · `useFrame` 은 visible 과 무관하게 계속 돈다
//       · R3F 의 레이캐스트는 **부모의 visible 을 보지 않는다**
//         (three 의 `Mesh.raycast` 에 visible 검사가 없다)
//     이 스크린 자리(X −16.4 · Y 5 · Z 4)는 **역 방 안 좌표**라, 한 번
//     기차를 탄 뒤 로비에서 그 허공을 클릭하면 목적지가 골라지고 [E] 로
//     나주 진입 연출이 돌아 버렸다. 그래서 켬 으로 통째로 잠근다.
export default function 홀로그램스크린({ 켬 = true }) {
  const C = useSavedControls("홀로그램 스크린", {
    보이기: true,
    X: { value: -16.4, min: -26, max: 26, step: 0.1 },
    // step 0.1 → 0.02. 0.1 유닛이 화면에서 약 19px 이라 잔조정이 안 됐다.
    //   (step·min·max 는 코드 것을 쓰므로 저장된 값은 그대로 살아 있다)
    Y: { value: 5.0, min: 0, max: 12, step: 0.02 },
    Z: { value: 4.0, min: -5, max: 6, step: 0.1 },
    // ★ 8.0 은 서서 보면 화면을 넘겨서 **전체가 한눈에 안 들어왔다.**
    //   기차 안 스크린까지 거리가 4~7 유닛인데 가로 8 이면 시야(fov 60)를 넘는다.
    //   4.6 이면 그 거리에서 판 전체가 화면 안에 들어온다.
    폭: { value: 4.6, min: 1, max: 16, step: 0.1 }, // 스크린 가로(월드 유닛)
    회전X: { value: 0, min: -90, max: 90, step: 1 },
    회전Y: { value: 180, min: -180, max: 180, step: 1 },
    색: "#25bdff",
    밝기: { value: 1.15, min: 0.2, max: 3, step: 0.05 },
    깜빡임: { value: 0.06, min: 0, max: 0.4, step: 0.01 }, // 홀로그램 미세 떨림
    // 발광 빔 (장치에서 스크린으로 쏘아 올라오는 빛)
    빔보이기: true,
    빔색: "#24a6de",
    빔길이: { value: 0.3, min: 0, max: 14, step: 0.1 }, // 스크린 아래로 뻗는 길이
    빔세기: { value: 0.25, min: 0, max: 2, step: 0.05 },
    빔퍼짐: { value: 2.1, min: 0.2, max: 8, step: 0.1 }, // 아래로 갈수록 넓어지는 정도
  });

  const [선택, set선택] = useState(null); // 뽑힌 목적지 id
  const { camera } = useThree();
  const [근처, set근처] = useState(false);
  const 근처ref = useRef(false);

  // 나주 맵(naju01)은 이제 본편과 같은 서버(5173)가 /naju01/ 로 함께 내준다.
  //   → 포트를 나누지 않고 같은 출처로 바로 넘어간다(브라우저 저장소도 공유).
  //   (시네마틱 이동 영상은 이 사이에 이후 넣는다 — 지금은 바로 이동만.)
  const 이동 = useCallback(() => {
    if (typeof window === "undefined") return;
    window.__목적지선택 = "naju";
    // 아바타 종류(사이드킥)만 이어서 넘긴다 — naju 기본은 Meshy 캐릭터.
    const av = new URLSearchParams(location.search).get("avatar");
    const 쿼리 = av === "sidekick" ? "?avatar=sidekick" : "";
    // 바로 넘어가지 않고 진입 연출(암전+안내)을 먼저 돌린다.
    //   연출이 끝나면 나주진입연출.jsx 가 대신 같은 출처 /naju01/ 로 이동시킨다.
    window.dispatchEvent(new CustomEvent("kgeseo:나주진입", { detail: { 쿼리 } }));
  }, []);

  // 캔버스 + 텍스처(한 번만 만들고, 상태 바뀔 때 다시 그린다)
  const cv = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [cv]);
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(() => {
    const g = cv.getContext("2d");
    UI그리기(g, { 선택, 근처 });
    tex.needsUpdate = true;
  }, [cv, tex, 선택, 근처]);

  // ── [E] — **목적지를 고른 뒤에만** 떠난다 ──────────────────
  // [왜 고르는 단계를 따로 두나]
  //   전에는 스크린 근처이기만 하면 [E] 가 곧바로 맵을 갈아탔다. 기차 안에서
  //   다른 걸 하려고 [E] 를 누르다가 **의도치 않게 나주로 넘어가** 버린다.
  //   장소를 옮기는 건 되돌릴 수 없는 동작이라, 한 번 짚고(클릭) 한 번 확인
  //   (E)하는 두 박자가 맞다.
  //   순서: 목적지 카드를 마우스로 **한 번 클릭** → 체크됨 → [E] → 이동.
  const 선택ref = useRef(null);
  선택ref.current = 선택;
  useEffect(() => {
    const 눌림 = (e) => {
      if (e.code !== "KeyE" || e.repeat) return;
      if (!켬ref.current) return; // 기차 씬이 꺼져 있으면 아무 일도 없다
      // 근처 + **고른 목적지가 있을 때만**. 안 골랐으면 아무 일도 안 일어난다.
      if (근처ref.current && 선택ref.current) 이동();
    };
    window.addEventListener("keydown", 눌림);
    return () => window.removeEventListener("keydown", 눌림);
  }, [이동]);

  // 빔 세로 그라데이션(아래=밝고 위=투명)
  const 빔맵 = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 128;
    const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, "rgba(255,255,255,0.9)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.28)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 16, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => 빔맵.dispose(), [빔맵]);

  const 패널ref = useRef(null);
  const 스캔ref = useRef(null);
  const 켬ref = useRef(켬);
  켬ref.current = 켬;
  useFrame(({ clock }) => {
    if (!켬) {
      // 꺼진 씬에서 '근처'로 남아 있으면 안 된다 — [E] 가 그대로 먹는다
      if (근처ref.current) {
        근처ref.current = false;
        set근처(false);
      }
      return;
    }
    const t = clock.elapsedTime;
    // 스크린 가까이 왔나 — E 로 이동 가능 판정
    // ★ **사람이 선 자리**에서 잰다. 카메라에서 재면 3인칭이 망가진다 —
    //   카메라는 캐릭터 뒤 9.33 유닛이라, 스크린을 마주 보면 캐릭터가 3.7 안으로
    //   얼굴을 박아야 겨우 켜지고, 등을 돌리면 22 밖에서도 켜져 엉뚱한 자리에서
    //   [E] 가 먹었다. 로비 → 나주로 넘어가는 유일한 길이라 그대로 두면 진행이 막힌다.
    const 사람 = 플레이어시점.쓸수있나 ? 플레이어시점.눈 : camera.position;
    const 거리 = Math.hypot(사람.x - C.X, 사람.y - C.Y, 사람.z - C.Z);
    const 가까움 = 거리 < 13;
    if (근처ref.current !== 가까움) {
      근처ref.current = 가까움;
      set근처(가까움);
    }
    // 미세한 홀로그램 떨림(밝기 흔들기)
    const 흔 = 1 - C.깜빡임 * (0.5 + 0.5 * Math.sin(t * 37.0)) * (0.5 + 0.5 * Math.sin(t * 5.3));
    if (패널ref.current) 패널ref.current.material.opacity = Math.min(1, C.밝기 * 흔);
    // 스캔 바가 위로 흐른다
    if (스캔ref.current) {
      const h = C.폭 * (H / W);
      스캔ref.current.position.y = ((t * 0.5) % 1) * h - h / 2;
      스캔ref.current.material.opacity = 0.12 * C.밝기;
    }
  });

  // 클릭 — 평면 UV(0~1)를 캔버스 좌표로 바꿔 영역 판정
  const 클릭 = useCallback(
    (e) => {
      if (!e.uv) return;
      e.stopPropagation();
      const cx = e.uv.x * W;
      const cy = (1 - e.uv.y) * H;
      // 목적지 행
      for (let i = 0; i < 목적지들.length; i++) {
        if (안(행사각(i), cx, cy)) {
          const d = 목적지들[i];
          if (d.열림) set선택((p) => (p === d.id ? null : d.id));
          return;
        }
      }
      if (안(셀렉트, cx, cy)) {
        if (선택) 이동(); // 나주 선택 상태에서 SELECT → 나주 맵으로 이동
        return;
      }
      if (안(리셋, cx, cy)) set선택(null);
    },
    [선택, 이동],
  );

  if (!C.보이기) return null;
  const 높이 = C.폭 * (H / W); // 16:? 비율 유지

  return (
    <group
      position={[C.X, C.Y + 살짝올림, C.Z]}
      rotation={[라디안(C.회전X), 라디안(C.회전Y), 0]}
    >
      {/* 발광 빔 — 스크린 아래로 뻗어 장치 쪽으로 좁아진다 */}
      {C.빔보이기 && (
        <mesh
          position={[0, -높이 / 2 - C.빔길이 / 2, -0.05]}
          scale={[C.빔퍼짐, 1, 1]}
        >
          <planeGeometry args={[C.폭 * 0.5, C.빔길이]} />
          <meshBasicMaterial
            map={빔맵}
            color={C.빔색}
            transparent
            opacity={C.빔세기}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* 스크린 패널 — 클릭 가능 */}
      {/* ★ 손잡이는 **하나만** 단다.
             onClick 과 onPointerDown 을 둘 다 걸어 뒀더니, 한 번 누르는 동안
             누를 때(pointerdown) 한 번 · 뗄 때(click) 한 번 — **토글이 두 번**
             돌아서 고른 것이 제자리로 돌아갔다. 버튼을 누르고 있는 동안에만
             SELECT 가 떠 있던 게 그것이다.
             남긴 쪽은 pointerdown 이다. 3D 화면에서는 누른 뒤 떼기 전에 시점이
             움직여 커서가 판 밖으로 나갈 수 있는데, 그러면 click 은 아예 안 온다. */}
      {/* 꺼진 씬에서는 레이캐스트 자체를 막는다 — visible=false 는 클릭을 안 막는다 */}
      <mesh ref={패널ref} onPointerDown={켬 ? 클릭 : undefined} raycast={켬 ? undefined : () => null}>
        <planeGeometry args={[C.폭, 높이]} />
        <meshBasicMaterial
          map={tex}
          color={C.색}
          transparent
          opacity={C.밝기}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* 위로 흐르는 스캔 바 */}
      <mesh ref={스캔ref} position={[0, 0, 0.01]}>
        <planeGeometry args={[C.폭, 0.12]} />
        <meshBasicMaterial
          color={C.색}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
