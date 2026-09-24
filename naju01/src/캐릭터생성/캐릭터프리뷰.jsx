// 캐릭터 생성 화면의 3D 미리보기.
//
// [무엇을 재사용하나]
//   게임과 같은 렌더러(치비게임아바타)·같은 모델·같은 툰 재질을 그대로 쓴다. 이 파일은 그 위에
//   **생성 화면에만 필요한 껍데기**만 얹는다 — 관찰용 카메라, 부위 보기, 모델 교체 대기.
//
// [왜 '예열' 을 따로 두나]
//   성별·옷을 바꾸면 전신 GLB 를 통째로 새로 읽는다(파일 10~15MB). 그냥 갈아 끼우면 읽는 동안
//   Suspense 가 캐릭터를 지워 화면이 빈다. 그래서 **새 모델을 먼저 조용히 읽고**, 다 읽힌 뒤에야
//   보여 주는 착장을 바꾼다. 늦게 도착한 옛 요청은 열쇠가 달라 그냥 버려진다.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import ChibiGameAvatar from "../치비게임아바타.jsx";
import { 메시모델파일, 메시신발파일 } from "../메시외형옵션.js";
import { 색, 단추, 고른단추, 작은글 } from "./스타일.js";

export const 보기목록 = [["전신", "전신"], ["머리", "머리"], ["손", "손"], ["발", "발"]];

// 미리보기 자세는 **외형 데이터가 아니다.** 게임에서 실제로 쓰는 자세만 둔다.
// (T포즈 같은 작업용 자세는 빼 두었다 — 이용자에게 보여 줄 자세가 아니다.)
export const 자세목록 = [["Idle_Loop", "대기"], ["Walk_Loop", "걷기"]];

export const 품질목록 = [["낮음", "낮음"], ["보통", "보통"], ["높음", "높음"]];

const 품질값 = {
  낮음: { dpr: [1, 1], 그림자: 0 },
  보통: { dpr: [1, 1.5], 그림자: 512 },
  높음: { dpr: [1, 2], 그림자: 1024 },
};

// 모델 파일을 바꾸는 값만 모은 열쇠. 슬라이더·색·헤어는 파일을 안 바꾸므로 들어가지 않는다.
export function 파일열쇠만들기(설정) {
  return `${설정.gender}|${설정.top}|${설정.bottom}|${설정.shoes}`;
}

function 열쇠풀기(열쇠) {
  const [gender, top, bottom, shoes] = 열쇠.split("|");
  return { gender, top: Number(top), bottom: Number(bottom), shoes: Number(shoes) };
}

// 아바타는 게임 플레이어 상태를 읽는다. 생성 화면에는 플레이어가 없으니 '가만히 서 있는' 상태를 준다.
function 정지상태() {
  return {
    position: new THREE.Vector3(),
    footY: 0,
    groundY: 0,
    facing: 0,
    moving: false,
    running: false,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
    speed: 0,
    attackSerial: 0,
    attackMotion: "Punch_Jab",
  };
}

// 다음에 보여 줄 모델을 조용히 읽는다. 다 읽히면 알린다(읽는 동안 멈추는 것은 이 컴포넌트뿐이다).
function CC모델예열({ 설정, 열쇠, 알림 }) {
  const 몸 = 메시모델파일(설정);
  const 신발 = 메시신발파일(설정);
  useGLTF(몸);
  useGLTF(신발);
  useEffect(() => {
    알림(열쇠);
  }, [알림, 열쇠, 몸, 신발]);
  return null;
}

