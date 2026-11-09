/**
 * 벼랑 끝 틈 — 바위 위(4스테이지)에서 바위 아래 굿판(5스테이지)으로 건너간다.
 *   편지의 숨긴 말은 함에서 나온 구렁이상이 무엇인지 일러 준다. 아랑사가 미끄러져 떨어진 자리 곁에 구렁이 모양으로 파인
 *   바위가 있다(serpentStone). 그 홈에 구렁이상을 끼우면(opened) 돌이 풀리듯 구렁이가 살아나 곁을 스르르 지나
 *   벼랑 끝으로 사라지고(serpentRun), 그 자리에 구렁이가 밤마다 오르내린 길 — 틈이 열린다. 틈 너머는 아랑사가 떨어져 내린 물가다. 금줄 둘레에 굿 불이 타오르고
 *   징 소리가 올라온다. 발자국을 끝까지 따라 들어서면 진부촌 문과 같은 화면(riftEntry)으로 건너가 금줄 앞에서 깨어난다.
 *   틈은 한 방향이다. 내려선 물가는 비 갠 밤이다(굿판의 밤 — 비는 RitualCircle 이 그친다).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { assetUrl } from "@/config/env";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { cancelCameraFocus, focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director, setZoneTime } from "../../scene/immersion/director";
import { addDynamicSolid } from "../../movement/solidField";
import { teleportPlayer } from "../cave/caveState";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { makeGlowTexture } from "../glowTexture";
import { STAKES } from "../gut/gutShape";
import { gut } from "../gut/gutState";
import { FIRE_SEAT } from "../gut/torchPost";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { SERPENT_MODEL } from "../itemLooks";
import { loadModel } from "../itemModel";
import { setPuzzlePanel } from "../puzzlePanel";
import { RIFT_ENTRY, riftEntrySince, startRiftEntry, tickRiftEntry } from "../ridge/riftEntry";
import { makeRiftMaterial, pointBeyondRift } from "../ridge/riftPortal";
import { M } from "../units";
import { usePrewarm } from "../usePrewarm";
import { EDGE_RIFT, FALL_SPOT, RITE_ARRIVAL, RITE_CENTER, SERPENT_STONE, TRAIL } from "./cliffShape";
import { cliff } from "./cliffState";
import { MODELS, floorAt, planar } from "./riteScene";
import { buildSerpentRun, updateSerpentRun } from "./serpentRun";
import { ALIVE_AT, buildSerpentStone, fitFigure, fitStone, updateSerpentStone } from "./serpentStone";
import { useGroundReady } from "./useGroundReady";

/** 구렁이상을 끼운 뒤 틈이 열리기 시작하는 때 · 다 벌어지는 시간 · 굿 불이 켜지는 때 · 다 켜지는 시간(초) */
const RIFT_AT = 3.4;
const RIFT_OPEN_SECONDS = 2.0;
const FIRES_AT = 10;
const FIRES_SECONDS = 2.5;
/** 틈 가운데에서 이만큼(m) 안에 들어서면 빨려 든다 */
const ENTER_RADIUS = 0.9;
/** 구렁이상을 끼우느라 틈 코앞에 서 있었으면 — 이만큼(m) 물러났다 다시 다가서야 끌어당긴다. 안 물러나도 이만큼(초) 뒤에는 당긴다 */
const ARM_DISTANCE = ENTER_RADIUS + 0.25;
const ARM_SECONDS = 7;
/** 때를 이만큼(초) 넘겨 맞으면 이어 하기로 돌아온 것 — 소리와 알림 없이 끝난 모습으로 둔다 */
const LATE_SECONDS = 3;
/** 틈의 판은 틈보다 이만큼 크다 — 새어 나오는 빛이 판 가장자리에서 잘리지 않게 */
const RIFT_MARGIN = 1.85;
/** 벼랑 위까지 날아오르는 불티 수 · 오르는 높이(미터) · 바람에 벼랑 쪽(북)으로 밀리는 거리(미터) */
const EMBERS = 30;
const EMBER_RISE = 17;
const EMBER_DRIFT = 7.5;
/** 벼랑 너머로 번져 오르는 불빛 — 굿판 위쪽 허공에 둔다. 바위 위에서는 벼랑 끝 뒤로 반쯤 솟아 보인다 */
const HAZE = { x: 45.5, y: 8, z: 32.5, size: 18 };
/** 안내판이 뜨는 거리(m) */
const PANEL_RANGE = 9;

