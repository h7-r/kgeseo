// [E] 인스턴스 편집기 — 화면에서 흩뿌린 물건 하나를 집어 고친다.
// 만질 수 있는 것은 instanceGroups 로 심은 인스턴스뿐이다. 지형·절벽·통로는 도면 숫자가 정하고,
// 마우스로 주무르면 그림과 걷는 판정이 갈라진다(이 프로젝트가 가장 오래 싸운 버그).
//
// 조작: 클릭 고르기 · 드래그 옮기기(4 px 넘게) · 우클릭 드래그 시점 · , . 시점 돌리기(Shift 3 배)
//   WASD 걷기 · 방향키 미세 이동(0.25 m, Shift 1 m) · Ctrl+C/V · R/Shift+R 15° · [ ] 크기 ±10 %
//   Delete/X 지우기 · Ctrl+Z 되돌리기 · Ctrl+S 저장 · ESC 해제 · Tab 부감(휠 돌리기, 핀치/⌘+휠 높낮이)
// 편집만 파일에 남겨 팀원 화면에서도 같은 배치가 나오게 한다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MESH_NAMES } from "../plan/meshNames";
import { CORE, METERS_PER_UNIT, UNITS_PER_METER } from "../plan/sitePlan";
import { ASSET_CATALOG, ASSET_CATEGORIES, assetPrototype, findAsset } from "./assetCatalog";
import { canSaveEdits, saveEdits } from "./editFile";
import {
  addInstances,
  countEdits,
  modifyInstance,
  removeInstances,
  type Edits,
  type SpotPatch,
} from "./instanceGroups";
import { bakeThumbnail } from "./thumbnails";

const ROTATION_STEP = Math.PI / 12; // 15°
// 광선이 「땅」으로 받아 주는 메시. 무대 밖에 놓으려면 원경 들판도 맞혀야 한다.
const GROUND_MESHES: string[] = [
  MESH_NAMES.ground,
  MESH_NAMES.path,
  MESH_NAMES.slope,
  MESH_NAMES.cliffFace,
  MESH_NAMES.cliffBoulders,
  MESH_NAMES.zoneSides,
  MESH_NAMES.distantFields,
  MESH_NAMES.distantFarFields,
];
// 여기 맞았으면 그 점의 높이를 그대로 쓴다 — 코어 밖은 지표가 값을 안 갖고 있어 원경 나무가 땅에 박힌다
const OUTER_GROUND = new Set<string>([MESH_NAMES.distantFields, MESH_NAMES.distantFarFields]);

// 못 고르는 것을 눌렀을 때 이유를 말해 준다. 조용하면 편집기가 고장 난 줄 안다.
const UNPICKABLE: Record<string, string> = {
  [MESH_NAMES.blockerRock]: "차단물 바위 — 도면 §4 가 시야를 막으려고 세운 것이다. 옮기면 V3 에서 사건 현장이 보인다",
  [MESH_NAMES.zoneSides]: "구역 옆구리 — 대지를 깎은 면이다. 걷는 높이와 한 몸이라 못 옮긴다",
  [MESH_NAMES.ground]: "땅 — 걷는 바닥 그 자체다",
  [MESH_NAMES.path]: "길 바닥 — 도면이 정한 통로다(T1~T4 길이·경사가 여기에 걸려 있다)",
  [MESH_NAMES.slope]: "길을 받치는 흙비탈 — 길 바닥과 한 몸이다",
  [MESH_NAMES.cliffFace]: "절벽면 — 도면이 정한 벼랑이다",
  [MESH_NAMES.grass]: "풀 — 한 장으로 합쳐 그린다(11만 삼각형이라 하나씩 나누면 느려진다)",
};
// 하늘·물·원경은 눌러도 알릴 것이 없다
const SILENT_MESHES = /^(river|sky|distant)/;
const NUDGE_STEP = 0.25; // m — Shift 를 누르면 4 배

// 부감 — 걸으면서 배치하면 전체가 안 보여 한쪽으로 쏠린 걸 뒤늦게 안다
const OVERVIEW = {
  height: 22, // m
  heightRange: [4, 90] as const,
  pitch: -1.05, // ≈ -60°. 수직이면 방향 감각이 사라진다
  panSpeed: 14, // m/s, Shift 3 배
};

// 무대 밖 원경(코어에서 사방 250 m)까지만 연다 — 끝없이 두면 1 km 밖으로 밀려 돌아올 길을 잃는다
const EDIT_BOUNDS = {
  x: [CORE.x[0] - 250, CORE.x[1] + 250],
  z: [CORE.z[0] - 250, CORE.z[1] + 250],
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// 긴 프레임 한 번에 시점이 다섯 바퀴 돈 적이 있다 — dt 를 50 ms 로 물린다
const clampDelta = (dt: number) => Math.min(dt, 0.05);

const tempForward = new THREE.Vector3();
const tempSide = new THREE.Vector3();
const tempPivot = new THREE.Vector3();
const tempColor = new THREE.Color();

/**
 * 부감 시점 돌리기. 제자리에서 고개만 돌리면 보던 땅이 큰 원을 그리며 휩쓸려 「이동」으로 보인다 —
 * 지도 앱처럼 화면 한복판이 내려다보는 땅 지점을 축으로 카메라째 돈다.
 */
function orbitView(camera: THREE.Camera, delta: number, groundY: number) {
  camera.rotation.order = "YXZ";
  const yaw = camera.rotation.y;
  const heightM = camera.position.y * METERS_PER_UNIT - groundY;
  // 수평에 가까우면 축이 무한히 멀어진다 — 0.15 rad 아래로는 안 내려간다
  const pitch = Math.max(0.15, -camera.rotation.x);
  const aheadM = Math.min(400, heightM / Math.tan(pitch));
  tempPivot.set(
    camera.position.x - Math.sin(yaw) * aheadM * UNITS_PER_METER,
    camera.position.y,
    camera.position.z - Math.cos(yaw) * aheadM * UNITS_PER_METER,
  );
  const dx = camera.position.x - tempPivot.x;
  const dz = camera.position.z - tempPivot.z;
  const c = Math.cos(delta),
    s = Math.sin(delta);
  camera.position.x = tempPivot.x + dx * c - dz * s;
  camera.position.z = tempPivot.z + dx * s + dz * c;
  camera.rotation.y = yaw + delta;
}

// 화면 위가 앞이다. 월드 축으로 밀면 시점을 돌린 뒤 방향이 어긋난다.
function panView(camera: THREE.Camera, sideM: number, aheadM: number) {
  camera.getWorldDirection(tempForward);
  tempForward.y = 0;
  if (tempForward.lengthSq() < 1e-9) tempForward.set(0, 0, -1);
  tempForward.normalize();
  tempSide.crossVectors(tempForward, camera.up).normalize();
  const x = camera.position.x * METERS_PER_UNIT + tempForward.x * aheadM + tempSide.x * sideM;
  const z = camera.position.z * METERS_PER_UNIT + tempForward.z * aheadM + tempSide.z * sideM;
  camera.position.x = clamp(x, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]) * UNITS_PER_METER;
  camera.position.z = clamp(z, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]) * UNITS_PER_METER;
}