// 씬에서 캐릭터를 찾아 크기와 주요 부위 위치를 잰다. 카메라를 어디에 둘지 정하는 데만 쓴다.
function 캐릭터재기(scene, 키배율) {
  let 무리 = null;
  scene.traverse((o) => {
    if (!무리 && o.name === "NAJU-chibi-avatar" && o.visible) 무리 = o;
  });
  if (!무리) return null;
  const 상자 = new THREE.Box3().setFromObject(무리);
  if (상자.isEmpty() || !Number.isFinite(상자.min.y)) return null;
  const 높이 = 상자.max.y - 상자.min.y;
  if (!(높이 > 0.05)) return null;
  let 뼈대 = null;
  무리.traverse((o) => {
    if (!뼈대 && o.isSkinnedMesh) 뼈대 = o.skeleton;
  });
  const 자리 = (이름) => {
    const b = 뼈대?.getBoneByName(이름);
    return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null;
  };
  const 손왼 = 자리("hand_l");
  const 손오 = 자리("hand_r");
  return {
    높이,
    // 키 배율을 뺀 '기본 키'. 키를 줄였을 때 카메라까지 따라 당겨지면 변화가 안 보인다.
    기준높이: 높이 / Math.max(0.01, 키배율),
    머리: 자리("head") ?? new THREE.Vector3(0, 높이 * 0.88, 0),
    손: 손왼 && 손오 ? 손왼.clone().add(손오).multiplyScalar(0.5) : new THREE.Vector3(0, 높이 * 0.5, 0),
    손폭: 손왼 && 손오 ? 손왼.distanceTo(손오) : 높이 * 0.6,
    발: new THREE.Vector3(0, 상자.min.y + 높이 * 0.05, 0),
  };
}

// 어느 부위를, 화면의 어느 자리에 담을지 정한다.
//   가림px = 아래 도구줄이 덮는 높이. 그만큼을 빼고 남는 자리에 캐릭터를 담아야
//   발이 도구줄 뒤로 숨지 않는다(요구 3장: 캐릭터·조절 항목·진행 단추가 겹치면 안 된다).
function 보기목표(보기, 잰값, 화면) {
  const H = 잰값.기준높이;
  const 담을높이 = 보기 === "머리" ? H * 0.32
    : 보기 === "손" ? Math.max(H * 0.36, 잰값.손폭 * 1.3)
    : 보기 === "발" ? H * 0.28
    // 전신은 키를 키운 만큼만 더 담는다(줄일 때는 그대로 둬야 작아진 것이 보인다).
    : H * 1.06 * Math.max(1, 잰값.높이 / H);
  const 중심 = 보기 === "머리" ? 잰값.머리.clone()
    : 보기 === "손" ? 잰값.손.clone()
    : 보기 === "발" ? 잰값.발.clone()
    : new THREE.Vector3(0, H * 0.5, 0);

  const 높이px = Math.max(120, 화면.높이px);
  const 쓸자리 = Math.max(80, 높이px - 화면.가림px - 24);
  const 보이는높이 = 담을높이 * (높이px / 쓸자리);
  const 거리 = 보이는높이 / (2 * Math.tan((화면.fov * Math.PI) / 360));
  // 가려지는 만큼 목표를 내리면 캐릭터가 그만큼 위로 올라온다.
  중심.y -= (화면.가림px / 2) * (보이는높이 / 높이px);
  return { 목표: 중심, 거리 };
}

