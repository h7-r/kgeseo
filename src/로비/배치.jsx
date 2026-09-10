// 배치.jsx — 크기를 재서 등록하는 껍데기 + 놓을 자리 미리보기
//
// 크기를 코드에 적어 넣지 않고 **화면에 그려진 실물을 three 에게 물어본다.**
// App.jsx 의 <충돌체> 가 쓰는 방식과 같다. Leva 로 물건을 옮기거나 키워도
// 발자국이 알아서 따라오고, 값이 어긋날 일이 없다.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  표면등록,
  표면해제,
  점유등록,
  점유해제,
  크기등록,
  놓을자리찾기,
  최근자리설정,
  최근자리값,
  놓기상태갱신,
} from "./배치.js";

/**
 * 자식의 실제 크기를 재서 등록한다. 화면에는 아무 영향이 없다.
 *
 * @param 면    이 물건의 윗면을 '놓을 수 있는 면'으로 등록한다 (책상·캐비닛)
 * @param 자리  이 물건이 차지한 공간을 등록한다 (겹침 검사 대상)
 * @param 재기  이 물건의 발자국 크기를 등록한다 (들 수 있는 물건)
 * @param 다시재기 이 값이 바뀌면 다시 잰다 (Leva 값들을 넣어 준다)
 */
export function 잰다({
  id,
  면 = false,
  자리 = false,
  재기 = false,
  다시재기,
  children,
}) {
  const ref = useRef(null);

  useEffect(() => {
    let 타이머 = null;
    let 남은시도 = 30; // GLB 는 내려받은 뒤에야 자식으로 붙는다 → 될 때까지 다시 잰다

    const 재다 = () => {
      const g = ref.current;
      if (!g) return false;
      g.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(g);
      if (b.isEmpty() || !isFinite(b.min.x)) return false;
      const 폭 = b.max.x - b.min.x;
      const 깊이 = b.max.z - b.min.z;
      if (폭 < 0.02 || 깊이 < 0.02) return false; // 아직 모델이 안 붙었다

      if (면)
        표면등록(id, {
          minX: b.min.x,
          maxX: b.max.x,
          minZ: b.min.z,
          maxZ: b.max.z,
          top: b.max.y,
        });
      if (자리)
        점유등록(id, {
          minX: b.min.x,
          maxX: b.max.x,
          minZ: b.min.z,
          maxZ: b.max.z,
          minY: b.min.y,
          maxY: b.max.y,
        });
      if (재기) {
        // ★ 발자국은 정사각으로 잡는다.
        //   놓을 때 물건을 사람 쪽으로 돌려 놓기 때문에, 가로세로를 따로 재면
        //   돌린 순간 발자국이 달라져 '괜찮다고 해놓고 겹치는' 일이 생긴다.
        //   긴 쪽으로 맞춘 정사각이면 어느 각도로 돌려도 안전하다.
        const 반 = Math.max(폭, 깊이) / 2;
        크기등록(id, { halfX: 반, halfZ: 반, height: b.max.y - b.min.y });
      }
      return true;
    };

    const 시도 = () => {
      if (재다() || --남은시도 <= 0) return;
      타이머 = setTimeout(시도, 500);
    };
    타이머 = setTimeout(시도, 100);

    return () => {
      clearTimeout(타이머);
      if (면) 표면해제(id);
      if (자리) 점유해제(id);
    };
  }, [id, 면, 자리, 재기, 다시재기]);

  return <group ref={ref}>{children}</group>;
}

/**
 * 놓을 자리를 매 프레임 계산해 저장한다. 화면에는 아무것도 안 그린다.
 *
 * ★ 계산을 보여주기와 떼어 놓은 이유
 *   전에는 미리보기 표시가 계산까지 겸했다. 그러면 표시를 끈 순간 계산이 통째로
 *   멈춰 **E 로 놓는 것 자체가 안 된다.** 판단과 표시는 분리해야 한다.
 */
export function 놓을자리계산({ 물건id }) {
  const { camera } = useThree();
  useFrame(() => {
    if (!물건id) {
      최근자리설정(null);
      놓기상태갱신(null);
      return;
    }
    const r = 놓을자리찾기(camera, 물건id);
    최근자리설정(r);
    놓기상태갱신(r);
  });
  return null;
}

// ── 놓기 유령(ghost) ──────────────────────────────────────
// [왜 사각형 발자국이 아니라 '물건 자체'를 비춰 보여주나]
//   조사해 보니 놓기 미리보기의 지배적인 관례는 **반투명한 물건 자체를 초록/빨강으로
//   물들여 보여주는 것**이다(발하임·폴아웃4 정착지·그린헬·하우스플리퍼…).
//   사각형·원 같은 추상 도형은 **격자에 스냅되는 건설 게임**(RTS·시티빌더·팩토리오)
//   에서 쓴다. 거기서는 격자 칸이 곧 사각형이라 도형이 규칙을 그대로 설명하기 때문이다.
//   우리처럼 격자 없이 아무 데나 놓는 1인칭에서는 격자 도형이 오히려 거짓말이 된다
//   ('이 칸에 맞춰진다'는 인상을 주는데 실제로는 자유 배치다).
//   원은 이 맥락에서 거의 안 쓰인다 — 원은 보통 **블롭 그림자**나 **범위 표시**의 기호다.
//
// 발자국은 없애지 않고 아주 옅게 남긴다. 물건이 면에 '닿는 지점'을 알려 줘서
// 깊이감을 잡아 주기 때문이다(블롭 그림자가 하는 일과 같다).

const _유령색 = new THREE.Color();

export function 놓기유령({ 가능색, 불가색, 투명도 = 0.4, children }) {
  const g = useRef(null);
  const 재질 = useRef(null);
  if (!재질.current)
    재질.current = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false, // 자기들끼리 겹쳐 그려도 얼룩이 안 생긴다
      toneMapped: false,
    });

  useEffect(() => {
    const m = 재질.current;
    return () => m.dispose();
  }, []);

  useFrame(() => {
    const o = g.current;
    if (!o) return;
    const r = 최근자리값();
    if (!r?.있나) {
      o.visible = false;
      return;
    }
    o.visible = true;
    o.position.set(r.x, r.y, r.z);
    o.rotation.set(0, r.rot ?? 0, 0);

    const m = 재질.current;
    m.color.copy(_유령색.set(r.됨 ? 가능색 : 불가색));
    m.opacity = 투명도;

    // GLB 는 늦게 붙으므로 매 프레임 훑되, 이미 손본 것은 건너뛴다.
    o.traverse((n) => {
      if (n === o || n.userData.__유령) return;
      if (n.isLine || n.isLineSegments || n.isPoints) {
        n.visible = false; // 만화 주름선 — 유령에는 안 어울린다
      } else if (n.isMesh) {
        // drei <Outlines> 는 뒷면만 그리는 껍데기다. 유령에 씌우면 덩어리로 보인다.
        if (n.material?.side === THREE.BackSide) n.visible = false;
        else {
          n.material = m;
          n.castShadow = false;
          n.receiveShadow = false;
        }
      } else return;
      n.userData.__유령 = true;
    });
  });

  return (
    <group ref={g} visible={false}>
      {children}
    </group>
  );
}
