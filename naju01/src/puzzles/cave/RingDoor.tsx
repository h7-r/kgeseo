/**
 * 물레 고리문 — 큰 방 뒷벽 앞에 선 큰 돌바퀴. 얼굴에 고리 셋이 겹쳐 있고 고리마다 틈이 하나씩 있다. 돌바퀴를 겨눠 [E] 로
 * 밀면 고리 셋의 눈금을 서버에 내고, 맞다는 답을 받으면 옆으로 굴러가 뒤의 아치 통로가 드러난다(tryOpenDoor).
 *   돌 물레(다이얼) — 넓적한 돌판에 뜬 돌 모양 홈 넷이 파여 있다. 뜬 돌을 가진 채 물레 어디든 겨눠 [E] 하면 빈 홈에
 *   차례로 들어가고(홈을 정확히 겨눌 필요 없다), 한 번 들어간 돌은 빠지지 않는다. 넷을 다 끼워야 돌아간다 — 물레 어디든
 *   겨눠 [E] 를 꾹 누르면 한 눈금씩
 *   톱니돌 홈 셋 — 위 홈부터 차례로만 끼운다: 위 톱니돌을 끼우고 물레를 한 번 돌려야 다음 홈이 열린다(한 번 열린 홈은
 *   돌을 빼도 닫히지 않는다). 톱니돌을 끼운 고리만 물레를 따라 한 눈금씩 돈다. 빈손으로 [E] 하면 도로 뺀다
 *   숫자판은 하나 — 고리마다 틈에 화살이 있어 바깥 숫자(눈금 번호, gapNotch)를 가리킨다
 *
 * 판정(P09, 서버 판정 input): 뜬 돌 넷 · 톱니돌 셋이 다 물려 있어야 밀 수 있다(화면이 먼저 막는다 — 톱니돌을 주는
 * 독 · 조개밭 · 물고기 굴을 건너뛰고는 못 낸다). 그다음 고리마다 틈이 가리키는 눈금 번호를 ringDoorAnswer 모양으로
 * 한 번 낸다. 서버가 correct · already_completed 라고 답할 때만 문이 열린다 — 정답은 서버에만 있고 이 파일은 모른다.
 * 서버로 보낼 수 없으면(대응표 확정 전 · 세션 없음) 개발 빌드에서만 ringDoorLocalJudge.dev 로 판정하고,
 * 배포 빌드에서는 열지 않고 「연결 필요」를 띄운다. 연결이 끊기면 고리가 그대로일 때 같은 이벤트를 [E] 로 다시 보낸다.
 * 비석을 읽으면 서버에 조사(inspect)로 남긴다(najuInspect) — 제출 조건은 아니다.
 * 치수와 모양은 ringDoorShape, 비석 · 새김 그림은 ringDoorArt. 규칙·상태는 가까이 가면 안내판에 뜬다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { toRadians } from "@/engine/math";

import { NAJU_LOCAL } from "../../progress/najuLocalIds";
import { najuInspect, najuProgress } from "../../progress/najuProgress";
import {
  createPuzzleSubmission,
  verdictNotice,
  type PuzzleVerdict,
  type SubmissionState,
} from "../../progress/puzzleSubmission";
import { recall, track, useRememberedState } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { focusCamera } from "../../scene/cameraFocus";
import { director } from "../../scene/immersion/director";
import { aimedId, interactableFor, setKeyInterceptor, noticeFor } from "../interaction";
import { onEscapeUnlock } from "../pointerHold";
import { inventory } from "../inventory";
import { buildFloatStoneGeometry, buildGearStoneGeometry } from "../itemLooks";
import { makeToonMaterial } from "../materials";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import {
  DOOR,
  FLOOR_Y,
  WHEEL_DEPTH,
  WHEEL_RADIUS,
  registerCaveObstacles,
  setDoorOpen,
  guardBreath,
  guardBreathFor,
  stirSand,
  useCaveShown,
} from "./caveState";
import { isPointerActive } from "@/engine/input/virtualLock";
import { gameNow, gameSetTimeout } from "@/engine/input/gameClock";
import { buildHintStele, buildStele, makeDialFaceTexture, makeWheelFaceTexture } from "./ringDoorArt";
import { DialWheel, GearPost, SPOKE_OUT, Steles } from "./ringDoorParts";
import {
  DARK,
  DIAL,
  FLOAT_SLOTS,
  GAP_DEGREES,
  GEAR_POST,
  GEAR_Y,
  GLOW,
  LIGHT_X,
  LIGHT_Y,
  NOTCHES,
  NOTCH_DEGREES,
  NOTCH_SECONDS,
  PANEL_RANGE,
  RATTLE_SECONDS,
  RIM_RADIUS,
  RING_COLOR,
  RING_LIT,
  RINGS,
  ROLL,
  ROLL_SECONDS,
  TABLET,
  WHEEL_CENTER,
  buildDialStone,
  buildGearSocketGeometry,
  buildRing,
  wrapDegrees,
} from "./ringDoorShape";
import { ringDoorAnswer } from "./ringDoorAnswer";

/** 이 퍼즐(장면)의 글 · 물건 — 다른 퍼즐로 넘어가면 여기서 남긴 글은 내린다(interaction noticeFor · interactableFor) */
const showNotice = noticeFor("ringDoor");
const registerInteractable = interactableFor("ringDoor");

