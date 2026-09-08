// ═══════════════════════════════════════════════════════════════
//  use지형이동.js — 층이 여러 개인 지형 위를 걷는 1인칭 이동
// ═══════════════════════════════════════════════════════════════
// [공용.jsx 의 use이동 을 왜 그대로 못 쓰나]
//   use이동 은 바닥이 **하나**라고 가정한다(floorY = 눈높이 상수).
//   NAJU-01 은 EL 0 · +8 · +14 가 통로로 이어진 지형이라, 발밑 높이를
//   좌표로 물어봐야 한다. 그 한 가지만 다르다.
//
// [그래서 무엇을 지켰나]
//   조작감을 정하는 숫자(걷기·달리기·앉기 배율·중력·점프·공중제어·반경)와
//   키 처리 규칙은 **공용.jsx 에서 그대로 가져다 쓴다.** 여기에 다시 적지 않는다.
//   → 원본을 고치지 않으면서도 "역·기차와 같은 조작감"이 보장된다.
//   ※ 걷기 속도의 **기본값**은 공용.jsx 의 WALK(6 유닛/s ≈ 1.8 m/s)가 정한다.
//     문서 §9 의 가정치는 2.5 m/s 다. 어느 쪽이 맞는지는 걸어 봐야 아는 값이라
//     `걷기속도`(m/s)를 인자로 받아 Leva 에서 돌릴 수 있게 해 두었다.
//     **본편 공용.jsx 는 여전히 한 줄도 고치지 않는다** — 안 넘기면 WALK 그대로다.
//     여기서 정한 값은 §7 0단계에서 공용.jsx 에 반영해야 본편에 전달된다.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  EYE,
  WALK,
  RUN,
  CROUCH,
  GRAVITY,
  JUMP,
  AIR_CONTROL,
  R,
  HANDLED,
} from "../../src/공용.jsx";
import { 미터, 유닛, 기준 } from "./공간도면.js";
import { 코어경계, 기본지형 } from "./지형.js";

// 오를 수 있는 턱(미터). 이보다 높으면 벽이다 —
//   절벽 아래에서 위로 걸어 올라가는 일이 없게 만드는 값이기도 하다.
const 턱 = 0.55;
// 이만큼 넘게 떨어지면 '추락'으로 본다(§6 ② 빠지면 복귀시키는 영역).
//   ※ 4.0 m 는 너무 느슨했다. 길 옆으로 2~3 m 만 미끄러져도 **비탈 아래에 갇힌
//     느낌**이 든다(실제로 그런 신고가 있었다). 사람 키의 한 배 반이면 충분하다.
// 산허리를 채워 **어디로 떨어져도 이어진 땅 위**가 된 뒤로는, 낮은 문턱이
  // 오히려 방해가 된다 — 3 m 짜리 정상적인 턱을 내려섰을 뿐인데 복귀가 걸렸다.
  // 이건 갇혔을 때를 위한 안전망이지 이동 규칙이 아니다.
  const 추락 = 5.0;

