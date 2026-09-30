// 안내판정.jsx — 캔버스 안에서 **값만 읽어** 단계 완료를 판정한다.
//
// [왜 컴포넌트로 빼나]
//   App.jsx 에는 태그만 놓고 로직은 여기 둔다(지시서 4단계). 그래야 본편 파일이
//   튜토리얼 때문에 커지지 않고, 붙였다 뗐다 하기도 쉽다.
//
// [★ 매 프레임 setState 금지]
//   `판정하기()` 는 값만 읽는다. 단계가 실제로 넘어갈 때만 상자가 바뀐다(안내상태.js).

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { 판정하기, 입력기록 } from "./안내상태.js";

export default function TG안내판정({ 플레이어참조 }) {
  const get = useThree((s) => s.get);

  // ── 키 안내는 **그 키를 실제로 눌렀을 때만** 걷힌다 ──────────
  //   [왜 여기서 듣나]  App.jsx 는 손대지 않는다(다른 사람이 고치는 중이다).
  //   창 단위로 듣기만 하면 되므로 이 컴포넌트가 맡는다.
  //   [왜 시간으로 안 없애나]  "점프하라"고 띄워 놓고 5 초 뒤에 저절로 사라지면,
  //   아직 못 한 사람은 **무엇을 하라는지 모른 채 안내만 잃는다**(사용자 지적).
  //   그래서 실제로 눌러야 걷힌다.
  useEffect(() => {
    const 눌림 = (e) => {
      if (e.repeat) return;
      const c = e.code;
      if (c === "KeyW" || c === "KeyA" || c === "KeyS" || c === "KeyD") 입력기록("WASD");
      else if (c === "Space") 입력기록("Space");
      else if (c === "KeyC") 입력기록("C");
      else if (c === "KeyE") 입력기록("E");
    };
    // 마우스는 **움직였을 때**만 친다(클릭은 다른 뜻이다).
    const 움직임 = () => 입력기록("마우스");
    window.addEventListener("keydown", 눌림);
    window.addEventListener("mousemove", 움직임);
    return () => {
      window.removeEventListener("keydown", 눌림);
      window.removeEventListener("mousemove", 움직임);
    };
  }, []);
  useFrame(() => {
    const { camera } = get();
    const p = 플레이어참조?.current?.position;
    판정하기({
      위치: p ? [p.x, p.y, p.z] : null,
      // 좌우로 얼마나 돌렸나만 본다(둘러보기 판정).
      시선각: camera.rotation.y,
      // 동전은 **앉아야** 주워진다. 그래서 앉기도 한 단계로 가르친다.
      앉음: !!플레이어참조?.current?.crouching,
      점프: !!플레이어참조?.current?.jumping,
    });
  });
  return null;
}
