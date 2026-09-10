// 겨냥판정.jsx — 3D 씬 안에서 매 프레임 「지금 뭘 보고 있나」를 갱신한다
//
// Canvas 안에서만 useFrame 을 쓸 수 있어서 상호작용.js(순수 JS)와 파일을 나눴다.

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { 겨냥갱신, use대상 } from "./상호작용.js";
import { 스프링암, 크기 } from "./배치.js";

// 초당 20번. 매 프레임 돌 만큼 무거운 계산은 아니지만, 고개를 돌리는 속도에 비해
// 60번은 낭비다. 0.05초면 사람 눈에는 즉시로 느껴진다.
const 주기 = 0.05;

export default function 겨냥판정({ 켬 = true }) {
  const { camera } = useThree();
  const 누적 = useRef(0);

  useFrame((_, dt) => {
    누적.current += dt;
    if (누적.current < 주기) return;
    누적.current = 0;
    겨냥갱신(camera, 켬);
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
