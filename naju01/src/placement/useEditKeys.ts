// 편집 키 — 저장 · 되돌리기 · 복사/붙여넣기 · ESC · 지우기 · 회전 · 크기 · 방향키 밀기.

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { EDIT_BOUNDS, NUDGE_STEP, ROTATION_STEP, clamp, type Selection } from "./editorConfig";
import { addInstance, modifyInstance, removeInstance, type Edits, type SpotPatch } from "./instanceGroups";

/** 복사해 둔 것을 (x, y, z) 에 하나 더 놓는다 */
function pasteCopy(edits: Edits, copied: Selection, x: number, y: number, z: number) {
  // 복사는 같은 물건이어야 한다 — 색·모양·납작함·기울기까지
  return addInstance(edits, copied.groupId, {
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
}

/** 화면 기준 수평 앞·오른쪽. 오른쪽은 걷기 훅과 같은 식(fwd × up) — 부호를 뒤집으면 좌우가 뒤바뀐다. */
function computeScreenAxes(camera: THREE.Camera) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  return { forward, right };
}

interface EditKeysOptions {
  enabled: boolean;
  selected: Selection | null;
  edits: Edits;
  setEdits: Dispatch<SetStateAction<Edits>>;
  floorHeightAt: (x: number, z: number, fallback?: number) => number;
  save: () => Promise<void>;
  undoStack: MutableRefObject<Edits[]>;
  clipboard: MutableRefObject<Selection | null>;
  brushRef: MutableRefObject<string | null>;
  selectedRef: MutableRefObject<Selection | null>;
  setSelected: Dispatch<SetStateAction<Selection | null>>;
  setBrush: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

// ev.code(물리 키)로 본다. 한글 IME 에서는 R 이 ev.key "ㄱ" 으로 온다.
export function useEditKeys({
  enabled,
  selected,
  edits,
  setEdits,
  floorHeightAt,
  save,
  undoStack,
  clipboard,
  brushRef,
  selectedRef,
  setSelected,
  setBrush,
  setNotice,
}: EditKeysOptions) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!enabled) return;

    const paste = () => {
      const copied = clipboard.current;
      if (!copied) {
        setNotice("복사한 것이 없다 — 먼저 Ctrl+C");
        return;
      }
      // 화면 오른쪽으로 한 걸음 띄운다 — 정확히 겹치면 안 보인다
      const { right } = computeScreenAxes(camera);
      const gap = Math.max(1, copied.size * 0.6);
      const x = clamp(copied.x + right.x * gap, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]);
      const z = clamp(copied.z + right.z * gap, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]);
      const y = floorHeightAt(x, z, copied.y);
      undoStack.current.push(edits);
      const { edits: next, id } = pasteCopy(edits, copied, x, y, z);
      setEdits(next);
      const pasted = { ...copied, id, x, y, z };
      setSelected(pasted);
      selectedRef.current = pasted;
      setNotice(`붙여넣음 — ${copied.groupId} #${id} · Ctrl+S 로 저장`);
    };

    // 고른 것을 화면 기준으로 민다
    const nudgeByArrow = (chosen: Selection, ev: KeyboardEvent, nudge: (patch: SpotPatch) => void) => {
      const step = NUDGE_STEP * (ev.shiftKey ? 4 : 1);
      const { forward, right } = computeScreenAxes(camera);
      const d = new THREE.Vector3();
      if (ev.code === "ArrowUp") d.copy(forward);
      if (ev.code === "ArrowDown") d.copy(forward).negate();
      if (ev.code === "ArrowRight") d.copy(right);
      if (ev.code === "ArrowLeft") d.copy(right).negate();
      const x = clamp(chosen.x + d.x * step, EDIT_BOUNDS.x[0], EDIT_BOUNDS.x[1]);
      const z = clamp(chosen.z + d.z * step, EDIT_BOUNDS.z[0], EDIT_BOUNDS.z[1]);
      const y = floorHeightAt(x, z, chosen.y);
      setSelected((v) => v && { ...v, x, y, z });
      nudge({ x, y, z });
      setNotice(`(${x.toFixed(1)}, ${z.toFixed(1)}) · Ctrl+S 로 저장`);
    };

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
        if (ev.code === "KeyC") {
          if (!selected) return;
          clipboard.current = { ...selected };
          setNotice(`복사함 — ${selected.groupId} #${selected.id} · Ctrl+V 로 붙이기`);
          return;
        }
        if (ev.code === "KeyV") {
          paste();
          return;
        }
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
          setEdits((e) => removeInstance(e, selected.groupId, selected.id));
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
        case "ArrowDown":
          ev.preventDefault();
          nudgeByArrow(selected, ev, nudge);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    selected,
    edits,
    setEdits,
    camera,
    floorHeightAt,
    save,
    undoStack,
    clipboard,
    brushRef,
    selectedRef,
    setSelected,
    setBrush,
    setNotice,
  ]);
}
