// 같은 방 다른 사람을 실제 캐릭터로 그린다(설계 5절 「원격 표시」). 3단계에서 본부실 정식 연결 때 다시 쓸 부품.
// - 내 연결 ID 는 뺀다(내 이름표·말풍선은 LocalLabel). 첫 정상 위치(placed) 전에는 그리지 않는다.
// - 머리 위 이름은 입장권의 이름 — 캐릭터를 만든 계정은 조사관명, 없으면 계정 닉네임(FastAPI 가 정한다).
// - 위치·방향은 약 100ms 로 따라간다(🟡). 위치가 바뀔 때마다 모델을 다시 만들지 않는다 — 상자 하나에 값만 쓴다.
// - 충돌·퍼즐 상호작용에 넣지 않는다(물리·상호작용 목록에 등록하지 않음).
// - 동작은 「자동」(lobbyLookToRendererConfig), framePriority 는 내 아바타보다 먼저(1인칭 잘림면이 전역 하나).
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { IS_LOBBY_OUTLINE_DISABLED, IS_LOBBY_TOON_DISABLED, LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import type { AvatarLink } from "@/engine/avatarLink";
import { FRAME_PRIORITY } from "@/engine/camera";
import { EYE_HEIGHT, UNITS_PER_METER } from "@/engine/movement/constants";
import { DEFAULT_OUTLINE, DEFAULT_TOON, LobbyChibi } from "@/naju";
import type { LobbyConnection, RemotePlayerView } from "@/net/colyseus";
import { lobbyLookToRendererConfig } from "@/net/lobbyLook";

const TOON = { ...DEFAULT_TOON, enabled: !IS_LOBBY_TOON_DISABLED };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: !IS_LOBBY_OUTLINE_DISABLED };
/** 따라가는 시간 상수(초) — 서버 패치 100ms 와 맞춘다 🟡 */
const FOLLOW_SECONDS = 0.1;
/** 머리 위 이름표 높이 — 발바닥에서 눈높이보다 약 25cm 위(유닛) */
const LABEL_HEIGHT = EYE_HEIGHT + 0.25 * UNITS_PER_METER;

