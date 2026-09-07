// 조사레이.jsx — 화면 한가운데로 무엇을 겨냥하고 있는지 찾는다 (S7-015)
//
// 1인칭이라 마우스 커서가 없다 → **화면 정중앙이 곧 커서다.**
// 매 프레임 광선을 쏘면 낭비라 초당 12번만 쏜다(판정.주기).
//
// [왜 '가장 가까운 것 하나만' 보나]
//   벽 뒤 물건까지 잡히면 벽 너머로 조사가 된다. 제일 앞에 맞은 것만 보면
//   자연스럽게 가림이 처리된다.

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { 겨냥설정, 판정 } from "./조사시스템.js";

export default function 조사레이({ 켜기 = true }) {
  const { camera, scene } = useThree();
  const 광선 = useRef(new THREE.Raycaster());
  const 중앙 = useRef(new THREE.Vector2(0, 0));
  const 누적 = useRef(0);

  useFrame((_, dt) => {
    if (!켜기) {
      겨냥설정(null);
      return;
    }
    누적.current += dt;
    if (누적.current < 판정.주기) return;
    누적.current = 0;

    광선.current.setFromCamera(중앙.current, camera);
    광선.current.far = 판정.거리;
    const 맞은것 = 광선.current.intersectObjects(scene.children, true);

    let 찾음 = null;
    if (맞은것.length) {
      // 제일 가까운 것 하나만 — 그 물건이 조사 대상에 속해 있는지 부모로 거슬러 올라간다
      let o = 맞은것[0].object;
      while (o) {
        if (o.userData?.조사ID) {
          찾음 = o.userData.조사ID;
          break;
        }
        o = o.parent;
      }
    }
    겨냥설정(찾음);
  });

  return null;
}
