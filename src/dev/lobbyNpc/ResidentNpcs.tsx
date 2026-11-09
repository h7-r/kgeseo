// 로비 상주쌤 3명(미르 11/9~11/10) — 본부실에 서서 가끔 대사(말풍선)를 하고, 대사마다 꾸미기 창에서 고른 동작을 한다.
// 다른 사람처럼 걸어서 통과할 수 없다(걷기 판정의 사람 몸통). 로비가 켜진 화면(LobbyPreviewRig — 개발 미리보기 · 운영의
// VITE_LOBBY_URL 빌드)에 붙는다. 대사 · 동작은 각자 화면에서 따로 돈다(서버 방송 없음 — 사람마다 말하는 때가 다를 수 있다).
//
// 모델: public/models/residents/p1~p3.glb — 실존 인물(본인 동의, 미르 11/10)을 게임 화풍으로 그려 3D 로 만든 것.
//   뼈대(로비 치비와 같은 이름 23개) · 대기 동작(1번 짝다리 Idle_Contrapposto, 2·3번 Idle_Stand)이 들어 있다.
// 설정: src/dev/residentNpc/residentNpcs.json — 이름 · 대사 · 대사마다 동작 · 자리. 개발 서버(vite.lobby-preview.config.ts)의
//   꾸미기 창 http://localhost:5173/resident-npc.html 에서 저장하고 커밋한다(팀 캐릭터와 같은 방식).
// 자리 정하기: 개발 서버에서 주소에 ?상주쌤=자리 를 붙이면 왼쪽에 패널이 뜬다(배포 빌드에는 안 들어간다).
// 화풍: 로비 캐릭터와 같은 applyToon · applyOutline. TRELLIS 메시 주름에 테두리 빛 · 가장 밝은 계단이 하얗게 찍혀
//   쌤만 그 둘을 낮춘다(로비 공용 툰 코드는 그대로).
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";

import { IS_LOBBY_OUTLINE_DISABLED, IS_LOBBY_TOON_DISABLED } from "@/app/runtimeFlags";
import { PLAYER_RADIUS, UNITS_PER_METER } from "@/engine/movement/constants";
import { playerView } from "@/engine/playerView";
import { UI, UI_FONT } from "@/game/gameUi";
import { sharedAssetUrl } from "@/config/env";

import { type PersonBox, personBoxes } from "../lobbyPreview/personColliders";
import SpeechBubble from "../lobbyPreview/SpeechBubble";
import residentJson from "../residentNpc/residentNpcs.json";
import { parseResidentFile, type ResidentFile, type ResidentPlacement } from "../residentNpc/residentNpcFile";

import { useRiggedNpc } from "./RiggedNpc";

import { applyToon, DEFAULT_TOON } from "../../../naju01/src/avatar/toonMaterial";
import { applyOutline, DEFAULT_OUTLINE } from "../../../naju01/src/avatar/toonOutline";

interface NpcSpec {
  /** 패널에 보이는 번호 */
  label: string;
  /** 설정 파일의 쌤 키(p1·p2·p3) — 모델 파일 이름도 같다 */
  key: string;
  /** 발끝~머리끝 키(미터) */
  heightM: number;
  /** 머리 꼭대기~목이 키에서 차지하는 비율(그림에서 잰 값) — 얼굴 법선 눕히기 범위 */
  headFrac: number;
  /** 설정 파일에 자리가 없을 때 */
  x: number;
  z: number;
  rot: number;
  /** 툰 얼굴 구 중심을 머리 뒤로 물리는 양(키 대비) — 얼굴 앞쪽 위주로 눕힌다(검토 09·10회차) */
  faceBack: number;
  /** 얼굴 법선 눕히기 세기 */
  faceFlatten: number;
  /** 텍스처 전체 밝기 배율(기본 1) */
  albedo?: number;
}

/** 쌤 모델 주소 — 공용 에셋(CDN, 없으면 공개 폴더) */
const residentModelUrl = (key: string) => sharedAssetUrl(`/models/residents/${key}.glb`);