const FLOAT_SLOT_NAMES = ["위", "오른쪽", "아래", "왼쪽"];
/** 물레를 겨누는 너비 — 돌판에 살 손잡이까지. 뜬 돌 끼우기도 돌리기도 이 안이면 된다 */
const DIAL_AIM_RADIUS = DIAL.radius + SPOKE_OUT;
/**
 * 돌바퀴를 겨누는 너비 — 바퀴 가운데가 눈보다 1.3 m 넘게 높아, 좁으면 고개를 들어야만 잡힌다. 눈높이로 바퀴를 봐도 잡히게
 * 얼굴 대부분을 덮되, 바퀴 전체(WHEEL_RADIUS)보다는 좁혀 옆 비석을 보는 시선은 덜 잡는다
 */
const DOOR_AIM_RADIUS = 2.2;
const countFilled = (slots: boolean[]) => slots.filter(Boolean).length;
/**
 * 틈이 가리키는 바퀴 눈금 번호(0~35). 고리 각 angle 은 「틈이 위 눈금에서 문을 마주 보고 왼쪽으로 간 각」이고
 * (mesh.rotation.z = −angle → 틈 가운데가 바퀴 자리 (sin angle, cos angle)), 바퀴 얼굴의 숫자 n 도 같은 자리
 * (ringDoorArt 의 a = 90° − n·10°)에 새겨져 있다. 그래서 눈금 번호 = angle ÷ 한 눈금(10°)
 */
const gapNotch = (angle: number) => Math.round(wrapDegrees(angle) / NOTCH_DEGREES) % NOTCHES;

function createDoorAssets() {
  const wheelFaceTexture = makeWheelFaceTexture();
  const dialFaceTexture = makeDialFaceTexture();
  return {
    rings: RINGS.map((ring) => buildRing(ring.radius, ring.tube)),
    // 고리 — 밝은 맨 돌
    ringMaterials: RINGS.map(() => makeToonMaterial(RING_COLOR, { vertexColors: true, emissive: DARK.clone() })),
    wheelFaceTexture,
    dialFaceTexture,
    stele: buildStele(),
    hintStele: buildHintStele(),
    gearSocket: buildGearSocketGeometry(),
    dialStone: buildDialStone(),
    floatGeometry: buildFloatStoneGeometry(),
    gearGeometry: buildGearStoneGeometry(),
    materials: {
      wheelFace: makeToonMaterial("#FFFFFF", {
        map: wheelFaceTexture,
        emissive: DARK.clone(),
        emissiveMap: wheelFaceTexture,
      }),
      cap: makeToonMaterial(RING_COLOR),
      // 톱니 홈 옆 번호 점 — 돌에 얕게 박힌 옅은 돌알
      dot: makeToonMaterial("#7C8480"),
      frame: makeToonMaterial("#5B6360"),
      wheel: makeToonMaterial("#666E6A"),
      dial: makeToonMaterial("#6D7169"),
      spoke: makeToonMaterial("#6B4E33"),
      rope: makeToonMaterial("#8A7A58"),
      dialFace: makeToonMaterial("#FFFFFF", { map: dialFaceTexture }),
      post: makeToonMaterial("#4C5552"),
      hollow: makeToonMaterial("#1A2022"),
      floatStone: makeToonMaterial("#E2DCCD"),
      gearStone: makeToonMaterial("#6A6E68"),
    },
  };
}

function disposeDoorAssets(assets: ReturnType<typeof createDoorAssets>) {
  for (const stele of [assets.stele, assets.hintStele]) {
    stele.geometry.dispose();
    stele.texture.dispose();
    stele.textMaterial.dispose();
    stele.sideMaterial.dispose();
  }
  [
    ...assets.rings,
    assets.gearSocket.plate,
    assets.gearSocket.floor,
    assets.dialStone,
    assets.floatGeometry,
    assets.gearGeometry,
  ].forEach((geometry) => geometry.dispose());
  [...assets.ringMaterials, ...Object.values(assets.materials)].forEach((material) => material.dispose());
  assets.wheelFaceTexture.dispose();
  assets.dialFaceTexture.dispose();
}

