// 캐릭터 생성 화면의 3D 무대.
//
// [화면 전체가 하나의 공간이다]
//   캔버스는 **투명**하다. 배경은 그 아래 CSS 그라데이션 한 덩이가 화면 끝까지 그리고,
//   캔버스는 캐릭터와 접지 그림자만 얹는다. 그래서 헤더·패널 뒤로도 같은 공간이 이어지고,
//   캔버스 테두리나 검은 사각형이 공간을 자르지 않는다.
//   ※ 예전에는 gl.setClearColor(..., 1) 로 캔버스를 불투명하게 칠해 아래 배경이 통째로 가려졌다.
//
// [무엇을 재사용하나]
//   게임과 같은 렌더러(치비게임아바타)·같은 모델·같은 툰 재질. 여기서는 관찰용 카메라와 빛,
//   그리고 모델 교체 대기만 얹는다.
//
// [왜 '예열' 을 따로 두나]
//   성별·옷을 바꾸면 전신 GLB 를 새로 읽는다(10~15MB). 그냥 갈아 끼우면 읽는 동안 Suspense 가
//   캐릭터를 지워 화면이 빈다. 새 모델을 먼저 조용히 읽고, 다 읽힌 뒤에 보여 주는 착장을 바꾼다.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import ChibiGameAvatar from "../치비게임아바타.jsx";
import { 메시모델파일, 메시신발파일 } from "../메시외형옵션.js";
import { 기본툰 } from "../툰재질.js";

// 생성 화면 전용 툰 설정 — 명암 계단 경계를 아주 조금 풀어 준다.
//   캐릭터를 얼굴까지 확대해 보는 화면이라, 딱 떨어지는 계단이 낮은 폴리곤의 삼각형 모서리를 따라
//   꺾여 목선에서 톱니로 보였다. 게임 화면은 기본값(0) 그대로다.
const 생성툰 = { ...기본툰, 부드럼: 0.06 };

export const 보기목록 = [["전신", "전신"], ["머리", "머리"], ["손", "손"], ["발", "발"]];

// 이용자에게 보여 줄 자세는 게임에서 실제로 쓰는 것만 둔다(T포즈 같은 작업용 자세는 뺀다).
export const 자세목록 = [["Idle_Loop", "대기"], ["Walk_Loop", "걷기"]];

export const 품질목록 = [["낮음", "낮음"], ["보통", "보통"], ["높음", "높음"]];

// 손을 볼 때만 팔을 벌린 자세로 바꾼다 — 허리에 손을 얹은 대기 자세는 손을 가린다.
// 이용자가 고르는 값이 아니라 관찰을 위한 내부 전환이다.
export function 관찰자세(보기, 자세) {
  return 보기 === "손" ? "A_TPose" : 자세;
}

const 품질값 = {
  낮음: { dpr: [1, 1], 그림자: 256, 흐림: 2.2 },
  보통: { dpr: [1, 1.5], 그림자: 512, 흐림: 2.6 },
  높음: { dpr: [1, 2], 그림자: 1024, 흐림: 3.0 },
};

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
    가슴: 자리("spine_03") ?? new THREE.Vector3(0, 높이 * 0.66, 0),
  };
}

// 어느 부위를 얼마나 크게 담을지.
function 담을것(보기, 잰값) {
  const H = 잰값.기준높이;
  if (보기 === "머리") return { 중심: 잰값.머리.clone(), 높이: H * 0.30 };
  // 손은 좌우를 함께 봐야 비교가 된다 — 두 손 사이 거리에 맞춰 물러난다.
  if (보기 === "손") return { 중심: 잰값.손.clone(), 높이: Math.max(H * 0.34, 잰값.손폭 * 1.05) };
  if (보기 === "발") return { 중심: 잰값.발.clone(), 높이: H * 0.26 };
  // 이름 단계 — 가슴만 담으면 머리가 잘린다. 가슴과 머리 사이를 중심으로 잡고 넉넉히 담는다.
  if (보기 === "상반신") return { 중심: 잰값.가슴.clone().lerp(잰값.머리, 0.55), 높이: H * 0.62 };
  // 전신은 키를 키운 만큼만 더 담는다(줄일 때는 그대로 둬야 작아진 것이 보인다).
  return { 중심: new THREE.Vector3(0, H * 0.5, 0), 높이: H * 1.08 * Math.max(1, 잰값.높이 / H) };
}

