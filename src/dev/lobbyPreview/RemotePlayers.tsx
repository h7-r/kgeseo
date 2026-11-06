// 같은 방 다른 사람을 실제 캐릭터로 그린다(설계 5절 「원격 표시」). 3단계에서 본부실 정식 연결 때 다시 쓸 부품.
// - 내 연결 ID 는 뺀다(내 이름표·말풍선은 LocalLabel). 첫 정상 위치(placed) 전에는 그리지 않는다.
// - 머리 위 이름은 입장권의 이름 — 캐릭터를 만든 계정은 조사관명, 없으면 계정 닉네임(FastAPI 가 정한다).
// - 위치·방향은 약 100ms 로 따라간다(🟡). 위치가 바뀔 때마다 모델을 다시 만들지 않는다 — 상자 하나에 값만 쓴다.
// - 퍼즐 상호작용에는 넣지 않는다. 내 **걷기** 충돌에만 넣는다 — 내 캐릭터가 다른 사람을 뚫고 지나가지 않게(미르 지시 11/6,
//   설계 v0.20 5절). 몸통 상자는 personColliders(걷기 전용)에 올린다 — 본편 공용 충돌 목록에는 안 올린다(카메라·물건 놓기 그대로).
// - 동작은 「자동」(lobbyLookToRendererConfig), framePriority 는 내 아바타보다 먼저(1인칭 잘림면이 전역 하나).
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { IS_LOBBY_OUTLINE_DISABLED, IS_LOBBY_TOON_DISABLED, LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import type { AvatarLink } from "@/engine/avatarLink";
import { FRAME_PRIORITY } from "@/engine/camera";
import { EYE_HEIGHT, PLAYER_RADIUS, UNITS_PER_METER } from "@/engine/movement/constants";
import { playerView } from "@/engine/playerView";
import { DEFAULT_OUTLINE, DEFAULT_TOON, LobbyChibi } from "@/naju";
import type { LobbyConnection, RemotePlayerView } from "@/net/colyseus";
import { lobbyLookToRendererConfig } from "@/net/lobbyLook";
import { overlayLayer, isTypingTarget } from "@/game/overlayLayer";
import { getLockControl } from "@/props/combinationLockState";
import { useIsCutscenePlaying } from "@/props/vendingPushState";
import { HEADQUARTERS_MIN_X } from "@/station/layout/dimensions";
import { passage } from "@/station/layout/passage";
import { trainDoors } from "@/station/layout/trainDoors";

import { remoteLinks } from "./avatarLinks";
import { type PersonBox, personBoxes } from "./personColliders";
import SpeechBubble from "./SpeechBubble";

const TOON = { ...DEFAULT_TOON, enabled: !IS_LOBBY_TOON_DISABLED };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: !IS_LOBBY_OUTLINE_DISABLED };
/** 따라가는 시간 상수(초) — 서버 패치 100ms 와 맞춘다 🟡 */
const FOLLOW_SECONDS = 0.1;
/** 머리뼈(head, 목과 머리 이음매)에서 이름표까지 — 머리 꼭대기 바로 위(약 40cm, 유닛) 🟡 화면 보고 맞춤 */
const LABEL_ABOVE_HEAD_BONE = 0.4 * UNITS_PER_METER;
/** 머리뼈를 아직 못 찾았을 때(모델 내려받는 중) 발바닥에서의 높이 */
const LABEL_FALLBACK_HEIGHT = EYE_HEIGHT;
/**
 * 다른 사람 몸통 상자 반폭(유닛). 걷기 판정이 내 반지름(PLAYER_RADIUS 0.6)을 더하므로 중심 사이가 약 1.2 유닛(36cm)
 * 아래로는 다가가지 못한다 🟡 화면 보고 맞춤. 걷기 판정에만 쓰므로 높이는 없다.
 */
const BODY_HALF_WIDTH = 0.6;
/** 이보다 얇아지면(상대가 내 몸 안까지 들어옴) 상자를 내린다 */
const MIN_BODY_HALF_WIDTH = 0.05;
/**
 * 출구 막힘 예외(미르 11/6 「권장안대로」, Codex 09 로 좁힘): 출구(서쪽 벽 구멍·기차 문) 근처에서, 내가 가려는 쪽을
 * 사람이 막고 있고, 이동 키를 누른 채 0.5초 동안 거의 못 움직인 상태가 3초 이어지면 막고 있던 사람들만 통과한다.
 * 키를 떼거나·다시 나아가거나·화면창·자물쇠·컷신·출구를 벗어나면 처음부터. 몸이 완전히 빠지면(2 유닛) 다시 막는다.
 * 사람 상자는 걷기 전용이라 통과도 걷기에서만 빠진다. 「가려는 쪽」은 몸 방향이 아니라 실제 이동 입력(카메라 앞·옆 × WASD).
 */
