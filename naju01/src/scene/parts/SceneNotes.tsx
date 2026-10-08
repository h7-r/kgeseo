import type { PresentedControls } from "../../app/presentation";
import { SCENE1_NOTES } from "../../story/scene1";
import { SCENE2_NOTES } from "../../story/scene2";
import { SCENE3_NOTES } from "../../story/scene3";
import { SCENE4_NOTES } from "../../story/scene4";
import { SCENE5_NOTES } from "../../story/scene5";
import type { StoryProps } from "../useStoryProps";
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
function SceneNoteLabel({ sceneNumber, enabled, spots, notes, isFlat = false }: SceneNoteLabelProps) {
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

interface SceneNotesProps {
  controls: PresentedControls;
  story: StoryProps;
}

/** 씬1~씬5 요소 이름표. 씬 3·4 는 납작한 것들이라 낮게 띄운다. */
export default function SceneNotes({ controls: T, story }: SceneNotesProps) {
  return (
    <>
      <SceneNoteLabel
        sceneNumber={1}
        enabled={T.showLabels && T.scene1Props}
        spots={story.scene1}
        notes={SCENE1_NOTES}
      />
      <SceneNoteLabel
        sceneNumber={2}
        enabled={T.showLabels && T.scene2Props}
        spots={story.scene2}
        notes={SCENE2_NOTES}
      />
      <SceneNoteLabel
        sceneNumber={3}
        enabled={T.showLabels && T.scene3Props}
        spots={story.scene3}
        notes={SCENE3_NOTES}
        isFlat
      />
      <SceneNoteLabel
        sceneNumber={4}
        enabled={T.showLabels && T.scene4Props}
        spots={story.scene4}
        notes={SCENE4_NOTES}
        isFlat
      />
      <SceneNoteLabel
        sceneNumber={5}
        enabled={T.showLabels && T.scene5Props}
        spots={story.scene5}
        notes={SCENE5_NOTES}
      />
    </>
  );
}