// 카메라를 궤도 위에 놓고, **UI 를 뺀 빈 자리**의 한가운데에 캐릭터를 담는다.
//   안전영역 = 좌·우·상·하로 UI 가 덮는 픽셀. 패널 폭이 달라져도 머리·손·발이 그 뒤로 숨지 않는다.
function CC카메라({ 조작, 보기, 키배율, 안전영역, 덜움직이기, 측정열쇠 }) {
  // three 객체는 반응형 값으로 잡지 않고 필요할 때 꺼내 쓴다(보행비교 GAIT카메라와 같은 방식).
  const get = useThree((s) => s.get);
  const 상태 = useRef({ 중심: new THREE.Vector3(0, 0.9, 0), 담을높이: 1.9, 채움: false });
  const 바람 = useRef({ 중심: new THREE.Vector3(0, 0.9, 0), 높이: 1.9 });
  const 키 = useRef(1);
  const 안전 = useRef(안전영역);
  const 셈 = useRef(0);
  const 주광 = useRef();
  const 보조광 = useRef();

  useEffect(() => {
    키.current = 키배율;
  }, [키배율]);
  useEffect(() => {
    안전.current = 안전영역;
  }, [안전영역]);

  // 부위·착장이 바뀔 때만 목표를 다시 잡는다.
  //   ※ 키배율을 의존성에 넣으면 슬라이더를 움직일 때마다 카메라가 튀어 시점을 빼앗는다.
  useEffect(() => {
    const { scene } = get();
    const 잰값 = 캐릭터재기(scene, 키.current);
    if (!잰값) return;
    바람.current = 담을것(보기, 잰값);
    if (!상태.current.채움 || 덜움직이기) {
      상태.current.중심.copy(바람.current.중심);
      상태.current.담을높이 = 바람.current.높이;
      상태.current.채움 = true;
    }
  }, [보기, 측정열쇠, get, 덜움직이기]);

  useFrame((_, delta) => {
    const { camera, scene, size } = get();
    const s = 상태.current;
    셈.current += 1;
    if ((!s.채움 || 보기 === "전신") && 셈.current % 10 === 0) {
      const 잰값 = 캐릭터재기(scene, 키.current);
      if (잰값) {
        바람.current = 담을것(보기, 잰값);
        if (!s.채움) {
          s.중심.copy(바람.current.중심);
          s.담을높이 = 바람.current.높이;
          s.채움 = true;
        }
      }
    }
    const 비율 = 덜움직이기 ? 1 : 1 - Math.exp(-delta * 7);
    s.중심.lerp(바람.current.중심, 비율);
    s.담을높이 += (바람.current.높이 - s.담을높이) * 비율;

    // 1) UI 를 뺀 빈 자리
    const a = 안전.current;
    const 폭px = Math.max(160, size.width - a.왼쪽 - a.오른쪽);
    const 높이px = Math.max(160, size.height - a.위 - a.아래);
    // 2) 그 자리에 담을 높이 → 화면 전체가 보여야 하는 세계 높이 → 거리
    const 세계높이 = s.담을높이 * (size.height / 높이px);
    const 거리 = (세계높이 / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 조작.current.줌;
    const 세계폭 = 세계높이 * (size.width / size.height);

    // 3) 궤도 위 카메라
    const { 좌우, 위아래 } = 조작.current;
    const 높이각 = THREE.MathUtils.clamp(위아래, -0.40, 0.75);
    const 앞 = new THREE.Vector3(
      Math.sin(좌우) * Math.cos(높이각),
      Math.sin(높이각),
      Math.cos(좌우) * Math.cos(높이각),
    );
    const 자리 = s.중심.clone().addScaledVector(앞, 거리);
    // 4) 빈 자리의 한가운데로 화면을 옮긴다(카메라와 목표를 같이 밀면 시선 방향은 그대로다).
    const cx = (a.왼쪽 + 폭px / 2) / size.width - 0.5;
    const cy = 0.5 - (a.위 + 높이px / 2) / size.height;
    // 앞 = 목표에서 카메라로 가는 방향이라 **시선은 그 반대**다. 화면 오른쪽은 cross(위, 앞) 이다.
    //   (cross(앞, 위) 로 잡으면 좌우가 뒤집혀 캐릭터가 UI 쪽으로 밀려간다.)
    const 오른 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), 앞).normalize();
    const 위 = new THREE.Vector3().crossVectors(앞, 오른).normalize();
    const 밀기 = 오른.clone().multiplyScalar(-cx * 세계폭).add(위.clone().multiplyScalar(-cy * 세계높이));
    const 목표 = s.중심.clone().add(밀기);
    자리.add(밀기);

    camera.position.set(자리.x, Math.max(0.1, 자리.y), 자리.z);
    camera.lookAt(목표);
    camera.near = Math.max(0.05, 거리 * 0.05);
    camera.far = 거리 * 14 + 24;
    camera.updateProjectionMatrix();

    // 5) 빛 — 공간의 빛 방향은 고정하고 보조광만 카메라를 따라간다.
    //    전부 카메라에 붙이면 어느 각도에서나 평평해져 얼굴 굴곡이 사라진다.
    if (주광.current) {
      주광.current.target.position.copy(s.중심);
      주광.current.target.updateMatrixWorld();
    }
    if (보조광.current) {
      보조광.current.position.copy(camera.position).addScaledVector(위, 0.4);
      보조광.current.target.position.copy(s.중심);
      보조광.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      {/* 주광 — 왼쪽 위 앞. 얼굴과 몸의 굴곡을 만든다. */}
      <directionalLight ref={주광} position={[-2.4, 3.4, 2.6]} intensity={1.30} color="#FFF6EA" />
      {/* 윤곽광 — 뒤 오른쪽. 머리·어깨를 배경에서 떼어 낸다. */}
      <directionalLight position={[2.6, 2.2, -3.0]} intensity={0.85} color="#9AD8E8" />
      {/* 보조광 — 카메라를 따라가며 그림자 쪽이 검게 죽지 않을 만큼만 채운다. */}
      <directionalLight ref={보조광} intensity={0.28} color="#CFE6F2" />
      <hemisphereLight args={["#DCEAF5", "#1A2B38", 0.46]} />
      <ambientLight intensity={0.18} />
    </>
  );
}

function CC보임감시({ 바뀜 }) {
  useEffect(() => {
    const 듣기 = () => 바뀜(!document.hidden);
    document.addEventListener("visibilitychange", 듣기);
    return () => document.removeEventListener("visibilitychange", 듣기);
  }, [바뀜]);
  return null;
}

// 개발용 손잡이 — 헤드리스 검사에서 씬을 직접 재려고 연다.
function CC손잡이({ 표시열쇠 }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
    window.__캐릭터생성 = { get, THREE, 표시열쇠 };
    return () => { delete window.__캐릭터생성; };
  }, [get, 표시열쇠]);
  return null;
}