/** 안내판 그림 — 사람이 보는 대로(문을 마주 보고). 틈은 위 눈금에서 왼쪽으로 angle 만큼. 색은 톱니돌 물림만 가른다 */
function RingDiagram({ angles, engaged }: { angles: number[]; engaged: boolean[] }) {
  const radii = [40, 31, 22];
  const widths = [7, 6, 5];
  const arc = (r: number, angle: number) => {
    const from = toRadians(-angle + GAP_DEGREES / 2);
    const to = toRadians(-angle + GAP_DEGREES / 2 + 360 - GAP_DEGREES);
    const point = (a: number) => `${(50 + r * Math.sin(a)).toFixed(2)} ${(50 - r * Math.cos(a)).toFixed(2)}`;
    return `M ${point(from)} A ${r} ${r} 0 1 1 ${point(to)}`;
  };
  return (
    <svg width="120" height="120" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,2 46,9 54,9" fill="#F2EAC8" />
      {RINGS.map((_, k) => (
        <path
          key={k}
          d={arc(radii[k], angles[k])}
          fill="none"
          stroke={engaged[k] ? "#D8DED9" : "#5A6664"}
          strokeWidth={widths[k]}
          strokeLinecap="round"
        />
      ))}
      <circle cx="50" cy="50" r="12" fill="#3B4542" />
    </svg>
  );
}

