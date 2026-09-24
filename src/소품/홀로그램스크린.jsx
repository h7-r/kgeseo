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
import { useSavedControls } from "../공용.jsx";

const 라디안 = (도) => (도 * Math.PI) / 180;

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

export default function 홀로그램스크린() {
  const C = useSavedControls("홀로그램 스크린", {
    보이기: true,
    X: { value: -16.4, min: -26, max: 26, step: 0.1 },
    Y: { value: 5.0, min: 0, max: 12, step: 0.1 },
    Z: { value: 4.0, min: -5, max: 6, step: 0.1 },
    폭: { value: 8.0, min: 1, max: 16, step: 0.1 }, // 스크린 가로(월드 유닛)
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
    // 같은 출처의 나주 진입점 — 본편 vite 가 /naju01/index.html 을 그대로 내준다.
    location.href = `${location.origin}/naju01/index.html${쿼리}`;
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

  // E — 스크린 가까이서 나주로 이동
  useEffect(() => {
    const 눌림 = (e) => {
      if (e.code === "KeyE" && 근처ref.current) 이동();
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
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // 스크린 가까이 왔나 — E 로 이동 가능 판정
    const 거리 = Math.hypot(
      camera.position.x - C.X,
      camera.position.y - C.Y,
      camera.position.z - C.Z,
    );
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
      position={[C.X, C.Y, C.Z]}
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
      <mesh ref={패널ref} onClick={클릭} onPointerDown={클릭}>
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
