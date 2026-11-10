/**
 * 물고기 굴 — 큰 방 동쪽 벽 밑 바위에 굴 넷. 굴마다 물고기가 숨어 있다.
 *   가운데 돌 항아리를 [E] 로 두드리면 물고기들이 정해진 차례로 고개를 내밀었다 들어간다.
 *   본 차례 그대로 굴을 [E] 로 두드려 따라 한다. 넷 · 다섯 · 여섯 마리, 판마다 빨라진다. 차례는 들어올 때마다 새로 뽑는다.
 *   한 판을 맞추면 그 판의 물고기들은 굴을 나와 큰 방을 헤엄쳐 다니고, 다음 판엔 굴 안의 다른 물고기가 나온다.
 *   세 판을 다 맞추면 항아리 뚜껑이 밀려나고 톱니돌이 굴러 나오며 공기가 솟는다.
 *   틀리면 물고기들이 놀라 숨는다 — 항아리를 다시 두드려 차례를 다시 본다.
 * 규칙은 가까이 가면 안내판에 뜬다. 자리는 미터.
 */
import { gameNow } from "@/engine/input/gameClock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { useRememberedState } from "../../save/puzzleMemory";
import { buildBakedRockPrototypes } from "../../models/nature";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makeToonMaterial } from "../materials";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import AirColumn from "./AirColumn";
import { FISH_BURROWS, floorY, guardBreathFor, stirSand, useCaveShown } from "./caveState";
import { SPECIES, buildFishGeometry } from "./fishLooks";
import { normalizePrototype } from "./seabed";

/** 굴 넷 — 동쪽 벽 밑에 남북으로. 입이 서쪽(−x, 방 가운데)을 본다. 왼쪽(북)부터 피라미 · 쉬리 · 붕어 · 메기 */
const BURROWS = [-1.5, -0.5, 0.5, 1.5].map((k) => ({ x: FISH_BURROWS.x + 0.55, z: FISH_BURROWS.z + k * 0.78 }));
/** 굴에서 보이는 물고기 길이(미터) — 피라미는 실물보다 키워야 읽힌다 */
const FISH_LENGTH = [0.28, 0.34, 0.42, 0.52];
/** 굴 입 높이(바닥에서) — 기둥돌 사이 틈(높이 0.36)의 가운데 */
const MOUTH_Y = 0.17;
/** 굴 틈 — 기둥돌 사이 너비 · 덮개돌 밑 높이(미터) */
const GAP = { half: 0.16, height: 0.36 };
/** 고개를 내미는 길이 · 판마다 차례 사이(초) — 갈수록 빨라진다. 고개 내미는 시간은 그 0.8 배 */
const PEEK_OUT = 0.5;
const NOTE_SECONDS = [0.6, 0.44, 0.32];
const peekSeconds = (round: number) => NOTE_SECONDS[Math.min(round, NOTE_SECONDS.length - 1)] * 0.8;
/** 판 r 에서 굴 k 에 숨은 물고기 종 — 판이 바뀌면 다른 물고기가 나온다 */
const speciesAt = (round: number, k: number) => (k + round) % SPECIES.length;
/** 굴을 나온 물고기가 헤엄쳐 다니는 네모(미터) — 큰 방 동쪽 반 */
const ROAM = { x: [46, 53] as const, z: [60, 72] as const, y: [0.6, 2.6] as const };
/** 판마다 따라 할 수 — 넷 · 다섯 · 여섯(11/4 「더 어렵게」) */
const ROUND_LENGTHS = [4, 5, 6];
/** 틀렸을 때 붉게 번쩍이는 시간(초) */
const WRONG_FLASH_SECONDS = 0.6;

/** 판마다 물고기가 나오는 차례(굴 번호) — 같은 굴이 연달아 나오지 않게 새로 뽑는다 */
function makeRounds() {
  return ROUND_LENGTHS.map((length) => {
    const sequence: number[] = [];
    while (sequence.length < length) {
      const k = Math.floor(Math.random() * BURROWS.length);
      if (sequence[sequence.length - 1] !== k) sequence.push(k);
    }
    return sequence;
  });
}
/** 돌 항아리 — 굴 앞 */
const POT = { x: FISH_BURROWS.x - 0.85, z: FISH_BURROWS.z };
const PANEL_RANGE = 5;

