/**
 * 물건을 어떻게 쥐는가 — 쥐는 자리는 물건이 들고, 팔은 IK 로 따라간다.
 * 손 쪽에 보정 하나를 두면 컵은 손잡이를 놓치고 상자는 한 손에 매달린다.
 * 숫자는 화면을 보며 맞춘 값이다. 모델 원점이 GLB 마다 달라 코드로 끌어낼 수 없다.
 */
import type { Vector3Tuple } from "three";

import { exposeDevHook } from "@/debug/devHooks";

export interface GripSpec {
  /** 물건 로컬 좌표에서 손이 잡는 점. 이 점이 손뼈 자리에 오도록 물건을 민다. */
  gripPoint: Vector3Tuple;
  /** 물건을 손에 맞춰 돌리는 각(도). */
  gripRotation: Vector3Tuple;
  /** 왼손도 같이 쓴다(폭이 넓은 것). */
  twoHanded: boolean;
  /** 손이 아니라 가슴 앞에 안는다. 손뼈에 붙이면 걸을 때 팔 스윙대로 휘둘린다. */
  hugged: boolean;
  /** hugged 일 때 가슴 앵커에 오는 점. 없으면 gripPoint. */
  hugPoint?: Vector3Tuple | null;
  /** twoHanded 일 때 오른손이 짚는 점. 왼손은 x 를 뒤집어 쓴다. 없으면 양팔 IK 를 안 건다. */
  handPoint?: Vector3Tuple | null;
  /** 물건 회전에서 손 회전으로 가는 각(도). 없으면 손목을 안 건드린다. */
  handRotation?: Vector3Tuple | null;
  /** 물건이 손 회전을 얼마나 따라 도나(0 = 몸 기준 똑바로, 1 = 손 회전 그대로). 이 팔 자세에서 1 이면 컵이 크게 기운다. */
  followHand?: number;
  /** 손가락을 얼마나 감나(절대값, fistHands 모프). 「주먹 섞기」가 0 이면 화면에 안 나온다. */
  gripStrength: number;
}

type GripKind =
  | "mug"
  | "drink"
  | "nozzle"
  | "coin"
  | "numberTag"
  | "mouse"
  | "hat"
  | "paper"
  | "laptop"
  | "keyboard"
  | "box"
  | "collectionBox";

/** 아무 규격도 없는 물건. 손뼈 자리에 그대로 둔다. */
const DEFAULT_GRIP: GripSpec = {
  gripPoint: [0, 0, 0],
  gripRotation: [0, 0, 0],
  twoHanded: false,
  hugged: false,
  hugPoint: null,
  handPoint: null,
  handRotation: null,
  followHand: 0,
  gripStrength: 0.7,
};

// 상자·수거함은 원점이 밑바닥이라 한가운데는 y 0.42. 손자리는 IK 가 옮기는 손목 자리 —
// 옆면 바로 바깥·윗부분이라야 팔이 닿고 손이 위 모서리를 쥔다.
const BOX_GRIP: GripSpec = {
  gripPoint: [0, 0, 0],
  gripRotation: [0, 0, 0],
  twoHanded: true,
  hugged: true,
  hugPoint: [0, 0.42, 0],
  handPoint: [0.64, 0.66, 0.05],
  gripStrength: 0.45,
};