// 틈 너머 그림 — 바위 위에서 내려다본 물가의 굿판(금줄 · 굿 불 · 달 비친 강). 셰이더 문자열에는 ASCII 만 쓴다
const RITE_BELOW = /* glsl */ `
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a; vec2 ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }
  vec2 fireAt(int k) {
    if (k == 0) return vec2(0.14, 0.27);
    if (k == 1) return vec2(0.40, 0.335);
    if (k == 2) return vec2(0.63, 0.34);
    if (k == 3) return vec2(0.87, 0.28);
    return vec2(0.52, 0.10);
  }
  vec3 riftVision(vec2 p) {
    // 틈은 세로로 길다 — 이 좌표에서 거리를 재야 둥근 것이 둥글게 나온다
    vec2 shape = vec2(0.625, 1.0);
    vec2 P = p * shape;
    // 밤의 강 — 건너편으로 갈수록 옅고, 달빛이 한 줄 진다
    vec3 col = mix(vec3(0.02, 0.05, 0.10), vec3(0.07, 0.12, 0.20), smoothstep(0.42, 0.84, p.y));
    float ripple = noise(vec2(p.x * 30.0, p.y * 110.0 - uTime * 1.6));
    col += vec3(0.6, 0.6, 0.55) * exp(-abs(p.x - 0.64) * 14.0) * (0.4 + 0.6 * ripple) * 0.5 * smoothstep(0.44, 0.6, p.y);
    // 건너편 기슭, 그 위로 하늘 한 줄
    float bank = 0.83 + 0.012 * sin(p.x * 13.0) + 0.008 * sin(p.x * 31.0);
    if (p.y > bank) col = vec3(0.02, 0.03, 0.06);
    if (p.y > bank + 0.05) col = mix(vec3(0.05, 0.08, 0.17), vec3(0.10, 0.15, 0.28), (p.y - bank - 0.05) / 0.12);
    // 바위 아래 자갈밭
    float shore = 0.43 + 0.02 * sin(p.x * 6.0) + 0.008 * sin(p.x * 21.0 + 1.0);
    float onShore = step(p.y, shore);
    col = mix(col, vec3(0.045, 0.05, 0.06) + 0.035 * noise(p * vec2(60.0, 96.0)), onShore);
    // 굿 불 — 말뚝, 자갈에 번진 따뜻한 빛, 물에 진 불빛
    vec3 fire = vec3(1.0, 0.62, 0.25);
    float pool = 0.0;
    float flame = 0.0;
    float stake = 1.0;
    for (int k = 0; k < 5; k++) {
      vec2 f = fireAt(k);
      vec2 tip = f + vec2(0.0, 0.05);
      float flicker = 0.8 + 0.2 * sin(uTime * 7.0 + float(k) * 1.7);
      flame += exp(-length((p - tip) * shape) * 90.0) * 1.7 * flicker;
      pool += exp(-length((p - f) * shape * vec2(1.0, 1.8)) * 15.0) * 0.5 * flicker;
      vec2 mirror = vec2(f.x, 2.0 * shore - tip.y);
      pool += (1.0 - onShore) * exp(-length((p - mirror) * vec2(2.2, 0.45)) * 30.0) * 0.35 * flicker * step(0.2, f.y);
      stake = min(stake, segment(P, f * shape, tip * shape));
    }
    col += fire * pool;
    col = mix(col, vec3(0.10, 0.07, 0.05), smoothstep(0.005, 0.002, stake));
    // 금줄 — 기둥 둘, 처진 새끼줄, 흰 · 붉은 · 푸른 천자락
    vec2 postL = vec2(0.27, 0.19);
    vec2 postR = vec2(0.73, 0.21);
    float post = min(
      segment(P, postL * shape, (postL + vec2(0.0, 0.11)) * shape),
      segment(P, postR * shape, (postR + vec2(0.0, 0.11)) * shape)
    );
    col = mix(col, vec3(0.16, 0.11, 0.07) + fire * pool * 0.3, smoothstep(0.011, 0.006, post));
    float t = clamp((p.x - postL.x) / (postR.x - postL.x), 0.0, 1.0);
    float ropeY = mix(postL.y, postR.y, t) + 0.10 - 0.03 * sin(3.14159 * t);
    float between = step(postL.x, p.x) * step(p.x, postR.x);
    col = mix(col, vec3(0.55, 0.47, 0.30), between * smoothstep(0.006, 0.0025, abs(p.y - ropeY)));
    for (int k = 0; k < 5; k++) {
      float tk = (float(k) + 0.5) / 5.0;
      float x = mix(postL.x, postR.x, tk);
      float top = mix(postL.y, postR.y, tk) + 0.10 - 0.03 * sin(3.14159 * tk);
      float len = 0.035 + 0.012 * mod(float(k), 2.0);
      float sway = 0.006 * sin(uTime * 1.3 + float(k) * 1.9) * clamp((top - p.y) / len, 0.0, 1.0);
      float strip = step(abs(p.x - x - sway), 0.011) * step(top - len, p.y) * step(p.y, top);
      float kind = mod(float(k), 3.0);
      vec3 cloth = kind < 0.5 ? vec3(0.80, 0.78, 0.70) : kind < 1.5 ? vec3(0.62, 0.20, 0.17) : vec3(0.22, 0.34, 0.50);
      col = mix(col, cloth, strip);
    }
    return col + (fire + vec3(0.0, 0.25, 0.3)) * flame;
  }
`;