/** 돌 항아리 옆선(미터) — 배가 부르고 입이 좁다 */
const POT_PROFILE: [number, number][] = [
  [0, 0],
  [0.19, 0],
  [0.27, 0.12],
  [0.29, 0.28],
  [0.22, 0.42],
  [0.15, 0.47],
  [0.17, 0.52],
  [0.15, 0.53],
];
const POT_TOP = POT_PROFILE[POT_PROFILE.length - 1][1];

/** 굴을 나온 물고기 — 종 · 자리 · 빠르기 · 가는 곳 */
interface Swimmer {
  species: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  until: number;
}

function createBurrowAssets() {
  const glowTexture = makeGlowTexture();
  // 굴 바위 — 큰 방 바위와 같은 표본. 굴마다 다른 꼴
  const prototypes = buildBakedRockPrototypes().map(normalizePrototype);
  // 굴마다 돌 넷 — 양옆 기둥돌 · 위 덮개돌 · 안쪽 뒷돌. 사이 틈이 곧 굴 입이다
  const rocks = BURROWS.map((_, k) =>
    [0, 1, 2, 3].map((n) => prototypes[(k * 3 + n * 2 + 1) % prototypes.length].clone()),
  );
  prototypes.forEach((geometry) => geometry.dispose());
  return {
    rocks,
    fish: SPECIES.map((species) => buildFishGeometry(species)),
    pot: new THREE.LatheGeometry(
      POT_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    ),
    materials: {
      // 굴마다 재질을 따로 — 겨눈 굴만 밝아지게
      rocks: BURROWS.map(() => makeToonMaterial("#6A7574", { vertexColors: true })),
      // 굴 속 뒷돌 — 틈으로만 보이는 깊은 어둠
      inside: makeToonMaterial("#0D1412"),
      fish: makeToonMaterial("#FFFFFF", { vertexColors: true, side: THREE.DoubleSide }),
      // 굴 입의 빛무리 — 물고기가 고개를 내밀 때 같이 번쩍여 어느 굴인지 멀리서도 읽힌다
      glows: BURROWS.map(
        () =>
          new THREE.SpriteMaterial({
            map: glowTexture,
            color: "#BFEBFF",
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
            toneMapped: false,
          }),
      ),
      pot: makeToonMaterial("#6A655A"),
      potBand: makeToonMaterial("#8A6A3A", { emissive: new THREE.Color("#2A1E0A") }),
    },
  };
}

function disposeBurrowAssets(assets: ReturnType<typeof createBurrowAssets>) {
  assets.rocks.flat().forEach((geometry) => geometry.dispose());
  assets.fish.forEach((geometry) => geometry.dispose());
  assets.pot.dispose();
  const { rocks, glows, ...rest } = assets.materials;
  glows[0].map?.dispose();
  [...rocks, ...glows, ...Object.values(rest)].forEach((material) => material.dispose());
}