export function use지형이동(
  active,
  {
    지형 = 기본지형,
    시작,
    눈높이 = 기준.눈높이,
    걷기속도, // m/s — 안 넘기면 본편 WALK 를 그대로 쓴다
    낙하복귀 = true,
    보고,
  } = {},
) {
  const { camera } = useThree();
  // Leva 로 돌리는 값들은 프레임마다 바뀔 수 있다. 콜백 안에서 옛 값을 붙잡지
  // 않도록 항상 최신치를 상자에 담아 둔다(useEffect 안에 갇힌 낡은 값 문제).
  const 현재 = useRef({ 지형, 눈높이 });
  현재.current = { 지형, 눈높이 };
  const keys = useRef({ f: false, b: false, l: false, r: false, run: false, 앉기: false });
  const vel = useRef(new THREE.Vector3());
  const vy = useRef(0);
  const 접지 = useRef(true);
  const 첫프레임 = useRef(true);
  const 최고점 = useRef(0); // 공중에 뜬 뒤 도달한 가장 높은 y
  const 안전 = useRef(null); // 마지막으로 멀쩡히 서 있던 자리
  const 누적거리 = useRef(0);
  const 경과 = useRef(0);
  const 방문 = useRef([]); // 지나온 구역 순서 — 고리 검증용

  useEffect(() => {
    const set = (code, v) => {
      const k = keys.current;
      if (code === "KeyW" || code === "ArrowUp") k.f = v;
      else if (code === "KeyS" || code === "ArrowDown") k.b = v;
      else if (code === "KeyA" || code === "ArrowLeft") k.l = v;
      else if (code === "KeyD" || code === "ArrowRight") k.r = v;
      else if (code === "ShiftLeft" || code === "ShiftRight") k.run = v;
    };
    const down = (e) => {
      if (HANDLED.has(e.code)) e.preventDefault();
      if (e.code === "Space" && 접지.current) {
        vy.current = JUMP;
        접지.current = false;
      }
      if (e.code === "KeyC" && !e.repeat) keys.current.앉기 = !keys.current.앉기;
      set(e.code, true);
    };
    const up = (e) => set(e.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // 개발용 순간이동(시점 확인) — 여기서만 위치를 강제로 옮긴다
  const 텔레포트 = useRef(null);
  useEffect(() => {
    텔레포트.current = (X, Z, 방위) => {
      const { 지형: 지, 눈높이: 눈 } = 현재.current;
      const g = 지.지면(X, Z);
      camera.position.set(X * 미터, (g.y + 눈) * 미터, Z * 미터);
      vy.current = 0;
      접지.current = true;
      // ★ 이 두 줄이 없으면 **높은 데서 낮은 데로 옮길 때 도로 튕겨 나간다.**
      //   최고점이 옛 높이(예: Z3 +14)에 남아 있어서, 새 바닥(Z1 0)에 닿는 순간
      //   14 m 를 떨어진 것으로 계산되고 → 낙하 복귀가 걸려 원래 자리로 되돌린다.
      //   실제로 `2`(V2·절벽 위) 를 눌렀다가 `1`(V1·나루터) 을 누르면 V2 로 튕겼다.
      최고점.current = camera.position.y;
      안전.current = { X, Z };
      if (방위) {
        const yaw = { "+X": -Math.PI / 2, "-X": Math.PI / 2, "+Z": Math.PI, "-Z": 0 }[방위];
        if (yaw !== undefined) camera.rotation.set(0, yaw, 0, "YXZ");
      }
    };
  }, [camera]);

  // 절벽 높이를 돌리면 발밑이 통째로 올라가거나 내려간다. 그대로 두면
  // "갑자기 공중에 뜬 것"으로 읽혀 낙하 복귀가 튄다 — 조용히 다시 앉힌다.
  useEffect(() => {
    if (첫프레임.current) return; // 아직 시작 자리로 옮기기도 전이다
    const g = 지형.지면(camera.position.x * 유닛, camera.position.z * 유닛);
    camera.position.y = (g.y + 눈높이) * 미터;
    vy.current = 0;
    접지.current = true;
    최고점.current = camera.position.y;
  }, [지형, 눈높이, camera]);

  useFrame((_, dt) => {
    const p = camera.position;

    // 시작 자리로 한 번 옮긴다. 텔레포트는 useEffect 에서 만들어지므로
    //   아직 준비가 안 됐으면 다음 프레임에 다시 시도한다.
    if (첫프레임.current && 텔레포트.current) {
      첫프레임.current = false;
      if (시작) 텔레포트.current(시작[0], 시작[1], 시작[2]);
    }

    // ── 발밑 조사 ─────────────────────────────────────────
    const X = p.x * 유닛;
    const Z = p.z * 유닛;
    const 발밑 = 지형.지면(X, Z);
    const 앉음 = keys.current.앉기;
    const 눈 = (앉음 ? 기준.앉은눈높이 : 눈높이) * 미터;
    const 바닥Y = 발밑.y * 미터 + 눈;

    if (active) {
      const k = keys.current;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const wish = new THREE.Vector3();
      if (k.f) wish.add(fwd);
      if (k.b) wish.sub(fwd);
      if (k.r) wish.add(right);
      if (k.l) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize();
      // 걷기속도(m/s)를 넘기면 그 값을, 안 넘기면 본편 WALK 를 쓴다
      const 기본속도 = 걷기속도 ? 걷기속도 * 미터 : WALK;
      const 속도 = 기본속도 * (앉음 ? CROUCH : k.run ? RUN : 1);
      const 목표 = wish.multiplyScalar(속도);

      if (접지.current) {
        vel.current.x = 목표.x;
        vel.current.z = 목표.z;
      } else {
        vel.current.x += (목표.x - vel.current.x) * AIR_CONTROL;
        vel.current.z += (목표.z - vel.current.z) * AIR_CONTROL;
      }

      // 갈 수 있는 자리인가 — 축마다 따로 본다(벽에 붙어 미끄러지게)
      const 갈수있나 = (nx, nz) => {
        const mx = nx * 유닛;
        const mz = nz * 유닛;
        if (지형.막힘(mx, mz, 발밑.y, R * 유닛 + 0.2)) return false;
        const g = 지형.지면(mx, mz);
        if (접지.current && g.y - 발밑.y > 턱) return false; // 오르지 못할 턱
        return true;
      };

      const 이전 = { x: p.x, z: p.z };
      const nx = THREE.MathUtils.clamp(
        p.x + vel.current.x * dt,
        코어경계.xmin * 미터,
        코어경계.xmax * 미터,
      );
      if (갈수있나(nx, p.z)) p.x = nx;
      else vel.current.x = 0;

      const nz = THREE.MathUtils.clamp(
        p.z + vel.current.z * dt,
        코어경계.zmin * 미터,
        코어경계.zmax * 미터,
      );
      if (갈수있나(p.x, nz)) p.z = nz;
      else vel.current.z = 0;

      누적거리.current += Math.hypot(p.x - 이전.x, p.z - 이전.z) * 유닛;
      경과.current += dt;
    }

    // ── 위아래 ────────────────────────────────────────────
    vy.current += GRAVITY * dt;
    let ny = p.y + vy.current * dt;
    최고점.current = Math.max(최고점.current, p.y);

    if (ny <= 바닥Y) {
      const 낙차 = (최고점.current - 바닥Y) * 유닛; // m
      ny = 바닥Y;
      vy.current = 0;
      접지.current = true;
      최고점.current = ny;

      const 되돌릴까 = 낙하복귀 && (낙차 > 추락 || 발밑.물);
      // 복귀는 '이동'이 아니므로 보행 거리에 더하지 않는다
      if (되돌릴까 && 안전.current) 텔레포트.current(안전.current.X, 안전.current.Z);
    } else {
      접지.current = false;
    }
    if (접지.current) ny = THREE.MathUtils.lerp(p.y, 바닥Y, 1 - Math.pow(0.0001, dt));
    p.y = ny;

    // 멀쩡한 자리(구역·통로 위, 물 아님)를 계속 기억해 둔다
    if (접지.current && (발밑.구역 || 발밑.통로) && !발밑.물)
      안전.current = { X, Z };

    // 구역 방문 순서 — 고리 1바퀴 확인용
    if (발밑.구역) {
      const 마지막 = 방문.current[방문.current.length - 1];
      if (마지막 !== 발밑.구역) 방문.current.push(발밑.구역);
      if (방문.current.length > 12) 방문.current.shift();
    }

    if (보고)
      보고.current = {
        X,
        Z,
        EL: 발밑.y,
        // 지금 카메라가 바닥에서 실제로 몇 m 떠 있나 —
        // 설정값(아래 `눈높이`)과 달리 앉으면 줄고 공중에 뜨면 커진다.
        실눈높이: p.y * 유닛 - 발밑.y,
        자리: 지형.자리이름(X, Z),
        접지: 접지.current,
        앉음,
        달리기: keys.current.run,
        속도: Math.hypot(vel.current.x, vel.current.z) * 유닛,
        거리: 누적거리.current,
        시간: 경과.current,
        방문: 방문.current,
        // 계기판이 볼 것들 — 매 프레임 같은 객체라 새로 만드는 비용이 없다
        지형,
        눈높이,
        걷기속도: 걷기속도 ?? WALK * 유닛,
      };
  });

  return 텔레포트;
}

// 계기판·초기화에서 같이 쓰는 값 — **본편 공용.jsx 가 정한 원래 값**이다.
// Leva 로 돌린 값과 나란히 보여 주려고 남겨 둔다.
export const 이동상수 = {
  걷기: WALK * 유닛, // m/s
  달리기: WALK * RUN * 유닛,
  앉아걷기: WALK * CROUCH * 유닛,
  점프: JUMP * 유닛,
  중력: GRAVITY * 유닛,
  반경: R * 유닛,
  // 본편은 눈높이 EYE = 6.5 유닛 ≈ 1.95 m 로 걷는다. 이 그레이박스는 문서 §9 의
  // 1.6 m 를 쓰므로 시선이 0.35 m 낮다 — V1~V3 시야 판정을 본편에 옮길 때
  // 이 차이를 잊으면 "여기서는 안 보였는데 본편에서는 보인다"가 난다(§7 0단계).
  본편눈높이: EYE * 유닛,
};
