import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { 배경시작점 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   페이지 뒤에 깔리는 깊은 공간 — 스크롤하면 카메라가 **안으로 날아간다**

   [CSS 확대와 무엇이 다른가]
   CSS 로 scale 을 키우는 건 납작한 그림을 늘리는 것이다. 각도가 바뀌어도
   새로 드러나는 면이 없고, 앞뒤 물체가 **서로 다른 속도로** 움직이지 않는다.
   그래서 아무리 키워도 「커졌다」로만 읽힌다.

   여기서는 진짜 3차원 공간을 만들고 **카메라 자체를 z 축으로 움직인다.**
   그러면 저절로 이런 일들이 생긴다 — 이게 3D 웹사이트의 실제 재료다.
   · 가까운 것이 먼 것보다 훨씬 빨리 지나간다(운동 시차)
   · 앞에 있던 것이 화면 밖으로 밀려나며 **옆면이 드러난다**
   · 멀리 있던 것이 안개를 뚫고 서서히 나타난다
   · 고리를 하나씩 **통과한다** — 통과하는 순간이 깊이를 가장 잘 알려 준다

   [무엇이 있나]
   · 통로 고리 — 일정 간격으로 놓인 원. 카메라가 그 속을 지난다.
   · 떠 있는 파편 — 통로 벽 쪽에 흩어져 있다. 지날 때 옆면이 보인다.
   · 먼지 — 아주 가까운 층. 조금만 움직여도 크게 흘러 시차를 강조한다.
   · 지수 안개 — 멀수록 바탕색에 녹는다. 안개가 없으면 깊이가 안 느껴진다.

   [화면을 해치지 않게]
   페이지 내용보다 **뒤에** 깔리고 클릭을 받지 않는다.

   ★ 세기를 두 번 낮췄다. 처음엔 또렷하게 그렸더니 글을 읽는 동안 뒤에서
     계속 뭔가 움직여 눈이 피로했다. 배경은 **있는 줄 알아볼 정도**면 된다.
     · 고리 투명도 0.75 → 0.30  · 파편 반투명 0.45  · 먼지 0.5 → 0.26
     · 조명 전반 절반으로  · 안개 0.019 → 0.032 (먼 것이 일찍 사라진다)

   [가볍게]
   · 파편은 InstancedMesh 하나로 그린다(그리기 호출 1번).
   · 고리는 얇은 도넛 12개뿐.
   · dpr 1.5 로 묶고, 탭이 숨으면 렌더를 멈춘다.
   · 동작 줄이기를 켠 사람에겐 카메라를 세운다.
   ═══════════════════════════════════════════════════════ */

const 바탕 = "#02040a";
const 파랑 = "#3b82f6";
const 하늘 = "#93c5fd";

/* 통로 전체 길이(단위). 스크롤 0~1 이 이 거리를 지난다.
   ★ 520 은 너무 길었다. 페이지를 조금만 굴려도 카메라가 수십 단위를 날아가
     화면이 어지러웠다. 절반 아래로 줄여 **한 화면 굴릴 때 한 칸쯤** 가게 한다. */
const 통로길이 = 210;
const 고리수 = 8;
const 파편수 = 260;

/* ───────────────────────────────────────────────────────
   통과하는 고리들

   일정 간격으로 놓인 얇은 원. 「지나간다」는 느낌은 크기 변화가 아니라
   **통과하는 사건**에서 나온다 — 고리가 화면을 가득 채웠다가 뒤로
   사라지는 그 순간이 깊이를 가장 분명하게 알려 준다.
   ─────────────────────────────────────────────────────── */
function 고리들() {
  const 칸 = useRef(null);

  const 자리 = useMemo(
    () =>
      Array.from({ length: 고리수 }, (_, i) => ({
        z: -(i + 1) * (통로길이 / 고리수),
        /* 반지름을 넓게 흔든다 — 다 같으면 그냥 원기둥으로 보이고,
           들쭉날쭉해야 좁아졌다 넓어지는 통로처럼 읽힌다 */
        반지름: 6 + Math.sin(i * 1.7) * 3.6,
        비틈: [Math.sin(i * 0.9) * 0.26, Math.cos(i * 1.3) * 0.26, i * 0.4],
        진하기: 0.3 - i * 0.015,
      })),
    [],
  );

  useFrame((_, 지난시간) => {
    /* 통로 전체가 아주 천천히 돈다 — 멈춰 있으면 터널이 죽어 보인다 */
    if (칸.current) 칸.current.rotation.z += 지난시간 * 0.02;
  });

  return (
    <group ref={칸}>
      {자리.map((ㄱ, i) => (
        <mesh key={i} position={[0, 0, ㄱ.z]} rotation={ㄱ.비틈}>
          {/* ★ 튜브를 0.022 로 뒀더니 20 단위만 떨어져도 1픽셀이 안 돼서
              아예 안 보였다. 화면에 잡히려면 이 정도는 굵어야 한다. */}
          <torusGeometry args={[ㄱ.반지름, 0.075, 6, 96]} />
          <meshBasicMaterial color={i % 3 === 0 ? 하늘 : 파랑} transparent opacity={Math.max(0.09, ㄱ.진하기)} />
        </mesh>
      ))}
    </group>
  );
}

/* ───────────────────────────────────────────────────────
   통로 벽에 떠 있는 단서 조각

   [왜 뾰족한 돌이 아니라 납작한 조각인가]
   이 게임은 지워진 기록을 쫓는 이야기다(조사관 · 단서 카드 · 수사 수첩).
   그래서 둥둥 떠 있는 것도 **낱장으로 흩어진 기록**처럼 보이는 게 맞다.
   얇은 판이라 옆에서 보면 선이 되고 정면에서 보면 면이 된다 — 카메라가
   지나갈 때 반짝 뒤집히는 모습이 「종이가 떠다닌다」로 읽힌다.

   가운데는 비워 둔다 — 카메라가 지나갈 길이고, 글 뒤가 어수선하면 안 된다.
   InstancedMesh 라 260개를 그려도 그리기 호출은 한 번이다.
   ─────────────────────────────────────────────────────── */
function 파편들() {
  const 몸 = useRef(null);

  const 배치 = useMemo(() => {
    const 임시 = new THREE.Object3D();
    const 목록 = [];
    for (let i = 0; i < 파편수; i += 1) {
      const 각 = Math.random() * Math.PI * 2;
      /* 반지름 5.5 안쪽은 비운다 — 카메라가 지나는 길 */
      const 거리 = 3.6 + Math.random() * 15;
      임시.position.set(Math.cos(각) * 거리, Math.sin(각) * 거리 * 0.75, -Math.random() * 통로길이);
      임시.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      /* 낱장이라 세로로 길쭉하다. 크기를 제각각으로 둬야 멀고 가까운 게 섞인다. */
      const 크기 = 0.5 + Math.random() * 0.9;
      임시.scale.set(크기 * 0.72, 크기, 1);
      임시.updateMatrix();
      목록.push(임시.matrix.clone());
    }
    return 목록;
  }, []);

  useFrame((_, 지난시간) => {
    if (몸.current) 몸.current.rotation.z -= 지난시간 * 0.012;
  });

  return (
    <instancedMesh
      ref={(el) => {
        몸.current = el;
        if (!el || el.userData.깔림) return;
        배치.forEach((m, i) => el.setMatrixAt(i, m));
        el.instanceMatrix.needsUpdate = true;
        el.userData.깔림 = true;
      }}
      args={[undefined, undefined, 파편수]}
    >
      {/* 얇은 판 — 두께가 거의 없어 옆에서 보면 선이 된다 */}
      <boxGeometry args={[1, 1.35, 0.02]} />
      {/* 스스로 내는 빛을 낮추고 금속감을 올린다 — 제 빛으로 환하면 면마다
          밝기가 같아져서 납작한 색종이처럼 보인다. 빛을 **받아야** 입체가 된다. */}
      <meshStandardMaterial
        color="#0a1730"
        emissive="#1e3a8a"
        emissiveIntensity={0.06}
        metalness={0.4}
        roughness={0.55}
        transparent
        opacity={0.45}
        depthWrite={false}
        flatShading
      />
    </instancedMesh>
  );
}

/* ───────────────────────────────────────────────────────
   휘는 격자 — 게임 이름 「왜곡」을 그대로 그린 것

   [왜 넣었나]
   ① **이름 그 자체다.** 반듯해야 할 격자가 물결처럼 휘는 것만큼
      「왜곡」을 분명히 보여 주는 그림은 없다.
   ② **속도의 기준이 된다.** 허공에 점만 떠 있으면 얼마나 빨리 가는지
      가늠이 안 된다. 바닥이 깔리면 격자가 흘러가는 걸 보고 속도를 읽는다.
      (「너무 빠르다」는 느낌은 기준이 없어서 생기기도 한다)

   [어떻게 휘나]
   꼭짓점 높이를 두 방향 물결로 밀어 올린다. 시간이 지나면 물결이
   흘러가서 바닥이 천천히 일렁인다.
   40×40 칸이라 꼭짓점이 1681개 — 매 프레임 고쳐도 가볍다.
   ─────────────────────────────────────────────────────── */
function 휘는격자({ 높이 = -7, 뒤집기 = false }) {
  const 몸 = useRef(null);
  const 처음 = useRef(null);

  useFrame(({ clock }) => {
    const 판 = 몸.current?.geometry;
    if (!판) return;
    const 자리 = 판.attributes.position;
    if (!처음.current) 처음.current = Float32Array.from(자리.array);

    const ㅅ = clock.getElapsedTime() * 0.35;
    for (let i = 0; i < 자리.count; i += 1) {
      const x = 처음.current[i * 3];
      const y = 처음.current[i * 3 + 1];
      /* 두 방향 물결을 겹친다 — 한 방향만 쓰면 빨래판처럼 규칙적이다 */
      자리.array[i * 3 + 2] =
        Math.sin(x * 0.12 + ㅅ) * 1.1 + Math.sin(y * 0.09 - ㅅ * 0.8) * 0.9;
    }
    자리.needsUpdate = true;
  });

  return (
    <mesh
      ref={몸}
      position={[0, 높이, -통로길이 / 2]}
      rotation={[뒤집기 ? Math.PI / 2 : -Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[70, 통로길이 + 80, 40, 40]} />
      <meshBasicMaterial color={파랑} wireframe transparent opacity={0.075} />
    </mesh>
  );
}

/* 아주 가까운 먼지 층 — 조금만 움직여도 크게 흘러 시차를 강조한다 */
function 가까운먼지({ 개수 = 500 }) {
  const 자리 = useMemo(() => {
    const 값 = new Float32Array(개수 * 3);
    for (let i = 0; i < 개수; i += 1) {
      const 각 = Math.random() * Math.PI * 2;
      const 거리 = 2 + Math.random() * 16;
      값[i * 3] = Math.cos(각) * 거리;
      값[i * 3 + 1] = Math.sin(각) * 거리 * 0.8;
      값[i * 3 + 2] = -Math.random() * 통로길이;
    }
    return 값;
  }, [개수]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[자리, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} color={하늘} transparent opacity={0.26} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/* ───────────────────────────────────────────────────────
   스크롤에 물린 카메라

   ★ 여기가 핵심이다. 물체를 키우는 게 아니라 **카메라를 앞으로 민다.**
   그래야 가까운 것과 먼 것이 서로 다른 속도로 지나가는 진짜 시차가 생긴다.

   · 목표 위치로 조금씩 따라붙는다(lerp) — 스크롤을 홱 움직여도
     카메라는 관성을 갖고 부드럽게 따라온다. 바로 붙이면 뚝뚝 끊긴다.
   · 마우스로는 **위치가 아니라 바라보는 방향**을 조금 돌린다.
     둘러보는 느낌은 고개를 돌려야 나지, 몸을 옮겨서는 안 난다.
   ─────────────────────────────────────────────────────── */
/* ───────────────────────────────────────────────────────
   소실점 옮기기

   [왜 캔버스를 밀지 않나]
   캔버스째 옆으로 밀면 반대쪽에 캔버스가 안 닿는 띠가 생긴다. 많이 밀수록
   그 띠가 넓어져서, 덮개로 감추려 해도 경계가 드러난다. 그렇다고 캔버스를
   화면의 두 배로 키우면 칠할 픽셀이 네 배가 된다.

   [대신 하는 것]
   카메라에게 「실제보다 큰 그림의 한쪽 귀퉁이를 그리는 중」이라고 알려 준다
   (setViewOffset). 그러면 그림의 한가운데 — 곧 소실점 — 가 화면 안의 원하는
   자리로 옮겨 간다. 캔버스는 화면 크기 그대로라 픽셀이 한 장도 안 늘고,
   덜 닿는 곳도 없다. 배율(fov)도 그대로다.

   화면 크기가 바뀌면 다시 잡아 줘야 한다 — 값이 픽셀 단위이기 때문이다.
   ─────────────────────────────────────────────────────── */
function 소실점옮기기() {
  const { camera, size } = useThree();

  useEffect(() => {
    const { width: 폭, height: 높이 } = size;
    if (!폭 || !높이) return undefined;
    camera.setViewOffset(
      폭,
      높이,
      폭 * (0.5 - 배경시작점.가로),
      높이 * (0.5 - 배경시작점.세로),
      폭,
      높이,
    );
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, size]);

  return null;
}

function 카메라({ 줄임 }) {
  const { camera } = useThree();
  const 몫 = useRef(0);
  const 목표 = useRef(new THREE.Vector3(0, 0, 0));
  const 봄 = useRef(new THREE.Vector3(0, 0, -20));

  useFrame(({ pointer }, 지난시간) => {
    if (줄임) return;

    const 끝 = document.documentElement.scrollHeight - window.innerHeight;
    const 새몫 = 끝 <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / 끝));
    몫.current = 새몫;

    목표.current.set(0, 0, -새몫 * 통로길이);

    /* ═══ 속도 다스리기 ═══
       스크롤 막대를 홱 끌면 목표가 순식간에 수십 단위 앞으로 뛴다.
       lerp 만 쓰면 그 거리를 그대로 따라가서 **화면이 휙 날아간다.**
       그래서 두 겹으로 잡는다.
       ① 따라붙는 비율을 낮춘다(0.06 → 0.035) — 늘 한 박자 늦게 온다.
       ② 그래도 한 프레임에 갈 수 있는 거리를 **초당 22단위**로 자른다.
          아무리 빨리 굴려도 카메라는 그 속도를 넘지 못한다.
       프레임 시간(지난시간)을 곱해야 빠른 기기·느린 기기에서 같은 속도가 된다. */
    const 최대속도 = 22;
    const 남은 = 목표.current.z - camera.position.z;
    const 가려는거리 = 남은 * 0.035;
    const 한계 = 최대속도 * 지난시간;
    const 실제 = Math.max(-한계, Math.min(한계, 가려는거리));
    camera.position.z += 실제;

    /* 바라보는 점을 마우스 쪽으로 살짝 옮긴다 = 고개를 돌리는 것.
       이쪽도 천천히 따라오게 해서 마우스를 휙 움직여도 화면이 안 흔들린다. */
    봄.current.lerp(
      { x: pointer.x * 2.6, y: pointer.y * 1.8, z: camera.position.z - 20 },
      0.05,
    );
    camera.lookAt(봄.current);
  });

  return null;
}

export default function 깊은우주({ 보임 = true, 줄임 = false }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 0], fov: 62, near: 0.1, far: 260 }}
      /* 안 보일 때는 아예 안 그린다 — 화면에서 사라진 걸 계속 그릴 이유가 없다 */
      frameloop={보임 && !줄임 ? "always" : "never"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* 안개가 깊이를 만든다 — 없으면 먼 것도 또렷해서 평면처럼 보인다 */}
      {/* 안개를 진하게 잡을수록 먼 것이 일찍 바탕에 녹는다 —
          화면에 떠 있는 물체 수가 줄어 눈이 덜 피로하다 */}
      <fogExp2 attach="fog" args={[바탕, 0.032]} />

      {/* 환한 주변광을 낮추고 방향광 대비를 키운다 — 면끼리 밝기 차이가
          나야 다면체가 다면체로 보인다 */}
      <ambientLight intensity={0.16} />
      <directionalLight position={[8, 6, 3]} intensity={1.4} color={하늘} />
      <directionalLight position={[-7, -4, -2]} intensity={0.6} color="#1d4ed8" />
      {/* 카메라 앞을 비추는 등 — 가까이 오는 것이 먼저 밝아진다 */}
      <pointLight position={[0, 0, 4]} intensity={14} distance={30} decay={1.7} color={파랑} />

      <고리들 />
      {/* 바닥과 천장 — 위아래로 감싸면 「통로 안」이 분명해진다 */}
      <휘는격자 높이={-7} />
      <휘는격자 높이={8.5} 뒤집기 />
      <파편들 />
      <가까운먼지 />
      <소실점옮기기 />
      <카메라 줄임={줄임} />
    </Canvas>
  );
}