export default function CC캐릭터프리뷰({
  설정,
  보기 = "전신",
  자세 = "Idle_Loop",
  품질 = "보통",
  안전영역 = { 왼쪽: 0, 오른쪽: 0, 위: 0, 아래: 0 },
  조작알림,
  읽는중알림,
}) {
  const 상태참조 = useRef(정지상태());
  // 카메라 조작값은 이 컴포넌트가 들고 있고, 바깥(도크 단추)에는 손잡이만 넘긴다.
  //   ※ 바깥에서 받은 ref 를 여기서 바꾸면 리액트 규칙 검사에 걸린다(그리고 추적이 어렵다).
  const 조작 = useRef({ 좌우: -0.30, 위아래: 0.06, 줌: 1 });
  const 끌기 = useRef(null);
  const 손가락 = useRef(new Map());
  const 벌림 = useRef(0);
  const 감쌈 = useRef(null);
  const 파일열쇠 = 파일열쇠만들기(설정);
  const [표시열쇠, set표시열쇠] = useState(파일열쇠);
  const [보임, set보임] = useState(() => typeof document === "undefined" || !document.hidden);

  const 덜움직이기 = useMemo(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  const 표시설정 = useMemo(() => ({ ...설정, ...열쇠풀기(표시열쇠) }), [설정, 표시열쇠]);
  const 읽는중 = 파일열쇠 !== 표시열쇠;

  useEffect(() => {
    읽는중알림?.(읽는중);
  }, [읽는중, 읽는중알림]);

  const 예열끝 = useCallback((열쇠) => {
    set표시열쇠((이전) => (열쇠 === 이전 ? 이전 : 열쇠));
  }, []);

  useEffect(() => {
    조작알림?.({
      돌리기: (라디안) => { 조작.current.좌우 += 라디안; },
      초기화: () => { 조작.current = { 좌우: -0.30, 위아래: 0.06, 줌: 1 }; },
    });
  }, [조작알림]);

  const 줌바꾸기 = useCallback((배) => {
    조작.current.줌 = THREE.MathUtils.clamp(조작.current.줌 * 배, 0.45, 2.2);
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
    조작.current.위아래 = THREE.MathUtils.clamp(조작.current.위아래 + dy * 0.005, -0.40, 0.75);
  };
  const 뗌 = (e) => {
    손가락.current.delete(e.pointerId);
    if (손가락.current.size < 2) 벌림.current = 0;
    if (손가락.current.size === 0) 끌기.current = null;
  };

  const 품질설정 = 품질값[품질] ?? 품질값.보통;
  const 실제자세 = 관찰자세(보기, 자세);

  return (
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
        // 캔버스는 투명하다 — 아래 CSS 배경이 화면 전체에 그대로 이어져야 한다.
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl, scene }) => {
          gl.setClearAlpha(0);
          scene.background = null;
        }}
        style={{ background: "transparent" }}
      >
        <CC보임감시 바뀜={set보임} />
        <CC손잡이 표시열쇠={표시열쇠} />
        <CC카메라
          조작={조작}
          보기={보기}
          키배율={표시설정.heightScale ?? 1}
          안전영역={안전영역}
          덜움직이기={덜움직이기}
          측정열쇠={표시열쇠}
        />
        <Suspense fallback={null}>
          <ChibiGameAvatar 보이기 플레이어참조={상태참조} 설정={{ ...표시설정, motion: 실제자세 }} 크기={1} 몸체="meshy" 툰={생성툰} />
          {/* 접지 — 발 밑은 또렷하고 둘레로 넓게 흐려진다. 두 장을 겹쳐 '검은 원 한 장' 을 피한다.
              매 프레임 다시 굽는다(frames=1 로 캐시하면 걷는 동안 그림자가 멈춘다). */}
          <ContactShadows position={[0, 0.002, 0]} opacity={0.5} scale={3.2} blur={품질설정.흐림} far={1.6}
                          resolution={품질설정.그림자} color="#04080E" />
          <ContactShadows position={[0, 0.001, 0]} opacity={0.24} scale={7} blur={4.5} far={2.4}
                          resolution={Math.max(128, Math.round(품질설정.그림자 / 2))} color="#04080E" />
        </Suspense>
        <Suspense fallback={null}>
          <CC모델예열 설정={설정} 열쇠={파일열쇠} 알림={예열끝} key={파일열쇠} />
        </Suspense>
      </Canvas>
    </div>
  );
}
