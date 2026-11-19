/**
 * 「안전한 곳으로 이동」(미르 11/12) — 어딘가에 끼였거나 틈(포털) 코앞에 서서 안 들어가질 때, 진행(퍼즐 · 소지품 · 조사 시간)은 그대로 두고
 * 자리만 **지금 구역**의 정해 둔 안전 자리로 옮긴다. 페이지를 새로 불러오지 않는다(느리고 도착 연출이 다시 돈다).
 *
 * 「맵 가운데」로 보내지 않는다 — 지역 문(나루터로 못 돌아가기 등) · 퍼즐 경계를 건너뛰는 지름길이 된다. 구역은 문 · 퍼즐 경계로 나눴다
 * (자리 다시 잡기 01회차 Codex — 걸어온 길 기록보다 미리 검증한 고정 자리가 예측되고, 기록한 자리는 그사이 닫힌 문 너머일 수 있다).
 *   나루터 · 바위아래 · 물굴(큰 방 · 길목) · 석실 · 능선 장막 안(갇힘) · 능선 · 바위 위
 * 물굴 · 석실은 물속이다 — 물굴은 마지막으로 숨 쉰 자리(숨이 다했을 때 돌아가는 곳)를 먼저 쓴다. 숨을 채워 주지는 않는다.
 * 지금 자리에서 MIN_MOVE 넘게 떨어지고 막히지 않은(지형 · 물굴 벽 · 물건) 첫 자리로. 다 가까우면 막히지 않은 첫 자리, 다 막혔으면 옮기지 않는다.
 * 순수 판정(zoneAt · pickSafeSpot)과 옮기기(moveToSafeSpot)를 나눴다 — 판정은 시험에서 따로 본다.
 */
import { VIEWPOINTS } from "../plan/sitePlan";
import { CORRIDOR, HALL, INNER, getLastAirSpot, isLeavingChamber, teleportPlayer } from "../puzzles/cave/caveState";
import { RITE_ARRIVAL } from "../puzzles/cliff/cliffShape";
import { riftEntrySince } from "../puzzles/ridge/riftEntry";
import { isInsideCurtain } from "../puzzles/ridge/ridgeShape";
import { ridge } from "../puzzles/ridge/ridgeState";
import { ritual } from "../puzzles/ritual/ritualState";
import { isCameraFocused } from "../scene/cameraFocus";
import { stage as immersionStage } from "../scene/immersion/state";
import { playerPose, walkTerrain } from "./playerPose";
import { regionAt } from "./regions";
import { pickSafeSpot, type SafeSpot } from "./safeSpotPick";
import { solidQueries } from "./solidField";

export type SafeZone = "나루터" | "바위아래" | "물굴" | "석실" | "능선 장막 안" | "능선" | "바위 위";
export type { SafeSpot };

/** 지금 자리에서 이만큼(m) 넘게 떨어진 자리를 먼저 — 틈 코앞 · 끼인 자리 바로 곁으로 다시 보내지 않게 */
export const MIN_MOVE = 3;
/** 막혔는지 볼 때의 몸 반지름(m) — 걷기와 같다 */
const BODY_RADIUS = 0.3;

/**
 * 구역마다 안전 자리(미터) — 앞에서부터 쓴다. 로컬에서 하나씩 세워 보고 둘레 0.6 m 까지 막히지 않는 것만 골랐다(지형 · 물건 격자).
 * 틈(능선 장승 문 75.35, 12.05 · 벼랑 끝 50.35, 24.95)에서 멀리 둔다.
 */
export const SAFE_SPOTS: Record<SafeZone, readonly SafeSpot[]> = {
  // 첫 장면 자리(V1) · 화톳불 쪽 물가
  나루터: [
    { x: VIEWPOINTS[0].x, z: VIEWPOINTS[0].z, heading: VIEWPOINTS[0].heading },
    { x: 19, z: 41, heading: "+X" },
  ],
  // 굿판 앞 물가(벼랑 틈을 건너오는 자리) · 그 서쪽 너른 물가
  바위아래: [
    { x: RITE_ARRIVAL.x, z: RITE_ARRIVAL.z, heading: RITE_ARRIVAL.heading },
    { x: 37, z: 40, heading: "+X" },
  ],
  // 물이 머리 위에서 합쳐지기 전 길목(숨이 차는 곳) — 마지막으로 숨 쉰 자리가 물굴 안이면 그것이 먼저(pickSafeSpot)
  물굴: [
    { x: CORRIDOR.x, z: 53.5, heading: "+Z" },
    { x: CORRIDOR.x, z: 50, heading: "+Z" },
  ],
  // 석실 들머리(입구 양옆 모서리에 숨구멍)
  석실: [
    { x: 45, z: 77.2, heading: "+Z" },
    { x: 45, z: 78.6, heading: "+Z" },
  ],
  // 바람 장막 안 — 장막이 닫혀 있으면 이 안에서만
  "능선 장막 안": [
    { x: 69.8, z: 20, heading: "+X" },
    { x: 66.5, z: 25, heading: "+X" },
    { x: 67, z: 14.5, heading: "+X" },
  ],
  능선: [
    { x: 69.8, z: 20, heading: "+X" },
    { x: 64, z: 22, heading: "+X" },
  ],
  // 장승 문 틈을 지나 도착하는 자리 · 그 아래 너른 곳
  "바위 위": [
    { x: 52, z: 11, heading: "+Z" },
    { x: 46, z: 13, heading: "+Z" },
  ],
};

