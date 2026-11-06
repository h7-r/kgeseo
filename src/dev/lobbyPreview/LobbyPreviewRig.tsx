// 로비 실제 화면 미리보기 — Canvas 안. 본부실 출입에 맞춰 연결·퇴장하고, 내 자세를 보내고, 다른 사람을 그린다.
// 설계 4절 연결 조건: 본부실 벽 안 · 컷신·장면 전환 중 아님 · 기차·나주 아님. 카메라 시점만 바뀌면 그대로.
// 정식 연결(3단계)은 App.tsx·StationScene.tsx 에 끼운다 — 여기서는 playerView 로 읽는 임시 방식이다.
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
    // 이미 들어와 있으면 밖으로 충분히 나가야 퇴장, 아니면 안으로 충분히 들어와야 입장
    const inside = insideHeadquarters(eye.x, eye.z, connected ? -HYSTERESIS : HYSTERESIS);
    if (connected && (!inside || inTrain || najuRef.current)) connection.exit();
    else if (!connected && inside && !inTrain && !najuRef.current && !cutsceneRef.current) connection.enter();

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