// instanceColor 는 선형 값이다. getHex() 가 sRGB 로 돌려주므로 color.set(hex) 로 다시 읽으면 같은 값이 된다.
function instanceColorHex(mesh: THREE.InstancedMesh, i: number | undefined) {
  const colors = mesh.instanceColor;
  if (!colors || i === undefined || i >= colors.count) return null;
  return tempColor.fromArray(colors.array, i * 3).getHex();
}

type Vec3Tuple = [number, number, number];

interface Selection {
  groupId: string;
  id: number;
  x: number;
  y: number;
  z: number;
  size: number;
  rotation: number;
  tilt: number;
  tilt2: number;
  widthRatio: number;
  depthRatio: number;
  shapeIndex?: number;
  color?: number;
  /** 유닛 단위 국소 상자(모양 기준, 인스턴스 크기를 곱한 것) */
  box?: { size: Vec3Tuple; center: Vec3Tuple };
}

interface EditorProps {
  enabled: boolean;
  edits: Edits;
  setEdits: Dispatch<SetStateAction<Edits>>;
  /** 코어 지표 높이(m). 무대 밖은 값이 없다. */
  groundHeightAt?: ((x: number, z: number) => number) | null;
  /** 포인터락을 풀어야 마우스로 집는다 */
  unlockPointer?: () => void;
  overview: boolean;
  setOverview?: Dispatch<SetStateAction<boolean>>;
}

