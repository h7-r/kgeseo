// 로비 스피커(Canvas 안) — 본부실 노랑 책상(책상4) 왼쪽 끝에 놓인 청록 카세트 라디오(붐박스). 검토 17회차.
// 처음엔 원목 책상 스피커였는데 멀리서 옆 모니터와 같은 「어두운 상자」로 읽혀 못 찾았다(11/7 미르) → 둥근 스피커 둘 ·
// 카세트 · 손잡이 · 안테나로 한눈에 음악 물건이게, 꺼져 있을 땐 위에 ♪ 표지가 둥실 떠 방 건너편에서도 보이게.
// 게임의 겨냥 장치(useInteractable)에 등록해 빛남 · 팔 뻗기 · [E] 가 다른 물건과 똑같이 동작한다. 1인칭에선 클릭도(주먹이 없다).
// 집을 수 없고, 놓을 자리 검사에 차지한 칸으로 등록한다(위에 노트북을 내려놓지 못하게).
// 재생 중(유튜브 PLAYING)에만 콘이 박자처럼 들썩이고 음표가 피어오른다 — 교차 출처라 소리를 분석할 수 없어 가짜 박자다.
// 각자 듣기라 다른 사람 화면의 스피커는 가만히 있다. 기차 · 나주에선 숨기고, 컷신 · 게임 창 · 자물쇠 중엔 끈다.
import { Outlines, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { TRAIN_PATH } from "@/app/useSceneTransition";
import { playerView } from "@/engine/playerView";
import { TOON_GRADIENT } from "@/engine/toon";
import { overlayLayer } from "@/game/overlayLayer";
import { AimHighlight } from "@/lobby/AimHighlight";
import { MeasuredItem } from "@/lobby/ItemPlacement";
import { aimStore, useInteractable } from "@/lobby/interactions";
import { getLockControl } from "@/props/combinationLockState";
import { useIsCutscenePlaying } from "@/props/vendingPushState";
import { NAJU_ENTER_EVENT } from "@/station/najuEnter";

import { closeMusic, musicStore, openMusic, SPEAKER_AIM_ID } from "./musicState";

/** 책상4(노랑, 윗면 2.06 · x −0.4~5.8 · z −4.0~−1.2)의 왼쪽 끝. 스탠드(x 1.2~2.0) · 서류를 비켜 방 가운데를 본다 */
const SPOT = { x: 0.35, y: 2.06, z: -2.8, rot: -0.35 } as const;
const BODY = { width: 1.15, height: 0.6, depth: 0.36 } as const;
/** 좌우 스피커 가운데(x) · 높이(y) · 반지름 */
const CONE = { x: 0.36, y: 0.29, radius: 0.2 } as const;
/** 겨냥 강조(팀 기준값 「겨냥 강조」와 같게) */
const HIGHLIGHT = { color: "#fffed7", strength: 0.45, grow: 0.08 } as const;
const BPM = 112;
const NOTE_COUNT = 6;
const NOTE_EVERY = 0.55;
const NOTE_LIFE = 1.8;

const center = (): [number, number, number] => [SPOT.x, SPOT.y + BODY.height / 2, SPOT.z];
/** 위에 늘 떠 있는 ♪ 배지 높이(손잡이 · 안테나 위) */
const MARKER_Y = BODY.height + 0.72;
/** 이만큼 가까우면 겨냥 전에도 「음악 라디오」 이름표(검토 17회차 Codex: 근접 안내) */
const LABEL_NEAR = 9;

/** 쿵 — 박마다 짧게 솟는 0~1 */
function beat(time: number) {
  const phase = (time * BPM) / 60;
  const main = Math.max(0, Math.cos(phase * Math.PI * 2)) ** 6;
  const off = 0.4 * Math.max(0, Math.cos((phase + 0.5) * Math.PI * 2)) ** 10;
  return Math.min(1, main + off);
}

function makeNoteTexture(symbol: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.font = "bold 48px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "#131416";
    g.strokeText(symbol, 32, 34);
    g.fillStyle = "#fff7d6";
    g.fillText(symbol, 32, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** ♪ 배지 — 남색 동그라미 · 밝은 테두리 · 크림 ♪. 밝은 벽 · 어두운 가구 어느 쪽 앞에서도 보인다 */
function makeBadgeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  if (g) {
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fillStyle = "rgba(10,20,40,0.92)";
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = "#86a6f0";
    g.stroke();
    g.font = "bold 72px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff3cf";
    g.fillText("♪", 62, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.font = "bold 34px 'IBM Plex Sans KR', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.lineJoin = "round";
    g.strokeStyle = "rgba(5,11,26,0.95)";
    g.strokeText(text, 128, 34);
    g.fillStyle = "#f1f1fc";
    g.fillText(text, 128, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Note {
  sprite: THREE.Sprite;
  age: number;
  drift: number;
}

export default function LobbySpeaker() {
  const cutscene = useIsCutscenePlaying();
  const gate = useRef({ cutscene, naju: false, hidden: false, blocked: false });
  useEffect(() => {
    gate.current.cutscene = cutscene;
  }, [cutscene]);

  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const wooferRef = useRef<THREE.Group>(null);
  const ledRef = useRef<THREE.MeshBasicMaterial>(null);
  const notesRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Sprite>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const amount = useRef(0);
  const spawnClock = useRef(0);

  const textures = useMemo(() => [makeNoteTexture("♪"), makeNoteTexture("♫")], []);
  const badge = useMemo(() => ({ marker: makeBadgeTexture(), label: makeLabelTexture("음악 라디오") }), []);
  useEffect(
    () => () => {
      badge.marker.dispose();
      badge.label.dispose();
    },
    [badge],
  );
  const notes = useMemo<Note[]>(
    () =>
      Array.from({ length: NOTE_COUNT }, (_, i) => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: textures[i % 2], transparent: true, depthWrite: false, opacity: 0 }),
        );
        sprite.scale.setScalar(0.3);
        sprite.visible = false;
        return { sprite, age: NOTE_LIFE, drift: 0 };
      }),
    [textures],
  );
  useEffect(
    () => () => {
      textures.forEach((texture) => texture.dispose());
      notes.forEach((note) => note.sprite.material.dispose());
    },
    [textures, notes],
  );

  useInteractable(SPEAKER_AIM_ID, {
    label: () => (musicStore.get().mode === "closed" ? "[E] 음악 틀기" : "[E] 음악 화면"),
    position: center,
    radius: 0.75,
    run: openMusic,
    disabled: () => gate.current.hidden || gate.current.blocked,
  });

  useEffect(() => {
    const onNaju = () => {
      gate.current.naju = true;
    };
    // 1인칭 클릭 — [E] 와 같은 조건(겨냥 · 가림 없음). 3인칭 왼쪽 클릭은 주먹이라 받지 않는다.
    // 잠겨 있으면 이벤트가 캔버스를 감싼 틀로 오고, 풀려 있으면 캔버스를 누른 것만 받는다(화면 창 · HUD 클릭 거르기)
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || aimStore.get() !== SPEAKER_AIM_ID || playerView.isThirdPerson) return;
      if (gate.current.hidden || gate.current.blocked) return;
      if (!document.pointerLockElement && !(event.target instanceof HTMLCanvasElement)) return;
      openMusic();
    };
    window.addEventListener(NAJU_ENTER_EVENT, onNaju);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener(NAJU_ENTER_EVENT, onNaju);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useFrame(({ clock }, delta) => {
    const g = gate.current;
    g.hidden = window.location.pathname === TRAIN_PATH || g.naju;
    g.blocked = g.cutscene || overlayLayer.get() !== null || getLockControl() !== null;
    if (rootRef.current) rootRef.current.visible = !g.hidden;
    const music = musicStore.get();
    if ((g.hidden || g.blocked) && music.mode !== "closed") closeMusic("system");

    // 연출 — 재생 중이면 0 → 1 로 스며들고, 멈추면 빠진다
    const target = music.playing && !g.hidden ? 1 : 0;
    amount.current += (target - amount.current) * (1 - Math.exp(-delta * 6));
    const a = amount.current;
    const b = beat(clock.elapsedTime) * a;
    wooferRef.current?.children.forEach((cone) => cone.scale.set(1 + 0.04 * b, 1 + 0.04 * b, 1 + 0.6 * b));
    if (bodyRef.current) bodyRef.current.scale.set(1 + 0.012 * b, 1 + 0.03 * b, 1 + 0.012 * b);
    ledRef.current?.color.set(a > 0.5 ? "#3dff8f" : "#3a2c2c");
    // ♪ 배지 — 늘 떠서 살짝 둥실(재생 중엔 음표가 더해진다). 가까우면 아래에 「음악 라디오」, 겨냥하면 빛남 + [E] 안내가 대신
    const bob = 0.035 * Math.sin(clock.elapsedTime * 2.2);
    const marker = markerRef.current;
    if (marker) {
      marker.position.y = MARKER_Y + bob;
      // 멀수록 크게 — 방 건너편(17칸)에서도 점 하나로 안 줄어들게, 코앞에선 라디오를 가리지 않게
      const eye = playerView.eye;
      const distance = playerView.ready ? Math.hypot(eye.x - SPOT.x, eye.z - SPOT.z) : 8;
      marker.scale.setScalar(THREE.MathUtils.clamp(distance * 0.04, 0.45, 0.85));
    }
    const label = labelRef.current;
    if (label) {
      const eye = playerView.eye;
      const [cx, cy, cz] = center();
      const near = playerView.ready && Math.hypot(eye.x - cx, eye.y - cy, eye.z - cz) < LABEL_NEAR;
      const show = near && aimStore.get() !== SPEAKER_AIM_ID && !g.blocked ? 1 : 0;
      label.material.opacity += (show - label.material.opacity) * (1 - Math.exp(-delta * 8));
      label.visible = label.material.opacity > 0.02;
      label.position.y = MARKER_Y - 0.42 + bob;
    }

    // 음표 — 위로 피어오르며 옆으로 흔들리다 사라진다
    spawnClock.current += delta;
    if (a > 0.5 && spawnClock.current >= NOTE_EVERY) {
      spawnClock.current = 0;
      const free = notes.find((note) => note.age >= NOTE_LIFE);
      if (free) {
        free.age = 0;
        free.drift = (Math.random() - 0.5) * 0.5;
        free.sprite.visible = true;
      }
    }
    for (const note of notes) {
      if (note.age >= NOTE_LIFE) continue;
      note.age += delta;
      const t = Math.min(1, note.age / NOTE_LIFE);
      // 좌우 스피커에서 번갈아 피어오른다
      note.sprite.position.set(
        Math.sign(note.drift) * CONE.x + note.drift * t + Math.sin(note.age * 3 + note.drift * 10) * 0.08,
        BODY.height + 0.1 + t * 1.2,
        BODY.depth * 0.4,
      );
      note.sprite.material.opacity = Math.min(1, t * 6) * (1 - t) ** 1.5;
      if (t >= 1) note.sprite.visible = false;
    }
  });

  return (
    <group ref={rootRef}>
      <MeasuredItem id="lobby-speaker" occupiesSpace baseY={SPOT.y}>
        <AimHighlight id={SPEAKER_AIM_ID} anchor={center} {...HIGHLIGHT}>
          <group position={[SPOT.x, SPOT.y, SPOT.z]} rotation={[0, SPOT.rot, 0]}>
            <group ref={bodyRef}>
              <SpeakerModel wooferRef={wooferRef} ledRef={ledRef} />
            </group>
          </group>
        </AimHighlight>
      </MeasuredItem>
      <group ref={notesRef} position={[SPOT.x, SPOT.y, SPOT.z]} rotation={[0, SPOT.rot, 0]}>
        {notes.map((note, i) => (
          <primitive key={i} object={note.sprite} />
        ))}
        <sprite ref={markerRef} position={[0, MARKER_Y, 0]} scale={0.5}>
          <spriteMaterial map={badge.marker} transparent depthWrite={false} />
        </sprite>
        <sprite ref={labelRef} position={[0, MARKER_Y - 0.42, 0]} scale={[1.1, 0.275, 1]} visible={false}>
          <spriteMaterial map={badge.label} transparent depthWrite={false} opacity={0} />
        </sprite>
      </group>
    </group>
  );
}

const toon = (color: string) => <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />;

/** 청록 몸통 · 좌우 둥근 스피커 · 가운데 카세트 · 위 손잡이 · 안테나 · 불빛. 밑면 가운데가 원점, 앞이 +Z */
function SpeakerModel({
  wooferRef,
  ledRef,
}: {
  wooferRef: RefObject<THREE.Group | null>;
  ledRef: RefObject<THREE.MeshBasicMaterial | null>;
}) {
  const front = BODY.depth / 2;
  const top = BODY.height;
  return (
    <>
      <RoundedBox
        args={[BODY.width, BODY.height, BODY.depth]}
        radius={0.07}
        smoothness={3}
        position={[0, BODY.height / 2, 0]}
      >
        {toon("#2f7f80")}
        <Outlines thickness={4} color="#131416" />
      </RoundedBox>
      {/* 좌우 스피커 — 크림 테두리 · 짙은 망 · 콘(들썩임) */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * CONE.x, CONE.y, front + 0.004]}>
          <mesh>
            <torusGeometry args={[CONE.radius, 0.028, 10, 40]} />
            {toon("#efe4c8")}
          </mesh>
          <mesh position={[0, 0, -0.002]}>
            <circleGeometry args={[CONE.radius - 0.01, 40]} />
            {toon("#1d2126")}
          </mesh>
        </group>
      ))}
      <group ref={wooferRef}>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * CONE.x, CONE.y, front + 0.004]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.022]}>
              <coneGeometry args={[CONE.radius - 0.05, 0.05, 36, 1, true]} />
              <meshToonMaterial color="#454a53" gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0, 0.002]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.5, 1]}>
              <sphereGeometry args={[0.055, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              {toon("#efe4c8")}
            </mesh>
          </group>
        ))}
      </group>
      {/* 가운데 카세트 — 크림 판 · 짙은 창 · 릴 둘 */}
      <group position={[0, 0.3, front + 0.004]}>
        <mesh>
          <boxGeometry args={[0.3, 0.2, 0.012]} />
          {toon("#e8dcc0")}
        </mesh>
        <mesh position={[0, 0.01, 0.008]}>
          <boxGeometry args={[0.21, 0.085, 0.006]} />
          {toon("#22262c")}
        </mesh>
        {[-0.055, 0.055].map((x) => (
          <mesh key={x} position={[x, 0.01, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.006, 16]} />
            {toon("#d9cfb5")}
          </mesh>
        ))}
      </group>
      {/* 위 단추 넷 · 불빛(재생 중 초록) */}
      {[-0.18, -0.06, 0.06, 0.18].map((x, i) => (
        <mesh key={x} position={[x, top + 0.015, front - 0.07]}>
          <boxGeometry args={[0.08, 0.03, 0.06]} />
          {toon(i === 0 ? "#c4473c" : "#cfd3d8")}
        </mesh>
      ))}
      <mesh position={[0, 0.47, front + 0.008]}>
        <sphereGeometry args={[0.02, 10, 8]} />
        <meshBasicMaterial ref={ledRef} color="#3a2c2c" />
      </mesh>
      {/* 손잡이 — 기둥 둘 · 가로대 */}
      {[-0.4, 0.4].map((x) => (
        <mesh key={x} position={[x, top + 0.07, 0]}>
          <boxGeometry args={[0.05, 0.14, 0.06]} />
          {toon("#b9bec6")}
        </mesh>
      ))}
      <mesh position={[0, top + 0.15, 0]}>
        <boxGeometry args={[0.86, 0.05, 0.07]} />
        {toon("#b9bec6")}
        <Outlines thickness={3} color="#131416" />
      </mesh>
      {/* 안테나 */}
      <group position={[BODY.width / 2 - 0.1, top, -0.08]} rotation={[0, 0, -0.42]}>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.008, 0.012, 0.6, 8]} />
          {toon("#c7ccd3")}
        </mesh>
        <mesh position={[0, 0.61, 0]}>
          <sphereGeometry args={[0.022, 10, 8]} />
          {toon("#c7ccd3")}
        </mesh>
      </group>
    </>
  );
}