export default function RingDoor() {
  const isShown = useCaveShown();
  const { camera } = useThree();
  const [floats, setFloats] = useRememberedState<boolean[]>("door.floats", () => Array(FLOAT_SLOTS).fill(false));
  const [gears, setGears] = useRememberedState<boolean[]>("door.gears", [false, false, false]);
  const [isOpen, setIsOpen] = useRememberedState("door.isOpen", false);
  /** 안내판에 적는 각 — 눈금이 넘어갈 때만 바뀐다 */
  const [shownAngles, setShownAngles] = useState(() =>
    recall(
      "door.angles",
      RINGS.map((ring) => ring.start),
    ),
  );
  // 가로채기·회전은 매 프레임 최신 끼움 상태를 봐야 해서 ref 에 비춰 둔다
  const floatsRef = useRef(floats);
  const gearsRef = useRef(gears);
  useLayoutEffect(() => {
    floatsRef.current = floats;
    gearsRef.current = gears;
  }, [floats, gears]);
  /** 끼울 수 있게 열린 톱니돌 홈 수 — 위 홈은 늘 열려 있고, 끼운 홈 아래는 물레를 한 번 돌리면 열린다 */
  const openGearSlots = useRef(recall("door.openGearSlots", 1));
  const angles = useRef(shownAngles);
  const dialAngle = useRef(0);
  const shownDial = useRef(0);
  const isHolding = useRef(false);
  const holdTime = useRef(0);
  // 이미 열린 문은 다 굴러간 뒤로 시작한다(시각은 페이지 시작부터 세므로 0 이면 충분히 지났다).
  const openedAt = useRef(isOpen ? 0 : -1);
  const wobble = useRef(0);
  /** P09 제출 — 연결이 끊긴 이벤트는 여기 쥐고, 고리가 그대로면 [E] 로 같은 이벤트를 다시 보낸다 */
  const [syncState, setSyncState] = useState<SubmissionState>("idle");
  const submission = useMemo(() => createPuzzleSubmission(najuProgress, { onChange: setSyncState }), []);
  /** 판정을 기다리는 중(서버 · 개발용 로컬 판정) — 돌바퀴를 다시 밀 수 없다 */
  const isJudging = useRef(false);
  /** 쥔 이벤트에 실은 답 — 고리를 바꿨으면 다시 보내지 않고 새로 낸다 */
  const heldAnswer = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) setDoorOpen(true);
    const untrackAngles = track("door.angles", () => angles.current);
    const untrackSlots = track("door.openGearSlots", () => openGearSlots.current);
    return () => {
      untrackAngles();
      untrackSlots();
    };
    // 시작할 때 한 번만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assets = useMemo(() => createDoorAssets(), []);
  useEffect(() => () => disposeDoorAssets(assets), [assets]);

  const ringMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const capMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const dialGroup = useRef<THREE.Group>(null);
  const tabletGroup = useRef<THREE.Group>(null);
  const wheelGroup = useRef<THREE.Group>(null);
  /** 화면 고정이 매 프레임 읽는 바퀴 자리(유닛) */
  const wheelSpot = useMemo(() => new THREE.Vector3(), []);

  // 겨누는 자리(유닛) — 물레는 가운데 한 점에 넓은 반지름으로, 홈 넷을 따로 겨누지 않는다
  const spots = useMemo(() => {
    const dialFront = (DIAL.z - DIAL.depth / 2) * M;
    return {
      dial: new THREE.Vector3(DIAL.x * M, DIAL.y * M, dialFront),
      gears: GEAR_Y.map((y) => new THREE.Vector3(GEAR_POST.x * M, y * M, (GEAR_POST.z - 0.15) * M)),
      tablet: new THREE.Vector3(TABLET.x * M, TABLET.y * M, TABLET.z * M),
      door: new THREE.Vector3(WHEEL_CENTER.x * M, WHEEL_CENTER.y * M, WHEEL_CENTER.z * M),
    };
  }, []);

  /** 뜬 돌을 빈 홈에 차례로(위 → 오른쪽 → 아래 → 왼쪽) 끼운다. 한 번 끼운 돌은 빠지지 않는다 */
  const insertFloat = () => {
    const k = floatsRef.current.indexOf(false);
    if (k < 0) return false;
    floatsRef.current = floatsRef.current.map((filled, i) => (i === k ? true : filled));
    setFloats(floatsRef.current);
    audio.play("똑");
    const count = countFilled(floatsRef.current);
    showNotice(
      count === FLOAT_SLOTS
        ? "뜬 돌 넷이 홈에 꼭 맞게 들어갔다. 물레가 묵직하게 걸린다."
        : `뜬 돌이 ${FLOAT_SLOT_NAMES[k]} 홈에 들어갔다. (${count}/${FLOAT_SLOTS})`,
      count === FLOAT_SLOTS ? 4 : 2.5,
    );
    return true;
  };
  /** 아직 아무것도 물리지 않은 돌바퀴를 밀었다 — 무엇을 보아야 하는지 알린다 */
  const noticeDoorStuck = () =>
    showNotice(
      "돌바퀴는 밀어도 꿈쩍도 않는다 — 얼굴에 겹친 고리 셋이 바퀴를 물고 있다. 고리마다 갈라진 틈이 하나씩 있고, 오른쪽에 비석 둘과 돌 물레, 톱니돌 홈이 있다.",
      6,
    );
  /** 빈 톱니돌 홈이 남은 채 밀었다 — 고리가 맞았는지와 상관없이 같은 말 */
  const noticeEmptyGearSlot = () => showNotice("비어 있는 톱니돌 홈이 있다 — 홈 셋이 다 물려야 돌바퀴가 구른다.", 4.5);
  /** 서버(또는 개발용 로컬 판정)가 틀렸다고 했다 — 어느 고리인지는 알리지 않는다 */
  const noticeWrong = () => {
    wobble.current = 1;
    audio.play("똑");
    showNotice("돌바퀴가 꿈쩍도 않는다. 고리가 아직 제자리가 아닌 것 같다.", 4);
  };
  /** 문을 연다 — 서버 correct · already_completed 또는 개발용 로컬 판정에서만 부른다. 두 번 불려도 한 번만 */
  const openDoor = () => {
    if (openedAt.current >= 0) return;
    openedAt.current = gameNow() / 1000;
    isHolding.current = false;
    setIsOpen(true);
    // 문이 열리는 장면 — 덜컹이고 바퀴가 다 굴러갈 때까지(화면 고정 3.7 s 보다 길다) 숨이 줄지 않는다(미르 11/10)
    guardBreathFor("ring-door-open", RATTLE_SECONDS + ROLL_SECONDS + 0.4);
    // 바퀴가 다 굴러간 뒤에야 지나갈 수 있다
    gameSetTimeout(() => setDoorOpen(true), (RATTLE_SECONDS + ROLL_SECONDS * 0.8) * 1000);
    // 물속이 쿵 울린다 — 처음 덜컹에 크게, 구르는 동안은 매 프레임 잔떨림
    director.cue({ 카메라: "흔들림", 세기: 0.9 });
    stirSand(0.9);
    focusCamera({
      id: "ring-door-open",
      target: () => wheelGroup.current?.getWorldPosition(wheelSpot) ?? wheelSpot,
      hold: RATTLE_SECONDS + 1.4,
      turnIn: 0.6,
      turnOut: 0.6,
      zoom: 0.9,
    });
    audio.play("우르릉");
    audio.play("징");
    showNotice("틈 셋이 한 줄로 섰다. 돌바퀴가 무겁게 굴러간다 — 석실로 가는 길이 열렸다.", 5);
  };
  /** 판정 → 문. 여는 것은 correct · already_completed 뿐이다 */
  const settle = async (verdict: PuzzleVerdict, notches: readonly number[]) => {
    if (verdict.kind === "correct" || verdict.kind === "already-completed") {
      openDoor();
      return;
    }
    // 서버를 쓸 수 없을 때만, 개발 빌드에서만 — 배포 빌드에는 이 분기와 판정 파일이 들어가지 않는다
    if (import.meta.env.DEV) {
      if (verdict.kind === "unavailable") {
        const { isLocalRingDoorCorrect } = await import("./ringDoorLocalJudge.dev");
        if (isLocalRingDoorCorrect(notches)) openDoor();
        else noticeWrong();
        return;
      }
    }
    if (verdict.kind === "incorrect") {
      noticeWrong();
      return;
    }
    // 그 밖에는 안내만 — 완료로 보지 않는다
    const notice = verdictNotice(verdict);
    if (notice) showNotice(notice, 4.5);
  };
  /**
   * 돌바퀴를 민다 — 문을 여는 판정은 여기서만 낸다. 장착(뜬 돌 넷 · 톱니돌 셋)은 화면이 먼저 막고,
   * 다 물렸으면 고리 셋의 눈금 번호를 한 번 내고 답을 기다린다(settle).
   */
  const tryOpenDoor = async () => {
    if (openedAt.current >= 0 || isJudging.current) return;
    const seated = countFilled(gearsRef.current);
    if (seated < RINGS.length) {
      if (seated === 0) noticeDoorStuck();
      else noticeEmptyGearSlot();
      return;
    }
    if (countFilled(floatsRef.current) < FLOAT_SLOTS) {
      noticeDoorStuck();
      return;
    }
    const notches = angles.current.map(gapNotch);
    const answer = ringDoorAnswer(notches);
    isJudging.current = true;
    // 판정을 기다리는 동안도 숨을 지킨다 — 맞으면 openDoor 가 이어 지키고, 틀리거나 끊기면 여기서 풀린다(Codex 01)
    const releaseJudgeGuard = guardBreath("ring-door-judge");
    try {
      // 연결이 끊겨 쥔 이벤트가 있고 고리가 그대로면 같은 이벤트를, 바뀌었으면 새 시도를 보낸다(쥔 것은 버려진다)
      const verdict =
        submission.canRetry() && heldAnswer.current === answer
          ? await submission.retry()
          : await submission.submit({
              action: "input",
              zone: NAJU_LOCAL.zones.caveHall,
              object: NAJU_LOCAL.objects.P09,
              answer,
            });
      heldAnswer.current = answer;
      if (verdict) await settle(verdict, notches);
    } finally {
      isJudging.current = false;
      releaseJudgeGuard();
    }
  };
  /** 톱니돌은 위 홈부터 — 열리지 않은 홈이면 거절한다(물건은 손 · 소지품에 남는다) */
  const insertGear = (k: number) => {
    if (gearsRef.current[k]) return false;
    if (k >= openGearSlots.current) {
      showNotice("홈이 꽉 막혀 있다 — 위 홈부터 차례로. 위 톱니돌을 끼우고 물레를 한 번 돌리면 다음 홈이 열린다.", 4);
      return false;
    }
    setGears((previous) => previous.map((filled, i) => (i === k ? true : filled)));
    audio.play("단서");
    showNotice(`${RINGS[k].name}가 물레에 물렸다. 이제 물레를 돌리면 같이 돈다.`, 3.5);
    return true;
  };
  const removeGear = (k: number) => {
    if (!gearsRef.current[k]) return;
    if (!inventory.add("gearStone")) {
      showNotice("소지품이 가득 찼다.", 3.2, { urgent: true, fleeting: true });
      return;
    }
    setGears((previous) => previous.map((filled, i) => (i === k ? false : filled)));
    audio.play("똑");
    showNotice(`${RINGS[k].name}에서 톱니돌을 뺐다. 그 고리는 지금 자리에 멈춘다.`, 3);
  };
  /** 다이얼을 눈금만큼 돌린다 — 물린 고리가 제 비율로 따라 돌고, 물린 홈 아래 홈이 열린다 */
  const turn = (notches: number) => {
    dialAngle.current += NOTCH_DEGREES * notches;
    RINGS.forEach((ring, k) => {
      if (!gearsRef.current[k]) return;
      angles.current[k] += ring.perNotch * notches;
      openGearSlots.current = Math.min(RINGS.length, Math.max(openGearSlots.current, k + 2));
    });
    setShownAngles([...angles.current]);
    audio.play("똑");
  };

  useEffect(() => {
    if (!isShown) return undefined;
    const filled = countFilled(floats);
    const disposers = [
      // 물레 하나가 뜬 돌 끼우기와 돌리기를 다 받는다 — 돌리기는 [E] 를 누르고 있는 동안 가로채기가 맡으니 use 는 안내만
      registerInteractable({
        id: "cave-valve",
        position: spots.dial,
        label: filled < FLOAT_SLOTS ? `물레 — 뜬 돌 홈 ${filled}/${FLOAT_SLOTS}` : "물레 돌리기 (E 꾹)",
        highlight: () => dialGroup.current,
        radius: DIAL_AIM_RADIUS * M,
        reach: 2.8 * M,
        enabled: () => !isOpen,
        use: () => {},
        handLabel: (kind) => (kind === "floatStone" && filled < FLOAT_SLOTS ? "뜬 돌 끼우기" : null),
        receive: insertFloat,
      }),
      ...spots.gears.map((spot, k) =>
        registerInteractable({
          id: `cave-gear-${k}`,
          position: spot,
          label: gears[k] ? `${RINGS[k].name} 홈 — 톱니돌 빼기` : `${RINGS[k].name} 홈 — 비었음`,
          radius: 0.2 * M,
          reach: 2.8 * M,
          enabled: () => !isOpen,
          use: () =>
            gears[k]
              ? removeGear(k)
              : showNotice("톱니돌이 들어갈 홈이다. 큰 방 세 곳(독 · 조개밭 · 숨구멍)에서 톱니돌을 찾을 수 있다.", 4),
          handLabel: (kind) => (kind === "gearStone" && !gears[k] ? "톱니돌 끼우기" : null),
          receive: () => insertGear(k),
        }),
      ),
      registerInteractable({
        id: "cave-tablet",
        position: spots.tablet,
        label: "비석 읽기",
        highlight: () => tabletGroup.current,
        radius: 0.4 * M,
        reach: 3 * M,
        // 알림이 먼저 — 서버 기록(조사)은 기다리지 않고 뒤에서 보낸다. 준비 전이면 기억해 두었다가 한 번 보낸다
        use: () => {
          showNotice("비석에 수수께끼가 새겨져 있다 — 「갈라진 입」은 무엇이고 「하늘」은 어디일까.", 6);
          void najuInspect.note(NAJU_LOCAL.zones.caveHall, NAJU_LOCAL.objects.caveTablet);
        },
      }),
      // 다 물렸으면 눈금을 내고 답을 기다린다. 아니면 안 밀리는 까닭을 알린다. 판정을 기다리는 동안은 못 민다
      registerInteractable({
        id: "cave-door",
        position: spots.door,
        label: syncState === "retryable" ? "판정 다시 받기" : "돌바퀴 밀기",
        radius: DOOR_AIM_RADIUS * M,
        reach: 5 * M,
        enabled: () => !isOpen && !isJudging.current,
        use: () => void tryOpenDoor(),
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, floats, gears, isOpen, spots, syncState]);

  // 몸이 뚫고 지나가지 않게 — 비석 둘 · 물레 굴대 · 톱니돌 기둥
  useEffect(() => {
    if (!isShown) return undefined;
    return registerCaveObstacles([
      { x: TABLET.x, z: TABLET.z - 0.08, radius: 0.55, top: FLOOR_Y + 1.72, name: "비석" },
      { x: TABLET.x + 0.92, z: TABLET.z - 0.42, radius: 0.36, top: FLOOR_Y + 0.97, name: "비석" },
      { x: DIAL.x, z: DIAL.z + 0.1, radius: 0.32, top: DIAL.y + DIAL.radius, name: "물레" },
      { x: GEAR_POST.x, z: GEAR_POST.z + 0.05, radius: 0.3, top: FLOOR_Y + 2.3, name: "돌기둥" },
    ]);
  }, [isShown]);

  // 다이얼은 [E] 를 꾹 누르는 동안 돈다 — keydown 을 가로채고 keyup 에서 놓는다.
  // 손에 든 것이 있거나 소지품에 뜬 돌이 있어 끼울 차례면 가로채지 않는다 — 그 E 는 물건 쓰기(WorldItems)가 받는다
  useEffect(() => {
    if (!isShown) return undefined;
    setKeyInterceptor(() => {
      if (aimedId() !== "cave-valve" || inventory.hand()) return false;
      const filled = countFilled(floatsRef.current);
      if (filled < FLOAT_SLOTS) {
        if (inventory.has("floatStone")) return false;
        showNotice(`물레가 헛돈다 — 뜬 돌 넷을 가운데 홈에 다 끼워야 걸린다. (지금 ${filled}/${FLOAT_SLOTS})`, 3.5, {
          urgent: true,
          fleeting: true,
        });
        wobble.current = 1;
        return true;
      }
      if (!gearsRef.current.some(Boolean))
        showNotice("물린 고리가 없다 — 물레만 돈다. 톱니돌을 홈에 끼우자.", 3, { urgent: true, fleeting: true });
      isHolding.current = true;
      holdTime.current = NOTCH_SECONDS; // 누르자마자 한 눈금
      return true;
    });
    const release = (event: KeyboardEvent) => {
      if (event.code === "KeyE") isHolding.current = false;
    };
    const blur = () => {
      isHolding.current = false;
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    // ESC 로 잠금이 풀리면 돌리던 물레를 멈춘다 — 첫 ESC 는 돌리기 전으로(pointerHold)
    const removeEscape = onEscapeUnlock(() => {
      if (!isHolding.current) return false;
      isHolding.current = false;
      return true;
    });
    return () => {
      removeEscape();
      setKeyInterceptor(null);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, [isShown]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuDoorDev", {
      insertFloat: () => {
        if (inventory.consume("floatStone")) insertFloat();
      },
      fillValve: () => {
        for (let k = 0; k < FLOAT_SLOTS; k++) if (inventory.consume("floatStone")) insertFloat();
      },
      // 위 홈부터 차례 규칙은 여기서도 지킨다 — 거절되면 톱니돌은 소지품에 남는다
      insertGear: (k: number) => {
        if (inventory.has("gearStone") && insertGear(k)) inventory.consume("gearStone");
      },
      removeGear,
      openGearSlots: () => openGearSlots.current,
      dial: () => dialAngle.current,
      turn: (notches: number) => turn(notches),
      angles: () => angles.current.map(wrapDegrees),
      // 낼 답의 눈금 번호 — 바퀴 숫자 그대로
      notches: () => angles.current.map(gapNotch),
      filled: () => ({ floats: floatsRef.current, gears: gearsRef.current }),
      tryOpen: () => tryOpenDoor(),
      sync: () => submission.state(),
      isOpen: () => openedAt.current >= 0,
    });
  }, []);

  useEffect(() => () => setPuzzlePanel("cave-door", null), []);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = gameNow() / 1000;
    if (isHolding.current && openedAt.current < 0) {
      if (!isPointerActive() || aimedId() !== "cave-valve") isHolding.current = false;
      else {
        holdTime.current += dt;
        // 프레임이 길면 밀린 눈금을 한꺼번에 돈다
        while (isHolding.current && holdTime.current >= NOTCH_SECONDS) {
          holdTime.current -= NOTCH_SECONDS;
          turn(1);
        }
      }
    }
    wobble.current = Math.max(0, wobble.current - dt * 3);
    const shake = Math.sin(time * 40) * wobble.current * 0.04;
    // 고리 · 틈 끝 구슬 · 빛. 빛은 서버가 맞다고 해 문이 열린 뒤에만 — 고리가 맞았는지는 화면이 모른다
    const isLit = openedAt.current >= 0;
    RINGS.forEach((ring, k) => {
      const angle = angles.current[k];
      const mesh = ringMeshes.current[k];
      if (mesh) mesh.rotation.z += (-toRadians(angle) + shake - mesh.rotation.z) * Math.min(1, dt * 9);
      assets.ringMaterials[k].emissive.lerp(isLit ? RING_LIT : DARK, Math.min(1, dt * 4));
      const shown = mesh ? -mesh.rotation.z : toRadians(angle);
      for (let end = 0; end < 2; end++) {
        const cap = capMeshes.current[k * 2 + end];
        if (!cap) continue;
        const a = Math.PI / 2 + (end === 0 ? -1 : 1) * (toRadians(GAP_DEGREES) / 2) - shown;
        cap.position.set(Math.cos(a) * ring.radius, Math.sin(a) * ring.radius, 0);
      }
    });
    // 바퀴 얼굴 새김 — 문이 열리면 새긴 홈마다 따뜻한 흰빛이 스민다
    const faceGlow = isLit ? 0.35 + 0.05 * Math.sin(time * 4) : 0;
    assets.materials.wheelFace.emissive.lerp(GLOW.clone().multiplyScalar(faceGlow), Math.min(1, dt * 5));
    // 여기서는 열지 않는다 — 서버 판정을 받은 tryOpenDoor 만 연다
    shownDial.current += (dialAngle.current - shownDial.current) * Math.min(1, dt * 9);
    if (dialGroup.current) dialGroup.current.rotation.z = -toRadians(shownDial.current) + shake * 2;
    // 열리면 바퀴가 통째로 왼쪽(+x)으로 굴러간다 — 구른 만큼 돈다(미끄러지지 않게)
    if (wheelGroup.current && openedAt.current >= 0) {
      const since = time - openedAt.current;
      // 먼저 제자리에서 덜컹덜컹 떨고, 그 뒤 구른다. 구르는 동안 바닥이 울려 화면이 잘게 흔들린다
      const rattle = since < RATTLE_SECONDS ? (1 - since / RATTLE_SECONDS) * 0.5 + 0.5 : 0;
      if (since < RATTLE_SECONDS + ROLL_SECONDS) {
        director.cue({ 카메라: "흔들림", 세기: dt * (rattle > 0 ? 2.2 : 1.1) });
        stirSand(dt * 0.45);
      }
      const t = THREE.MathUtils.smootherstep((since - RATTLE_SECONDS) / ROLL_SECONDS, 0, 1);
      const rolled = ROLL * t;
      // 덜컹 — 바퀴가 제자리에서 좌우로 떨고 들썩인다
      const jolt = rattle * (Math.sin(time * 47) * 0.025 + Math.sin(time * 31) * 0.015);
      wheelGroup.current.position.x = WHEEL_CENTER.x + rolled + jolt;
      wheelGroup.current.position.y = WHEEL_CENTER.y + Math.abs(Math.sin(time * 23)) * rattle * 0.03;
      wheelGroup.current.rotation.z = -rolled / WHEEL_RADIUS + jolt * 0.6;
    }
    // 안내판
    const distance = Math.hypot(camera.position.x / M - WHEEL_CENTER.x, camera.position.z / M - WHEEL_CENTER.z);
    if (distance > PANEL_RANGE || isOpen) setPuzzlePanel("cave-door", null);
    else {
      const filled = countFilled(floatsRef.current);
      setPuzzlePanel("cave-door", {
        distance,
        title: "물레 고리문",
        rule: "여는 법은 큰 비석에 수수께끼로 새겨져 있다. 검게 지워진 말은 왼쪽 작은 비석의 초성과 뜻풀이로 채운다.\n뜬 돌은 물레를 겨눠 [E] 로 끼운다(한 번 끼우면 안 빠진다). 물레는 겨눠 [E] 를 꾹.\n톱니돌은 위 홈부터 — 하나 끼우고 물레를 돌려야 다음 홈이 열린다. 빈손 [E] 로 도로 뺀다.\n돌바퀴는 겨눠 [E] 로 민다.",
        diagram: <RingDiagram angles={shownAngles} engaged={gearsRef.current} />,
        rows: [
          { label: "물레", value: `뜬 돌 ${filled}/${FLOAT_SLOTS}`, ok: filled === FLOAT_SLOTS },
          // 고리마다 지금 눈금(바퀴 숫자 그대로)과 톱니돌 물림만 — 맞았는지는 서버만 안다
          ...RINGS.map((ring, k) => ({
            label: ring.name,
            value: `눈금 ${gapNotch(shownAngles[k])} · ${gearsRef.current[k] ? "물림" : "비었음"}`,
          })),
        ],
      });
    }
  });

  if (!isShown) return null;
  const { materials } = assets;
  return (
    <group scale={M}>
      {/* 돌바퀴 — 단 위에 서 있다. 얼굴(−z)에 고리·숫자판·허브. 풀리면 통째로 굴러간다 */}
      <group ref={wheelGroup} position={[WHEEL_CENTER.x, WHEEL_CENTER.y, WHEEL_CENTER.z]}>
        <mesh material={materials.wheel} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_DEPTH, 72]} />
        </mesh>
        {/* 둘레 돌테 */}
        <mesh material={materials.frame} position={[0, 0, -WHEEL_DEPTH / 2 + 0.02]}>
          <torusGeometry args={[RIM_RADIUS, 0.11, 10, 72]} />
        </mesh>
        {/* 바퀴 얼굴 — 숫자 · 눈금 · 고리 홈 · 가운데 물고기 한 쌍을 돌에 새긴 한 장 */}
        <mesh material={materials.wheelFace} position={[0, 0, -WHEEL_DEPTH / 2 - 0.006]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[RIM_RADIUS - 0.06, 96]} />
        </mesh>
        {/* 고리 셋 — 얼굴에서 조금 나와 있다 */}
        {RINGS.map((_, k) => (
          <group key={k} position={[0, 0, -WHEEL_DEPTH / 2]}>
            <mesh
              ref={(mesh) => {
                ringMeshes.current[k] = mesh;
              }}
              geometry={assets.rings[k]}
              material={assets.ringMaterials[k]}
              castShadow
            />
          </group>
        ))}
        {/* 틈 끝 구슬 — 틈이 어디 있는지 멀리서도 읽힌다 */}
        <group position={[0, 0, -WHEEL_DEPTH / 2]}>
          {RINGS.map((_, k) =>
            [0, 1].map((end) => (
              <mesh
                key={`${k}-${end}`}
                ref={(mesh) => {
                  capMeshes.current[k * 2 + end] = mesh;
                }}
                material={materials.cap}
              >
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
            )),
          )}
        </group>
      </group>
      <DialWheel assets={assets} floats={floats} dialRef={dialGroup} />
      <GearPost assets={assets} gears={gears} />
      <Steles assets={assets} tabletRef={tabletGroup} />
      {/* 문 앞 은은한 빛 — 등불 모형 없이 빛만 */}
      {LIGHT_X.map((x) => (
        <pointLight
          key={x}
          color="#FFE6C4"
          intensity={0.9}
          distance={7 * M}
          decay={1.6}
          position={[x, LIGHT_Y, DOOR.z - 1.2]}
        />
      ))}
    </group>
  );
}