export default function Editor({
  enabled,
  edits,
  setEdits,
  groundHeightAt,
  unlockPointer,
  overview,
  setOverview,
}: EditorProps) {
  const { camera, scene, gl } = useThree();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const undoStack = useRef<Edits[]>([]);
  const editsRef = useRef(edits);
  const clipboard = useRef<Selection | null>(null);
  // 붓 — 팔레트에서 고른 물건. 들려 있으면 클릭이 고르기가 아니라 놓기다.
  const [brush, setBrush] = useState<string | null>(null);
  const brushRef = useRef<string | null>(null);
  // 「먹힌 건지 안 먹힌 건지」가 보이게 저장 상태를 따로 든다
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [canSave, setCanSave] = useState<boolean | null>(null);
  const fingerprint = JSON.stringify(edits);
  const hasUnsaved = countEdits(edits) > 0 && fingerprint !== savedFingerprint;

  useEffect(() => {
    if (!enabled) return;
    canSaveEdits().then(setCanSave);
  }, [enabled]);

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveEdits(editsRef.current);
      setSavedFingerprint(JSON.stringify(editsRef.current));
      setNotice("저장했다 → assets/edits.json");
      setCanSave(true);
    } catch (error) {
      setNotice("✘ " + (error as Error).message);
      setCanSave(false);
    } finally {
      setIsSaving(false);
    }
  }, []);
  const raycaster = useRef(new THREE.Raycaster());
  const pointer = useRef(new THREE.Vector2());

  const aimAt = useCallback(
    (ev: { clientX: number; clientY: number }) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer.current, camera);
    },
    [camera, gl],
  );

  // 마우스 아래의 인스턴스
  const pick = useCallback(
    (ev: PointerEvent): Selection | null => {
      aimAt(ev);
      for (const hit of raycaster.current.intersectObjects(scene.children, true)) {
        const mesh = hit.object as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || hit.instanceId === undefined) continue;
        const groupId = mesh.userData?.groupId as string | undefined;
        const ids = mesh.userData?.ids as Int32Array | undefined;
        if (!groupId || !ids) continue;
        const id = ids[hit.instanceId];
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(hit.instanceId, matrix);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, quaternion, scale);
        // 테두리는 그 모양의 진짜 바운딩 박스로 — 키를 세 축에 다 쓰면 폭 1.5 m 나무를 세 배 넘게 감싼다
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        // 복사가 그 물건 그대로(색·납작함·기울기)를 물려받게 여기서 다 캐낸다.
        // 키는 높이 그대로 두고 가로·세로는 키에 대한 비로 넘긴다.
        const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");
        const color = instanceColorHex(mesh, hit.instanceId);
        return {
          groupId,
          id,
          x: position.x * METERS_PER_UNIT,
          y: position.y * METERS_PER_UNIT,
          z: position.z * METERS_PER_UNIT,
          size: scale.y * METERS_PER_UNIT,
          rotation: euler.y,
          tilt: euler.x,
          tilt2: euler.z,
          widthRatio: scale.y > 1e-9 ? scale.x / scale.y : 1,
          depthRatio: scale.y > 1e-9 ? scale.z / scale.y : 1,
          shapeIndex: mesh.userData?.shapeIndex as number | undefined,
          ...(color !== null ? { color } : null),
          box: {
            size: [(bb.max.x - bb.min.x) * scale.x, (bb.max.y - bb.min.y) * scale.y, (bb.max.z - bb.min.z) * scale.z],
            center: [
              ((bb.max.x + bb.min.x) / 2) * scale.x,
              ((bb.max.y + bb.min.y) / 2) * scale.y,
              ((bb.max.z + bb.min.z) / 2) * scale.z,
            ],
          },
        };
      }
      return null;
    },
    [aimAt, scene],
  );

  // 그 자리의 바닥 높이. 코어 지표는 무대 밖에서 0 을 내서 원경 집이 2.5 m 튀어 올랐다 —
  // 밖에서는 원경 지면에 광선을 내리고, 못 맞히면 원래 높이를 둔다.
  const down = useRef(new THREE.Vector3(0, -1, 0));
  const floorHeight = useCallback(
    (x: number, z: number, fallback = 0) => {
      if (x >= CORE.x[0] && x <= CORE.x[1] && z >= CORE.z[0] && z <= CORE.z[1])
        return groundHeightAt ? groundHeightAt(x, z) : fallback;
      raycaster.current.set(
        new THREE.Vector3(x * UNITS_PER_METER, 400 * UNITS_PER_METER, z * UNITS_PER_METER),
        down.current,
      );
      raycaster.current.far = Infinity;
      const hits = raycaster.current
        .intersectObjects(scene.children, true)
        .filter((h) => GROUND_MESHES.includes(h.object.name));
      return hits.length ? hits[0].point.y * METERS_PER_UNIT : fallback;
    },
    [groundHeightAt, scene],
  );

  // 빈 하늘을 누른 것과 「옮길 수 없는 것」을 누른 것을 구별해 알린다
  const describeMiss = useCallback(
    (ev: PointerEvent) => {
      aimAt(ev);
      for (const hit of raycaster.current.intersectObjects(scene.children, true)) {
        const name = hit.object?.name;
        if (!hit.object?.visible || !name || SILENT_MESHES.test(name)) continue;
        const reason = UNPICKABLE[name];
        return reason ? `못 옮기는 것이다 — ${reason}` : `못 옮기는 것이다 — 「${name}」 (독립 요소가 아니다)`;
      }
      return "";
    },
    [aimAt, scene],
  );

  const floorHeightRef = useRef(floorHeight);
  const describeMissRef = useRef(describeMiss);
  const overviewRef = useRef(overview);
  const selectedRef = useRef<Selection | null>(null);
  const groundHeightRef = useRef(groundHeightAt);
  const pressedKeys = useRef(new Set<string>());
  const panDrag = useRef<{ x: number; y: number } | null>(null); // 가운데 버튼 끌기
  const drag = useRef<{ start: [number, number]; moved: boolean } | null>(null);
  const orbitDrag = useRef<{ x: number; y: number } | null>(null); // 오른쪽 버튼

  // 리스너는 한 번만 붙이고(렌더마다 다시 붙으면 드래그가 끊긴다) 최신 값은 ref 로 본다
  useLayoutEffect(() => {
    editsRef.current = edits;
    brushRef.current = brush;
    floorHeightRef.current = floorHeight;
    describeMissRef.current = describeMiss;
    overviewRef.current = overview;
    selectedRef.current = selected;
    groundHeightRef.current = groundHeightAt;
  });

  // 부감에 들어갈 때 띄우고 나올 때 곧바로 내려놓는다 — 걷기 훅에 맡기면 22 m 에서 떨어져
  // 낙하복귀가 사람을 마지막 안전 지점으로 보낸다
  useEffect(() => {
    if (!enabled) return;
    const groundY = () =>
      groundHeightAt ? groundHeightAt(camera.position.x * METERS_PER_UNIT, camera.position.z * METERS_PER_UNIT) : 0;
    camera.rotation.order = "YXZ";
    if (overview) {
      camera.position.y = (groundY() + OVERVIEW.height) * UNITS_PER_METER;
      camera.rotation.x = OVERVIEW.pitch;
      camera.rotation.z = 0;
      return;
    }
    // 높이는 걷기 훅이 그 자리에서 잡는다 — 고개만 수평으로
    camera.rotation.x = 0;
    camera.rotation.z = 0;
  }, [enabled, overview, camera, groundHeightAt]);

  // 부감 밀기 — 키는 모아 두고 매 프레임 민다(키다운마다 옮기면 프레임률에 따라 빠르기가 달라진다)
  useFrame((_, rawDelta) => {
    if (!enabled || !overviewRef.current) return;
    const dt = clampDelta(rawDelta);
    const keys = pressedKeys.current;
    // 고른 것이 있으면 방향키는 그 물건을 민다 — WASD 로는 여전히 화면을 밀어 따라간다
    const arrowsPan = !selectedRef.current;
    const ahead =
      (keys.has("KeyW") ? 1 : 0) -
      (keys.has("KeyS") ? 1 : 0) +
      (arrowsPan ? (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0) : 0);
    const side =
      (keys.has("KeyD") ? 1 : 0) -
      (keys.has("KeyA") ? 1 : 0) +
      (arrowsPan ? (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0) : 0);
    if (!ahead && !side) return;
    const speed = OVERVIEW.panSpeed * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1);
    panView(camera, side * speed * dt, ahead * speed * dt);
  });

  // , . 시점 돌리기 — 맥 트랙패드엔 오른쪽 버튼이 없다. 걸을 때도 같은 키로 돈다.
  useFrame((_, rawDelta) => {
    if (!enabled) return;
    const dt = clampDelta(rawDelta);
    const keys = pressedKeys.current;
    const turn = (keys.has("Period") ? 1 : 0) - (keys.has("Comma") ? 1 : 0);
    if (!turn) return;
    const speed = 0.9 * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1);
    const groundY = groundHeightRef.current
      ? groundHeightRef.current(camera.position.x * METERS_PER_UNIT, camera.position.z * METERS_PER_UNIT)
      : 0;
    orbitView(camera, -turn * speed * dt, groundY);
  });

  // 마우스 — 고르기 · 끌기 · 놓기 · 시점
  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    const plane = new THREE.Plane();
    const planeHit = new THREE.Vector3();

    // 커서 아래 땅 자리 [x, z, 원경이면 그 높이]. 못 맞히면 지금 높이의 수평면으로 받는다 —
    // 언덕 위에서 수평으로 보면 광선이 코어를 넘어 날아간다.
    const groundUnderCursor = (ev: PointerEvent, baseY: number): [number, number, number | null] | null => {
      aimAt(ev);
      const hits = raycaster.current
        .intersectObjects(scene.children, true)
        .filter((h) => GROUND_MESHES.includes(h.object.name));
      let x: number;
      let z: number;
      let hitY: number | null = null;
      if (hits.length) {
        x = hits[0].point.x * METERS_PER_UNIT;
        z = hits[0].point.z * METERS_PER_UNIT;
        if (OUTER_GROUND.has(hits[0].object.name)) hitY = hits[0].point.y * METERS_PER_UNIT;
      } else {
        plane.set(new THREE.Vector3(0, 1, 0), -baseY * UNITS_PER_METER);
        if (!raycaster.current.ray.intersectPlane(plane, planeHit)) return null;
        x = planeHit.x * METERS_PER_UNIT;
        z = planeHit.z * METERS_PER_UNIT;
      }
      // 면 교점은 수백 m 밖까지 간다
      return [clamp(x, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]), clamp(z, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]), hitY];
    };

    const handlePointerDown = (ev: PointerEvent) => {
      if (ev.button === 2) {
        orbitDrag.current = { x: ev.clientX, y: ev.clientY };
        canvas.setPointerCapture?.(ev.pointerId);
        ev.preventDefault();
        return;
      }
      // 가운데 버튼 = 부감에서 지도를 끌어 옮기는 손짓
      if (ev.button === 1) {
        panDrag.current = { x: ev.clientX, y: ev.clientY };
        canvas.setPointerCapture?.(ev.pointerId);
        ev.preventDefault();
        return;
      }
      if (ev.button !== 0) return;
      // 붓이 들려 있으면 놓는다. 이어 놓을 수 있게 붓은 그대로 든다(ESC 로 내려놓는다).
      const brushKey = brushRef.current;
      if (brushKey) {
        const spot = groundUnderCursor(ev, 0);
        if (!spot) return;
        const [x, z, outerY] = spot;
        const y = outerY !== null ? outerY : floorHeightRef.current(x, z, 0);
        const asset = findAsset(brushKey);
        undoStack.current.push(editsRef.current);
        // 필드 순서가 곧 편집 파일의 필드 순서다
        const { edits: next, id } = addInstances(editsRef.current, brushKey, {
          x,
          y: y - (asset?.centerOrigin ? -(asset.defaultSize ?? 1) * 0.3 : 0),
          z,
          size: asset?.defaultSize ?? 1,
          rotation: Math.random() * Math.PI * 2,
          // 언덕·길처럼 키와 가로세로가 다른 물건은 비율을 같이 싣는다
          ...(asset?.defaultWidthRatio !== undefined ? { widthRatio: asset.defaultWidthRatio } : null),
          ...(asset?.defaultDepthRatio !== undefined ? { depthRatio: asset.defaultDepthRatio } : null),
          ...(asset?.defaultColor !== undefined ? { color: asset.defaultColor } : null),
        });
        setEdits(next);
        setNotice(`${asset?.label ?? brushKey} 놓음 #${id} · Ctrl+S 로 저장`);
        return;
      }
      const found = pick(ev);
      if (found) {
        setSelected(found);
        selectedRef.current = found;
        drag.current = { start: [ev.clientX, ev.clientY], moved: false };
        canvas.setPointerCapture?.(ev.pointerId);
        setNotice(
          `${found.groupId} #${found.id} · (${found.x.toFixed(1)}, ${found.z.toFixed(1)}) · 키 ${found.size.toFixed(1)} m`,
        );
      } else {
        setSelected(null);
        selectedRef.current = null;
        setNotice(describeMissRef.current(ev));
      }
    };

    const handlePointerMove = (ev: PointerEvent) => {
      // 높이에 비례해 민다 — 90 m 위와 4 m 위에서 같은 양을 밀면 한쪽은 안 움직이고 한쪽은 날아간다
      if (panDrag.current) {
        const dx = ev.clientX - panDrag.current.x;
        const dy = ev.clientY - panDrag.current.y;
        panDrag.current = { x: ev.clientX, y: ev.clientY };
        const groundY = groundHeightRef.current
          ? groundHeightRef.current(camera.position.x * METERS_PER_UNIT, camera.position.z * METERS_PER_UNIT)
          : 0;
        const height = Math.max(2, camera.position.y * METERS_PER_UNIT - groundY);
        const factor = height * 0.0022;
        panView(camera, -dx * factor, dy * factor);
        return;
      }
      if (orbitDrag.current) {
        const dx = ev.clientX - orbitDrag.current.x;
        const dy = ev.clientY - orbitDrag.current.y;
        orbitDrag.current = { x: ev.clientX, y: ev.clientY };
        camera.rotation.order = "YXZ";
        camera.rotation.y -= dx * 0.0035;
        camera.rotation.x = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, camera.rotation.x - dy * 0.0035),
        );
        return;
      }
      // 4 px 넘게 움직여야 끌기다(클릭과 구분)
      const current = drag.current;
      const chosen = selectedRef.current;
      if (!current || !chosen) return;
      if (!current.moved) {
        const d = Math.hypot(ev.clientX - current.start[0], ev.clientY - current.start[1]);
        if (d < 4) return;
        current.moved = true;
        undoStack.current.push(editsRef.current);
      }
      const spot = groundUnderCursor(ev, chosen.y);
      if (!spot) return;
      const [x, z, outerY] = spot;
      const y = outerY !== null ? outerY : floorHeightRef.current(x, z, chosen.y);
      const moved = { ...chosen, x, y, z };
      selectedRef.current = moved;
      setSelected(moved);
      setEdits((e) => modifyInstance(e, chosen.groupId, chosen.id, { x, y, z }));
    };

    const handlePointerUp = (ev: PointerEvent) => {
      if (orbitDrag.current) {
        orbitDrag.current = null;
        canvas.releasePointerCapture?.(ev.pointerId);
        return;
      }
      if (panDrag.current) {
        panDrag.current = null;
        canvas.releasePointerCapture?.(ev.pointerId);
        return;
      }
      if (drag.current?.moved) setNotice("옮김 · Ctrl+S 로 저장");
      drag.current = null;
      canvas.releasePointerCapture?.(ev.pointerId);
    };

    const preventMenu = (ev: Event) => ev.preventDefault();
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("contextmenu", preventMenu);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("contextmenu", preventMenu);
    };
  }, [enabled, pick, aimAt, gl, camera, scene, setEdits]);

  // 키 — ev.code(물리 키)로 본다. 한글 IME 에서는 R 이 ev.key "ㄱ" 으로 온다.
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = async (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey) {
        if (ev.code === "KeyS") {
          ev.preventDefault();
          ev.stopPropagation(); // S(뒤로 걷기)로 새지 않게
          await save();
          return;
        }
        if (ev.code === "KeyZ") {
          ev.preventDefault();
          const previous = undoStack.current.pop();
          if (previous) {
            setEdits(previous);
            setNotice("되돌림");
          }
          return;
        }
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyC") {
        if (!selected) return;
        clipboard.current = { ...selected };
        setNotice(`복사함 — ${selected.groupId} #${selected.id} · Ctrl+V 로 붙이기`);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyV") {
        const copied = clipboard.current;
        if (!copied) {
          setNotice("복사한 것이 없다 — 먼저 Ctrl+C");
          return;
        }
        // 화면 오른쪽으로 한 걸음 띄운다 — 정확히 겹치면 안 보인다
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        const gap = Math.max(1, copied.size * 0.6);
        const x = clamp(copied.x + right.x * gap, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]);
        const z = clamp(copied.z + right.z * gap, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]);
        const y = floorHeight(x, z, copied.y);
        undoStack.current.push(edits);
        // 복사는 같은 물건이어야 한다 — 색·모양·납작함·기울기까지
        const { edits: next, id } = addInstances(edits, copied.groupId, {
          x,
          y,
          z,
          size: copied.size,
          rotation: copied.rotation ?? 0,
          tilt: copied.tilt ?? 0,
          tilt2: copied.tilt2 ?? 0,
          widthRatio: copied.widthRatio ?? 1,
          depthRatio: copied.depthRatio ?? 1,
          ...(copied.shapeIndex !== undefined ? { shapeIndex: copied.shapeIndex } : null),
          ...(copied.color !== undefined ? { color: copied.color } : null),
        });
        setEdits(next);
        const pasted = { ...copied, id, x, y, z };
        setSelected(pasted);
        selectedRef.current = pasted;
        setNotice(`붙여넣음 — ${copied.groupId} #${id} · Ctrl+S 로 저장`);
        return;
      }
      // ESC 는 고른 것이 없어도 들어야 붓을 내려놓을 수 있다
      if (ev.code === "Escape") {
        if (brushRef.current) {
          setBrush(null);
          setNotice("붓 내려놓음");
          return;
        }
        setSelected(null);
        selectedRef.current = null;
        setNotice("");
        return;
      }
      if (!selected) return;
      const nudge = (patch: SpotPatch) => {
        undoStack.current.push(edits);
        setEdits((e) => modifyInstance(e, selected.groupId, selected.id, patch));
      };
      switch (ev.code) {
        case "Delete":
        case "Backspace":
        case "KeyX":
          undoStack.current.push(edits);
          setEdits((e) => removeInstances(e, selected.groupId, selected.id));
          setSelected(null);
          setNotice("지움 · Ctrl+S 로 저장");
          break;
        case "KeyR": {
          const rotation = (selected.rotation ?? 0) + (ev.shiftKey ? -ROTATION_STEP : ROTATION_STEP);
          setSelected((v) => v && { ...v, rotation });
          nudge({ rotation });
          break;
        }
        case "BracketLeft": {
          const size = selected.size * 0.9;
          setSelected((v) => v && { ...v, size });
          nudge({ size });
          break;
        }
        case "BracketRight": {
          const size = selected.size * 1.1;
          setSelected((v) => v && { ...v, size });
          nudge({ size });
          break;
        }
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          ev.preventDefault();
          const step = NUDGE_STEP * (ev.shiftKey ? 4 : 1);
          // 화면 기준. 오른쪽은 걷기 훅과 같은 식(fwd × up) — 부호를 뒤집으면 좌우가 뒤바뀐다.
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          forward.y = 0;
          if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
          forward.normalize();
          const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
          const d = new THREE.Vector3();
          if (ev.code === "ArrowUp") d.copy(forward);
          if (ev.code === "ArrowDown") d.copy(forward).negate();
          if (ev.code === "ArrowRight") d.copy(right);
          if (ev.code === "ArrowLeft") d.copy(right).negate();
          const x = clamp(selected.x + d.x * step, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]);
          const z = clamp(selected.z + d.z * step, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]);
          const y = floorHeight(x, z, selected.y);
          setSelected((v) => v && { ...v, x, y, z });
          nudge({ x, y, z });
          setNotice(`(${x.toFixed(1)}, ${z.toFixed(1)}) · Ctrl+S 로 저장`);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, selected, edits, setEdits, camera, floorHeight, save]);

  // 눌린 키 모으기 · Tab 부감. 위 핸들러는 고른 것이 바뀔 때마다 다시 붙어서,
  // 거기서 모으면 누르고 있던 키를 잃어 화면이 멈춘다.
  useEffect(() => {
    const keys = pressedKeys.current;
    if (!enabled) {
      keys.clear();
      return;
    }
    const handleDown = (ev: KeyboardEvent) => {
      if (ev.code === "Tab") {
        ev.preventDefault(); // 안 막으면 브라우저가 포커스를 옮긴다
        setOverview?.((v) => !v);
        return;
      }
      keys.add(ev.code);
    };
    const handleUp = (ev: KeyboardEvent) => keys.delete(ev.code);
    // 창을 벗어나면 누른 채로 남아 화면이 혼자 흘러간다
    const clearKeys = () => keys.clear();
    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", clearKeys);
      keys.clear();
    };
  }, [enabled, setOverview]);

  // 휠 — 안내판은 pointer-events:none 이라 휠이 캔버스로 샌다. 커서가 어느 상자 안인지를 자리로 잰다.
  useEffect(() => {
    if (!enabled) return;
    const isInside = (el: HTMLElement | null, ev: WheelEvent) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    };
    const handleWheel = (ev: WheelEvent) => {
      // ① 에셋함 안이면 그 상자만 구른다
      const tray = document.getElementById(TRAY_ID);
      if (tray && isInside(tray, ev)) {
        ev.preventDefault();
        tray.scrollTop += ev.deltaY;
        return;
      }
      // ② 안내판 위면 막기만 한다
      if (isInside(document.getElementById(PANEL_ID), ev)) {
        ev.preventDefault();
        return;
      }
      // ③ 부감일 때만. 걸을 때는 휠에 아무 일도 없다.
      if (!overview) return;
      ev.preventDefault();
      const groundY = groundHeightAt
        ? groundHeightAt(camera.position.x * METERS_PER_UNIT, camera.position.z * METERS_PER_UNIT)
        : 0;
      const current = camera.position.y * METERS_PER_UNIT - groundY;
      // 그냥 굴리면 돌린다(트랙패드 두 손가락). 높낮이는 핀치 — 맥은 핀치를 ctrlKey 붙은 wheel 로 보낸다.
      const isHeight = ev.ctrlKey || ev.metaKey || ev.shiftKey;
      if (!isHeight) {
        const amount = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        orbitView(camera, -amount * 0.0035, groundY);
        return;
      }
      // 곱셈으로 — 5 m 와 80 m 에서 같은 양을 더하면 한쪽이 못 쓴다
      const next = Math.min(
        OVERVIEW.heightRange[1],
        Math.max(OVERVIEW.heightRange[0], current * (ev.deltaY > 0 ? 1.15 : 1 / 1.15)),
      );
      camera.position.y = (groundY + next) * UNITS_PER_METER;
    };
    // 창 하나에만 단다 — 캔버스에도 달면 버블링으로 두 번 발동한다
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [enabled, overview, camera, groundHeightAt]);

  // 붓을 들면 십자 커서 — 클릭이 놓기라는 게 보여야 한다
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.style.cursor = enabled && brush ? "crosshair" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [enabled, brush, gl]);

  useEffect(() => {
    if (enabled && unlockPointer) unlockPointer();
  }, [enabled, unlockPointer]);

  if (!enabled) return null;
  return (
    <>
      {selected && (
        // 테두리를 같이 돌리고 앞에 코를 단다 — 대칭에 가까운 나무는 돌려도 안 보여 「회전이 안 먹힌다」고 했다
        <group
          position={[selected.x * UNITS_PER_METER, selected.y * UNITS_PER_METER, selected.z * UNITS_PER_METER]}
          rotation={[0, selected.rotation ?? 0, 0]}
          renderOrder={999}
        >
          <mesh
            position={[
              selected.box?.center[0] ?? 0,
              selected.box?.center[1] ?? selected.size * 0.5 * UNITS_PER_METER,
              selected.box?.center[2] ?? 0,
            ]}
          >
            <boxGeometry
              args={
                selected.box
                  ? (selected.box.size.map((v) => v * 1.06) as Vec3Tuple)
                  : [selected.size * UNITS_PER_METER, selected.size * UNITS_PER_METER, selected.size * UNITS_PER_METER]
              }
            />
            <meshBasicMaterial color="#FFD166" wireframe depthTest={false} toneMapped={false} />
          </mesh>
          <mesh
            position={[
              0,
              selected.box?.center[1] ?? selected.size * 0.5 * UNITS_PER_METER,
              -((selected.box?.size[2] ?? selected.size * UNITS_PER_METER) * 0.53 + 0.35 * UNITS_PER_METER),
            ]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <coneGeometry args={[0.22 * UNITS_PER_METER, 0.7 * UNITS_PER_METER, 4]} />
            <meshBasicMaterial color="#FFD166" depthTest={false} toneMapped={false} />
          </mesh>
        </group>
      )}
      <EditHelpPanel
        brush={brush}
        setBrush={setBrush}
        overview={overview}
        gl={gl}
        notice={notice}
        selected={selected}
        hasUnsaved={hasUnsaved}
        editCount={countEdits(edits)}
        isSaving={isSaving}
        canSave={canSave}
        onSave={save}
      />
    </>
  );
}