export default function FishBurrows() {
  const isShown = useCaveShown();
  const { camera } = useThree();
  /** 맞춘 판 수 */
  const [roundsDone, setRoundsDone] = useRememberedState("burrows.roundsDone", 0);
  /** 지금 판에서 따라 한 수 · 차례를 본 뒤 따라 할 수 있나 */
  const [inputCount, setInputCount] = useState(0);
  const [isAwaiting, setIsAwaiting] = useState(false);
  const rounds = useMemo(() => makeRounds(), []);
  const isSolved = roundsDone >= rounds.length;
  const roundsRef = useRef(roundsDone);
  /** 마지막 보상(톱니돌)을 줬나 — 판 수는 solve 전에 오르므로 판 수로는 못 막는다(Codex 04). 두 번 주지 않게 */
  const isRewardedRef = useRef(roundsDone >= rounds.length);
  const inputRef = useRef(0);
  const awaitingRef = useRef(false);
  /** 차례 보여 주기 — 시작 시각(없으면 −1) · 다음 판 자동 시작 시각 */
  const playStart = useRef(-1);
  const autoPlayAt = useRef(-1);
  const peekAt = useRef(BURROWS.map(() => -99));
  const startledAt = useRef(-99);
  /** 마지막으로 틀린 때 · 그때 두드린 굴 */
  const wrongAt = useRef(-99);
  const wrongBurrow = useRef(-1);
  const solvedAt = useRef(isSolved ? 0 : -1);
  /** 판마다 그 판에 나온 물고기가 더해진다 */
  const swimmers = useRef<Swimmer[]>([]);
  const swimmerMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const burrowFishMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const lastTime = useRef(0);
  const wanted = useMemo(() => new THREE.Vector3(), []);
  const lid = useRef<THREE.Group>(null);
  const potGroup = useRef<THREE.Group>(null);
  const rockGroups = useRef<(THREE.Group | null)[]>([]);

  const assets = useMemo(() => createBurrowAssets(), []);
  useEffect(() => () => disposeBurrowAssets(assets), [assets]);

  const spots = useMemo(
    () => ({
      burrows: BURROWS.map(
        (burrow) => new THREE.Vector3((burrow.x - 0.1) * M, (floorY(burrow.x, burrow.z) + MOUTH_Y) * M, burrow.z * M),
      ),
      pot: new THREE.Vector3(POT.x * M, (floorY(POT.x, POT.z) + 0.4) * M, POT.z * M),
    }),
    [],
  );

  // 게임 시계 — 「전부 멈춤」(창 · 게임 밖 · PC 일시정지) 동안은 흐르지 않는다. 실제 시계면 오래 멈췄다 돌아올 때 차례 시범이 건너뛰어졌다(Codex 리뷰)
  const now = () => gameNow() / 1000;

  const play = () => {
    if (roundsRef.current >= rounds.length || playStart.current >= 0) return;
    playStart.current = now() + 0.4;
    autoPlayAt.current = -1;
    awaitingRef.current = false;
    setIsAwaiting(false);
    inputRef.current = 0;
    setInputCount(0);
    audio.play("똑");
  };

  const solve = () => {
    if (isRewardedRef.current) return;
    isRewardedRef.current = true;
    roundsRef.current = rounds.length;
    setRoundsDone(rounds.length);
    awaitingRef.current = false;
    setIsAwaiting(false);
    solvedAt.current = now();
    // 물고기들이 굴을 나오고 항아리 뚜껑이 밀려나는 것을 보는 동안은 숨이 줄지 않는다(미르 11/10)
    guardBreathFor("burrows-open", 3);
    audio.play("징");
    audio.play("우르릉");
    director.cue({ 카메라: "흔들림", 세기: 0.7 });
    stirSand(1.2);
    showNotice("마지막 물고기들까지 굴을 나오자 항아리 뚜껑이 밀려난다. 공기가 솟고 톱니돌이 굴러 나왔다.", 5.5);
    inventory.spawn(
      "gearStone",
      new THREE.Vector3((POT.x - 0.45) * M, (floorY(POT.x, POT.z) + 0.03) * M, (POT.z + 0.3) * M),
    );
  };

  /** 한 판을 다 따라 했다 — 이 판에 나온 물고기들이 굴을 나와 헤엄쳐 간다 */
  const releaseRound = (sequence: number[]) => {
    const round = roundsRef.current;
    [...new Set(sequence)].forEach((b) => {
      const burrow = BURROWS[b];
      const y = floorY(burrow.x, burrow.z) + MOUTH_Y;
      swimmers.current.push({
        species: speciesAt(round, b),
        pos: new THREE.Vector3(burrow.x - 0.3, y, burrow.z),
        vel: new THREE.Vector3(-1.2, 0.3, (Math.random() - 0.5) * 0.6),
        target: new THREE.Vector3(
          burrow.x - 3 - Math.random() * 2,
          y + 1 + Math.random(),
          burrow.z + (Math.random() - 0.5) * 4,
        ),
        until: now() + 2 + Math.random() * 2,
      });
    });
    roundsRef.current += 1;
    setRoundsDone(roundsRef.current);
    awaitingRef.current = false;
    setIsAwaiting(false);
    if (roundsRef.current >= rounds.length) {
      solve();
      return;
    }
    audio.play("단서");
    director.cue({ 카메라: "흔들림", 세기: 0.25 });
    stirSand(0.5);
    showNotice(
      `맞았다 (${roundsRef.current}/${rounds.length}). 물고기들이 굴을 나와 헤엄쳐 간다 — 굴 안의 다른 물고기들이 다음 차례를 보여 준다.`,
      4,
    );
    autoPlayAt.current = now() + 2.4;
  };

  const tap = (k: number) => {
    if (roundsRef.current >= rounds.length) return;
    if (playStart.current >= 0) return;
    peekAt.current[k] = now();
    if (!awaitingRef.current) {
      audio.play("똑");
      showNotice("물고기가 고개를 내밀었다 들어간다. 먼저 가운데 항아리를 두드려 차례를 보자.", 3.5);
      return;
    }
    const sequence = rounds[roundsRef.current];
    if (sequence[inputRef.current] !== k) {
      inputRef.current = 0;
      setInputCount(0);
      awaitingRef.current = false;
      setIsAwaiting(false);
      startledAt.current = now();
      wrongAt.current = now();
      wrongBurrow.current = k;
      audio.play("우르릉");
      director.cue({ 카메라: "흔들림", 세기: 0.35 });
      stirSand(0.6);
      showNotice("차례가 틀렸다 — 물고기들이 놀라 굴 깊이 숨었다. 항아리를 다시 두드려 차례를 다시 보자.", 4);
      return;
    }
    inputRef.current += 1;
    setInputCount(inputRef.current);
    audio.play("똑");
    if (inputRef.current >= sequence.length) releaseRound(sequence);
  };

  // 상호작용 · 개발 훅은 늘 최신 풀이 함수를 부른다
  const actions = { play, tap, solve };
  const actionsRef = useRef(actions);
  useLayoutEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    if (!isShown) return undefined;
    const disposers = [
      registerInteractable({
        id: "cave-burrow-pot",
        position: spots.pot,
        label: isSolved ? "돌 항아리 — 공기가 솟는다" : "돌 항아리 두드리기",
        highlight: () => potGroup.current,
        radius: 0.4 * M,
        reach: 2.8 * M,
        enabled: () => !isSolved,
        use: () => actionsRef.current.play(),
      }),
      ...BURROWS.map((_, k) =>
        registerInteractable({
          id: `cave-burrow-${k}`,
          position: spots.burrows[k],
          label: "굴 두드리기",
          highlight: () => rockGroups.current[k],
          radius: 0.24 * M,
          reach: 2.8 * M,
          enabled: () => !isSolved,
          use: () => actionsRef.current.tap(k),
        }),
      ),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, isSolved, spots]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuBurrowsDev", {
      play: () => actionsRef.current.play(),
      tap: (k: number) => actionsRef.current.tap(k),
      sequence: () => rounds[roundsRef.current] ?? [],
      rounds: () => roundsRef.current,
      solve: () => actionsRef.current.solve(),
    });
  }, [rounds]);

  useEffect(() => () => setPuzzlePanel("cave-burrows", null), []);

  useFrame(() => {
    if (!isShown) return;
    const time = now();
    if (autoPlayAt.current >= 0 && time >= autoPlayAt.current) play();
    // 차례 보여 주기 — 차례가 된 굴의 물고기가 고개를 내민다
    if (playStart.current >= 0) {
      const sequence = rounds[roundsRef.current];
      const note = NOTE_SECONDS[roundsRef.current];
      const step = Math.floor((time - playStart.current) / note);
      if (step >= 0 && step < sequence.length) {
        const k = sequence[step];
        const at = playStart.current + step * note;
        if (peekAt.current[k] < at - 0.01) {
          peekAt.current[k] = at;
          audio.play("똑");
        }
      }
      if (step >= sequence.length) {
        playStart.current = -1;
        awaitingRef.current = true;
        setIsAwaiting(true);
      }
    }
    // 물고기 — 굴 속에서 고개를 내밀었다 들어간다. 놀라면 다 같이 깊이 숨었다가 천천히 나온다. 풀리면 굴은 비었다
    const startled = Math.max(0, 1 - (time - startledAt.current) / 1.2);
    const peekTime = peekSeconds(roundsRef.current);
    const wrongFlash = Math.max(0, 1 - (time - wrongAt.current) / WRONG_FLASH_SECONDS);
    BURROWS.forEach((burrow, k) => {
      const since = time - peekAt.current[k];
      const peek = isSolved ? 0 : since >= 0 && since < peekTime ? Math.sin((since / peekTime) * Math.PI) : 0;
      // 굴 입 빛무리 — 고개를 내밀 때 희푸르게, 틀린 굴은 붉게 번쩍인다
      const glow = assets.materials.glows[k];
      const isWrong = wrongBurrow.current === k && wrongFlash > 0;
      glow.color.set(isWrong ? "#FF5A3C" : "#BFEBFF");
      glow.opacity = isWrong ? wrongFlash * 0.95 : peek * 0.8;
      const species = speciesAt(roundsRef.current, k);
      // 판마다 굴 속 물고기가 바뀐다 — 굴 하나에 메시 넷(종마다), 그 판의 종만 보인다
      burrowFishMeshes.current.forEach((mesh, index) => {
        if (mesh && Math.floor(index / SPECIES.length) === k && index % SPECIES.length !== species)
          mesh.visible = false;
      });
      const mesh = burrowFishMeshes.current[k * SPECIES.length + species];
      if (mesh) {
        const length = FISH_LENGTH[species];
        const hidden = burrow.x + length * 0.15 + startled * 0.2;
        mesh.position.x = hidden - (PEEK_OUT + length * 0.3) * peek;
        // 나오면서 옆으로 몸을 튼다 — 정면만 보이면 어떤 물고기인지 안 읽힌다
        mesh.rotation.y = Math.PI + (k % 2 === 0 ? 1 : -1) * 1.05 * peek + Math.sin(time * 18 + k) * 0.15 * peek;
        mesh.visible = peek > 0.01;
      }
    });
    // 굴을 나온 물고기 — 가는 곳을 향해 부드럽게 돌며 헤엄친다. 이따금 새 가는 곳을 고른다
    const dt = Math.min(0.1, time - (lastTime.current || time));
    lastTime.current = time;
    swimmers.current.forEach((swimmer, i) => {
      if (time > swimmer.until || swimmer.pos.distanceTo(swimmer.target) < 0.4) {
        swimmer.target.set(
          ROAM.x[0] + Math.random() * (ROAM.x[1] - ROAM.x[0]),
          floorY(swimmer.pos.x, swimmer.pos.z) + ROAM.y[0] + Math.random() * (ROAM.y[1] - ROAM.y[0]),
          ROAM.z[0] + Math.random() * (ROAM.z[1] - ROAM.z[0]),
        );
        swimmer.until = time + 4 + Math.random() * 4;
      }
      const speed = SPECIES[swimmer.species].speed * 1.3;
      wanted.subVectors(swimmer.target, swimmer.pos).normalize().multiplyScalar(speed);
      swimmer.vel.lerp(wanted, Math.min(1, dt * 1.6));
      swimmer.pos.addScaledVector(swimmer.vel, dt);
      const mesh = swimmerMeshes.current[i];
      if (!mesh) return;
      if (mesh.geometry !== assets.fish[swimmer.species]) {
        mesh.geometry = assets.fish[swimmer.species];
        mesh.scale.setScalar(FISH_LENGTH[swimmer.species]);
      }
      mesh.visible = true;
      mesh.position.copy(swimmer.pos);
      mesh.rotation.set(
        0,
        Math.atan2(-swimmer.vel.z, swimmer.vel.x),
        Math.atan2(swimmer.vel.y, Math.hypot(swimmer.vel.x, swimmer.vel.z)) * 0.6,
      );
    });
    // 항아리 뚜껑 — 풀리면 옆으로 밀려나 모래에 떨어진다
    if (lid.current && solvedAt.current >= 0) {
      const t = THREE.MathUtils.smootherstep((time - solvedAt.current) / 1.2, 0, 1);
      lid.current.position.set(0, POT_TOP * (1 - t) + 0.03 * t + Math.sin(t * Math.PI) * 0.12, 0.42 * t);
      lid.current.rotation.x = t * 1.2;
    }
    // 안내판
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const distance = Math.hypot(FISH_BURROWS.x - px, FISH_BURROWS.z - pz);
    if (distance > PANEL_RANGE || isSolved) setPuzzlePanel("cave-burrows", null);
    else {
      const sequence = rounds[roundsDone];
      setPuzzlePanel("cave-burrows", {
        distance,
        title: "물고기 굴",
        rule: "굴 넷에 물고기들이 숨어 있다. 가운데 돌 항아리를 [E] 로 두드리면 물고기들이 차례로 고개를 내민다.\n본 차례 그대로 굴을 [E] 로 두드려 따라 한다. 판마다 빨라지고, 세 판을 맞추면 항아리가 열린다. 틀리면 항아리를 다시 두드려 차례를 다시 본다.",
        rows: [
          { label: "맞춘 판", value: `${roundsDone} / ${rounds.length}`, ok: false },
          {
            label: "따라 한 차례",
            value: isAwaiting ? `${inputCount} / ${sequence.length}` : "항아리를 두드려 보자",
            ok: false,
          },
        ],
      });
    }
  });

  if (!isShown) return null;
  const { materials } = assets;
  return (
    <>
      <group scale={M}>
        {/* 굴 넷 — 돌 셋을 짜 맞춘 틈. 물고기는 그 속 어둠에 숨어 있다 */}
        {BURROWS.map((burrow, k) => {
          const y = floorY(burrow.x, burrow.z);
          return (
            <group key={k}>
              <group
                ref={(group) => {
                  rockGroups.current[k] = group;
                }}
                position={[burrow.x, y - 0.04, burrow.z]}
              >
                {/* 양옆 기둥돌 — 사이가 굴 입 */}
                <mesh
                  geometry={assets.rocks[k][0]}
                  material={materials.rocks[k]}
                  position={[0.05, 0, -(GAP.half + 0.17)]}
                  rotation={[0, k * 1.3, 0]}
                  scale={[0.62, GAP.height + 0.16, 0.36]}
                  castShadow
                />
                <mesh
                  geometry={assets.rocks[k][1]}
                  material={materials.rocks[k]}
                  position={[0.05, 0, GAP.half + 0.17]}
                  rotation={[0, k * 0.7 + 1, 0]}
                  scale={[0.62, GAP.height + 0.12, 0.36]}
                  castShadow
                />
                {/* 덮개돌 — 두 기둥돌에 걸쳐 얹혔다 */}
                <mesh
                  geometry={assets.rocks[k][2]}
                  material={materials.rocks[k]}
                  position={[0.1, GAP.height + 0.02, 0]}
                  rotation={[0, k * 2.1, 0]}
                  scale={[0.75, 0.3, 0.98]}
                  castShadow
                />
              </group>
              {/* 굴 속 — 틈 너머 깊은 어둠 */}
              <mesh
                geometry={assets.rocks[k][3]}
                material={materials.inside}
                position={[burrow.x + 0.4, y - 0.05, burrow.z]}
                scale={[0.4, GAP.height + 0.2, 0.62]}
              />
              <sprite material={materials.glows[k]} position={[burrow.x - 0.28, y + MOUTH_Y, burrow.z]} scale={0.9} />
              {SPECIES.map((_, species) => (
                <mesh
                  key={species}
                  ref={(mesh) => {
                    burrowFishMeshes.current[k * SPECIES.length + species] = mesh;
                  }}
                  geometry={assets.fish[species]}
                  material={materials.fish}
                  position={[burrow.x, y + MOUTH_Y, burrow.z]}
                  scale={FISH_LENGTH[species]}
                  visible={false}
                />
              ))}
            </group>
          );
        })}
        {/* 굴을 나온 물고기들 — 한 판에 많아야 넷, 세 판. 종은 나온 뒤 매 프레임 쪽에서 바꿔 끼운다 */}
        {Array.from({ length: BURROWS.length * rounds.length }, (_, i) => (
          <mesh
            key={`swim-${i}`}
            ref={(mesh) => {
              swimmerMeshes.current[i] = mesh;
            }}
            geometry={assets.fish[0]}
            material={materials.fish}
            scale={FISH_LENGTH[0]}
            visible={false}
          />
        ))}
        {/* 돌 항아리 — 청동 띠, 뚜껑은 풀리면 밀려난다 */}
        <group ref={potGroup} position={[POT.x, floorY(POT.x, POT.z), POT.z]}>
          <mesh geometry={assets.pot} material={materials.pot} castShadow />
          <mesh material={materials.potBand} position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.285, 0.018, 6, 28]} />
          </mesh>
          <group ref={lid} position={[0, POT_TOP, 0]}>
            <mesh material={materials.pot} position={[0, 0.02, 0]} castShadow>
              <cylinderGeometry args={[0.19, 0.19, 0.04, 20]} />
            </mesh>
            <mesh material={materials.potBand} position={[0, 0.07, 0]}>
              <sphereGeometry args={[0.04, 10, 8]} />
            </mesh>
          </group>
        </group>
      </group>
      <AirColumn x={POT.x} z={POT.z} floor={floorY(POT.x, POT.z) + 0.45} radius={1.3} on={isSolved} count={90} />
    </>
  );
}
