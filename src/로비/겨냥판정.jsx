// 겨냥판정.jsx — 3D 씬 안에서 매 프레임 「지금 뭘 보고 있나」를 갱신한다
//
// Canvas 안에서만 useFrame 을 쓸 수 있어서 상호작용.js(순수 JS)와 파일을 나눴다.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { 겨냥갱신, use대상 } from "./상호작용.js";
import { 스프링암, 크기 } from "./배치.js";
import { 그림자흔들기 } from "../공용.jsx";

// 초당 20번. 매 프레임 돌 만큼 무거운 계산은 아니지만, 고개를 돌리는 속도에 비해
// 60번은 낭비다. 0.05초면 사람 눈에는 즉시로 느껴진다.
const 주기 = 0.05;

// ── 조준점 자리 ─────────────────────────────────────────────
//   [왜 화면 한가운데가 아닌가]  3인칭에서는 카메라가 **사람 뒤 위쪽**에 있다.
//   화면 정중앙은 사람의 머리 위 허공을 가리키므로, 거기에 조준점을 두면
//   물건을 보려고 카메라를 크게 숙여야 한다(사용자 지적).
//   판정은 이미 **사람 자리에서** 거리를 재므로(겨냥갱신 원점), 조준점도
//   「사람 눈에서 앞으로 뻗은 선이 화면에 닿는 자리」에 두어야 둘이 맞는다.
//   ※ DOM 을 직접 옮긴다 — 매 프레임 React state 를 건드리면 그게 더 비싸다.
export const 조준점칸 = { el: null };

// 캐릭터 머리 높이(발 기준, 유닛). 3인칭 카메라는 **논리 눈높이와 같은 높이**에 있어서
//   `플레이어참조.position` 을 그대로 투영하면 언제나 화면 한가운데가 나온다(실측).
//   치비 캐릭터는 그보다 훨씬 작으므로 발에서 재야 맞는다.
const 머리높이 = 4.0;

// 조준점은 **캐릭터의 두 눈 사이**에 둔다(3인칭). 화면 정중앙은 카메라 기준이라
//   캐릭터 머리 위 허공을 가리켰다 — 물건을 보려고 카메라를 크게 숙여야 했다.
//   판정 원점도 같은 점이라 「보이는 곳 = 잡히는 곳」이다.
//   ※ 1인칭은 카메라가 곧 눈이므로 화면 한가운데가 맞다.

export default function 겨냥판정({ 켬 = true, 플레이어참조 = null, 삼인칭 = false }) {
  const { camera } = useThree();
  const 누적 = useRef(0);

  const _앞 = useMemo(() => new THREE.Vector3(), []);
  const _점 = useMemo(() => new THREE.Vector3(), []);
  const _원점 = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    // 조준점은 **매 프레임** 옮긴다(0.05초마다 옮기면 눈에 띄게 끊긴다).
    const el = 조준점칸.el;
    const 사람 = 플레이어참조?.current?.position;
    if (el) {
      if (!사람) {
        el.style.transform = "translate(-50%, -50%)";
      } else {
        if (삼인칭) {
          // 캐릭터 머리 자리를 화면에 옮긴다. 발(footY)에서 재야 앉든 서든 머리에 붙는다.
          const 발 = 플레이어참조?.current?.footY ?? 0;
          _점.set(사람.x, 발 + 머리높이, 사람.z).project(camera);
        } else {
          // 1인칭 — 눈에서 앞으로 3 유닛. 결과는 화면 한가운데다.
          camera.getWorldDirection(_앞);
          _점.copy(사람).addScaledVector(_앞, 3).project(camera);
        }
        const x = (_점.x * 0.5 + 0.5) * 100;
        const y = (-_점.y * 0.5 + 0.5) * 100;
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
        el.style.transform = "translate(-50%, -50%)";
      }
    }

    누적.current += dt;
    if (누적.current < 주기) return;
    누적.current = 0;
    // 3인칭이면 카메라가 사람 뒤 멀리 있어서 거리 판정이 전부 걸러진다.
    //   사람 자리를 원점으로 넘긴다(방향은 카메라 그대로 — 조준점과 맞아야 한다).
    const p = 플레이어참조?.current?.position;
    // 판정 원점도 **같은 가슴 높이**로 내린다. 조준점만 내리면 보이는 곳과
    //   잡히는 곳이 어긋난다.
    겨냥갱신(camera, 켬, p ?? null);
  });

  return null;
}

