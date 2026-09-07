// 조사물.jsx — 조사할 수 있는 물건을 감싸는 껍데기 (USR-051)
//
// 쓰는 법
//   <조사물 id="E-03"> <증거상자 …/> </조사물>
//
// 하는 일
//   ① userData.조사ID 를 심어 둔다 → 조사레이가 광선으로 찾아낸다 (S7-015)
//   ② 겨냥되면 발밑에 고리를 띄운다 → 「이건 만질 수 있다」 (S7-002 · S7-016)
//      한 번 조사한 물건은 고리를 흐리게 (S7-016 「조사 완료한 대상은 표시를 약하게」)
//
// ★ 위치를 건드리지 않는다. 그냥 group 하나가 더 생길 뿐이라 배치가 안 흔들린다.

import { useEffect, useRef } from "react";
import { use겨냥, use이력횟수 } from "./조사시스템.js";

export default function 조사물({ id, 고리반지름 = 0.8, children }) {
  const ref = useRef(null);
  const 겨냥 = use겨냥();
  const 횟수 = use이력횟수(id);
  const 선택됨 = 겨냥 === id;

  useEffect(() => {
    if (ref.current) ref.current.userData.조사ID = id;
  }, [id]);

  return (
    <group ref={ref}>
      {children}
      {선택됨 && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[고리반지름 * 0.86, 고리반지름, 32]} />
          <meshBasicMaterial
            color="#FFC271"
            toneMapped={false}
            transparent
            /* 이미 본 물건은 흐리게 — 아직 안 본 것에 눈이 가야 한다 */
            opacity={횟수 > 0 ? 0.35 : 0.9}
            depthTest={false}
          />
        </mesh>
      )}
    </group>
  );
}
