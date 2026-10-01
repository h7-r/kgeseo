// 출동길.jsx — 캔버스 안: 출동 단계를 굴리고 **바닥 화살표**를 기차 문까지 깐다
//
// [길을 어떻게 찾나]
//   본부실에는 책상·보드·기둥·의자가 있어 사람→문 직선은 가구를 뚫는다.
//   그래서 방 바닥을 0.5 유닛 격자로 나눠, 사람이 설 수 있는 칸(막힘반경 R)만
//   이어 **너비 우선 탐색**으로 길을 찾고, 서로 보이는 꼭짓점은 건너뛰어(줄 당기기)
//   매끈한 꺾은선으로 만든다. 가구를 옮기면(의자를 끌면) 다음 갱신에 길이 바뀐다.
//   격자는 72 × 52 ≈ 3,700 칸이라 0.4초마다 다시 풀어도 1ms 남짓이다.
//   복도에 있으면 「사람 → 방 구멍」 직선을 앞에 붙인다(복도엔 막을 게 없다).
//
// [그리기]
//   화살표(꺾쇠) 하나를 인스턴스로 최대 64개 — 드로우콜 1. 광원 없음.
//   길을 따라 앞으로 흘러가듯 밝기가 굽이친다. 문 앞에는 튜토리얼과 같은 빛기둥.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { 플레이어시점 } from "../공용.jsx";
import { 출동틱, use출동 } from "./출동.js";

const 칸 = 0.5;
const 간격 = 1.5; // 화살표 사이(유닛)
const 최대수 = 64;
const 색 = new THREE.Color("#ffb25c"); // 경보의 주황 — 튜토리얼(하늘색)과 구분한다
const 사람반지름 = 0.6;

// 꺾쇠 모양(›) — 앞(+y 로컬)을 가리킨다. 바닥에 눕혀 쓴다.
function 꺾쇠지오() {
  const s = new THREE.Shape();
  const w = 0.55, h = 0.42, t = 0.17;
  s.moveTo(-w, -h);
  s.lineTo(0, h - t);
  s.lineTo(w, -h);
  s.lineTo(w - t * 1.3, -h);
  s.lineTo(0, h - t * 3.1);
  s.lineTo(-w + t * 1.3, -h);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2); // 바닥에 눕힌다 → 앞이 −z
  return g;
}

/** 격자 너비 우선 탐색 + 줄 당기기 → [[x,z],…] */
function 길찾기(시작, 목표, 방, 막힘) {
  const nx = Math.ceil((방.maxX - 방.minX) / 칸) + 1;
  const nz = Math.ceil((방.maxZ - 방.minZ) / 칸) + 1;
  const 칸x = (i) => 방.minX + i * 칸;
  const 칸z = (j) => 방.minZ + j * 칸;
  const 열림 = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i += 1)
    for (let j = 0; j < nz; j += 1) 열림[i * nz + j] = 막힘(칸x(i), 칸z(j)) ? 0 : 1;
  const 가까운칸 = ([x, z]) => {
    const ci = Math.round((x - 방.minX) / 칸), cj = Math.round((z - 방.minZ) / 칸);
    let 최선 = -1, 최소 = Infinity;
    for (let di = -6; di <= 6; di += 1)
      for (let dj = -6; dj <= 6; dj += 1) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !열림[i * nz + j]) continue;
        const d = di * di + dj * dj;
        if (d < 최소) { 최소 = d; 최선 = i * nz + j; }
      }
    return 최선;
  };
  const s = 가까운칸(시작), g = 가까운칸(목표);
  if (s < 0 || g < 0) return null;
  const 앞 = new Int32Array(nx * nz).fill(-1);
  앞[s] = s;
  const 줄 = [s];
  for (let k = 0; k < 줄.length && 앞[g] < 0; k += 1) {
    const c = 줄[k], i = Math.floor(c / nz), j = c % nz;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const n = a * nz + b;
      if (!열림[n] || 앞[n] >= 0) continue;
      // 대각선은 두 옆칸이 다 열려 있어야(모서리를 깎지 않게)
      if (di && dj && (!열림[a * nz + j] || !열림[i * nz + b])) continue;
      앞[n] = c;
      줄.push(n);
    }
  }
  if (앞[g] < 0) return null;
  const 점들 = [];
  for (let c = g; ; c = 앞[c]) {
    점들.push([칸x(Math.floor(c / nz)), 칸z(c % nz)]);
    if (c === s) break;
  }
  점들.reverse();
  // 줄 당기기 — 보이는 데까지 건너뛴다
  const 보이나 = (p, q) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.ceil(d / (칸 * 0.5));
    for (let k = 1; k < n; k += 1) {
      const t = k / n;
      if (막힘(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)) return false;
    }
    return true;
  };
  const 매끈 = [점들[0]];
  let k = 0;
  while (k < 점들.length - 1) {
    let 멀리 = k + 1;
    for (let m = 점들.length - 1; m > k + 1; m -= 1)
      if (보이나(점들[k], 점들[m])) { 멀리 = m; break; }
    매끈.push(점들[멀리]);
    k = 멀리;
  }
  매끈[0] = 시작;
  매끈[매끈.length - 1] = 목표;
  return 매끈;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _위 = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/**
 * @param 문찾기  (x, z) => { x, z, 거리 } | null — 안내할 기차 문(App: 기차를 마주 본 오른쪽 문)
 * @param 막힘    (x, z, r) => boolean — 그 자리에 반지름 r 짜리가 못 서면 true
 * @param 방      { minX, maxX, minZ, maxZ } 본부실 경계(벽 안쪽)
 * @param 구멍    [x, z] 복도 → 방 구멍의 **방 쪽** 자리
 * @param 기차안  기차 씬이면 true(그 순간 탑승으로 친다)
 */