/**
 * 물건 하나를 겨냥 대상으로 등록한다. 화면에는 아무것도 그리지 않는다.
 *
 * ★ 이 방식을 고른 이유
 *   Mug·Laptop·Chair 같은 기존 컴포넌트를 하나도 안 건드려도 된다.
 *   씬 JSX 에 이 태그 한 줄만 나란히 놓으면 그 물건이 만질 수 있는 것이 된다.
 *   나중에 백엔드가 「이 물건은 만질 수 있음」을 내려주면 이 태그의 조건만 바꾸면 된다.
 */
export function 상호대상({ id, 라벨, 위치, 실행, 반경, 거리, 끔 }) {
  use대상(id, { 라벨, 위치, 실행, 반경, 거리, 끔 });
  return null;
}

/**
 * 손에 든 물건 — 카메라 앞에 따라다닌다.
 *
 * [실제 게임이 하는 두 가지를 그대로 넣었다]
 *   ① 스프링 암 — 들고 싶은 자리가 벽·가구에 막혔으면 **막히지 않는 데까지만** 나간다.
 *      3인칭 카메라가 벽에 끼지 않게 당겨지는 것과 같은 원리다.
 *      이게 없으면 벽을 마주 보고 설 때 컵이 벽 속으로 들어간다.
 *   ② 지연(스웨이) — 고개를 돌리면 물건이 아주 살짝 늦게 따라온다.
 *      카메라에 딱 붙어 굳어 있으면 '화면에 붙은 스티커'처럼 보인다.
 *      FPS 게임의 무기 흔들림이 이걸 하는 이유다.
 *
 * [왜 카메라의 자식으로 안 붙이나]
 *   PointerLockControls 가 카메라를 직접 돌린다. 거기에 자식을 붙이면 씬을 오갈 때
 *   붙였다 떼는 관리가 필요하고, 실수로 안 떼면 기차 안까지 컵이 따라온다.
 */
const _목표 = new THREE.Vector3();
const _시작 = new THREE.Vector3();

export function 손에든것({
  children,
  물건id,
  앞 = 2.1,
  아래 = 0.95,
  옆 = 0.85,
}) {
  const g = useRef(null);
  const 첫프레임 = useRef(true);
  const { camera } = useThree();

  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;
    그림자흔들기(0.2); // 손에 든 물건은 계속 움직인다 — 그림자도 따라와야 한다

    // ① 들고 싶은 자리 = 카메라 기준 오른쪽·아래·앞
    _목표.set(옆, -아래, -앞).applyQuaternion(camera.quaternion).add(camera.position);

    // ② 막혔으면 카메라 쪽으로 당긴다. 물건 크기만큼 여유를 둔다.
    const 반경 = (크기.get(물건id)?.halfX ?? 0.3) + 0.12;
    _시작.copy(camera.position);
    const [x, y, z] = 스프링암(
      [_시작.x, _시작.y, _시작.z],
      [_목표.x, _목표.y, _목표.z],
      반경,
      물건id, // 들고 있는 자기 자신의 옛 자리는 검사에서 뺀다
    );
    _목표.set(x, y, z);

    // ③ 살짝 늦게 따라간다. 처음 든 순간만 즉시 맞춘다(안 그러면 방 저편에서 날아온다).
    if (첫프레임.current) {
      첫프레임.current = false;
      o.position.copy(_목표);
      o.quaternion.copy(camera.quaternion);
      return;
    }
    o.position.lerp(_목표, 1 - Math.exp(-dt * 20));
    o.quaternion.slerp(camera.quaternion, 1 - Math.exp(-dt * 15));
  });

  return <group ref={g}>{children}</group>;
}
