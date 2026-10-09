import { exposeDevHook } from "@/debug/devHooks";

/**
 * 컷신(자물쇠·자판기)이 카메라를 쥐고 있는지. 3인칭 붐은 프레임 순서상 컷신보다 먼저 돌며
 * 카메라를 붐 자리로 되돌리므로, 쥔 동안에는 붐이 계산만 하고 카메라에는 쓰지 않는다.
 * 잡은 쪽이 반드시 놓는다(언마운트 포함) — 안 놓으면 카메라가 영영 안 따라온다.
 */
export const cameraOwner: { owner: string | null } = { owner: null };

/** 컷신이 카메라를 넘겨받는다. 이미 다른 주인이 있으면 빼앗지 않고 false. */
export function claimCamera(owner: string): boolean {
  if (cameraOwner.owner && cameraOwner.owner !== owner) return false;
  cameraOwner.owner = owner;
  return true;
}

/** 잡았던 쪽만 놓을 수 있다. */
export function releaseCamera(owner: string) {
  if (cameraOwner.owner === owner) cameraOwner.owner = null;
}

// 콘솔에서 owner 를 아무 이름으로 채우면 붐이 손을 떼, 원하는 자리에서 화면을 볼 수 있다.
exposeDevHook("cameraOwner", cameraOwner);

/**
 * 씬이 정한 원래 시야각. Canvas 의 camera.fov 와 같아야 한다.
 * camera.fov 를 읽어 짐작하면 다른 씬이 넓혀 둔 3인칭 값(64)을 원래 값으로 굳혀 버린다.
 */
export const DEFAULT_FOV = 60;

/**
 * useFrame 순서. 물건을 손뼈에 맞추는 코드가 아바타보다 먼저 돌면 직전 프레임 손을 읽어 걸을 때 어긋난다.
 * 전부 음수인 이유: priority > 0 이 하나라도 있으면 R3F 가 자동 렌더를 끈다. 겨냥 판정은 기본 0 이다.
 */
export const FRAME_PRIORITY = {
  /** 사람이 이번 프레임 어디 서 있는지부터 */
  movement: -40,
  /** 끌고 가는 물건(의자) — 이동 뒤, 손목표 앞 */
  draggedProp: -35,
  /** 그 자리를 기준으로 손이 갈 곳 */
  handTarget: -30,
  /** 애니메이션 + 팔 IK 로 손뼈를 실제로 옮긴다 */
  avatar: -20,
  /** 이번 프레임 어깨 자리로 품 앵커를 만든다 */
  bodyAnchor: -15,
  /** 옮겨진 손뼈(또는 품 앵커)에 물건을 붙인다 */
  heldProp: -10,
} as const;

/**
 * 한 프레임에 흘려보낼 최대 시간(초). R3F 의 delta 에는 상한이 없어, 씬 전환으로 0.5초 멈추면
 * 그 한 프레임에 벽을 뚫고 지나간다. 매 프레임 무언가를 옮기는 코드는 Math.min(dt, MAX_FRAME_DELTA) 로 시작한다.
 */
export const MAX_FRAME_DELTA = 1 / 30;