// 얼굴 명암: 구 중심을 머리 뒤로 + 눕히기 0.8 — 기본값이면 볼 · 턱이 어두운 띠로 갈렸다(미르 11/9 「얼굴색이 위아래가 다르다」)
const NPCS: readonly NpcSpec[] = [
  // 1번: 안경 · 곱슬머리 · 남색 재킷. 대기 = 짝다리(무릎 펴고 한쪽 다리로 버팀, 미르 11/9)
  { label: "1번", key: "p1", heightM: 1.5, headFrac: 0.254, x: -4.78, z: -7.65, rot: -0.556, faceBack: 0.3, faceFlatten: 0.8 },
  // 2번: 니트 · 하늘색 깃
  { label: "2번", key: "p2", heightM: 1.42, headFrac: 0.27, x: -3.63, z: 2.09, rot: 3.109, faceBack: 0.3, faceFlatten: 0.8 },
  // 3번: 라마 의인화 — 「너무 밝아 반짝반짝」(미르 11/9)이라 밝기 0.88
  { label: "3번", key: "p3", heightM: 1.62, headFrac: 0.246, x: -16.6, z: 9.0, rot: Math.PI, faceBack: 0.3, faceFlatten: 0.8, albedo: 0.88 },
];
const DEFAULT_PLACES: Record<string, ResidentPlacement> = Object.fromEntries(
  NPCS.map((spec) => [spec.key, { x: spec.x, z: spec.z, rot: spec.rot }]),
);

const NPC_RIM = 0.03;
const NPC_TOP = 0.8;
const gradientByTop = new Map<string, THREE.DataTexture>();
/** 로비 툰 계단 텍스처를 그대로 베끼되 가장 밝은 계단(255)만 top 으로 */
function npcGradient(base: THREE.Texture, top: number) {
  const key = `${base.uuid}:${top}`;
  const hit = gradientByTop.get(key);
  if (hit) return hit;
  const src = (base.image as { data: Uint8Array; width: number; height: number }).data;
  const data = Uint8Array.from(src, (v) => (v > 200 ? Math.round(255 * top) : v));
  const { width, height } = base.image as { width: number; height: number };
  const tex = new THREE.DataTexture(data, width, height, (base as THREE.DataTexture).format as THREE.PixelFormat);
  tex.minFilter = base.minFilter;
  tex.magFilter = base.magFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientByTop.set(key, tex);
  return tex;
}

/** 말풍선을 띄워 두는 시간 · 다음 대사까지 쉬는 시간(초) — 팀 NPC 처럼 가끔 말한다 */
const SAY_SECONDS = 5;
const QUIET_MIN = 6;
const QUIET_MAX = 14;

interface SayState {
  text: string;
  /** 그 대사의 동작 ID — "" = 무작위 인사(쌤은 고개 끄덕) */
  gesture: string;
  /** 몇 번째 말하기(같은 대사가 다시 와도 동작을 새로 튼다) */
  serial: number;
}

/** 개발 확인용: 콘솔에서 바로 말 시키기 — __npcDebug.say("p1", 0) 은 대사 1, say("p1", "q:Dance_Loop") 는 그 동작 */
const sayNow = new Map<string, (what: number | string) => void>();

/** 대사 순서 — 몇 초 띄웠다가 쉬고 다음 대사로(번갈아). 말풍선과 동작이 같이 시작하도록 Npc 가 들고 있는다 */
function useSpeech(key: string, lines: string[], gestures: string[], offset: number) {
  const [say, setSay] = useState<SayState | null>(null);
  const serialRef = useRef(0);
  useEffect(() => {
    let timer = 0;
    const quiet = () => (QUIET_MIN + Math.random() * (QUIET_MAX - QUIET_MIN)) * 1000;
    let i = lines.length ? offset % lines.length : 0;
    const show = (text: string, gesture: string, next: () => void) => {
      window.clearTimeout(timer);
      serialRef.current += 1;
      setSay({ text, gesture, serial: serialRef.current });
      timer = window.setTimeout(() => {
        setSay(null);
        timer = window.setTimeout(next, quiet());
      }, SAY_SECONDS * 1000);
    };
    const speak = () => {
      if (!lines.length) return;
      const k = i % lines.length;
      i += 1;
      show(lines[k] ?? "", gestures[k] ?? "", speak);
    };
    if (import.meta.env.DEV) {
      sayNow.set(key, (what) => {
        if (typeof what === "number") {
          const n = Math.max(1, lines.length);
          const k = ((what % n) + n) % n;
          show(lines[k] ?? "(대사 없음)", gestures[k] ?? "", speak);
        } else show(`(${what})`, what, speak);
      });
    }
    if (lines.length) timer = window.setTimeout(speak, 1000 + offset * 1500);
    return () => {
      window.clearTimeout(timer);
      sayNow.delete(key);
      setSay(null); // 대사가 바뀌면(개발 서버에서 저장) 떠 있던 말풍선을 내린다
    };
  }, [key, lines, gestures, offset]);
  return say;
}