const GRIP_TABLE: Record<GripKind, GripSpec> = {
  // 손잡이 중심. 컵 몸통은 주먹 바깥으로 빠진다. y 180° — 손잡이가 오른손 쪽으로.
  // 손각 -40° 로 손바닥을 세운다(그대로 두면 컵을 위에서 얹은 모양).
  mug: {
    gripPoint: [0.212, 0.184, 0],
    gripRotation: [0, 180, 0],
    handRotation: [0, 0, -40],
    twoHanded: false,
    hugged: false,
    gripStrength: 0.7,
  },
  // 종이컵·캔 — 손잡이가 없어 몸통을 세로로 감싸 쥔다.
  drink: {
    gripPoint: [0, 0.03, 0],
    gripRotation: [0, 0, 0],
    handRotation: [0, 0, -40],
    twoHanded: false,
    hugged: false,
    gripStrength: 0.75,
  },
  nozzle: {
    gripPoint: [0, -0.04, 0],
    gripRotation: [0, 0, 0],
    twoHanded: false,
    hugged: false,
    gripStrength: 0.85,
  },
  // 중심을 잡으면 원반이 주먹을 관통한다. 아랫 가장자리를 잡아 주먹 위로 솟게 한다.
  coin: {
    gripPoint: [0, -0.16, 0],
    gripRotation: [0, 0, 0],
    twoHanded: false,
    hugged: false,
    gripStrength: 1,
  },
  // 손가락 뼈가 없는 리그라 꼭대기보다 조금 위를 잡아 표지가 주먹 아래에 매달리게 한다.
  numberTag: {
    gripPoint: [0, 0.47, 0],
    gripRotation: [0, 0, 0],
    twoHanded: false,
    hugged: false,
    gripStrength: 0.9,
  },
  // 손바닥이 윗면을 덮는다. 손을 펴서(0.25) 마우스가 손가락 사이로 보이게 한다.
  mouse: {
    gripPoint: [0, 0.07, 0],
    gripRotation: [0, 0, 0],
    twoHanded: false,
    hugged: false,
    gripStrength: 0.25,
  },
  // 챙을 옆에서 쥔다.
  hat: {
    gripPoint: [0.33, 0.04, 0],
    gripRotation: [0, 0, 0],
    handRotation: [0, 0, -40],
    twoHanded: false,
    hugged: false,
    gripStrength: 0.6,
  },
  // 밑면보다 더 아래를 잡아 뭉치가 주먹 위에 얹히게 한다(같은 높이면 낱장이 손가락을 뚫는다).
  paper: {
    gripPoint: [0.2, -0.09, 0],
    gripRotation: [0, 0, 0],
    twoHanded: true,
    hugged: false,
    gripStrength: 0.5,
  },
  // 폭 1.22 라 한 손으로는 몸을 뚫는다 — 상자처럼 안는다. y 180° 로 화면이 앞쪽.
  // 돌리면 로컬 +x 도 뒤집혀 손자리 x 가 음수여야 두 팔이 X 자로 꼬이지 않는다.
  laptop: {
    gripPoint: [0, 0, 0],
    gripRotation: [0, 180, 0],
    twoHanded: true,
    hugged: true,
    hugPoint: [0, 0.51, 0],
    handPoint: [-0.68, 0.02, 0.05],
    gripStrength: 0.4,
  },
  // 폭 1.55 — 안고 양 끝을 옆에서 쥔다. 윗면에 얹으면 손가락이 자판 속으로 파고든다.
  keyboard: {
    gripPoint: [0, 0, 0],
    gripRotation: [0, 0, 0],
    twoHanded: true,
    hugged: true,
    hugPoint: [0, 0.045, 0],
    handPoint: [0.8, -0.08, 0.05],
    gripStrength: 0.4,
  },
  box: BOX_GRIP,
  collectionBox: BOX_GRIP,
};

const isGripKind = (name: string): name is GripKind => Object.hasOwn(GRIP_TABLE, name);

/** 로비 물건은 id 가 `mug0` 처럼 붙는다. 앞머리로 종류를 찾는다. */
const ID_PREFIXES: [prefix: string, kind: GripKind][] = [
  ["mug", "mug"],
  ["laptop", "laptop"],
  ["paper", "paper"],
  ["hat", "hat"],
  ["kb", "keyboard"],
  ["ms", "mouse"],
];

// 손각·쥠점은 화면을 봐야 아는 값이라 콘솔에서 덧씌워 다음 프레임부터 본다.
// gripOffsets("mug", { handRotation: [0,0,-90] }) · ("mug", null) 로 되돌림 · () 로 전부 지움.
const overrides = new Map<string, Partial<GripSpec>>();

exposeDevHook("gripOffsets", (kind?: string, override?: Partial<GripSpec> | null) => {
  if (kind === undefined) overrides.clear();
  else if (override == null) overrides.delete(kind);
  else overrides.set(kind, override);
  return [...overrides.entries()];
});
exposeDevHook("gripTable", GRIP_TABLE);

/**
 * 이 물건을 어떻게 쥐나.
 * @param kind 든 물건이 알려 준 종류(있으면 우선)
 * @param itemId 없으면 id 앞머리로 짐작한다. "coin"·"drink"·"nozzle" 은 id 가 곧 종류다.
 */
export function gripSpec(kind?: string | null, itemId?: string | null): GripSpec {
  const withOverride = (spec: GripSpec, name: string) => {
    const override = overrides.get(name);
    return override ? { ...spec, ...override } : spec;
  };
  if (kind && isGripKind(kind)) return withOverride(GRIP_TABLE[kind], kind);
  if (itemId) {
    if (isGripKind(itemId)) return withOverride(GRIP_TABLE[itemId], itemId);
    const match = ID_PREFIXES.find(([prefix]) => itemId.startsWith(prefix));
    if (match) return withOverride(GRIP_TABLE[match[1]], match[1]);
  }
  return DEFAULT_GRIP;
}
