// [E] 인스턴스 편집기 — 화면에서 흩뿌린 물건 하나를 집어 고친다.
// 만질 수 있는 것은 instanceGroups 로 심은 인스턴스뿐이다. 지형·절벽·통로는 도면 숫자가 정하고,
// 마우스로 주무르면 그림과 걷는 판정이 갈라진다.
//
// 조작: 클릭 고르기 · 드래그 옮기기(4 px 넘게) · 우클릭 드래그 시점 · , . 시점 돌리기(Shift 3 배)
//   WASD 걷기 · 방향키 미세 이동(0.25 m, Shift 1 m) · Ctrl+C/V · R/Shift+R 15° · [ ] 크기 ±10 %
//   Delete/X 지우기 · Ctrl+Z 되돌리기 · Ctrl+S 저장 · ESC 해제 · Tab 부감(휠 돌리기, 핀치/⌘+휠 높낮이)
// 편집만 파일에 남겨 팀원 화면에서도 같은 배치가 나오게 한다.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useThree } from "@react-three/fiber";

import { UNITS_PER_METER } from "../plan/sitePlan";
import EditHelpPanel from "./EditHelpPanel";
import { canSaveEdits, saveEdits } from "./editFile";
import type { Selection, Vec3Tuple } from "./editorConfig";
import { countEdits, type Edits } from "./instanceGroups";
import { useOverviewCamera, useOverviewWheel, usePressedKeys } from "./overviewCamera";
import { useEditKeys } from "./useEditKeys";
import { usePicking } from "./usePicking";
import { usePointerEditing } from "./usePointerEditing";

/** 편집 저장 — 「먹힌 건지 안 먹힌 건지」가 보이게 저장 상태를 따로 든다. */
function useEditSave(
  enabled: boolean,
  edits: Edits,
  editsRef: MutableRefObject<Edits>,
  setNotice: Dispatch<SetStateAction<string>>,
) {
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
  }, [editsRef, setNotice]);

  return { hasUnsaved, isSaving, canSave, save };
}

interface SelectionBoxProps {
  selected: Selection;
}

/** 고른 물건의 노란 테두리. 테두리를 같이 돌리고 앞에 코를 단다 — 대칭에 가까운 나무는 돌려도 티가 안 난다. */
function SelectionBox({ selected }: SelectionBoxProps) {
  return (
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
  );
}

interface EditorProps {
  enabled: boolean;
  edits: Edits;
  setEdits: Dispatch<SetStateAction<Edits>>;
  /** 코어 지표 높이(m). 무대 밖은 값이 없다. */
  heightAt?: ((x: number, z: number) => number) | null;
  /** 포인터락을 풀어야 마우스로 집는다 */
  unlockPointer?: () => void;
  overview: boolean;
  setOverview?: Dispatch<SetStateAction<boolean>>;
}

export default function Editor({
  enabled,
  edits,
  setEdits,
  heightAt,
  unlockPointer,
  overview,
  setOverview,
}: EditorProps) {
  const { gl } = useThree();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const undoStack = useRef<Edits[]>([]);
  const editsRef = useRef(edits);
  const clipboard = useRef<Selection | null>(null);
  // 붓 — 팔레트에서 고른 물건. 들려 있으면 클릭이 고르기가 아니라 놓기다.
  const [brush, setBrush] = useState<string | null>(null);
  const brushRef = useRef<string | null>(null);
  const selectedRef = useRef<Selection | null>(null);

  const { hasUnsaved, isSaving, canSave, save } = useEditSave(enabled, edits, editsRef, setNotice);
  const picking = usePicking(heightAt);

  // 마우스·키 리스너는 최신 값을 ref 로 본다(렌더마다 다시 붙으면 드래그가 끊긴다)
  useLayoutEffect(() => {
    editsRef.current = edits;
    brushRef.current = brush;
    selectedRef.current = selected;
  });

  const pressedKeys = useOverviewCamera({ enabled, overview, heightAt, selectedRef });
  usePointerEditing({
    enabled,
    picking,
    heightAt,
    editsRef,
    brushRef,
    selectedRef,
    undoStack,
    setEdits,
    setSelected,
    setNotice,
  });
  useEditKeys({
    enabled,
    selected,
    edits,
    setEdits,
    floorHeightAt: picking.floorHeightAt,
    save,
    undoStack,
    clipboard,
    brushRef,
    selectedRef,
    setSelected,
    setBrush,
    setNotice,
  });
  usePressedKeys(pressedKeys, enabled, setOverview);
  useOverviewWheel(enabled, overview, heightAt);

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
      {selected && <SelectionBox selected={selected} />}
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