const PANEL_ID = "naju-edit-help";
const TRAY_ID = "naju-asset-tray";
const MORE_ID = "naju-more";
const STYLE_ID = "naju-edit-help-style";
const SAVE_BUTTON_ID = "naju-save-button";
const TRAY_UP_ID = "naju-tray-up";
const TRAY_DOWN_ID = "naju-tray-down";
const PALETTE_TOGGLE_ID = "naju-palette-toggle";
const BRUSH_DROP_ID = "naju-brush-drop";

const PANEL_CSS =
  "position:fixed;left:12px;bottom:12px;z-index:60;pointer-events:none;" +
  "font:12px/1.6 ui-monospace,monospace;color:#E8EAF0;" +
  "background:rgba(16,20,28,.86);padding:10px 12px;border-radius:8px;" +
  "border:1px solid rgba(255,209,102,.35);max-width:min(60ch,70vw);" +
  "max-height:calc(100vh - 24px);overflow:hidden;" +
  "display:flex;flex-direction:column;gap:0";

// 인라인 style 로는 ::-webkit-scrollbar 를 못 꾸민다. 기본 막대는 어두운 판 위에서 안 보인다.
const TRAY_SCROLLBAR_CSS =
  `#${TRAY_ID}::-webkit-scrollbar{-webkit-appearance:none;width:10px}` +
  `#${TRAY_ID}::-webkit-scrollbar-track{background:rgba(255,255,255,.06);border-radius:5px}` +
  `#${TRAY_ID}::-webkit-scrollbar-thumb{background:rgba(255,209,102,.55);` +
  "border-radius:5px;border:2px solid transparent;background-clip:content-box}" +
  `#${TRAY_ID}::-webkit-scrollbar-thumb:hover{background:rgba(255,209,102,.85);` +
  "background-clip:content-box}";