/**
 * 머리 위 표시 — 플레이어 머리 위(RemotePlayers NameTag)와 같은 모양: 꼬리 달린 흰 말풍선 위, 어두운 이름표 아래.
 * 이름표 아래 끝을 머리 위 점에 고정하고 말풍선은 그 위로만 쌓는다 — 가운데 맞춤이면 말풍선이 생길 때마다 이름표가
 * 얼굴 쪽으로 내려왔다(미르 11/10).
 */
function NpcNameTag({ name, say, height }: { name: string; say: string | null; height: number }) {
  if (!name && !say) return null;
  return (
    <Html position={[0, height * 1.04, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div style={tagStack}>
        {say && <SpeechBubble text={say} />}
        {name && <div style={nameTag}>{name}</div>}
      </div>
    </Html>
  );
}

/**
 * 쌤 몸통 = 다른 사람 몸통(personBoxes) — 내 걷기에서 통과하지 못한다(미르 11/10). 플레이어 몸통(RemotePlayers)과 같은 규칙:
 * 걷기 판정에만 쓰고, 상자 가장자리를 내가 지금 선 자리보다 안쪽으로 두지 않는다(내 발밑에 놓여도 갇히지 않게).
 * 반폭은 모델 가로 반폭(팔 포함)의 NPC_BODY_FRAC 배. 출구 3초 밀고 통과 예외는 없다 — 자리를 정할 때 출구를 피한다.
 */
const NPC_BODY_FRAC = 0.7;
const NPC_MIN_HALF = 0.05;
function usePersonBox(key: string, root: THREE.Object3D, place: ResidentPlacement, scale: number) {
  const rawHalf = useMemo(() => {
    let half = 0;
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox!;
      half = Math.max(half, -b.min.x, b.max.x, -b.min.z, b.max.z);
    });
    return half;
  }, [root]);
  const id = `resident:${key}`;
  const body = useRef<PersonBox>({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  useEffect(
    () => () => {
      if (personBoxes.get(id) === body.current) personBoxes.delete(id);
    },
    [id],
  );
  useFrame(() => {
    const full = rawHalf * scale * NPC_BODY_FRAC;
    const reach = playerView.ready
      ? Math.max(Math.abs(playerView.eye.x - place.x), Math.abs(playerView.eye.z - place.z)) - PLAYER_RADIUS - 1e-4
      : full;
    const half = Math.min(full, reach);
    const box = body.current;
    if (half < NPC_MIN_HALF) {
      if (personBoxes.get(id) === box) personBoxes.delete(id);
      return;
    }
    box.minX = place.x - half;
    box.maxX = place.x + half;
    box.minZ = place.z - half;
    box.maxZ = place.z + half;
    if (personBoxes.get(id) !== box) personBoxes.set(id, box);
  });
}

interface NpcProps {
  spec: NpcSpec;
  place: ResidentPlacement;
  name: string;
  lines: string[];
  gestures: string[];
  offset: number;
  selected: boolean;
}

function ResidentNpc({ spec, place, name, lines, gestures, offset, selected }: NpcProps) {
  const say = useSpeech(spec.key, lines, gestures, offset);
  const { root, rawHeight, footY } = useRiggedNpc({
    url: residentModelUrl(spec.key),
    headFrac: spec.headFrac,
    faceBack: spec.faceBack,
    say,
  });
  useEffect(() => {
    if (IS_LOBBY_TOON_DISABLED) return;
    // 한 메시라 부위를 못 나눈다 — "body" 로 두어야 얼굴 법선 눕히기(_faceFlatten)가 켜진다
    const handle = applyToon(root, () => "body", { ...DEFAULT_TOON, faceFlatten: spec.faceFlatten });
    root.traverse((o) => {
      const want = o.userData.npcHeadCentre as THREE.Vector3 | undefined;
      if (!want || !(o instanceof THREE.Mesh)) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        const u = m.userData.toonUniforms as
          | { _headCentre?: THREE.IUniform<THREE.Vector3>; _rimStrength?: THREE.IUniform<number> }
          | undefined;
        if (u?._headCentre) u._headCentre.value = want.clone(); // 재질마다 따로(applyToon 은 한 벡터를 모든 재질이 공유) — 10회차
        if (u?._rimStrength) u._rimStrength.value = NPC_RIM;
        const toon = m as THREE.MeshToonMaterial;
        if (toon.gradientMap) toon.gradientMap = npcGradient(toon.gradientMap, NPC_TOP);
        // applyToon 이 적용할 때마다 새 재질을 만들므로 한 번만 곱해진다(15회차)
        if (spec.albedo !== undefined && toon.color) toon.color.multiplyScalar(spec.albedo);
        toon.needsUpdate = true;
      });
    });
    return () => handle.restore();
  }, [root, spec.faceFlatten, spec.albedo]);
  useEffect(() => {
    if (IS_LOBBY_OUTLINE_DISABLED) return;
    const handle = applyOutline(root, DEFAULT_OUTLINE, () => "body");
    return () => handle.remove();
  }, [root]);
  const scale = (spec.heightM * UNITS_PER_METER) / rawHeight;
  const height = spec.heightM * UNITS_PER_METER;
  usePersonBox(spec.key, root, place, scale);
  return (
    <group name={`resident-${spec.key}`} position={[place.x, 0, place.z]} rotation={[0, place.rot, 0]}>
      <primitive object={root} scale={scale} position={[0, -footY * scale, 0]} />
      {/* 자리 정하기 중 고른 쌤 발밑 고리 */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[height * 0.22, height * 0.27, 40]} />
          <meshBasicMaterial color="#86a6f0" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}
      <NpcNameTag name={name} say={say?.text ?? null} height={height} />
    </group>
  );
}