// 카메라를 궤도 위에 놓는다. 좌우 회전·확대는 사람이 잡고, 부위 보기는 목표점과 거리만 바꾼다.
function CC카메라({ 조작, 보기, 키배율, 가림px, 덜움직이기, 측정열쇠 }) {
  // three 객체는 반응형 값으로 잡지 않고 필요할 때 꺼내 쓴다(보행비교 GAIT카메라와 같은 방식).
  const get = useThree((s) => s.get);
  const 상태 = useRef({ 목표: new THREE.Vector3(0, 0.9, 0), 거리: 3.4, 채움: false });
  const 바람 = useRef({ 목표: new THREE.Vector3(0, 0.9, 0), 거리: 3.4 });
  const 키 = useRef(1);
  const 가림 = useRef(0);
  const 셈 = useRef(0);
  const 빛 = useRef();

  useEffect(() => {
    키.current = 키배율;
  }, [키배율]);

  useEffect(() => {
    가림.current = 가림px;
  }, [가림px]);

  // 부위를 바꾸거나 착장이 바뀌면 목표를 다시 잡는다.
  //   ※ 키배율을 의존성에 넣으면 안 된다 — 슬라이더를 움직일 때마다 카메라가 목표로 다시 튀어
  //     이용자가 잡아 둔 시점을 빼앗는다(요구 6장).
  useEffect(() => {
    const { scene, camera, size } = get();
    const 잰값 = 캐릭터재기(scene, 키.current);
    if (!잰값) return;
    const 다음 = 보기목표(보기, 잰값, { 높이px: size.height, 가림px: 가림.current, fov: camera.fov });
    바람.current = 다음;
    if (!상태.current.채움 || 덜움직이기) {
      상태.current.목표.copy(다음.목표);
      상태.current.거리 = 다음.거리;
      상태.current.채움 = true;
    }
  }, [보기, 측정열쇠, 가림px, get, 덜움직이기]);

  useFrame((_, delta) => {
    const { camera, scene, size } = get();
    const 화면 = { 높이px: size.height, 가림px: 가림.current, fov: camera.fov };
    const s = 상태.current;
    셈.current += 1;
    // 전신 보기에서만 키 변화를 따라 거리를 다시 잡는다(열 프레임에 한 번이면 충분하다).
    if ((!s.채움 || 보기 === "전신") && 셈.current % 10 === 0) {
      const 잰값 = 캐릭터재기(scene, 키.current);
      if (잰값) {
        바람.current = 보기목표(보기, 잰값, 화면);
        if (!s.채움) {
          s.목표.copy(바람.current.목표);
          s.거리 = 바람.current.거리;
          s.채움 = true;
        }
      }
    }
    const 비율 = 덜움직이기 ? 1 : 1 - Math.exp(-delta * 8);
    s.목표.lerp(바람.current.목표, 비율);
    s.거리 += (바람.current.거리 - s.거리) * 비율;

    const { 좌우, 위아래, 줌 } = 조작.current;
    const 거리 = s.거리 * 줌;
    const 높이각 = THREE.MathUtils.clamp(위아래, -0.45, 0.85);
    const x = Math.sin(좌우) * Math.cos(높이각) * 거리;
    const z = Math.cos(좌우) * Math.cos(높이각) * 거리;
    const y = Math.sin(높이각) * 거리;
    // 바닥 아래로는 내려가지 않는다.
    camera.position.set(s.목표.x + x, Math.max(0.12, s.목표.y + y), s.목표.z + z);
    camera.lookAt(s.목표);
    camera.near = Math.max(0.05, 거리 * 0.05);
    camera.far = 거리 * 12 + 20;
    camera.updateProjectionMatrix();
    // 주광은 카메라를 따라간다 — 어느 쪽으로 돌려도 얼굴이 검게 죽지 않는다.
    if (빛.current) {
      빛.current.position.set(camera.position.x + 1.2, camera.position.y + 2.2, camera.position.z + 1.4);
      빛.current.target.position.copy(s.목표);
      빛.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <directionalLight ref={빛} intensity={1.15} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={["#eef3ff", "#5a5f6b", 0.55]} />
    </>
  );
}

// 개발용 손잡이 — 헤드리스 검사에서 씬을 직접 재려고 연다(보행비교 GAIT손잡이와 같은 방식).
function CC손잡이({ 표시열쇠 }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
    // 표시열쇠 = 지금 **화면에 서 있는** 착장. 고른 값과 견줘 '옷을 빨리 바꿔도 어긋나지 않는지' 본다.
    window.__캐릭터생성 = { get, THREE, 표시열쇠 };
    return () => { delete window.__캐릭터생성; };
  }, [get, 표시열쇠]);
  return null;
}

// 탭이 안 보이면 그리지 않는다(배경에서 GPU 를 돌리지 않는다).
function CC보임감시({ 바뀜 }) {
  useEffect(() => {
    const 듣기 = () => 바뀜(!document.hidden);
    document.addEventListener("visibilitychange", 듣기);
    return () => document.removeEventListener("visibilitychange", 듣기);
  }, [바뀜]);
  return null;
}