interface EditHelpPanelProps {
  notice: string;
  selected: Selection | null;
  hasUnsaved: boolean;
  editCount: number;
  isSaving: boolean;
  canSave: boolean | null;
  onSave: () => void;
  brush: string | null;
  setBrush: Dispatch<SetStateAction<string | null>>;
  overview: boolean;
  gl: THREE.WebGLRenderer;
}

/**
 * 화면 구석 안내 + 저장 단추 + 팔레트. Ctrl+S 는 S(뒤로 걷기)와 맞물려 눌렸는지 모르니 단추와 상태를 보인다.
 * <Canvas> 안이라 R3F 재조정기가 div 를 three 객체로 해석해 터진다(createPortal 도 같다) — DOM 을 직접 만든다.
 */
function EditHelpPanel({
  notice,
  selected,
  hasUnsaved,
  editCount,
  isSaving,
  canSave,
  onSave,
  brush,
  setBrush,
  overview,
  gl,
}: EditHelpPanelProps) {
  // 팔레트는 접어 둔다 — 펼치면 놓을 자리를 가린다
  const [isOpen, setIsOpen] = useState(false);
  // 썸네일은 펼칠 때 한 번만 굽는다
  const [thumbnails, setThumbnails] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!isOpen || thumbnails) return;
    // 한 프레임 넘기고 — 펼치는 순간 화면이 멈칫하지 않게
    const timer = setTimeout(() => setThumbnails(bakeThumbnail(ASSET_CATALOG, assetPrototype, gl)), 0);
    return () => clearTimeout(timer);
  }, [isOpen, thumbnails, gl]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onSaveRef = useRef(onSave);
  const setBrushRef = useRef(setBrush);
  const placeRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    onSaveRef.current = onSave;
    setBrushRef.current = setBrush;
  });

  // 판은 한 번만 만든다
  useEffect(() => {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    // 세로 flex — 판은 화면 높이를 안 넘고, 넘치는 건 제 스크롤바를 가진 에셋함뿐이다.
    // 판 전체가 pointer-events:none 이라 판 자체가 스크롤되면 막대를 잡을 수 없다.
    panel.style.cssText = PANEL_CSS;
    document.body.appendChild(panel);
    panelRef.current = panel;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = TRAY_SCROLLBAR_CSS;
    document.head.appendChild(style);

    // fixed 는 레이아웃 뷰포트에 붙는다. 핀치 줌·가로 스크롤 때 보이는 영역(visualViewport)과 어긋나
    // 판이 화면 밖으로 잘리므로 그만큼 밀어 둔다.
    const place = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      panel.style.left = `${vv.offsetLeft + 12}px`;
      panel.style.bottom = "auto";
      panel.style.top = `${vv.offsetTop + vv.height - panel.offsetHeight - 12}px`;
      panel.style.maxHeight = `${Math.max(120, vv.height - 24)}px`;
      // 위 계산이 못 잡는 경우(조상의 transform 등)까지 — 안 보이는 것보다 조금 어긋난 게 낫다
      const r = panel.getBoundingClientRect();
      const left = vv.offsetLeft;
      const top = vv.offsetTop;
      if (r.left < left) panel.style.left = `${parseFloat(panel.style.left) + (left - r.left)}px`;
      if (r.top < top) panel.style.top = `${parseFloat(panel.style.top) + (top - r.top)}px`;
      const bottomEdge = top + vv.height;
      const r2 = panel.getBoundingClientRect();
      if (r2.bottom > bottomEdge) panel.style.top = `${parseFloat(panel.style.top) - (r2.bottom - bottomEdge)}px`;
    };
    place();
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    placeRef.current = place;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest(`#${SAVE_BUTTON_ID}`)) {
        onSaveRef.current?.();
        return;
      }
      // 한 줄(단추 한 칸 높이)씩 굴린다
      const scroller = target.closest(`#${TRAY_UP_ID}, #${TRAY_DOWN_ID}`);
      if (scroller) {
        const tray = document.getElementById(TRAY_ID);
        if (tray) tray.scrollTop += scroller.id === TRAY_UP_ID ? -78 : 78;
        return;
      }
      if (target.closest(`#${PALETTE_TOGGLE_ID}`)) {
        setIsOpen((v) => !v);
        return;
      }
      if (target.closest(`#${BRUSH_DROP_ID}`)) {
        setBrushRef.current?.(null);
        return;
      }
      const button = target.closest("[data-asset]");
      if (button) {
        // 같은 것을 다시 누르면 내려놓는다 — 해제할 길이 하나뿐이면 갇힌다
        const key = button.getAttribute("data-asset");
        setBrushRef.current?.((v) => (v === key ? null : key));
      }
    };
    panel.addEventListener("click", handleClick);
    return () => {
      panel.removeEventListener("click", handleClick);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      panel.remove();
      style.remove();
      panelRef.current = null;
      placeRef.current = null;
    };
  }, []);

  // 내용만 갱신
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const saveColor = isSaving ? "#9AA3B2" : canSave === false ? "#FF8A80" : hasUnsaved ? "#FFD166" : "#9BE3B4";
    const saveLabel = isSaving
      ? "저장 중…"
      : canSave === false
        ? "저장 불가 — 서버 재시작"
        : hasUnsaved
          ? `저장하기 (변경 ${editCount})`
          : editCount > 0
            ? `저장됨 (${editCount})`
            : "변경 없음";
    const degrees = ((((((selected?.rotation ?? 0) * 180) / Math.PI) % 360) + 360) % 360) | 0;
    const brushLabel = brush ? (findAsset(brush)?.label ?? brush) : null;
    const palette =
      // flex 자식이라 min-height:0 이 없으면 안쪽 스크롤이 안 먹는다
      '<div style="margin-top:8px;padding-top:8px;flex:1 1 auto;min-height:0;' +
      "display:flex;flex-direction:column;" +
      'border-top:1px solid rgba(255,255,255,.14)">' +
      // 머리줄을 한 블록으로 감싸야 단추들이 세로 flex 자식으로 늘어나지 않는다
      '<div style="flex:0 0 auto">' +
      `<button id="${PALETTE_TOGGLE_ID}" type="button" style="pointer-events:auto;cursor:pointer;` +
      "font:inherit;color:#E8EAF0;background:rgba(255,255,255,.08);border:1px solid " +
      'rgba(255,255,255,.2);border-radius:5px;padding:3px 9px">' +
      `${isOpen ? "▾" : "▸"} 놓을 것</button>` +
      (brushLabel
        ? ` <span style="color:#FFD166">붓: ${brushLabel}</span>` +
          ` <button id="${BRUSH_DROP_ID}" type="button" style="pointer-events:auto;` +
          "cursor:pointer;font:inherit;color:#12161F;background:#FFD166;border:none;" +
          'border-radius:5px;padding:2px 8px">내려놓기 (ESC)</button>' +
          '<span style="opacity:.6"> — 화면을 클릭해 놓는다</span>'
        : '<span style="opacity:.6"> — 눌러서 고른다</span>') +
      (isOpen
        ? // 맥 크롬은 스크롤바를 겹쳐 그려 굴리기 전엔 안 보인다 — 눌리는 단추를 둔다
          ` <span id="${MORE_ID}" style="color:#FFD166"></span>` +
          `<button id="${TRAY_UP_ID}" type="button" style="pointer-events:auto;` +
          "cursor:pointer;font:inherit;color:#E8EAF0;background:rgba(255,255,255,.08);" +
          "border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:1px 7px;" +
          'margin-left:6px">▲</button>' +
          `<button id="${TRAY_DOWN_ID}" type="button" style="pointer-events:auto;` +
          "cursor:pointer;font:inherit;color:#E8EAF0;background:rgba(255,255,255,.08);" +
          "border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:1px 7px;" +
          'margin-left:3px">▼</button>'
        : "") +
      "</div>" +
      (!isOpen
        ? ""
        : // 에셋함만 pointer-events:auto — 막대를 잡을 수 있어야 하고, 판의 나머지는 뒤가 클릭돼야 한다.
          // scrollbar-width/color 를 쓰면 크롬이 ::-webkit-scrollbar 를 무시해 흐린 막대가 나온다.
          `<div id="${TRAY_ID}" style="pointer-events:auto;` +
          "flex:1 1 auto;min-height:88px;overflow-y:scroll;" +
          'overflow-x:hidden;margin-top:2px;padding-right:4px">' +
          ASSET_CATEGORIES.map((category) => {
            const buttons = ASSET_CATALOG.filter((asset) => asset.category === category)
              .map((asset) => {
                const isActive = brush === asset.key;
                const image = thumbnails?.get(asset.key);
                return (
                  `<button type="button" data-asset="${asset.key}" title="${asset.label}" ` +
                  'style="pointer-events:auto;cursor:pointer;font:inherit;' +
                  `border:1px solid ${isActive ? "#FFD166" : "rgba(255,255,255,.22)"};` +
                  `background:${isActive ? "#FFD166" : "rgba(255,255,255,.06)"};` +
                  `color:${isActive ? "#12161F" : "#E8EAF0"};` +
                  "border-radius:6px;padding:3px 5px 2px;margin:3px 4px 0 0;" +
                  "display:inline-flex;flex-direction:column;align-items:center;" +
                  'gap:1px;width:62px;vertical-align:top">' +
                  (image
                    ? `<img src="${image}" width="46" height="46" alt="" ` +
                      'style="display:block;border-radius:4px;' +
                      `background:${isActive ? "rgba(0,0,0,.10)" : "rgba(0,0,0,.22)"}">`
                    : '<span style="display:block;width:46px;height:46px;' +
                      'border-radius:4px;background:rgba(0,0,0,.22)"></span>') +
                  `<span style="font-size:10px;line-height:1.15;text-align:center;` +
                  `word-break:keep-all">${asset.label}</span></button>`
                );
              })
              .join("");
            return `<div style="margin-top:4px"><span style="opacity:.55">${category}</span><br>${buttons}</div>`;
          }).join("") +
          "</div></div>");

    panel.innerHTML =
      '<b style="color:#FFD166">편집 모드</b>' +
      '<span style="opacity:.75"> · 클릭·드래그 고르고 옮기기 · 우클릭 드래그 시점 · WASD 걷기</span><br>' +
      '<span style="opacity:.75">방향키 밀기(Shift 크게) · R 회전 · [ ] 크기 · ' +
      '<b style="color:#9BD6FF">, . 시점 돌리기</b> · ' +
      "Ctrl+C/V 복사·붙여넣기 · X 지우기 · Ctrl+Z 되돌리기 · ESC 해제</span><br>" +
      (overview
        ? '<span style="color:#9BD6FF">부감 — ' +
          "WASD·방향키 밀기 · <b>휠 돌리기</b>(, . 도 됨) · <b>핀치/⌘+휠 높낮이</b> · Tab 내려오기</span>"
        : '<span style="opacity:.75">Tab — 공중에서 내려다보기</span>') +
      (selected
        ? `<br><span style="color:#9BE3B4">${selected.groupId} #${selected.id}</span>` +
          `<span style="color:#C9CEDA">  (${selected.x.toFixed(1)}, ${selected.z.toFixed(1)})` +
          ` · 키 ${selected.size.toFixed(1)} m · ∠ ${degrees}°</span>`
        : "") +
      '<div style="margin-top:8px;display:flex;align-items:center;gap:8px">' +
      `<button id="${SAVE_BUTTON_ID}" type="button"${isSaving ? " disabled" : ""} ` +
      'style="pointer-events:auto;cursor:pointer;font:inherit;color:#12161F;' +
      `background:${saveColor};border:none;border-radius:6px;padding:5px 12px;font-weight:700">` +
      `${saveLabel}</button>` +
      '<span style="opacity:.6">또는 Ctrl+S</span></div>' +
      (notice
        ? `<div style="margin-top:6px;color:${notice.startsWith("✘") ? "#FF8A80" : "#FFD166"}">${notice}</div>`
        : "") +
      (canSave === false
        ? '<div style="margin-top:4px;color:#FF8A80">개발 서버에 저장 기능이 없다 — ' +
          "<b>npx vite naju01</b> 을 다시 띄워라</div>"
        : "") +
      palette;
    // 그린 뒤에 재야 한다 — 그려지기 전엔 높이가 0 이다
    const tray = panel.querySelector(`#${TRAY_ID}`);
    const more = panel.querySelector(`#${MORE_ID}`);
    if (tray && more && tray.scrollHeight > tray.clientHeight + 2) more.textContent = "  ↕ 굴려서 더 보기";
    // 내용이 바뀌면 판 높이가 달라진다 — 아래 12 px 을 다시 맞춘다
    placeRef.current?.();
  }, [notice, selected, hasUnsaved, editCount, isSaving, canSave, brush, isOpen, overview, thumbnails]);

  return null;
}
