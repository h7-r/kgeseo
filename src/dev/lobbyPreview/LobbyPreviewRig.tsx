// 로비 실제 화면 미리보기 — Canvas 안. 본부실 출입에 맞춰 연결·퇴장하고, 내 자세를 보내고, 다른 사람을 그린다.
// 설계 4절 연결 조건: 본부실 벽 안 · 컷신·장면 전환 중 아님 · 기차·나주 아님. 카메라 시점만 바뀌면 그대로.
// 컷신(임시 정책): 입장·퇴장 판정, 자세 갱신, 위치 송신을 모두 멈춘다. 붙어 있으면 방은 그대로(남에게는 제자리에 선 모습).
//   카메라가 컷신을 따라 움직이므로 그 위치로 경계를 재거나 자세를 만들면 안 된다 — 컷신 전에 시작한 입장·예약 재시도가
//   컷신 중에 붙어도 마지막 자세로 들어간다. 인사창은 HUD 가 막는다.
//   몇 초짜리 컷신마다 나갔다 들어오면 남의 화면에서 사라졌다 나타나고 티켓도 새로 받는다 — 방 유지 여부는 3단계에서 설계 문장과 함께 정한다.
// 장면 전환: 기차(주소)·나주(이벤트)만 읽는다. 페이드 중인지는 App 안 상태라 미리보기에서 읽지 못한다.
// 자세는 playerView 로 읽는 임시 방식이다 — 앉기는 보내지 않고, 발 높이는 「눈 − 고정 눈높이」라 앉기·키 변경에서 틀릴 수 있다.
// 정식 연결(3단계)은 App.tsx·StationScene.tsx 에 끼우고 AvatarLink 의 발 높이·앉기 상태를 읽는다.
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { TRAIN_PATH } from "@/app/useSceneTransition";
import { EYE_HEIGHT, RUN_SPEED_MULTIPLIER, WALK_SPEED } from "@/engine/movement/constants";
import { playerView } from "@/engine/playerView";
import { useIsCutscenePlaying } from "@/props/vendingPushState";
import { NAJU_ENTER_EVENT } from "@/station/najuEnter";
import {
  HEADQUARTERS_MAX_X,
  HEADQUARTERS_MAX_Z,
  HEADQUARTERS_MIN_X,
  HEADQUARTERS_MIN_Z,
} from "@/station/layout/dimensions";

import { bubbles, connection, localPose, refreshAccount } from "./previewState";
import RemotePlayers, { LocalBubble } from "./RemotePlayers";

/** 경계 왔다 갔다 방지(🟡) — 안으로 이만큼 들어와야 입장, 밖으로 이만큼 나가야 퇴장 */
const HYSTERESIS = 0.5;

const insideHeadquarters = (x: number, z: number, margin: number) =>
  x > HEADQUARTERS_MIN_X + margin &&
  x < HEADQUARTERS_MAX_X - margin &&
  z > HEADQUARTERS_MIN_Z + margin &&
  z < HEADQUARTERS_MAX_Z - margin;

export default function LobbyPreviewRig() {
  const cutscene = useIsCutscenePlaying();
  const cutsceneRef = useRef(cutscene);
  const najuRef = useRef(false);
  const lastRef = useRef<{ x: number; z: number } | null>(null);

  useEffect(() => {
    cutsceneRef.current = cutscene;
  }, [cutscene]);

  useEffect(() => {
    void refreshAccount();
    const onNaju = () => {
      najuRef.current = true;
      connection.exit();
    };
    const onPageHide = () => connection.exit();
    addEventListener(NAJU_ENTER_EVENT, onNaju);
    addEventListener("pagehide", onPageHide);
    return () => {
      removeEventListener(NAJU_ENTER_EVENT, onNaju);
      removeEventListener("pagehide", onPageHide);
      connection.exit();
    };
  }, []);

  useFrame((_, delta) => {
    if (!playerView.ready) return;
    const eye = playerView.eye;
    const connected = connection.status().kind !== "idle";
    const inTrain = window.location.pathname === TRAIN_PATH;
    if (inTrain || najuRef.current) {
      if (connected) connection.exit();
      return;
    }
    if (cutsceneRef.current) {
      lastRef.current = null; // 컷신이 끝난 첫 프레임에 순간 이동을 속도로 읽지 않게
      return;
    }
    // 이미 들어와 있으면 밖으로 충분히 나가야 퇴장, 아니면 안으로 충분히 들어와야 입장
    const inside = insideHeadquarters(eye.x, eye.z, connected ? -HYSTERESIS : HYSTERESIS);
    if (connected && !inside) connection.exit();
    else if (!connected && inside) connection.enter();

    // 내 자세: 발바닥 높이(눈 − 눈높이), 몸 방향, 걸음새(속도로 고른다)
    const last = lastRef.current;
    const speed = last ? Math.hypot(eye.x - last.x, eye.z - last.z) / Math.max(delta, 1e-3) : 0;
    lastRef.current = { x: eye.x, z: eye.z };
    localPose.x = eye.x;
    localPose.z = eye.z;
    localPose.y = Math.max(0, eye.y - EYE_HEIGHT);
    localPose.ry = playerView.bodyYaw;
    localPose.gait = speed < 0.4 ? "idle" : speed < WALK_SPEED * (1 + RUN_SPEED_MULTIPLIER) * 0.5 ? "walk" : "run";
    if (connection.status().kind === "connected") connection.sendMove({ ...localPose });
  });

  return (
    <>
      <RemotePlayers connection={connection} bubbles={bubbles} />
      <LocalBubble
        getSid={() => {
          const status = connection.status();
          return status.kind === "connected" ? status.sessionId : null;
        }}
        getEye={() => playerView.eye}
        bubbles={bubbles}
      />
    </>
  );
}
