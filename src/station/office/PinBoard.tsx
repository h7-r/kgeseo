import { useMemo } from "react";
import { Outlines } from "@react-three/drei";
import * as THREE from "three";

import { UNIT_PLANE } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { type CardKind, corkTexture, isNoteKind, PIN_H, PIN_LIFT, PIN_W, pinCardTexture } from "./pinBoardTextures";

/** 나무 테두리 두께 */
const FRAME = 0.1;

interface PinCard {
  /** 판 로컬 x, y */
  x: number;
  y: number;
  /** 도 */
  degrees: number;
  kind: CardKind;
  seed: number;
}

const PIN_CARDS: PinCard[] = [
  { x: -1.24, y: 0.62, degrees: -4, kind: "spring", seed: 11 },
  { x: -0.24, y: 0.74, degrees: 3, kind: "wordingMismatch", seed: 23 },
  { x: 0.86, y: 0.58, degrees: -6, kind: "signboard", seed: 37 },
  { x: -1.3, y: -0.34, degrees: 5, kind: "distance", seed: 51 },
  { x: -0.2, y: -0.16, degrees: -3, kind: "eastGateBridge", seed: 67 },
  { x: 0.98, y: -0.28, degrees: 4, kind: "source", seed: 83 },
  { x: 0.24, y: -0.86, degrees: -5, kind: "cadastralMap", seed: 97 },
];

/** 붉은 실로 잇는 카드 번호 쌍 */
const PIN_LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 4],
  [4, 2],
  [3, 4],
  [4, 5],
  [3, 6],
  [6, 5],
  [1, 6],
];

interface PinBoardProps {
  /** [x, z] */
  pos?: [number, number];
  rot?: number;
  y?: number;
  scale?: number;
  /** 테두리·다리 */
  cFrame?: string;
  outline?: OutlineValues | null;
}

/**
 * 증거 핀보드. 화이트보드의 빨간 선은 텍스처 안 2D 선이지만, 여기 붉은 실은 핀과 핀을 잇는 진짜 3D 줄이다 —
 * 중력으로 처지고 그림자도 진다. 좌표를 아는 코드라야 만들 수 있어 GLB 로는 안 된다.
 */
export default function PinBoard({
  pos = [0, 0],
  rot = 0,
  y = 0,
  scale = 1,
  cFrame = "#3c4045",
  outline,
}: PinBoardProps) {
  const [x, z] = pos;
  const cork = useMemo(() => corkTexture(), []);
  const cards = useMemo(
    () =>
      PIN_CARDS.map((card) => {
        const isNote = isNoteKind(card.kind);
        const h = isNote ? 0.56 : 0.5;
        const w = isNote ? 0.6 : 0.64;
        return {
          texture: pinCardTexture(card.kind, card.seed),
          x: card.x,
          y: card.y,
          rotation: (card.degrees * Math.PI) / 180,
          w,
          h,
          // 핀은 카드 위쪽 가운데 — 실이 여기서 출발한다
          pin: new THREE.Vector3(card.x, card.y + h / 2 - 0.06, 0.045),
        };
      }),
    [],
  );

  // 두 핀을 잇되 가운데를 늘어뜨린다. 길수록 더 처진다.
  const strings = useMemo(
    () =>
      PIN_LINKS.map(([a, b]) => {
        const p1 = cards[a].pin;
        const p2 = cards[b].pin;
        const sag = 0.05 + p1.distanceTo(p2) * 0.1;
        const mid = new THREE.Vector3()
          .addVectors(p1, p2)
          .multiplyScalar(0.5)
          .add(new THREE.Vector3(0, -sag, 0.03));
        const curve = new THREE.CatmullRomCurve3([p1, mid, p2]);
        return new THREE.TubeGeometry(curve, 20, 0.008, 6, false);
      }),
    [cards],
  );

  const centerY = PIN_LIFT + PIN_H / 2;
  const frame: [number, number, number, number][] = [
    [0, PIN_H / 2 + FRAME / 2, PIN_W + FRAME * 2, FRAME],
    [0, -PIN_H / 2 - FRAME / 2, PIN_W + FRAME * 2, FRAME],
    [-PIN_W / 2 - FRAME / 2, 0, FRAME, PIN_H],
    [PIN_W / 2 + FRAME / 2, 0, FRAME, PIN_H],
  ];
  const outlines = outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />;

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      <group position={[0, centerY, 0]}>
        {/* 코르크판 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[PIN_W, PIN_H, 0.08]} />
          <meshToonMaterial map={cork} gradientMap={TOON_GRADIENT} />
          {outlines}
        </mesh>
        {frame.map(([fx, fy, fw, fh], i) => (
          <mesh key={i} position={[fx, fy, 0]} castShadow>
            <boxGeometry args={[fw, fh, 0.12]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {outlines}
          </mesh>
        ))}
        {/* 사진·메모 카드 — 판에서 살짝 띄워 그림자가 지게 */}
        {cards.map((card, i) => (
          <mesh
            key={`c${i}`}
            geometry={UNIT_PLANE}
            position={[card.x, card.y, 0.045]}
            rotation={[0, 0, card.rotation]}
            scale={[card.w, card.h, 1]}
            castShadow
          >
            <meshToonMaterial map={card.texture} gradientMap={TOON_GRADIENT} />
            <ToonOutline geometry={UNIT_PLANE} outline={outline} />
          </mesh>
        ))}
        {/* 압정 */}
        {cards.map((card, i) => (
          <mesh key={`p${i}`} position={card.pin} castShadow>
            <sphereGeometry args={[0.032, 10, 8]} />
            <meshToonMaterial color="#C0392B" gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
        {strings.map((geometry, i) => (
          <mesh key={`s${i}`} geometry={geometry} castShadow>
            <meshToonMaterial color="#B03024" gradientMap={TOON_GRADIENT} />
          </mesh>
        ))}
      </group>
      {/* 다리 — 화이트보드와 같은 모양 */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * (PIN_W / 2 - 0.3), PIN_LIFT / 2, 0]} castShadow>
            <boxGeometry args={[0.12, PIN_LIFT + 0.2, 0.12]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {outlines}
          </mesh>
          <mesh position={[sx * (PIN_W / 2 - 0.3), 0.06, 0]} castShadow>
            <boxGeometry args={[0.18, 0.12, 1.4]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {outlines}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[PIN_W - 0.6, 0.1, 0.1]} />
        <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
        {outlines}
      </mesh>
    </group>
  );
}
