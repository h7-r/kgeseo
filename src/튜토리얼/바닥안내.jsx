// ═══════════════════════════════════════════════════════════════
//  바닥안내.jsx — 바닥 화살표 길 + 목표 링 + 빛기둥 (3D)
// ═══════════════════════════════════════════════════════════════
// [왜 3D 로 그리나]
//   "저쪽으로 가라"를 글로 쓰면 읽어야 한다. 바닥에 흐르는 셰브론은 읽지 않아도
//   방향이 보인다. 그게 「읽히지 않고 걷게」다.
//
// [★ 숨기는 방법 — 조건부 렌더·visible=false 를 쓰지 않는다]
//   처음 보이는 순간 재질 셰이더를 컴파일하느라 멈춘다. 복도 첫 노출에서
//   2.1 초가 그렇게 날아갔다(지하 성능 보고서). `visible=false` 면 사전 컴파일
//   (`공용.jsx 셰이더예열` 의 `gl.compileAsync`)에서도 빠져서 결국 처음 켤 때 컴파일한다.
//   그래서 **처음부터 씬에 올려 두고 `material.opacity = 0` 으로만 숨긴다.**
//   2 회차(안내 꺼짐)에는 이 컴포넌트를 아예 안 붙이면 된다 — 마운트 여부는
//   복도에 들어오기 **전에 한 번만** 정한다(안내상태.켜기정하기).
//
// [조명을 하나도 안 쓴다]
//   three 는 보이는 조명 개수를 셰이더 키에 넣는다. 조명이 하나라도 늘면 재질
//   셰이더를 전부 다시 만든다(= 2 초 멈춤). 그래서 전부 MeshBasicMaterial 이고
//   castShadow·receiveShadow 도 끈다. 밝아 보이는 건 가산 합성이 낸다.
//
// [매 프레임 리렌더 금지]
//   흐름·맥박은 `useFrame` 에서 **텍스처 offset 과 material.opacity 만** 바꾼다.
//   React state 를 건드리지 않는다.

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { 안내설정 } from "./안내단계.js";
import { use안내, 지금단계, 자리풀기 } from "./안내상태.js";

// ── 셰브론(›) 줄무늬 한 장 ──────────────────────────────────
//   길이만큼 세로로 반복시킨다. 텍스처는 **한 번만** 만든다.
function 셰브론텍스처(색) {
  const W = 64;
  const H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 색;
  g.lineWidth = 9;
  g.lineCap = "round";
  g.lineJoin = "round";
  // 위를 향한 꺾쇠 하나. wrapT 반복으로 줄이 된다.
  g.beginPath();
  g.moveTo(W * 0.18, H * 0.68);
  g.lineTo(W * 0.5, H * 0.3);
  g.lineTo(W * 0.82, H * 0.68);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── 빛기둥 그라데이션 (아래 진하고 위로 사라진다) ────────────
function 기둥텍스처(색) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 64, 0, 0); // 아래 → 위
  grd.addColorStop(0, 색);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 길 점들([x,z] 배열)로 납작한 띠를 만든다.
