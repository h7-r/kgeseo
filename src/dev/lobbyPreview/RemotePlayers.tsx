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
/** 머리뼈(head, 목과 머리 이음매)에서 이름표까지 — 머리 꼭대기 바로 위(약 40cm, 유닛) 🟡 화면 보고 맞춤 */
const LABEL_ABOVE_HEAD_BONE = 0.4 * UNITS_PER_METER;
/** 머리뼈를 아직 못 찾았을 때(모델 내려받는 중) 발바닥에서의 높이 */
const LABEL_FALLBACK_HEIGHT = EYE_HEIGHT;
/** 원격 아바타를 담는 그룹 이름 — 내 머리뼈를 찾을 때 원격 아바타는 빼려고 */
const REMOTE_ROOT_NAME = "lobby-remote-players";

const headBoneOf = (root: THREE.Object3D | null): THREE.Object3D | null => {
  let found: THREE.Object3D | null = null;
  root?.traverse((object) => {
    if (!found && (object as THREE.Bone).isBone && object.name.toLowerCase() === "head") found = object;
  });
  return found;
};
const scratch = new THREE.Vector3();

/** 이름표 자리: 머리뼈가 있으면 그 위, 없으면 발바닥 기준. 키·머리 크기·애니메이션을 그대로 따른다 */
function placeLabel(label: THREE.Object3D | null, head: THREE.Object3D | null, x: number, footY: number, z: number) {
  if (!label) return;
  if (head) {
    head.getWorldPosition(scratch);
    label.position.set(scratch.x, scratch.y + LABEL_ABOVE_HEAD_BONE, scratch.z);
  } else {
    label.position.set(x, footY + LABEL_FALLBACK_HEIGHT, z);
  }
}

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
  const avatarRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Object3D | null>(null);
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
    // 외형이 바뀌면 모델이 새로 붙으니 머리뼈를 다시 찾는다
    if (!headRef.current?.parent) headRef.current = headBoneOf(avatarRef.current);
    placeLabel(labelRef.current, headRef.current, link.position.x, link.footY, link.position.z);
    // 외형·이름이 바뀌었을 때만 다시 그린다(매 프레임 setState 하지 않는다)
    if (view.look !== look) {
      headRef.current = null;
      setLook(view.look);
    }
    if (view.nickname !== nickname) setNickname(view.nickname);
    const said = bubbles.get(sid);
    const text = said && said.until > Date.now() ? said.text : null;
    if (text !== bubble) setBubble(text);
  }, FRAME_PRIORITY.avatar - 5);

  return (
    <>
      <group ref={avatarRef}>
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
      </group>
      <group ref={labelRef}>
        <NameTag name={nickname} bubble={bubble} />
      </group>
    </>
  );
}

/**
 * 내 머리 위: 조사관명(3인칭일 때만 — 1인칭에선 눈 바로 위라 화면 위 끝에 걸린다)과 내 말풍선.
 * 이름은 방 상태의 내 항목(서버가 입장권에서 넣은 값)을 쓴다 — 남이 보는 이름과 같다.
 * 높이는 원격과 같은 규칙(내 아바타의 머리뼈 위).
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
  const headRef = useRef<THREE.Object3D | null>(null);
  const lastSearchRef = useRef(0);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState("");
  useFrame(({ scene }) => {
    const eye = getEye();
    const sid = getSid();
    // 방에 없으면 띄울 것도 없다 — 장면을 뒤지지 않는다
    if (!sid) {
      headRef.current = null;
      if (text !== null) setText(null);
      if (name !== "") setName("");
      return;
    }
    // 내 아바타는 App 이 그려 참조가 없다(3단계에서 직접 받는다) — 내 자리(가로 1.5 유닛 안)에 가장 가까운,
    // 원격 그룹 밖의 보이는 머리뼈를 1초마다 고른다
    const now = performance.now();
    if (now - lastSearchRef.current > 1000) {
      lastSearchRef.current = now;
      let best: THREE.Object3D | null = null;
      let bestDistance = 1.5;
      scene.traverse((object) => {
        if (!(object as THREE.Bone).isBone || object.name.toLowerCase() !== "head") return;
        for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
          if (parent.name === REMOTE_ROOT_NAME || !parent.visible) return;
        }
        object.getWorldPosition(scratch);
        const distance = Math.hypot(scratch.x - eye.x, scratch.z - eye.z);
        if (distance < bestDistance) {
          best = object;
          bestDistance = distance;
        }
      });
      headRef.current = best;
    }
    placeLabel(groupRef.current, headRef.current, eye.x, eye.y - EYE_HEIGHT, eye.z);
    // 1인칭에서는 이름표와 내 말풍선이 눈 바로 위라 화면 밖이다(🟡 1인칭 내 말풍선 표시는 3단계에서)
    const said = bubbles.get(sid);
    const next = said && said.until > Date.now() ? said.text : null;
    if (next !== text) setText(next);
    const nextName = isThirdPerson() ? getName(sid) : "";
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
    <group name={REMOTE_ROOT_NAME}>
      {sids.map((sid) => (
        <RemoteAvatar key={sid} sid={sid} connection={connection} bubbles={bubbles} />
      ))}
    </group>
  );
}
