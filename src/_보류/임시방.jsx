// 임시방.jsx — 그레이박스 공간 (USR-104 임시)
//
// [왜 그레이박스인가]
//   케이스(완사천 현장) 미술이 나오기 전에도 **조작·상호작용·인벤토리·퍼즐은
//   만들어 둘 수 있다.** 오히려 미술이 없을 때 만들어야 기능에만 집중된다.
//   나중에 이 파일만 실제 공간으로 갈아 끼우면 된다 — 위에 얹힌 기능은 안 건드린다.
//
// [충돌]
//   벽은 네 방향 clamp 로, 방 안의 덩어리는 사각형 목록으로 막는다.
//   물건이 늘어나면 목록에 줄만 추가하면 된다.

import * as THREE from "three";
import { useMemo } from "react";

export const 방크기 = { 가로: 26, 깊이: 20, 높이: 9 };

// 방 안에 놓인 덩어리들. {x, z, 가로, 깊이, 높이}
export const 덩어리들 = [
  { 이름: "작업대", x: -5, z: -4, 가로: 5, 깊이: 2.2, 높이: 2.5 },
  { 이름: "선반", x: 7, z: -6, 가로: 1.2, 깊이: 6, 높이: 6 },
  { 이름: "상자더미", x: 4, z: 5, 가로: 3, 깊이: 3, 높이: 3.2 },
  { 이름: "기둥", x: -8, z: 6, 가로: 1.4, 깊이: 1.4, 높이: 9 },
];

// 충돌 판정 — 씬 밖(조작 훅)에서 쓴다.
//   반지름 R 만큼 부풀려서 검사해야 벽에 얼굴이 파묻히지 않는다.
export function 막힘만들기(반지름 = 0.6) {
  const 절반가로 = 방크기.가로 / 2 - 반지름;
  const 절반깊이 = 방크기.깊이 / 2 - 반지름;
  return (x, z) => {
    if (x < -절반가로 || x > 절반가로 || z < -절반깊이 || z > 절반깊이) return true;
    for (const d of 덩어리들) {
      if (
        x > d.x - d.가로 / 2 - 반지름 &&
        x < d.x + d.가로 / 2 + 반지름 &&
        z > d.z - d.깊이 / 2 - 반지름 &&
        z < d.z + d.깊이 / 2 + 반지름
      )
        return true;
    }
    return false;
  };
}

export default function 임시방() {
  // 바닥 격자 — 그레이박스에서 '얼마나 걸었는지'를 눈으로 재는 자다.
  //   1칸 = 2유닛 ≈ 0.6m. 이게 없으면 속도가 빠른지 느린지 감이 안 온다.
  const 격자 = useMemo(
    () => new THREE.GridHelper(방크기.가로, 방크기.가로 / 2, "#3a4350", "#252c36"),
    [],
  );

  const 벽 = "#5a626e";
  const 바닥 = "#42464c";

  return (
    <group>
      {/* 바닥 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[방크기.가로, 방크기.깊이]} />
        <meshStandardMaterial color={바닥} roughness={0.95} />
      </mesh>
      <primitive object={격자} position={[0, 0.02, 0]} />

      {/* 천장 — 법선이 어느 쪽을 보든 그려지게 양면으로 둔다.
             평면 한 장은 방향을 헷갈리기 쉽고, 뒤집히면 통째로 사라져
             '천장이 까맣다'로 보인다. 그레이박스에서는 양면이 안전하다. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 방크기.높이, 0]}>
        <planeGeometry args={[방크기.가로, 방크기.깊이]} />
        <meshStandardMaterial
          color="#5e666f"
          roughness={1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 벽 네 장 — 안쪽을 보게 세운다 */}
      {[
        [0, -방크기.깊이 / 2, 0, 방크기.가로],
        [0, 방크기.깊이 / 2, Math.PI, 방크기.가로],
        [-방크기.가로 / 2, 0, Math.PI / 2, 방크기.깊이],
        [방크기.가로 / 2, 0, -Math.PI / 2, 방크기.깊이],
      ].map(([x, z, ry, w], i) => (
        <mesh
          key={i}
          position={[x, 방크기.높이 / 2, z]}
          rotation={[0, ry, 0]}
          receiveShadow
        >
          <planeGeometry args={[w, 방크기.높이]} />
          <meshStandardMaterial color={벽} roughness={0.95} />
        </mesh>
      ))}

      {/* 덩어리 — 충돌이 실제로 먹는지 눈으로 확인하는 용도 */}
      {덩어리들.map((d) => (
        <mesh
          key={d.이름}
          position={[d.x, d.높이 / 2, d.z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[d.가로, d.높이, d.깊이]} />
          <meshStandardMaterial color="#6d7480" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