/** 모델 하나를 못 불러와도(네트워크 · 파일 없음) 로비 전체가 멈추지 않게 그 쌤만 뺀다 */
class NpcBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn("[상주쌤] 모델을 그리지 못해 뺐다", error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 대사 · 동작 목록 — 설정이 다시 읽혀도(개발 서버 HMR) 내용이 같으면 같은 배열(말풍선 순서가 처음으로 돌아가지 않게) */
const speechCache = new Map<string, { lines: string[]; gestures: string[] }>();
function speechOf(entry: { lines: string[]; lineGestures: string[] } | undefined) {
  const lines = entry?.lines ?? [];
  const gestures = entry?.lineGestures ?? [];
  const key = `${lines.join("\n")}\u0000${gestures.join("\n")}`;
  const hit = speechCache.get(key);
  if (hit) return hit;
  const value = { lines, gestures };
  speechCache.set(key, value);
  return value;
}

const RESIDENT_FILE: ResidentFile = parseResidentFile(residentJson);
/** 개발 서버에서 ?상주쌤=자리 — 자리 정하기 패널(배포 빌드에서는 import.meta.env.DEV 가 false 라 빠진다) */
const PLACING = import.meta.env.DEV && new URLSearchParams(location.search).get("상주쌤") === "자리";

export default function ResidentNpcs() {
  const file = RESIDENT_FILE;
  const [places, setPlaces] = useState<Record<string, ResidentPlacement>>(() => ({ ...DEFAULT_PLACES, ...file.placements }));
  const [selected, setSelected] = useState(NPCS[0]!.key);
  return (
    <>
      {NPCS.map((spec, i) => {
        const entry = file.npcs[spec.key];
        return (
          <NpcBoundary key={spec.key}>
            <Suspense fallback={null}>
              <ResidentNpc
                spec={spec}
                place={places[spec.key] ?? DEFAULT_PLACES[spec.key]!}
                name={entry?.displayName ?? ""}
                {...speechOf(entry)}
                offset={i}
                selected={PLACING && selected === spec.key}
              />
            </Suspense>
          </NpcBoundary>
        );
      })}
      {import.meta.env.DEV && <ResidentDebug />}
      {PLACING && (
        <PlacementTool
          file={file}
          places={places}
          setPlaces={setPlaces}
          selected={selected}
          setSelected={setSelected}
        />
      )}
    </>
  );
}

/** 개발 확인용: 콘솔에서 장면 · 카메라 · 말 시키기 · 몸통 상자 */
function ResidentDebug() {
  const { scene, camera, gl } = useThree();
  useEffect(() => {
    (window as unknown as { __npcDebug?: unknown }).__npcDebug = {
      scene,
      camera,
      gl,
      say: (key: string, what: number | string) => sayNow.get(key)?.(what),
      boxes: personBoxes,
    };
  }, [scene, camera, gl]);
  return null;
}

const ROUTE = "/__dev/resident-npcs";

/** 「상주쌤 자리 정하기」(개발 서버 전용) — 쌤을 고르고 내 발밑 · 화면 가운데 점이 보는 바닥에 놓고 돌린 뒤 저장 */
function PlacementTool({
  file,
  places,
  setPlaces,
  selected,
  setSelected,
}: {
  file: ResidentFile;
  places: Record<string, ResidentPlacement>;
  setPlaces: (next: Record<string, ResidentPlacement>) => void;
  selected: string;
  setSelected: (key: string) => void;
}) {
  const { scene, camera } = useThree();
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const move = useCallback(
    (key: string, next: ResidentPlacement) => {
      if (savingRef.current) return; // 저장 중에는 옮기지 않는다 — 저장이 옛 자리를 쓰고 새 변경을 지우지 않게(21회차)
      setPlaces({ ...places, [key]: next });
      setStatus("바뀐 자리가 있어요 — 「세 쌤 자리 저장」을 눌러 주세요.");
    },
    [places, setPlaces],
  );
  /** 놓은 쌤이 카메라 쪽을 보게 */
  const facingCamera = useCallback(
    (x: number, z: number) => Math.atan2(camera.position.x - x, camera.position.z - z),
    [camera],
  );
  /** 내 캐릭터(NAJU-chibi-avatar, 다른 사람 아바타 묶음 밖) 발밑에 놓는다 */
  const placeAtMe = useCallback(() => {
    let me: THREE.Object3D | undefined;
    scene.traverse((o) => {
      if (me || o.name !== "NAJU-chibi-avatar") return;
      for (let p = o.parent; p; p = p.parent) if (p.name === "lobby-remote-players") return;
      me = o;
    });
    if (!me) {
      setStatus("내 캐릭터를 못 찾았어요 — 본부실 안에서 눌러 주세요.");
      return;
    }
    const at = me.getWorldPosition(new THREE.Vector3());
    move(selected, { x: at.x, z: at.z, rot: facingCamera(at.x, at.z) });
  }, [facingCamera, move, scene, selected]);
  /** 화면 가운데(조준점)가 처음 맞는 면이 바닥(위를 보는 면 · 높이 0 근처)일 때만 — 벽 너머 · 가구 위에 놓이지 않게(21회차) */
  const placeAtAim = useCallback(() => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const skip = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent)
        if (p.name.startsWith("resident-") || p.name === "NAJU-chibi-avatar") return true;
      return false;
    };
    const hit = ray.intersectObjects(scene.children, true).find((h) => !skip(h.object) && (h.object as THREE.Mesh).isMesh);
    const up = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y : 0;
    if (!hit || up < 0.6 || Math.abs(hit.point.y) > 0.3) {
      setStatus("화면 가운데 점이 바닥을 가리킬 때 눌러 주세요(지금은 벽 · 가구를 보고 있어요).");
      return;
    }
    move(selected, { x: hit.point.x, z: hit.point.z, rot: facingCamera(hit.point.x, hit.point.z) });
  }, [camera, facingCamera, move, scene, selected]);
  const rotate = useCallback(
    (deg: number) => {
      const cur = places[selected] ?? DEFAULT_PLACES[selected]!;
      const r = cur.rot + (deg * Math.PI) / 180;
      move(selected, { ...cur, rot: Math.atan2(Math.sin(r), Math.cos(r)) });
    },
    [move, places, selected],
  );
  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setStatus("저장 중…");
    try {
      // 세 쌤을 한 번에 — 일부만 저장되지 않게(21회차)
      const r = await fetch(ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placements: places }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const saved = parseResidentFile(await r.json());
      setPlaces({ ...DEFAULT_PLACES, ...saved.placements });
      setStatus("저장했어요 — src/dev/residentNpc/residentNpcs.json 을 커밋하면 모두에게 반영돼요.");
    } catch (error) {
      setStatus(`저장하지 못했어요(${(error as Error).message}) — 로비 미리보기 개발 서버(5173)인지 확인.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [places, setPlaces]);

  const place = places[selected];
  return (
    // Html(fullscreen)은 장면 원점의 화면 위치를 따라가 패널이 화면 밖으로 나갔다 → Html 안에서 body 로 띄운다(화면 고정)
    <Html>
      {createPortal(
        <fieldset disabled={saving} style={panel} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <div style={panelTitle}>상주쌤 자리 정하기</div>
          <div style={panelRow}>
            {NPCS.map((spec) => (
              <button
                key={spec.key}
                type="button"
                onClick={() => setSelected(spec.key)}
                style={{ ...panelButton, ...(selected === spec.key ? panelButtonOn : null) }}
              >
                {spec.label}
                {file.npcs[spec.key]?.displayName ? ` ${file.npcs[spec.key]!.displayName}` : ""}
              </button>
            ))}
          </div>
          <button type="button" onClick={placeAtMe} style={{ ...panelButton, ...panelWide }}>
            내 캐릭터 자리에 놓기(걸어가서 누르기)
          </button>
          <button type="button" onClick={placeAtAim} style={{ ...panelButton, ...panelWide }}>
            화면 가운데 점이 보는 바닥에 놓기
          </button>
          <div style={panelRow}>
            <button type="button" onClick={() => rotate(15)} style={panelButton}>
              ↺ 15°
            </button>
            <button type="button" onClick={() => rotate(-15)} style={panelButton}>
              ↻ 15°
            </button>
            <button type="button" onClick={() => rotate(180)} style={panelButton}>
              뒤로 돌기
            </button>
          </div>
          <button type="button" onClick={() => void save()} style={{ ...panelButton, ...panelWide, ...panelSave }}>
            세 쌤 자리 저장
          </button>
          <div style={panelInfo}>
            {place ? `x ${place.x.toFixed(1)} · z ${place.z.toFixed(1)} · ${Math.round((place.rot * 180) / Math.PI)}°` : ""}
          </div>
          {status && <div style={panelStatus}>{status}</div>}
        </fieldset>,
        document.body,
      )}
    </Html>
  );
}

/** 머리 위 점과 이름표 아래 끝 사이(화면 픽셀) */
const TAG_GAP_PX = 6;
/** 아래 가운데를 기준점에 — 말풍선이 생겨도 이름표 자리는 그대로, 말풍선만 위로 */
const tagStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  transform: `translate(-50%, calc(-100% - ${TAG_GAP_PX}px))`,
};
/** 플레이어 이름표(RemotePlayers NameTag)와 같은 값 */
const nameTag: CSSProperties = {
  background: "rgba(16,18,22,0.72)",
  color: "#e8e8e8",
  padding: "2px 8px",
  borderRadius: 8,
  font: "12px system-ui, sans-serif",
  whiteSpace: "nowrap",
};
const panel: CSSProperties = {
  margin: 0,
  minWidth: 0,
  position: "fixed",
  zIndex: 60,
  top: 72,
  left: 14,
  width: 268,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderRadius: 14,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  color: UI.text,
  fontFamily: UI_FONT.body,
  pointerEvents: "auto",
};
const panelTitle: CSSProperties = { font: `700 15px/1.3 ${UI_FONT.title}` };
const panelRow: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const panelButton: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 40,
  padding: "0 10px",
  borderRadius: 10,
  border: `1px solid ${UI.border}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: "inherit",
  fontSize: 13,
  cursor: "pointer",
};
const panelButtonOn: CSSProperties = { borderColor: UI.accent, color: UI.accent, fontWeight: 700 };
const panelWide: CSSProperties = { width: "100%" };
const panelSave: CSSProperties = { borderColor: UI.borderStrong, fontWeight: 700 };
const panelInfo: CSSProperties = { color: UI.textSubtle, fontSize: 12, fontVariantNumeric: "tabular-nums" };
const panelStatus: CSSProperties = { color: UI.accent, fontSize: 12, lineHeight: 1.4 };
