import Label from "./Label";
import { planPoint } from "./planPoint";

interface NoteSpot {
  x: number;
  y: number;
  z: number;
  size?: number;
}

interface SceneNote {
  text: string;
  color: string;
}

interface SceneNoteLabelProps {
  sceneNumber: number;
  enabled: boolean;
  spots: Readonly<Record<string, readonly NoteSpot[] | undefined>> | null;
  notes: Readonly<Record<string, SceneNote>>;
  /** 씬 3·4 처럼 아주 납작한 것들 — 키에 비례해 띄우면 이름표가 땅에 깔린다. */
  isFlat?: boolean;
}

/** 씬 요소 이름표. 무리마다 첫 자리 하나에만 붙인다. */
export default function SceneNoteLabel({ sceneNumber, enabled, spots, notes, isFlat = false }: SceneNoteLabelProps) {
  if (!enabled || !spots) return null;
  return (
    <group>
      {Object.entries(notes).map(([key, note]) => {
        const first = spots[key]?.[0];
        if (!first) return null;
        // 누운 물건(구렁이·나루터)의 size 는 길이라 그대로 쓰면 이름표가 하늘로 뜬다 — 1.2 m 에서 끊는다.
        const lift = isFlat ? 0.8 : Math.min(first.size ?? 1, 1.2) * 0.9 + 0.6;
        return (
          <Label
            key={`scene${sceneNumber}Note.${key}`}
            position={planPoint(first.x, first.z, first.y + lift)}
            color={note.color}
            size={10.5}
          >
            {note.text}
          </Label>
        );
      })}
    </group>
  );
}