export default function 출동길({ 문찾기, 막힘, 방, 구멍, 기차안 = false }) {
  const { 단계 } = use출동();
  const 보임 = 단계 === "알림" || 단계 === "안내";
  const 지오 = useMemo(꺾쇠지오, []);
  const 재질 = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 색, transparent: true, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(() => () => { 지오.dispose(); 재질.dispose(); }, [지오, 재질]);
  const 무리 = useRef(null);
  const 표 = useRef(null);
  const 길 = useRef({ 점들: null, 다음갱신: 0, 문: null });

  useFrame(({ camera, clock }) => {
    const 눈 = 플레이어시점.쓸수있나 ? 플레이어시점.눈 : camera.position;
    const 본부실안 =
      눈.x > 방.minX - 0.2 && 눈.x < 방.maxX + 0.2 && 눈.z > 방.minZ - 0.2 && 눈.z < 방.maxZ + 0.2;
    const 문 = 문찾기(눈.x, 눈.z);
    // 남은 거리 = **실제로 걸어갈 길**의 길이. 직선거리로 재면 책상을 돌아가는 동안
    //   숫자가 그대로이거나 늘어서 「줄어든다」가 안 읽혔다(사용자 지적: 8m → 7m → 6m).
    //   길은 0.4초마다 다시 풀리지만, 사람→첫 꺾임 구간은 매 프레임 지금 자리로 잰다.
    const 지난길 = 길.current.점들;
    let 남은길 = 문 ? 문.거리 : null;
    if (문 && 지난길 && 지난길.length >= 2) {
      남은길 = Math.hypot(지난길[1][0] - 눈.x, 지난길[1][1] - 눈.z);
      for (let k = 1; k < 지난길.length - 1; k += 1)
        남은길 += Math.hypot(지난길[k + 1][0] - 지난길[k][0], 지난길[k + 1][1] - 지난길[k][1]);
    }
    출동틱({ 본부실안, 기차안, 문거리: 남은길 });

    const inst = 무리.current;
    if (!inst) return;
    if (!보임 || !문) {
      inst.count = 0;
      if (표.current) 표.current.visible = false;
      return;
    }
    const t = clock.elapsedTime;
    const L = 길.current;
    if (t > L.다음갱신) {
      L.다음갱신 = t + 0.4;
      const 막 = (x, z) => 막힘(x, z, 사람반지름);
      const 복도 = 눈.x < 방.minX;
      const 출발 = 복도 ? 구멍 : [눈.x, 눈.z];
      const 방길 = 길찾기(출발, [문.x, 문.z], 방, 막);
      L.점들 = 방길 ? (복도 ? [[눈.x, 눈.z], ...방길] : 방길) : [[눈.x, 눈.z], [문.x, 문.z]];
      L.문 = 문;
    }
    // ── 꺾은선을 따라 화살표를 일정 간격으로 놓는다 ──
    const 점들 = L.점들;
    let 전체 = 0;
    for (let k = 0; k < 점들.length - 1; k += 1)
      전체 += Math.hypot(점들[k + 1][0] - 점들[k][0], 점들[k + 1][1] - 점들[k][1]);
    let n = 0;
    let 남은 = 1.2; // 발밑은 비운다
    const 흐름 = (t * 1.6) % 간격; // 앞으로 흘러가는 듯 — 위치가 아니라 밝기 물결로
    let 누적 = 0;
    for (let k = 0; k < 점들.length - 1 && n < 최대수; k += 1) {
      const [ax, az] = 점들[k], [bx, bz] = 점들[k + 1];
      const d = Math.hypot(bx - ax, bz - az);
      if (d < 1e-4) continue;
      const ux = (bx - ax) / d, uz = (bz - az) / d;
      const 각 = Math.atan2(-ux, -uz); // 로컬 앞(−z) 을 진행 방향으로
      let s = 남은;
      while (s < d && n < 최대수) {
        if (전체 - (누적 + s) < 1.6) break; // 문 바로 앞은 빛기둥이 맡는다
        _p.set(ax + ux * s, 0.04, az + uz * s);
        _q.setFromAxisAngle(_위, 각);
        _s.setScalar(1);
        _m.compose(_p, _q, _s);
        inst.setMatrixAt(n, _m);
        const 물결 = 0.45 + 0.55 * Math.max(0, Math.cos(((누적 + s - 흐름) / 간격) * Math.PI * 0.5));
        inst.setColorAt(n, _c.copy(색).multiplyScalar(물결));
        n += 1;
        s += 간격;
      }
      누적 += d;
      남은 = s - d;
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

    const m = 표.current;
    if (m) {
      m.visible = true;
      m.position.set(L.문.x, 0.03, L.문.z);
      const 숨 = 0.5 + 0.5 * Math.sin(t * 4);
      m.scale.setScalar(1 + 숨 * 0.08);
    }
  });

  return (
    <>
      <instancedMesh ref={무리} args={[지오, 재질, 최대수]} frustumCulled={false} renderOrder={5} count={0} />
      <group ref={표} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
          <ringGeometry args={[1.25, 1.5, 48]} />
          <meshBasicMaterial color={색} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 2.4, 0]} renderOrder={5}>
          <cylinderGeometry args={[1.4, 1.5, 4.8, 40, 1, true]} />
          <meshBasicMaterial color={색} transparent opacity={0.13} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}