function buildGlowSprite(map: THREE.Texture, color: string, size: number) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  sprite.scale.setScalar(size * M);
  return sprite;
}

function buildCrossing() {
  const root = new THREE.Group();
  root.name = "cliff.edgeRift";
  const glow = makeGlowTexture();

  // 굿 불 — 말뚝 횃불 자체는 굿판(gut/TorchRite)이 세운다. 여기는 바위 위에서 보이는 것만:
  // 벼랑 너머로 번지는 빛과, 횃불에서 벼랑 위까지 날아오르는 불티
  const haze = buildGlowSprite(glow, "#FF9A4A", HAZE.size);
  haze.position.set(HAZE.x * M, HAZE.y * M, HAZE.z * M);
  const embers = makeGlowPoints(EMBERS, { additive: true, softness: 1.2 });
  embers.points.visible = false;
  root.add(haze, embers.points);

  // 구렁이 바위 — 홈과, 거기 끼울 구렁이상
  const stone = buildSerpentStone();
  const serpent = buildSerpentRun();
  root.add(stone.root, serpent.root);

  // 틈 — 미끄러진 자국 위, 발자국이 오는 쪽을 보고 선다
  const material = makeRiftMaterial(RITE_BELOW, RIFT_MARGIN);
  const rift = new THREE.Mesh(
    new THREE.PlaneGeometry(EDGE_RIFT.width * RIFT_MARGIN * M, EDGE_RIFT.height * RIFT_MARGIN * M),
    material,
  );
  rift.position.copy(planar(EDGE_RIFT.x, EDGE_RIFT.z, 0.1 + EDGE_RIFT.height / 2));
  const lastSteps = TRAIL[TRAIL.length - 1];
  const [fromX, fromZ] = lastSteps[lastSteps.length - 2];
  const [toX, toZ] = lastSteps[lastSteps.length - 1];
  rift.rotation.y = Math.atan2(fromX - toX, fromZ - toZ);
  rift.visible = false;
  rift.renderOrder = 6;
  root.add(rift);

  // 빛 하나 — 틈이 열리면 틈 앞을 밝히고, 건너간 뒤에는 굿판으로 옮겨 금줄 둘레를 밝힌다
  const light = new THREE.PointLight("#FFA55A", 0, 9 * M, 2);
  root.add(light);

  return {
    root,
    fireTops: STAKES.map((spot) => planar(spot.x, spot.z, FIRE_SEAT)),
    haze,
    embers,
    emberSeeds: Float32Array.from({ length: EMBERS * 3 }, () => Math.random()),
    stone,
    serpent,
    rift,
    material,
    light,
    fallTarget: planar(FALL_SPOT.x, FALL_SPOT.z, 0.1),
    riftLightAt: planar(EDGE_RIFT.x, EDGE_RIFT.z, 1.9),
    riteLightAt: planar(RITE_CENTER.x, RITE_CENTER.z, 1.5),
  };
}

/** 걷는 지형이 준비된 뒤에 세운다 */
export default function EdgeRift() {
  const ground = useGroundReady();
  return ground ? <EdgeRiftScene key={ground} /> : null;
}