//   점이 2개면 곧은 띠, 3개 이상이면 CatmullRom 으로 부드럽게 잇는다.
//   ※ 길이 없을 때도 **빈 지오메트리를 만들지 않는다** — 자리만 차지하는 작은 띠를
//     두고 opacity 로 숨긴다. 지오메트리가 없으면 그리지 않고, 그러면 셰이더도
//     안 데워진다(위 「숨기는 방법」과 같은 이유).
function 띠지오(점들, 폭) {
  const 안전 = 점들 && 점들.length >= 2 ? 점들 : [[0, 0], [0, 0.01]];
  const 곡선 = new THREE.CatmullRomCurve3(
    안전.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    "catmullrom",
    0.2,
  );
  const 칸 = Math.max(2, Math.min(200, Math.round(곡선.getLength() * 4)));
  const 점 = 곡선.getSpacedPoints(칸);
  const 자리 = [];
  const uv = [];
  const 인덱스 = [];
  const 접선 = new THREE.Vector3();
  const 옆 = new THREE.Vector3();
  const 위 = new THREE.Vector3(0, 1, 0);
  let 누적 = 0;
  for (let i = 0; i < 점.length; i += 1) {
    const p = 점[i];
    const q = 점[Math.min(점.length - 1, i + 1)];
    const r = 점[Math.max(0, i - 1)];
    접선.copy(q).sub(r);
    if (접선.lengthSq() < 1e-8) 접선.set(0, 0, 1);
    접선.normalize();
    옆.crossVectors(위, 접선).normalize().multiplyScalar(폭 / 2);
    자리.push(p.x - 옆.x, 0, p.z - 옆.z, p.x + 옆.x, 0, p.z + 옆.z);
    if (i > 0) 누적 += p.distanceTo(점[i - 1]);
    uv.push(0, 누적, 1, 누적);
    if (i > 0) {
      const a = (i - 1) * 2;
      인덱스.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(자리, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(인덱스);
  g.computeBoundingSphere();
  return { 지오: g, 길이: 누적 };
}

// ── 자원은 **모듈 수준에 하나만** 둔다 ──────────────────────
//   [왜 훅으로 안 만드나]  아래 useFrame 이 매 프레임 `opacity` 와 텍스처 `offset` 을
//   고친다. 그게 이 연출의 본체인데, 린트(react-hooks)는 「훅이 돌려준 값을 렌더 뒤에
//   고친다」와 「렌더 중 ref 접근」을 둘 다 막는다. useMemo·useRef 어느 쪽으로 담아도
//   걸린다. 안내는 화면에 **하나뿐**이라 모듈 수준 싱글턴이 맞고, 규칙도 안 건드린다.
let _자원 = null;
function 자원() {
  if (_자원) return _자원;
  const 색 = 안내설정.색;
  const 셰브론 = 셰브론텍스처(색);
  const 기둥결 = 기둥텍스처(색);
  const 공통 = {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  };
  _자원 = {
    셰브론,
    기둥결,
    띠재질: new THREE.MeshBasicMaterial({
      ...공통,
      map: 셰브론,
      color: 0xffffff,
      opacity: 0,
      // 바닥과 같은 높이라 z 싸움이 난다. 살짝 앞으로 당겨 둔다.
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    링재질: new THREE.MeshBasicMaterial({ ...공통, color: 색, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1 }),
    기둥재질: new THREE.MeshBasicMaterial({ ...공통, map: 기둥결, color: 0xffffff, opacity: 0 }),
    // ── 머리 위 방향 화살표 ────────────────────────────────
    //   [왜 두나]  바닥 길·링만으로는 "지금 어디로 가야 하나"가 안 읽힌다.
    //   특히 목표가 옆이나 뒤에 있으면 화면에 아무것도 없다(사용자 지적).
    //   캐릭터 머리 위에 큼직하게 띄우고 **목표 쪽으로 돌려** 둔다 —
    //   걸어서 자리가 바뀌면 방향도 따라 돈다.
    //   [왜 크고 흐리게]  크면 한눈에 읽히고, 흐리면 시야를 안 가린다.
    화살표재질: new THREE.MeshBasicMaterial({ ...공통, color: 색, opacity: 0, depthTest: false }),
    // ★ 원뿔을 썼다가 걷어냈다 — 뒤에서 보면 마름모, 위에서 보면 삼각뿔이라
    //   **어느 각도에서도 화살표로 안 읽혔다**(사용자 지적: "화살표처럼 보이질 않는다").
    //   바닥과 나란히 눕힌 **납작한 화살표 판**이면 3인칭 카메라(뒤 위쪽)에서
    //   그대로 "→" 로 읽힌다. 촉 + 자루를 한 모양으로 만든다.
    화살표지오: (() => {
      const 모 = new THREE.Shape();
      // +z 를 가리키는 화살표(촉이 앞). 단위는 유닛.
      모.moveTo(0, 1.0); // 촉 끝
      모.lineTo(-0.62, 0.15);
      모.lineTo(-0.24, 0.15);
      모.lineTo(-0.24, -0.85); // 자루
      모.lineTo(0.24, -0.85);
      모.lineTo(0.24, 0.15);
      모.lineTo(0.62, 0.15);
      모.closePath();
      const g = new THREE.ShapeGeometry(모);
      // Shape 은 XY 평면에 생긴다. 바닥과 나란하게 눕힌다.
      //   ★ 부호를 −π/2 로 두면 촉이 **−z** 를 가리킨다(실측: 화살표가 반대로 섰다).
      //     R_x(−90°) 는 +Y 를 −Z 로 보낸다. +z 를 향하게 하려면 +π/2 다.
      g.rotateX(Math.PI / 2);
      return g;
    })(),
    링지오: new THREE.RingGeometry(0.85, 1.05, 48),
    기둥지오: new THREE.CylinderGeometry(0.9, 0.9, 4, 24, 1, true),
  };
  return _자원;
}

// 띠는 **단계가 바뀔 때만** 다시 만든다. 이것도 모듈 수준에 둔다(같은 이유).
let _길 = { id: null, 값: null };
function 길지오(단계) {
  const id = 단계?.id ?? null;
  if (_길.id === id && _길.값) return _길.값;
  _길.값?.지오?.dispose?.();
  const 점들 = (단계?.길 ?? []).map((m) => 자리풀기(m)).filter(Boolean);
  _길 = { id, 값: 띠지오(점들.length >= 2 ? 점들 : null, 안내설정.띠폭) };
  return _길.값;
}

export default function TG바닥안내({ 바닥y = 0.01, 플레이어참조 = null }) {

  const { 띠재질, 링재질, 기둥재질, 링지오, 기둥지오, 화살표재질, 화살표지오 } = 자원(); // JSX 에서 읽기만 한다
  const 상자 = use안내();
  const 단계 = 지금단계();
  const 길 = 길지오(단계);

  const 띠ref = useRef(null);
  const 링ref = useRef(null);
  const 기둥ref = useRef(null);
  const 화살표ref = useRef(null);
  const 사라짐 = useRef(0); // 도착 뒤 0.3초 커지며 사라지는 진행도
  const 지난단계 = useRef(단계?.id ?? null);

  useFrame((_, dt) => {
    // ★ 바깥에서 뽑아 둔 이름을 여기서 고치면 린트가 「렌더 뒤에 지역 변수를 고친다」로
    //   잡는다. 프레임 안에서 **다시 꺼내** 쓴다(같은 싱글턴이라 값은 똑같다).
    const R = 자원();
    const 켜짐 = 상자.켜짐;
    const 목표 = 켜짐 ? 자리풀기(단계?.목표) : null;
    const 길있나 = 켜짐 && (단계?.길?.length ?? 0) >= 2;

    // 단계가 바뀌면 0.3초 동안 커지며 사라지는 연출을 시작한다.
    if (지난단계.current !== (단계?.id ?? null)) {
      지난단계.current = 단계?.id ?? null;
      사라짐.current = 목표 ? 0 : 1;
    }

    // ── 화살표 길 — 셰브론이 목표 쪽으로 흐른다 ──
    R.셰브론.offset.y -= dt * 안내설정.흐름속도;
    // ★ uv 의 v 는 이미 **세계 거리**(미터)다(띠지오). 그래서 repeat 에 길이를 또
    //   곱하면 두 번 세는 꼴이 된다 — 8 유닛 길에 꺾쇠가 100 개 넘게 찍혀 줄무늬가
    //   됐다(실제로 그렇게 나왔다). 여기서는 「몇 미터마다 하나」만 정한다.
    R.셰브론.repeat.set(1, 1 / Math.max(0.2, 안내설정.꺾쇠간격));
    R.띠재질.opacity += ((길있나 ? 0.55 : 0) - R.띠재질.opacity) * Math.min(1, dt * 6);

    // ── 목표 링 — 1.0 → 1.25 배, 투명도 0.9 → 0.3 을 1.2초 주기로 ──
    const t = (performance.now() / 1000) % 1.2;
    const k = 0.5 - 0.5 * Math.cos((t / 1.2) * Math.PI * 2); // 0→1→0
    if (목표 && 링ref.current) {
      링ref.current.position.set(목표[0], 바닥y + 0.02, 목표[1]);
      const 배 = (1 + 0.25 * k) * (1 + 사라짐.current * 0.8);
      링ref.current.scale.setScalar(배);
      기둥ref.current?.position.set(목표[0], 바닥y + 2, 목표[1]);
    }
    const 보임 = 목표 ? 1 - 사라짐.current : 0;
    R.링재질.opacity = (0.9 - 0.6 * k) * 보임;
    R.기둥재질.opacity = 0.22 * 보임;

    // ── 머리 위 화살표 — 사람을 따라다니며 목표를 가리킨다 ──
    const 사람 = 플레이어참조?.current?.position;
    const 화 = 화살표ref.current;
    if (화) {
      if (!사람 || !목표 || !켜짐) {
        R.화살표재질.opacity += (0 - R.화살표재질.opacity) * Math.min(1, dt * 8);
      } else {
        const dx = 목표[0] - 사람.x;
        const dz = 목표[1] - 사람.z;
        const 거리 = Math.hypot(dx, dz);
        // ★ 높이는 **발(footY) 기준**으로 잡는다. `사람.y` 는 1인칭 눈높이(6.5)라
        //   치비 캐릭터의 실제 키(훨씬 작다)와 안 맞는다 — 그대로 쓰면 화살표가
        //   머리보다 한참 위 허공에 뜬다(실측: 머리 화면 y 500, 화살표 320).
        const 발 = 플레이어참조?.current?.footY ?? 0;
        const 둥실 = Math.sin(performance.now() / 420) * 0.12;
        화.position.set(사람.x, 발 + 4.9 + 둥실, 사람.z);
        // 목표 쪽으로 돌린다. 바로 위에 서면(거리 0) 방향이 튀므로 그때는 그대로 둔다.
        if (거리 > 0.35) 화.rotation.y = Math.atan2(dx, dz);
        // 가까우면 흐려진다 — 다 왔는데 계속 가리키면 시야만 가린다.
        const 세기 = THREE.MathUtils.clamp((거리 - 1.2) / 2.5, 0, 1);
        // 깜빡인다 — 튜토리얼에서는 "저기다"가 한눈에 읽혀야 한다.
        const 맥 = 0.72 + 0.28 * Math.sin(performance.now() / 300);
        R.화살표재질.opacity += (0.4 * 세기 * 맥 - R.화살표재질.opacity) * Math.min(1, dt * 10);
      }
    }

    if (사라짐.current > 0 && 사라짐.current < 1) 사라짐.current = Math.min(1, 사라짐.current + dt / 0.3);
  });

  // ★ 언제나 마운트돼 있다. 숨김은 opacity 로만 한다(위 주석).
  return (
    <group name="튜토리얼-바닥안내" renderOrder={5}>
      <mesh
        ref={띠ref}
        geometry={길.지오}
        material={띠재질}
        position={[0, 바닥y + 안내설정.띠높이, 0]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      />
      <mesh
        ref={링ref}
        geometry={링지오}
        material={링재질}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      />
      {/* 머리 위 방향 화살표. 바깥 group 이 목표 쪽으로 돌고, 안쪽 mesh 가 원뿔을
          눕혀 앞(+z)을 가리키게 한다. 살짝 숙여 두면 바닥 목표를 가리키는 느낌이 난다. */}
      <group ref={화살표ref}>
        <mesh
          geometry={화살표지오}
          material={화살표재질}
          rotation={[-0.32, 0, 0]}
          castShadow={false}
          receiveShadow={false}
          frustumCulled={false}
          renderOrder={6}
        />
      </group>
      <mesh
        ref={기둥ref}
        geometry={기둥지오}
        material={기둥재질}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      />
    </group>
  );
}