function createLink(view: RemotePlayerView): AvatarLink {
  return {
    position: new THREE.Vector3(view.x, view.y + EYE_HEIGHT, view.z),
    groundY: 0,
    footY: view.y,
    facing: view.ry,
    moving: false,
    running: false,
    speed: 0,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
  };
}

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** 머리 위 표시: 말풍선(있을 때) 위, 조사관명 아래. 설계 5절 「말풍선은 닉네임표 위에 띄운다」 */
function NameTag({ name, bubble }: { name: string; bubble: string | null }) {
  return (
    <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        {bubble && (
          <div
            style={{
              background: "#fff6d5",
              color: "#222",
              padding: "4px 10px",
              borderRadius: 12,
              font: "600 13px system-ui, sans-serif",
              whiteSpace: "nowrap",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
          >
            {bubble}
          </div>
        )}
        {name && (
          <div
            style={{
              background: "rgba(16,18,22,0.72)",
              color: "#e8e8e8",
              padding: "2px 8px",
              borderRadius: 8,
              font: "12px system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
        )}
      </div>
    </Html>
  );
}

function RemoteAvatar({
  sid,
  connection,
  bubbles,
}: {
  sid: string;
  connection: LobbyConnection;
  bubbles: ReadonlyMap<string, { text: string; until: number }>;
}) {
  const first = connection.players().get(sid);
  const linkRef = useRef<AvatarLink>(createLink(first as RemotePlayerView));
  const labelRef = useRef<THREE.Group>(null);
  const [look, setLook] = useState(first?.look ?? "");
  const [nickname, setNickname] = useState(first?.nickname ?? "");
  const [bubble, setBubble] = useState<string | null>(null);
  const config = useMemo(() => lobbyLookToRendererConfig(look), [look]);

  useFrame((_, delta) => {
    const view = connection.players().get(sid);
    if (!view) return;
    const link = linkRef.current;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.1) / FOLLOW_SECONDS);
    const beforeX = link.position.x;
    const beforeZ = link.position.z;
    link.position.x += (view.x - link.position.x) * alpha;
    link.position.z += (view.z - link.position.z) * alpha;
    link.footY += (view.y - link.footY) * alpha;
    link.position.y = link.footY + EYE_HEIGHT;
    link.facing = wrapAngle(link.facing + wrapAngle(view.ry - link.facing) * alpha);
    const moved = Math.hypot(link.position.x - beforeX, link.position.z - beforeZ) / Math.max(delta, 1e-3);
    link.speed += (moved - link.speed) * Math.min(1, delta * 10);
    link.moving = view.gait !== "idle" && link.speed > 0.05;
    link.running = view.gait === "run";
    link.crouching = view.gait === "crouch";
    labelRef.current?.position.set(link.position.x, link.footY + LABEL_HEIGHT, link.position.z);
    // 외형·이름이 바뀌었을 때만 다시 그린다(매 프레임 setState 하지 않는다)
    if (view.look !== look) setLook(view.look);
    if (view.nickname !== nickname) setNickname(view.nickname);
    const said = bubbles.get(sid);
    const text = said && said.until > Date.now() ? said.text : null;
    if (text !== bubble) setBubble(text);
  }, FRAME_PRIORITY.avatar - 5);

  return (
    <>
      <Suspense fallback={null}>
        <LobbyChibi
          visible
          playerRef={linkRef}
          config={config}
          body={LOBBY_AVATAR_BODY}
          toon={TOON}
          outline={OUTLINE}
          framePriority={FRAME_PRIORITY.avatar - 1}
        />
      </Suspense>
      <group ref={labelRef}>
        <NameTag name={nickname} bubble={bubble} />
      </group>
    </>
  );
}

/**
 * 내 머리 위: 조사관명(3인칭일 때만 — 1인칭에선 눈 바로 위라 화면 위 끝에 걸린다)과 내 말풍선.
 * 이름은 방 상태의 내 항목(서버가 입장권에서 넣은 값)을 쓴다 — 남이 보는 이름과 같다.
 */
export function LocalLabel({
  getSid,
  getEye,
  getName,
  isThirdPerson,
  bubbles,
}: {
  getSid: () => string | null;
  getEye: () => THREE.Vector3;
  getName: (sid: string) => string;
  isThirdPerson: () => boolean;
  bubbles: ReadonlyMap<string, { text: string; until: number }>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState("");
  useFrame(() => {
    const eye = getEye();
    groupRef.current?.position.set(eye.x, eye.y - EYE_HEIGHT + LABEL_HEIGHT, eye.z);
    const sid = getSid();
    const said = sid ? bubbles.get(sid) : undefined;
    const next = said && said.until > Date.now() ? said.text : null;
    if (next !== text) setText(next);
    const nextName = sid && isThirdPerson() ? getName(sid) : "";
    if (nextName !== name) setName(nextName);
  });
  return <group ref={groupRef}>{(text || name) && <NameTag name={name} bubble={text} />}</group>;
}

export default function RemotePlayers({
  connection,
  bubbles,
}: {
  connection: LobbyConnection;
  bubbles: ReadonlyMap<string, { text: string; until: number }>;
}) {
  const [sids, setSids] = useState<string[]>([]);
  useFrame(() => {
    const status = connection.status();
    const mine = status.kind === "connected" ? status.sessionId : null;
    const next: string[] = [];
    if (mine) for (const [sid, view] of connection.players()) if (sid !== mine && view.placed) next.push(sid);
    next.sort();
    if (next.length !== sids.length || next.some((sid, index) => sid !== sids[index])) setSids(next);
  });
  return (
    <>
      {sids.map((sid) => (
        <RemoteAvatar key={sid} sid={sid} connection={connection} bubbles={bubbles} />
      ))}
    </>
  );
}
