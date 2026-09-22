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
//   ※ 걷기 속도의 **기본값**은 공용.jsx 의 WALK(2.9 유닛/s ≈ 0.87 m/s)가 정한다.
//     걷기 모션이 제자리 루프라 보폭 속도(0.52 m/s)에 맞춘 값이다 — 더 올리면 조깅 모션이 나온다.
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
    // 편집 모드에서는 방향키가 **고른 요소를 미는 데** 쓰인다.
    // 그때 사람이 같이 걸어가면 화면이 흔들려 조준이 안 된다.
    화살표이동 = true,
    // 3인칭에서는 카메라 위치와 실제 플레이어 충돌 좌표를 분리한다.
    // 플레이어는 지형 위를 걷고 카메라만 그 주위를 돈다.
    삼인칭 = false,
    플레이어참조 = null,
    삼인칭거리 = 4.2,
    // ★ 부감(공중에서 내려다보기) 동안 걷기를 통째로 멈춘다.
    //   `active` 만 꺼서는 안 된다 — 중력·접지는 `active` 밖에서 돌기 때문에
    //   카메라가 매 프레임 땅으로 도로 끌려 내려간다(실제로 그랬다).
    멈춤 = false,
    // 코어 밖으로 나갈 수 있는 자리를 알려 주는 함수 `(x, z) => boolean`.
    //   기본은 없음 = 예전대로 코어 사각형에 갇힌다.
    //   경계를 통째로 넓히면 동쪽 가장자리 어디서나 6.7 m 아래로 떨어진다 —
    //   **연결로 위에서만** 열어야 한다.
    밖으로 = null,
    // 소품 충돌 `(px, pz, y, 반경) => 이름|null` (미터). 지형 `막힘` 에 더해 본다(소품충돌.js).
    추가막힘 = null,
  } = {},
) {
  const { camera } = useThree();
  // Leva 로 돌리는 값들은 프레임마다 바뀔 수 있다. 콜백 안에서 옛 값을 붙잡지
  // 않도록 항상 최신치를 상자에 담아 둔다(useEffect 안에 갇힌 낡은 값 문제).
  const 현재 = useRef({ 지형, 눈높이 });
  현재.current = { 지형, 눈높이 };
  const 삼인칭참조 = useRef(삼인칭);
  삼인칭참조.current = 삼인칭;
  const 논리위치 = useRef(null);
  const 이전삼인칭 = useRef(false);
  const 바라봄 = useRef(Math.PI);
  const 카메라전방 = useRef(new THREE.Vector3());
  const keys = useRef({ f: false, b: false, l: false, r: false, run: false, 앉기: false });
  const vel = useRef(new THREE.Vector3());
  const vy = useRef(0);
  const 접지 = useRef(true);
  // `접지 === false`만으로는 점프를 판단하면 안 된다. 경사를 내려갈 때도
  // 새 바닥이 한 프레임 낮아지면 접지가 잠깐 풀릴 수 있다. Space로 실제
  // 점프를 시작했는지를 따로 기억해 보행 중 점프 모션이 트리거되지 않게 한다.
  const 점프중 = useRef(false);
  const 첫프레임 = useRef(true);
  const 최고점 = useRef(0); // 공중에 뜬 뒤 도달한 가장 높은 y
  const 안전 = useRef(null); // 마지막으로 멀쩡히 서 있던 자리
  const 멈춤이었나 = useRef(false); // 부감에서 막 내려왔는가
  const 누적거리 = useRef(0);
  const 경과 = useRef(0);
  const 방문 = useRef([]); // 지나온 구역 순서 — 고리 검증용

  const 화살표참조 = useRef(true);
  화살표참조.current = 화살표이동;

  useEffect(() => {
    const set = (code, v) => {
      const k = keys.current;
      const 화 = 화살표참조.current;
      if (code === "KeyW" || (화 && code === "ArrowUp")) k.f = v;
      else if (code === "KeyS" || (화 && code === "ArrowDown")) k.b = v;
      else if (code === "KeyA" || (화 && code === "ArrowLeft")) k.l = v;
      else if (code === "KeyD" || (화 && code === "ArrowRight")) k.r = v;
      else if (code === "ShiftLeft" || code === "ShiftRight") k.run = v;
    };
    const down = (e) => {
      // ★ Ctrl/⌘ 를 누른 채면 **이동으로 안 친다.**
      //   Ctrl+S(저장)가 S(뒤로 걷기)와 맞물려, 저장할 때마다 뒷걸음질쳤다.
      if (e.ctrlKey || e.metaKey) return;
      if (HANDLED.has(e.code)) e.preventDefault();
      if (e.code === "Space" && 접지.current) {
        vy.current = JUMP;
        접지.current = false;
        점프중.current = true;
      }
      if (e.code === "KeyC" && !e.repeat) keys.current.앉기 = !keys.current.앉기;
      set(e.code, true);
    };
    const up = (e) => set(e.code, false);
    const 비우기 = () => {
      keys.current = { f: false, b: false, l: false, r: false, run: false, 앉기: false };
      vel.current.x = 0;
      vel.current.z = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", 비우기);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", 비우기);
    };
  }, []);

  // 개발용 순간이동(시점 확인) — 여기서만 위치를 강제로 옮긴다
  const 텔레포트 = useRef(null);
  useEffect(() => {
    텔레포트.current = (X, Z, 방위) => {
      const { 지형: 지, 눈높이: 눈 } = 현재.current;
      const g = 지.지면(X, Z);
      const 목적지 = 삼인칭참조.current
        ? (논리위치.current ??= camera.position.clone())
        : camera.position;
      목적지.set(X * 미터, (g.y + 눈) * 미터, Z * 미터);
      vy.current = 0;
      접지.current = true;
      점프중.current = false;
      // ★ 이 두 줄이 없으면 **높은 데서 낮은 데로 옮길 때 도로 튕겨 나간다.**
      //   최고점이 옛 높이(예: Z3 +14)에 남아 있어서, 새 바닥(Z1 0)에 닿는 순간
      //   14 m 를 떨어진 것으로 계산되고 → 낙하 복귀가 걸려 원래 자리로 되돌린다.
      //   실제로 `2`(V2·절벽 위) 를 눌렀다가 `1`(V1·나루터) 을 누르면 V2 로 튕겼다.
      최고점.current = 목적지.y;
      안전.current = { X, Z };
      if (방위) {
        const yaw = { "+X": -Math.PI / 2, "-X": Math.PI / 2, "+Z": Math.PI, "-Z": 0 }[방위];
        if (yaw !== undefined) {
          camera.rotation.set(0, yaw, 0, "YXZ");
          바라봄.current = yaw;
        }
      }
    };
  }, [camera]);

  // 절벽 높이를 돌리면 발밑이 통째로 올라가거나 내려간다. 그대로 두면
  // "갑자기 공중에 뜬 것"으로 읽혀 낙하 복귀가 튄다 — 조용히 다시 앉힌다.
  useEffect(() => {
    if (첫프레임.current) return; // 아직 시작 자리로 옮기기도 전이다
    const p = 삼인칭참조.current
      ? (논리위치.current ??= camera.position.clone())
      : camera.position;
    const g = 지형.지면(p.x * 유닛, p.z * 유닛);
    p.y = (g.y + 눈높이) * 미터;
    vy.current = 0;
    접지.current = true;
    점프중.current = false;
    최고점.current = p.y;
  }, [지형, 눈높이, camera]);

  useFrame((_, dt) => {
    if (!논리위치.current) 논리위치.current = camera.position.clone();
    if (삼인칭 && !이전삼인칭.current) 논리위치.current.copy(camera.position);
    if (!삼인칭 && 이전삼인칭.current) camera.position.copy(논리위치.current);
    이전삼인칭.current = 삼인칭;
    const p = 삼인칭 ? 논리위치.current : camera.position;
    if (멈춤) {
      // 카메라는 남이 몬다. 계기판이 죽지 않게 자리 보고만 해 준다.
      if (보고) {
        const X0 = p.x * 유닛;
        const Z0 = p.z * 유닛;
        const 밑 = 지형.지면(X0, Z0);
        보고.current = {
          ...보고.current,
          X: X0,
          Z: Z0,
          EL: 밑.y,
          실눈높이: p.y * 유닛 - 밑.y,
          자리: 지형.자리이름(X0, Z0),
          속도: 0,
          지형,
        };
      }
      접지.current = false;
      멈춤이었나.current = true;
      return;
    }
    // 멈춤에서 깨어난 첫 프레임 — **그 자리에 그대로 선다.**
    //   안 그러면 부감 높이(22 m)가 낙차로 읽혀 `낙하복귀` 가 사람을 마지막
    //   안전 지점으로 보내 버린다. 부감으로 골라 둔 자리를 잃는 것이다
    //   (실측: 부감에서 (27.5, 51) 까지 갔는데 내려오니 시작점 (11, 38.5) 였다).
    if (멈춤이었나.current) {
      멈춤이었나.current = false;
      const 밑 = 지형.지면(p.x * 유닛, p.z * 유닛);
      p.y = 밑.y * 미터 + 눈높이 * 미터;
      vy.current = 0;
      접지.current = true;
      점프중.current = false;
      최고점.current = p.y;
      안전.current = { X: p.x * 유닛, Z: p.z * 유닛 };
    }

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
      if (wish.lengthSq() > 0.00001) 바라봄.current = Math.atan2(wish.x, wish.z);
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
        if (추가막힘 && 추가막힘(mx, mz, 발밑.y, R * 유닛)) return false;
        const g = 지형.지면(mx, mz);
        if (접지.current && g.y - 발밑.y > 턱) return false; // 오르지 못할 턱
        return true;
      };

      const 이전 = { x: p.x, z: p.z };
      // 코어 밖으로 나갈 수 있는가 — `밖으로` 가 참인 자리는 안 죈다
      const 죄기 = (v, a, b, mx, mz) =>
        밖으로 && 밖으로(mx * 유닛, mz * 유닛)
          ? v
          : THREE.MathUtils.clamp(v, a * 미터, b * 미터);

      const 갈x = p.x + vel.current.x * dt;
      const nx = 죄기(갈x, 코어경계.xmin, 코어경계.xmax, 갈x, p.z);
      if (갈수있나(nx, p.z)) p.x = nx;
      else vel.current.x = 0;

      const 갈z = p.z + vel.current.z * dt;
      const nz = 죄기(갈z, 코어경계.zmin, 코어경계.zmax, p.x, 갈z);
      if (갈수있나(p.x, nz)) p.z = nz;
      else vel.current.z = 0;

      누적거리.current += Math.hypot(p.x - 이전.x, p.z - 이전.z) * 유닛;
      경과.current += dt;
    }

    // 수평 이동이 끝난 **새 좌표**에서 바닥을 다시 잰다. 예전에는 이동 전
    // 좌표의 높이로 캐릭터를 놓아서 경사·길 경계에서 한 프레임씩 땅에 묻거나
    // 공중에 뜨는 현상이 누적됐다.
    const 최종X = p.x * 유닛;
    const 최종Z = p.z * 유닛;
    // 발 반경 안 다섯 점 중 가장 높은 땅을 밟는다. 중심 한 점만 보면 경사·길 경계에서 앞발이
    // 놓인 땅이 더 높아 신발이 땅에 파묻혔다(실제로 그랬다). 볼록한 모서리에선 조금 뜨지만 낫다.
    const 현재발밑 = 지형.지면(최종X, 최종Z);
    {
      const d = R * 유닛;
      for (const [ox, oz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        const g = 지형.지면(최종X + ox, 최종Z + oz);
        if (g.y > 현재발밑.y && !g.낙하 && !g.물) 현재발밑.y = g.y;
      }
    }
    const 바닥Y = 현재발밑.y * 미터 + 눈;

    // ── 위아래 ────────────────────────────────────────────
    // 작은 하향 경사는 공중 상태가 아니라 '지면을 따라가는 보행'이다.
    // 발밑이 턱 허용치 안에서 낮아진 경우는 바로 붙여 주고, 그보다
    // 큰 낙차만 실제 추락으로 처리한다.
    const 현재발Y = p.y - 눈;
    const 바닥까지거리 = (현재발Y - 현재발밑.y * 미터) * 유닛;
    const 지면따라가기 =
      접지.current && !점프중.current && 바닥까지거리 <= 턱 + 0.05;
    let ny;

    if (지면따라가기) {
      ny = 바닥Y;
      vy.current = 0;
      접지.current = true;
      최고점.current = ny;
    } else {
      vy.current += GRAVITY * dt;
      ny = p.y + vy.current * dt;
      최고점.current = Math.max(최고점.current, p.y);

      if (ny <= 바닥Y) {
        const 낙차 = (최고점.current - 바닥Y) * 유닛; // m
        ny = 바닥Y;
        vy.current = 0;
        접지.current = true;
        점프중.current = false;
        최고점.current = ny;

        const 되돌릴까 = 낙하복귀 && (낙차 > 추락 || 현재발밑.물);
        // 복귀는 '이동'이 아니므로 보행 거리에 더하지 않는다
        if (되돌릴까 && 안전.current)
          텔레포트.current(안전.current.X, 안전.current.Z);
      } else {
        접지.current = false;
      }
    }
    // 접지 중에는 정확히 지면에 놓는다. 보간하면 경사를 오를 때 몸이 땅속에,
    // 내려갈 때 공중에 남는다. 공중일 때만 중력 적분을 그대로 쓴다.
    if (접지.current) ny = 바닥Y;
    p.y = ny;

    // 멀쩡한 자리(구역·통로 위, 물 아님)를 계속 기억해 둔다
    if (접지.current && (현재발밑.구역 || 현재발밑.통로) && !현재발밑.물)
      안전.current = { X: 최종X, Z: 최종Z };

    // 구역 방문 순서 — 고리 1바퀴 확인용
    if (현재발밑.구역) {
      const 마지막 = 방문.current[방문.current.length - 1];
      if (마지막 !== 현재발밑.구역) 방문.current.push(현재발밑.구역);
      if (방문.current.length > 12) 방문.current.shift();
    }

    if (보고)
      보고.current = {
        X: 최종X,
        Z: 최종Z,
        EL: 현재발밑.y,
        // 지금 카메라가 바닥에서 실제로 몇 m 떠 있나 —
        // 설정값(아래 `눈높이`)과 달리 앉으면 줄고 공중에 뜨면 커진다.
        실눈높이: p.y * 유닛 - 현재발밑.y,
        자리: 지형.자리이름(최종X, 최종Z),
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

    // 캐릭터는 논리 플레이어의 실제 지면 좌표를 받고, 3인칭 카메라는
    // 현재 시선의 반대편으로 물러난다. 마우스로 yaw를 180° 돌리면 캐릭터
    // 정면까지 볼 수 있으며 플레이어 좌표 자체는 움직이지 않는다.
    if (플레이어참조) {
      const 상태 = 플레이어참조.current;
      상태.position.copy(p);
      상태.groundY = 현재발밑.y * 미터;
      상태.footY = p.y - 눈;
      상태.facing = 바라봄.current;
      // 아바타가 걷기 모션 재생 속도를 실제 이동 속도에 맞추는 데 쓴다.
      상태.speed = active ? Math.hypot(vel.current.x, vel.current.z) : 0;
      상태.moving = 상태.speed > 0.001;
      상태.running = active && keys.current.run;
      상태.crouching = keys.current.앉기;
      상태.grounded = 접지.current;
      상태.jumping = 점프중.current;
      상태.verticalVelocity = vy.current;
    }
    if (삼인칭) {
      camera.getWorldDirection(카메라전방.current);
      camera.position.copy(p).addScaledVector(카메라전방.current, -삼인칭거리 * 미터);
    }
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
