// use1인칭.js — 1인칭 이동 (USR-104 · S7-008)
//
// App.jsx 의 usePlayer 와 하는 일은 같지만, 로비 전용 값(방 크기·복도·충돌 목록)에
// 묶여 있지 않다. **씬이 자기 설정과 자기 충돌 판정을 넣어 준다.**
// 그래서 로비·훈련실·게임 방이 같은 조작을 쓰면서 값만 달리할 수 있다
// (USR-114 「본편과 똑같은 조작」의 전제).
//
// [시점 회전은 여기서 안 한다]
//   마우스 회전은 drei PointerLockControls 가 맡는다. 상하 제한도 그쪽 몫이라
//   씬에서 <PointerLockControls minPolarAngle maxPolarAngle> 로 준다 (S7-009).
//   여기서는 '어디로 걸어가는가'만 계산한다.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// 게임이 가로채는 키 — 브라우저 기본 동작(스크롤 등)을 막을 대상
const 처리키 = new Set([
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
  "ControlLeft",
  "ControlRight",
  "Space",
]);

/**
 * @param {object} 설정  조작설정.js 의 값 (게임조작 / 로비조작 …)
 * @param {object} 옵션
 *   - 켜기      : false 면 입력을 전부 무시한다 (일시정지·모달 — USR-113)
 *   - 막힘      : (x, z) => boolean. 그 자리에 못 서면 true
 *   - 시작위치  : [x, z]
 */
export function use1인칭(설정, { 켜기 = true, 막힘, 시작위치 = [0, 0] } = {}) {
  const { camera } = useThree();

  // useFrame 콜백은 처음 만들어질 때의 값을 '기억'해 버린다.
  //   설정을 바꿔도 반영되도록 상자(ref)에 담아 두고 그 상자를 들여다본다.
  const 설정ref = useRef(설정);
  설정ref.current = 설정;
  const 켜기ref = useRef(켜기);
  켜기ref.current = 켜기;
  const 막힘ref = useRef(막힘);
  막힘ref.current = 막힘;

  const 키 = useRef({ 앞: false, 뒤: false, 좌: false, 우: false, 달리기: false, 앉기: false });
  const 속도 = useRef(new THREE.Vector3());
  const 수직 = useRef(0);
  const 접지 = useRef(true);

  // 시작 위치로 한 번 세운다
  useEffect(() => {
    camera.position.set(시작위치[0], 설정.눈높이, 시작위치[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const 설정키 = (code, v) => {
      const k = 키.current;
      if (code === "KeyW" || code === "ArrowUp") k.앞 = v;
      if (code === "KeyS" || code === "ArrowDown") k.뒤 = v;
      if (code === "KeyA" || code === "ArrowLeft") k.좌 = v;
      if (code === "KeyD" || code === "ArrowRight") k.우 = v;
      if (code === "ShiftLeft" || code === "ShiftRight") k.달리기 = v;
      if (code === "ControlLeft" || code === "ControlRight") k.앉기 = v;
    };
    const 누름 = (e) => {
      // ★ 일시정지 중에도 preventDefault 는 한다.
      //   막지 않으면 Space 가 페이지를 스크롤해 화면이 튄다.
      if (처리키.has(e.code)) e.preventDefault();
      if (!켜기ref.current) return;
      설정키(e.code, true);
      if (e.code === "Space" && 접지.current) 수직.current = 설정ref.current.점프;
    };
    const 뗌 = (e) => 설정키(e.code, false);
    // 창을 벗어나면 키가 눌린 채로 남는다 → 계속 걷는 버그. 전부 뗀 것으로 친다.
    const 비움 = () => {
      키.current = { 앞: false, 뒤: false, 좌: false, 우: false, 달리기: false, 앉기: false };
    };
    window.addEventListener("keydown", 누름);
    window.addEventListener("keyup", 뗌);
    window.addEventListener("blur", 비움);
    return () => {
      window.removeEventListener("keydown", 누름);
      window.removeEventListener("keyup", 뗌);
      window.removeEventListener("blur", 비움);
    };
  }, []);

  // 일시정지에 들어가면 그 자리에 선다(관성으로 미끄러지지 않게)
  useEffect(() => {
    if (!켜기) {
      속도.current.set(0, 0, 0);
      키.current = { 앞: false, 뒤: false, 좌: false, 우: false, 달리기: false, 앉기: false };
    }
  }, [켜기]);

  const 앞벡터 = useRef(new THREE.Vector3());
  const 옆벡터 = useRef(new THREE.Vector3());

  useFrame((_, 델타) => {
    const s = 설정ref.current;
    const dt = Math.min(델타, 0.05); // 탭이 멈췄다 돌아오면 dt 가 튄다 → 상한
    const p = camera.position;
    const k = 키.current;
    const 앉음 = k.앉기;

    if (켜기ref.current) {
      // 바라보는 방향(수평 성분만) — 위를 봐도 앞으로만 간다
      camera.getWorldDirection(앞벡터.current);
      앞벡터.current.y = 0;
      앞벡터.current.normalize();
      옆벡터.current.crossVectors(앞벡터.current, camera.up).normalize();

      const 전후 = (k.앞 ? 1 : 0) - (k.뒤 ? 1 : 0);
      const 좌우 = (k.우 ? 1 : 0) - (k.좌 ? 1 : 0);
      const 속력 =
        s.걷기 * (앉음 ? s.앉기배수 : k.달리기 ? s.달리기배수 : 1);

      const 목표 = new THREE.Vector3()
        .addScaledVector(앞벡터.current, 전후)
        .addScaledVector(옆벡터.current, 좌우);
      if (목표.lengthSq() > 0) 목표.normalize().multiplyScalar(속력);

      // 땅에서는 즉시, 공중에서는 조금만 방향을 바꿀 수 있다
      const 반응 = 접지.current ? 1 : s.공중조작;
      속도.current.x += (목표.x - 속도.current.x) * 반응;
      속도.current.z += (목표.z - 속도.current.z) * 반응;
    }

    // ── 수평 이동 + 충돌 ───────────────────────────────────
    // ★ 이미 물건 '안'에 있으면 양쪽 축이 모두 막혀 영원히 못 움직인다.
    //   갇힌 상태면 이동을 허용해 빠져나가게 한다.
    const 막 = 막힘ref.current;
    const 갇힘 = 막 ? 막(p.x, p.z) : false;

    const nx = p.x + 속도.current.x * dt;
    if (갇힘 || !막 || !막(nx, p.z)) p.x = nx;
    else 속도.current.x = 0;

    const nz = p.z + 속도.current.z * dt;
    if (갇힘 || !막 || !막(p.x, nz)) p.z = nz;
    else 속도.current.z = 0;

    // ── 수직(중력·점프) ────────────────────────────────────
    const 바닥 = 앉음 ? s.앉은높이 : s.눈높이;
    수직.current += s.중력 * dt;
    let ny = p.y + 수직.current * dt;
    if (ny <= 바닥) {
      ny = 바닥;
      수직.current = 0;
      접지.current = true;
    } else {
      접지.current = false;
    }
    p.y = ny;
  });

  return { 접지, 키 };
}
