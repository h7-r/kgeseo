// 강조.jsx — 겨냥한 물건을 글자 없이 '보여서' 알려 준다
//
// [왜 글자를 없애나]
//   화면 구석의 작은 글씨는 시선이 물건에 있는데 읽으라고 시선을 끌어내린다.
//   요즘 1인칭 게임은 대부분 **대상 자체를 밝히는 쪽**을 쓴다 — 읽을 필요가 없고,
//   무엇이 대상인지가 그 자리에서 바로 보인다.
//
// [두 가지를 동시에 준다]
//   ① 아주 살짝 커진다(둥 — 4% 남짓). 크기 변화는 글자보다 훨씬 빨리 인지된다.
//   ② 재질을 스스로 빛나게(emissive) 만든다. 화면에 이미 걸린 Bloom 후처리가
//      그 빛을 번지게 해서 외곽이 물든 것처럼 보인다. 외곽선 메시를 따로 만들지
//      않아도 되니 드로우콜이 하나도 안 는다.
//
// [기준점을 받는 이유]
//   이 씬의 물건들은 자기 안에서 절대 좌표(pos=[x,z])로 그려진다.
//   그래서 그냥 scale 을 주면 원점(0,0,0) 기준으로 커져 물건이 방 밖으로 날아간다.
//   기준점 p 를 중심으로 키우려면  월드 = k·자식 + p·(1−k)  가 되어야 한다.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { 겨냥 } from "./상호작용.js";

const _색 = new THREE.Color();

export function 강조({
  id,
  기준, // () => [x, y, z]
  색 = "#fffee7",
  세기 = 0.45,
  확대 = 0.08,
  children,
}) {
  const g = useRef(null);
  const 양 = useRef(0);
  const 이전 = useRef(0);
  const 원래 = useRef(new WeakMap()); // 재질 -> 원래 발광색

  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;

    // id 는 하나여도 되고 여럿이어도 된다.
    //   한 물건에 겨냥 지점이 둘 이상 붙는 경우가 있다 — 배전반 퍼즐 선은
    //   아래 끝(잡기)과 위 끝(꽂기)이 **같은 한 가닥**이라, 어느 쪽을 보든
    //   그 가닥이 밝아져야 "이게 한 줄이구나"가 읽힌다.
    const 겨냥중 = 겨냥.값();
    const 목표 = (Array.isArray(id) ? id.includes(겨냥중) : 겨냥중 === id) ? 1 : 0;
    // 지수 감쇠 — 프레임 수에 상관없이 같은 속도로 붙는다
    양.current += (목표 - 양.current) * (1 - Math.exp(-dt * 14));
    const s = 양.current;

    // ① 기준점 중심으로 살짝 확대
    const k = 1 + 확대 * s;
    const p = 기준();
    if (p) {
      o.scale.setScalar(k);
      o.position.set(p[0] * (1 - k), p[1] * (1 - k), p[2] * (1 - k));
    }

    // ② 빛나게 — 꺼져 있고 이미 껐으면 훑지 않는다(대부분의 프레임이 여기서 끝난다)
    if (s < 0.002 && 이전.current < 0.002) return;
    이전.current = s;
    _색.set(색).multiplyScalar(s * 세기);
    o.traverse((n) => {
      const m = n.material;
      if (!m) return;
      if (Array.isArray(m)) for (const one of m) 입히기(one);
      else 입히기(m);
    });

    // ★ 원래 발광을 덮어쓰지 않고 '더한다'.
    //   스탠드 전구처럼 이미 스스로 빛나는 부품이 있다. 그냥 덮어쓰면
    //   강조가 꺼질 때 발광이 검정이 되어 **전구가 영영 안 켜진다.**
    function 입히기(m) {
      if (!m.emissive) return;
      let 원 = 원래.current.get(m);
      if (!원) {
        원 = m.emissive.clone();
        원래.current.set(m, 원);
      }
      m.emissive.copy(원).add(_색);
    }
  });

  return <group ref={g}>{children}</group>;
}