const isInRect = (x: number, z: number, rect: { x: readonly [number, number]; z: readonly [number, number] }) =>
  x > rect.x[0] && x < rect.x[1] && z > rect.z[0] && z < rect.z[1];

/** 물굴에 들어갈 수 있는 때 — 강이 갈라진 뒤부터 비늘을 얻고 강가로 나오기 전까지. 그 밖에 그 자리는 강이다 */
const isCaveOpen = () => ritual.isAtLeast("parted") && !ritual.isAtLeast("cleared");

/** 지금 자리의 구역 — 물굴 · 석실은 바위아래 지역 안의 따로 된 곳이고, 장막이 닫혀 있으면 능선은 장막 안만 */
export function zoneAt(x: number, z: number, isCurtainClosed = ridge.isConfining()): SafeZone {
  if (isCaveOpen() && isInRect(x, z, INNER)) return "석실";
  if (isCaveOpen() && x > HALL.x[0] && x < HALL.x[1] && z > CORRIDOR.zStart && z < INNER.z[0]) return "물굴";
  const region = regionAt(x, z);
  if (region === "능선") return isCurtainClosed && isInsideCurtain(x, z) ? "능선 장막 안" : "능선";
  return region === "바위위" ? "바위 위" : region;
}

/** 이 자리에서 옮길 후보 — 물굴이면 마지막으로 숨 쉰 자리(물굴 안일 때)를 먼저 */
function candidatesFor(zone: SafeZone, airSpot: { x: number; z: number } | null): SafeSpot[] {
  const air = zone === "물굴" && airSpot && zoneAt(airSpot.x, airSpot.z) === "물굴" ? [{ ...airSpot, heading: "+Z" as const }] : [];
  return [...air, ...SAFE_SPOTS[zone]];
}

/** 지금은 옮길 수 없는 까닭 — 장면 · 틈 · 물길 · 장면 전환 중. 옮길 수 있으면 null */
export function safeSpotUnavailableReason(): string | null {
  if (riftEntrySince() >= 0) return "틈으로 건너가는 중이에요.";
  if (isLeavingChamber()) return "물길에 실려 나가는 중이에요.";
  if (immersionStage.cut !== null) return "장면이 바뀌는 중이에요.";
  if (isCameraFocused()) return "장면을 보여 주는 중이에요.";
  return null;
}

/** 지금 몸을 (x, z) 에 세울 수 없나 — 지형(벼랑 · 물굴 벽 · 장애물) · 물건 격자 */
function isBlockedNow(x: number, z: number) {
  const terrain = walkTerrain.current;
  if (!terrain) return true;
  const footY = terrain.groundAt(x, z).y;
  if (terrain.blockedAt(x, z, footY, BODY_RADIUS)) return true;
  const solid = solidQueries.current;
  return !!solid?.isReady() && solid.blockedAt(x, z, footY, BODY_RADIUS);
}

/** 옮긴다 — 옮긴 자리, 옮길 수 없으면 null(까닭은 safeSpotUnavailableReason) */
export function moveToSafeSpot(): { zone: SafeZone; spot: SafeSpot } | null {
  if (safeSpotUnavailableReason()) return null;
  const from = { x: playerPose.x, z: playerPose.z };
  const zone = zoneAt(from.x, from.z);
  const spot = pickSafeSpot(from, candidatesFor(zone, getLastAirSpot()), (x, z) => zoneAt(x, z), isBlockedNow, MIN_MOVE);
  if (!spot) return null;
  teleportPlayer(spot.x, spot.z, spot.heading);
  // 저장은 이 자리를 읽는다(NajuSaveBridge) — 멈춘 채라 다음 프레임 전이어도 새 자리가 저장되게 바로 맞춘다
  playerPose.x = spot.x;
  playerPose.z = spot.z;
  return { zone, spot };
}