export default function CC캐릭터프리뷰({
  설정,
  보기 = "전신",
  set보기,
  자세 = "Idle_Loop",
  set자세,
  품질 = "보통",
  set품질,
  덧UI = null,
}) {
  const 상태참조 = useRef(정지상태());
  const 조작 = useRef({ 좌우: -0.35, 위아래: 0.08, 줌: 1 });
  const 끌기 = useRef(null);
  const 손가락 = useRef(new Map());
  const 벌림 = useRef(0);
  const 감쌈 = useRef(null);
  const 도구줄 = useRef(null);
  const [가림px, set가림px] = useState(64);
  const 파일열쇠 = 파일열쇠만들기(설정);
  // 지금 화면에 서 있는 착장. 예열이 끝나야 여기로 옮겨 온다.
  const [표시열쇠, set표시열쇠] = useState(파일열쇠);
  const [보임, set보임] = useState(() => typeof document === "undefined" || !document.hidden);
  const [초기화수, set초기화수] = useState(0);

  const 덜움직이기 = useMemo(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  // 슬라이더·색·헤어는 곧바로, 성별·옷은 다 읽힌 뒤에 반영한다.
  const 표시설정 = useMemo(() => ({ ...설정, ...열쇠풀기(표시열쇠) }), [설정, 표시열쇠]);
  const 읽는중 = 파일열쇠 !== 표시열쇠;

  const 예열끝 = useCallback((열쇠) => {
    // 같은 값이면 상태를 안 바꾼다. 늦게 온 옛 요청은 그 사이 열쇠가 또 바뀌었어도
    // 제 열쇠로 들어오므로, 다음 예열이 최신 열쇠로 다시 알려 준다.
    set표시열쇠((이전) => (열쇠 === 이전 ? 이전 : 열쇠));
  }, []);

  const 줌바꾸기 = useCallback((배) => {
    조작.current.줌 = THREE.MathUtils.clamp(조작.current.줌 * 배, 0.45, 2.2);
  }, []);

  // 아래 도구줄이 덮는 높이를 재서 카메라에 알린다(줄이 두 줄로 접히면 더 덮는다).
  useEffect(() => {
    const 요소 = 도구줄.current;
    if (!요소 || typeof ResizeObserver === "undefined") return undefined;
    const 눈 = new ResizeObserver(([항목]) => set가림px(Math.round(항목.contentRect.height) + 24));
    눈.observe(요소);
    return () => 눈.disconnect();
  }, []);

  useEffect(() => {
    const 요소 = 감쌈.current;
    if (!요소) return undefined;
    const 휠 = (e) => {
      e.preventDefault();
      줌바꾸기(Math.exp(e.deltaY * 0.0012));
    };
    요소.addEventListener("wheel", 휠, { passive: false });
    return () => 요소.removeEventListener("wheel", 휠);
  }, [줌바꾸기]);

  const 두손가락거리 = () => {
    const [a, b] = [...손가락.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const 누름 = (e) => {
    손가락.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (손가락.current.size === 2) 벌림.current = 두손가락거리();
    else 끌기.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const 움직임 = (e) => {
    if (!손가락.current.has(e.pointerId)) return;
    손가락.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (손가락.current.size >= 2) {
      const 새 = 두손가락거리();
      if (벌림.current > 0 && 새 > 0) 줌바꾸기(벌림.current / 새);
      벌림.current = 새;
      return;
    }
    if (!끌기.current) return;
    const dx = e.clientX - 끌기.current.x;
    const dy = e.clientY - 끌기.current.y;
    끌기.current = { x: e.clientX, y: e.clientY };
    조작.current.좌우 -= dx * 0.008;
    조작.current.위아래 = THREE.MathUtils.clamp(조작.current.위아래 + dy * 0.005, -0.45, 0.85);
  };
  const 뗌 = (e) => {
    손가락.current.delete(e.pointerId);
    if (손가락.current.size < 2) 벌림.current = 0;
    if (손가락.current.size === 0) 끌기.current = null;
  };
  const 보기초기화 = () => {
    조작.current = { 좌우: -0.35, 위아래: 0.08, 줌: 1 };
    set초기화수((n) => n + 1);
  };

  const 품질설정 = 품질값[품질] ?? 품질값.보통;

  return (
    <div style={무대}>
      <div
        ref={감쌈}
        style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab" }}
        onPointerDown={누름}
        onPointerMove={움직임}
        onPointerUp={뗌}
        onPointerCancel={뗌}
      >
        <Canvas
          shadows={false}
          frameloop={보임 ? "always" : "never"}
          dpr={품질설정.dpr}
          camera={{ fov: 30, position: [0, 1, 3.6], near: 0.1, far: 60 }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onCreated={({ gl }) => gl.setClearColor(new THREE.Color("#0a1120"), 1)}
        >
          <CC보임감시 바뀜={set보임} />
          <CC손잡이 표시열쇠={표시열쇠} />
          <CC카메라
            조작={조작}
            보기={보기}
            키배율={표시설정.heightScale ?? 1}
            가림px={가림px}
            덜움직이기={덜움직이기}
            측정열쇠={`${표시열쇠}|${초기화수}`}
          />
          <Suspense fallback={null}>
            <ChibiGameAvatar 보이기 플레이어참조={상태참조} 설정={{ ...표시설정, motion: 자세 }} 크기={1} 몸체="meshy" />
            {품질설정.그림자 > 0 ? (
              <ContactShadows
                position={[0, 0.001, 0]}
                opacity={0.42}
                scale={4}
                blur={2.6}
                far={2}
                resolution={품질설정.그림자}
                color="#01040c"
              />
            ) : null}
          </Suspense>
          <Suspense fallback={null}>
            <CC모델예열 설정={설정} 열쇠={파일열쇠} 알림={예열끝} key={파일열쇠} />
          </Suspense>
        </Canvas>
      </div>

      {읽는중 ? (
        <div style={읽는중표시} role="status" aria-live="polite">새 모델을 불러오는 중…</div>
      ) : null}

      <div style={아래줄} ref={도구줄}>
        <div style={줄} role="group" aria-label="보기 부위">
          {보기목록.map(([값, 이름]) => (
            <button key={값} type="button" style={보기 === 값 ? 고른단추 : 단추} aria-pressed={보기 === 값} onClick={() => set보기(값)}>
              {이름}
            </button>
          ))}
        </div>
        <div style={줄} role="group" aria-label="카메라 조작">
          <button type="button" style={단추} aria-label="왼쪽으로 회전" onClick={() => { 조작.current.좌우 -= Math.PI / 6; }}>↺</button>
          <button type="button" style={단추} aria-label="오른쪽으로 회전" onClick={() => { 조작.current.좌우 += Math.PI / 6; }}>↻</button>
          <button type="button" style={단추} aria-label="확대" onClick={() => 줌바꾸기(0.85)}>＋</button>
          <button type="button" style={단추} aria-label="축소" onClick={() => 줌바꾸기(1.18)}>－</button>
          <button type="button" style={단추} onClick={보기초기화}>보기 초기화</button>
        </div>
        <div style={줄} role="group" aria-label="미리보기 자세">
          {자세목록.map(([값, 이름]) => (
            <button key={값} type="button" style={자세 === 값 ? 고른단추 : 단추} aria-pressed={자세 === 값} onClick={() => set자세(값)}>
              {이름}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={작은글}>화질</span>
          <select value={품질} onChange={(e) => set품질(e.target.value)} style={{ ...단추, padding: "6px 8px" }}>
            {품질목록.map(([값, 이름]) => (<option key={값} value={값}>{이름}</option>))}
          </select>
        </label>
        {덧UI}
      </div>
    </div>
  );
}

const 무대 = {
  position: "relative",
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  borderRadius: 14,
  overflow: "hidden",
  border: `1px solid ${색.선}`,
  background: "#0a1120",
};

const 아래줄 = {
  position: "absolute",
  left: 12,
  right: 12,
  bottom: 12,
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  padding: 8,
  borderRadius: 12,
  background: "rgba(6,13,26,0.78)",
  border: `1px solid ${색.선}`,
};

const 줄 = { display: "flex", gap: 6, flexWrap: "wrap" };

const 읽는중표시 = {
  position: "absolute",
  left: "50%",
  top: 14,
  transform: "translateX(-50%)",
  padding: "6px 14px",
  borderRadius: 100,
  background: "rgba(6,13,26,0.85)",
  border: `1px solid ${색.선}`,
  font: "500 12px/1 inherit",
  color: 색.흐린글,
};