function EdgeRiftScene() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const crossing = useMemo(() => buildCrossing(), []);
  /** 한 번씩만 알리는 것 — 틈이 열렸다 · 굿 불이 켜졌다 */
  const told = useRef({ alive: false, rift: false, fires: false });
  /** 틈이 끌어당길 채비가 됐나(ARM_DISTANCE) */
  const isArmed = useRef(false);
  /** 개발용 — 기다리지 않고 틈을 연다(초) */
  const skipped = useRef(0);

  usePrewarm(crossing.root);

  useEffect(() => {
    scene.add(crossing.root);
    return () => {
      scene.remove(crossing.root);
      setPuzzlePanel("cliff-rift", null);
    };
  }, [scene, crossing]);

  // 구렁이 바위 — 모형을 읽어 윗면을 재고, 구렁이상의 윤곽으로 홈을 뜬다. 바위는 막기만 한다
  useEffect(() => {
    let isAlive = true;
    void loadModel(assetUrl(MODELS.seat), SERPENT_STONE.size).then((source) => {
      if (!isAlive || !source) return;
      fitStone(crossing.stone, source);
      crossing.serpent.stoneTop = crossing.stone.top / M;
    });
    void loadModel(assetUrl(SERPENT_MODEL), SERPENT_STONE.groove).then((source) => {
      if (isAlive && source) fitFigure(crossing.stone, gl, source);
    });
    const ground = floorAt(SERPENT_STONE.x, SERPENT_STONE.z);
    const removeSolid = addDynamicSolid({
      x: SERPENT_STONE.x,
      z: SERPENT_STONE.z,
      yaw: SERPENT_STONE.yaw,
      halfX: SERPENT_STONE.size * 0.46,
      halfZ: SERPENT_STONE.size * 0.28,
      bottom: ground - 0.2,
      top: ground + SERPENT_STONE.size * 0.3,
      enabled: true,
      walkable: false,
    });
    return () => {
      isAlive = false;
      removeSolid();
      crossing.stone.outline?.dispose();
    };
  }, [crossing, gl]);

  // 굿판의 밤 — 틈을 지나 내려선 뒤로 바위 아래 물가(2구역)는 밤이다. 굿이 풀리면 날이 갠다
  useEffect(() => {
    setZoneTime("Z2", () => (cliff.stage() !== "crossed" ? null : gut.stage() === "dawn" ? "갠날" : "밤"));
    return () => setZoneTime("Z2", null);
  }, []);

  const actions = useMemo(() => {
    /** 구렁이상을 바위의 홈에 끼운다 — 살아나 벼랑 끝으로 사라지고, 그 자리에 틈이 열린다 */
    const placeSerpent = () => {
      cliff.advance("opened");
      audio.play("사기");
      audio.play("단서");
      showNotice("구렁이상이 파인 자리에 꼭 맞게 들어앉는다. 돌빛 비늘에 달빛이 돌더니 — 몸이 꿈틀한다.", 4);
    };
    return { placeSerpent };
  }, []);

  useEffect(() => {
    const removers = [
      registerInteractable({
        id: "cliff-groove",
        position: crossing.stone.target,
        label: "구렁이 모양으로 파인 바위",
        radius: 0.5 * M,
        reach: 2.6 * M,
        // 주머니 속 편지를 읽은 뒤에야 쓴다 — 그 전에는 그냥 바위다
        enabled: () => cliff.stage() === "done",
        handLabel: (kind) => (kind === "serpentFigure" ? "파인 자리에 구렁이상 끼우기" : null),
        receive: () => actions.placeSerpent(),
        use: () =>
          showNotice(
            "바위 윗면이 구렁이 한 마리가 누운 모양으로 파였다. 편지의 숨긴 말을 읽었다면 — 함에서 나온 것이 여기 꼭 맞을 것이다.",
            6,
          ),
      }),
      registerInteractable({
        id: "cliff-fall",
        position: crossing.fallTarget,
        label: "미끄러진 자국",
        radius: 0.45 * M,
        reach: 2.6 * M,
        enabled: () => cliff.isAtLeast("traced") && !cliff.isAtLeast("opened"),
        use: () =>
          showNotice(
            cliff.stage() === "done"
              ? "아랑사가 떨어진 자리. 영상 속 구렁이는 바로 이 틈에서 올라왔다. 곁의 바위에 구렁이 모양으로 파인 자리가 있다."
              : "마지막 발자국이 여기서 길게 미끄러졌다. 아랑사는 이 두 바위 사이에서 떨어졌다.",
            6,
          ),
      }),
    ];
    return () => removers.forEach((remove) => remove());
  }, [crossing, actions]);

  useFrame((frame, rawDt) => {
    tickRiftEntry("edge", rawDt);
    const stage = cliff.stage();
    const time = frame.clock.elapsedTime;
    const hasCrossed = stage === "crossed";
    /** 구렁이상을 끼운 지 몇 초 — 그 전이면 −1 */
    const since = hasCrossed ? Infinity : stage === "opened" ? cliff.elapsed() + skipped.current : -1;
    const dx = frame.camera.position.x / M - EDGE_RIFT.x;
    const dz = frame.camera.position.z / M - EDGE_RIFT.z;
    const distance = Math.hypot(dx, dz);

    // 구렁이상 — 홈에 들어앉았다가 살아나 곁을 지나 벼랑 끝으로 사라진다. 건너간 뒤에는 빈 홈만 남는다
    const seatedFor = stage === "opened" ? cliff.elapsed() + skipped.current : hasCrossed ? Infinity : -1;
    updateSerpentStone(crossing.stone, seatedFor);
    updateSerpentRun(crossing.serpent, seatedFor - ALIVE_AT, time);
    if (seatedFor >= ALIVE_AT && !told.current.alive) {
      told.current.alive = true;
      if (seatedFor < ALIVE_AT + LATE_SECONDS) {
        audio.play("전환");
        showNotice("구렁이다. 바위에서 스르르 내려와 곁을 지나 — 미끄러진 자국을 따라 벼랑 끝으로 간다.", 5);
      }
    }

    // 틈 — 열리면 들어설 때까지 그대로 머문다
    if (since >= RIFT_AT && !told.current.rift) {
      told.current.rift = true;
      if (since < RIFT_AT + LATE_SECONDS) {
        audio.play("전환");
        showNotice(
          "구렁이가 사라진 자리에서 바람이 일그러진다 — 구렁이가 밤마다 오르내린 길이 열린다. 틈 너머는 아랑사가 떨어져 내린 물가다.",
          6.5,
        );
      }
    }
    const open = hasCrossed ? 0 : THREE.MathUtils.smootherstep(since, RIFT_AT, RIFT_AT + RIFT_OPEN_SECONDS);
    crossing.material.uniforms.uOpen.value = open;
    crossing.material.uniforms.uTime.value = time;
    // 그림이 읽히게 가장자리만 천천히 감겼다 풀린다
    crossing.material.uniforms.uTwist.value = 1 + 0.5 * Math.sin(time * 0.35);
    crossing.rift.visible = open > 0.002;

    // 굿 불 — 틈 너머 물가에서 징 소리와 함께 하나씩 타오른다
    if (since >= FIRES_AT && !told.current.fires) {
      told.current.fires = true;
      if (since < FIRES_AT + LATE_SECONDS) {
        audio.play("징");
        showNotice(
          "아래 물가에서 징 소리가 올라온다. 벼랑 너머로 불빛이 번지고 불티가 날아오른다 — 금줄 친 자리, 누군가 넋을 달래려 한다.",
          7,
        );
      }
    }
    const lit = THREE.MathUtils.clamp((since - FIRES_AT) / FIRES_SECONDS, 0, 1);
    gut.setCalledFires(lit);
    // 바위 위에서는 불이 벼랑에 가린다 — 벼랑 너머로 번지는 빛과 날아오르는 불티로 안다
    crossing.haze.visible = lit > 0 && !hasCrossed;
    (crossing.haze.material as THREE.SpriteMaterial).opacity = lit * (0.34 + 0.05 * Math.sin(time * 3.1));
    const { embers, emberSeeds } = crossing;
    // 건너간 뒤의 불티는 켜진 횃불만큼만 오른다(굿 중에 바람이 불을 끄면 불티도 잦아든다)
    const burning = hasCrossed ? gut.glow() : lit;
    embers.points.visible = burning > 0.02;
    if (embers.points.visible) {
      for (let i = 0; i < EMBERS; i++) {
        const from = crossing.fireTops[i % crossing.fireTops.length];
        const life = 7 + emberSeeds[i * 3] * 4;
        const u = (time / life + emberSeeds[i * 3 + 1]) % 1;
        const sway = Math.sin(time * 0.9 + i * 1.3) * 0.5 * u;
        embers.position.setXYZ(
          i,
          from.x + (sway + (emberSeeds[i * 3 + 2] - 0.5) * 3 * u) * M,
          from.y + u * EMBER_RISE * M,
          from.z - u * u * EMBER_DRIFT * M,
        );
        embers.size.setX(i, (0.05 + 0.05 * emberSeeds[i * 3 + 2]) * M);
        embers.alpha.setX(i, Math.sin(Math.PI * u) * burning * (0.7 + 0.3 * Math.sin(time * 9 + i)));
        embers.color.setXYZ(i, 1.8, 0.75 - 0.3 * u, 0.2);
      }
      embers.commit();
      embers.material.uniforms.uPointScale.value = pointScaleFor(gl, frame.camera);
    }

    // 들어서면 빨려 든다 — 구렁이상을 세우느라 코앞에 서 있었으면 한 번 물러났다 다가서야 한다
    if (open > 0.6 && (distance > ARM_DISTANCE || since > RIFT_AT + ARM_SECONDS)) isArmed.current = true;
    if (open > 0.6 && isArmed.current && distance < ENTER_RADIUS && startRiftEntry("edge")) {
      // 시선이 틈 너머로 천천히 당겨지고 걷기가 멈춘다. 건너가는 것은 캄캄해진 뒤
      audio.play("우르릉");
      director.cue({ 카메라: "흔들림", 세기: 0.35 });
      focusCamera({
        id: "rift-entry",
        target: pointBeyondRift(frame.camera, crossing.rift.position),
        hold: 1,
        turnIn: RIFT_ENTRY.warpIn,
        zoom: 0.55,
        replace: true,
      });
    }
    if (stage === "opened" && riftEntrySince("edge") >= RIFT_ENTRY.warpIn) {
      cancelCameraFocus();
      audio.play("전환");
      teleportPlayer(RITE_ARRIVAL.x, RITE_ARRIVAL.z, RITE_ARRIVAL.heading);
      // 틈은 한 방향이다 — 두고 온 물건은 함께 넘어온다. 구렁이상은 살아나 먼저 이 길로 갔다
      inventory.bringAlong(RITE_ARRIVAL.x, RITE_ARRIVAL.z);
      cliff.advance("crossed");
      showNotice("틈을 지나자 발밑이 자갈로 바뀐다 — 바위 아래 물가, 금줄 앞이다. 그 밤 아랑사가 떨어져 내린 곳.", 7);
    }

    crossing.light.position.copy(hasCrossed ? crossing.riteLightAt : crossing.riftLightAt);
    // 굿판의 빛은 켜진 횃불만큼 — 다 꺼져도 화로 불씨만큼은 남는다
    crossing.light.intensity = hasCrossed ? (2 + 14 * gut.glow()) * (1 + 0.18 * Math.sin(time * 6.3)) : open * 16;

    const panelDistance = Math.hypot(
      frame.camera.position.x / M - FALL_SPOT.x,
      frame.camera.position.z / M - FALL_SPOT.z,
    );
    setPuzzlePanel(
      "cliff-rift",
      panelDistance > PANEL_RANGE || (stage !== "done" && stage !== "opened")
        ? null
        : stage === "done"
          ? {
              title: "떨어진 자리",
              rule: "아랑사가 미끄러져 떨어진 두 바위 사이. 곁의 낮은 바위가 구렁이 모양으로 파였다. 편지의 숨긴 말을 읽었다면 — 함에서 나온 것을 그 자리에 끼운다.",
              distance: panelDistance,
            }
          : {
              title: "구렁이가 오르내린 길",
              rule: "미끄러진 자국 위에 틈이 열렸다. 발자국 끝까지 걸어 들어서면 아랑사가 떨어져 내린 물가 — 굿판으로 내려선다. 틈은 한 방향이다. 바위 위로는 돌아오지 못한다.",
              distance: panelDistance,
            },
    );
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuRiftDev", {
      /** 구렁이상을 끼우고 기다림 없이 틈을 연다 */
      open: () => {
        if (cliff.stage() === "done") actions.placeSerpent();
        skipped.current = 999;
      },
      spot: () => ({
        fall: crossing.fallTarget.clone().divideScalar(M),
        groove: crossing.stone.target.clone().divideScalar(M),
        rift: crossing.rift.position.clone().divideScalar(M),
        arrival: RITE_ARRIVAL,
      }),
    });
  }, [crossing, actions]);

  return null;
}