const PUSH_THROUGH_SECONDS = 3;
const EXIT_RADIUS = 5;
const STUCK_WINDOW_SECONDS = 0.5;
const STUCK_DISTANCE = 0.3;
const BLOCKING_ARC = (70 * Math.PI) / 180;
const PASS_RELEASE_DISTANCE = 2;
/** 지금 이동 입력이 가리키는 쪽(수평 단위 벡터). active 가 false 면 키를 안 눌렀거나 W+S 처럼 상쇄됐다 */
const wish = { x: 0, z: 0, active: false };
/** 이번 프레임 나와 닿아 있고 내가 가려는 쪽에 있는 사람 */
const blockers = new Set<string>();
/** 통과 중인 사람 */
const passThrough = new Set<string>();
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const nearExit = (x: number, z: number) =>
  Math.hypot(x - HEADQUARTERS_MIN_X, z - passage.get().doorZ) < EXIT_RADIUS ||
  (trainDoors.nearest(x, z)?.distance ?? Infinity) < EXIT_RADIUS;

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
const forwardScratch = new THREE.Vector3();

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

/** 그릴 차례가 왔을 때 그 사람이 이미 나갔을 수 있다(방을 나가면 목록이 먼저 비고, 그리기는 한 박자 늦다) — 없으면 원점 */
function createLink(view: RemotePlayerView | undefined): AvatarLink {
  return {
    position: new THREE.Vector3(view?.x ?? 0, (view?.y ?? 0) + EYE_HEIGHT, view?.z ?? 0),
    groundY: 0,
    footY: view?.y ?? 0,
    facing: view?.ry ?? 0,
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

/** 머리 위 표시: 말풍선(있을 때, 꼬리 달린 흰 풍선) 위, 조사관명(어두운 표) 아래. 설계 5절 「말풍선은 닉네임표 위에 띄운다」 */
function NameTag({ name, bubble }: { name: string; bubble: string | null }) {
  return (
    <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        {bubble && <SpeechBubble text={bubble} />}
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
  const linkRef = useRef<AvatarLink>(createLink(first));
  const labelRef = useRef<THREE.Group>(null);
  const avatarRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Object3D | null>(null);
  // 걷기 충돌 상자 — 매 프레임 같은 상자의 값만 바꾼다(새로 만들지 않는다)
  const bodyRef = useRef<PersonBox>({
    minX: (first?.x ?? 0) - BODY_HALF_WIDTH,
    maxX: (first?.x ?? 0) + BODY_HALF_WIDTH,
    minZ: (first?.z ?? 0) - BODY_HALF_WIDTH,
    maxZ: (first?.z ?? 0) + BODY_HALF_WIDTH,
  });
  // 인사·맞기·주먹 동작을 걸 수 있게 연결 ID 로 등록한다
  useEffect(() => {
    const link = linkRef.current;
    remoteLinks.set(sid, link);
    return () => {
      if (remoteLinks.get(sid) === link) remoteLinks.delete(sid);
      blockers.delete(sid);
      passThrough.delete(sid);
    };
  }, [sid]);
  // 상자는 그 사람의 자리를 받은 프레임에 올리고(useFrame), 사라질 때 내린다 — 이미 나간 사람은 올리지 않는다
  useEffect(
    () => () => {
      personBoxes.delete(sid);
    },
    [sid],
  );
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
    // 상자 가장자리를 「내가 지금 선 자리」보다 안쪽으로 두지 않는다 — 내 자리는 늘 상자 밖(걷기 판정이 제자리가 막히면
    // 「갇힘」으로 보고 가구까지 무시하므로), 한 걸음이라도 더 다가가면 막힌다. 여유를 크게 두면(예전 0.02) 그만큼씩
    // 프레임마다 파고들었다(Codex 08). 상대가 내 몸 안까지 들어오면(반폭이 거의 0) 상자를 내려 갇히지 않게 한다.
    const reach = playerView.ready
      ? Math.max(Math.abs(playerView.eye.x - link.position.x), Math.abs(playerView.eye.z - link.position.z)) -
        PLAYER_RADIUS -
        1e-4
      : BODY_HALF_WIDTH;
    const half = Math.min(BODY_HALF_WIDTH, reach);
    const body = bodyRef.current;
    // 출구 막힘 예외 — 닿아 있고 내가 가려는 쪽이면 「막는 사람」, 통과 중이면 몸이 완전히 빠질 때까지 상자 없음
    let passing = false;
    if (playerView.ready) {
      const dx = link.position.x - playerView.eye.x;
      const dz = link.position.z - playerView.eye.z;
      const distance = Math.hypot(dx, dz);
      const touching = Math.max(Math.abs(dx), Math.abs(dz)) <= BODY_HALF_WIDTH + PLAYER_RADIUS + 0.1;
      const ahead = wish.active && (distance < 0.3 || (wish.x * dx + wish.z * dz) / distance >= Math.cos(BLOCKING_ARC));
      if (touching && ahead) blockers.add(sid);
      else blockers.delete(sid);
      if (passThrough.has(sid) && distance > PASS_RELEASE_DISTANCE) passThrough.delete(sid);
      passing = passThrough.has(sid);
    }
    if (passing || half < MIN_BODY_HALF_WIDTH) {
      if (personBoxes.get(sid) === body) personBoxes.delete(sid);
    } else {
      body.minX = link.position.x - half;
      body.maxX = link.position.x + half;
      body.minZ = link.position.z - half;
      body.maxZ = link.position.z + half;
      if (personBoxes.get(sid) !== body) personBoxes.set(sid, body);
    }
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

  // 이미 나간 사람은 그리지 않는다(목록이 다음 프레임에 이 부품을 내린다)
  if (!connection.players().has(sid)) return null;

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
    // 1인칭에서는 이름표와 내 말풍선 모두 그리지 않는다(눈 바로 위라 화면 밖) — 1인칭 내 말풍선은 HUD 가 화면 아래에
    const thirdPerson = isThirdPerson();
    const said = bubbles.get(sid);
    const next = thirdPerson && said && said.until > Date.now() ? said.text : null;
    if (next !== text) setText(next);
    const nextName = thirdPerson ? getName(sid) : "";
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
  const cutscene = useIsCutscenePlaying();
  const cutsceneRef = useRef(cutscene);
  useEffect(() => {
    cutsceneRef.current = cutscene;
  }, [cutscene]);
  // 누르고 있는 이동 키(입력칸에 쓰는 중이면 무시, 창을 떠나면 모두 뗀 것으로)
  const keysRef = useRef(new Set<string>());
  useEffect(() => {
    const keys = keysRef.current;
    const down = (event: KeyboardEvent) => {
      if (MOVE_KEYS.has(event.code) && !isTypingTarget(event.target)) keys.add(event.code);
    };
    const up = (event: KeyboardEvent) => keys.delete(event.code);
    const clear = () => keys.clear();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", clear);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", clear);
      keys.clear();
    };
  }, []);
  const trailRef = useRef<{ t: number; x: number; z: number }[]>([]);
  const stuckRef = useRef(0);
  useFrame((state, delta) => {
    // 이동 입력 방향 — 본편 이동과 같이 카메라 앞(수평)·옆에 키를 더한다(1인칭에서 옆·뒤로 가는 것도 맞게, W+S 는 상쇄)
    const keys = keysRef.current;
    const ahead =
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const side =
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    state.camera.getWorldDirection(forwardScratch);
    forwardScratch.y = 0;
    if (forwardScratch.lengthSq() > 1e-6) forwardScratch.normalize();
    // 오른쪽 = 앞 × 위(0,1,0) = (−앞.z, 0, 앞.x)
    const wx = forwardScratch.x * ahead - forwardScratch.z * side;
    const wz = forwardScratch.z * ahead + forwardScratch.x * side;
    const length = Math.hypot(wx, wz);
    wish.active = length > 0.1;
    wish.x = wish.active ? wx / length : 0;
    wish.z = wish.active ? wz / length : 0;

    // 출구 막힘 예외 — 0.5초 동안 거의 못 움직인 채 막는 사람에게 밀고 있던 시간을 센다
    if (playerView.ready) {
      const now = state.clock.elapsedTime;
      const trail = trailRef.current;
      trail.push({ t: now, x: playerView.eye.x, z: playerView.eye.z });
      while (trail.length > 2 && now - trail[1].t >= STUCK_WINDOW_SECONDS) trail.shift();
      const oldest = trail[0];
      const moved = Math.hypot(playerView.eye.x - oldest.x, playerView.eye.z - oldest.z);
      const busy = cutsceneRef.current || overlayLayer.get() !== null || getLockControl() !== null;
      const stuck =
        wish.active &&
        !busy &&
        blockers.size > 0 &&
        nearExit(playerView.eye.x, playerView.eye.z) &&
        now - oldest.t >= STUCK_WINDOW_SECONDS * 0.8 &&
        moved < STUCK_DISTANCE;
      stuckRef.current = stuck ? stuckRef.current + delta : 0;
      if (stuckRef.current >= PUSH_THROUGH_SECONDS) {
        blockers.forEach((sid) => passThrough.add(sid));
        stuckRef.current = 0;
      }
    }
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
