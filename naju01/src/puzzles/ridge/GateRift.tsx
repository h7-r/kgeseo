/**
 * 진부촌 문 — 장막이 풀리고 새들이 떠나면 타오르는 횃불 사이, 두 장승 사이 「두 공간 사이」가 일그러져
 * 시공간 틈이 열린다. 틈 너머는 그날 밤의 강 — 초롱 하나가 물을 건너 앙암바위 위로 오른다(아랑사의 자취).
 * 결말(누가 어떻게)은 보여 주지 않는다. 「그 밤 아랑사는 바위 위로 갔다」는 다음 장소(바위 위)로 가는 물음만 남긴다.
 * 틈에 들어서면 화면이 뒤틀리며 빨려 들다(riftEntry · RiftEntryHud) 캄캄해진 뒤 바위 위에서 깨어난다.
 * 틈의 겉은 riftPortal, 틈 안 그림(달·강·건너편 둑·바위·초롱)은 여기서 셰이더로 그린다. 좌표는 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { gameClearTimeout, gameNow, gameSetTimeout } from "@/engine/input/gameClock";

import { cancelCameraFocus, focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { teleportPlayer } from "../cave/caveState";
import { showNotice } from "../interaction";
import { inventory } from "../inventory";
import { M, groundY } from "../units";
import { GATE } from "./ridgeShape";
import { RIFT_ENTRY, riftEntrySince, startRiftEntry, tickRiftEntry } from "./riftEntry";
import { makeRiftMaterial, pointBeyondRift } from "./riftPortal";
import { ridge, ridgeBox, useRidgeStage } from "./ridgeState";

/** 틈에 들어서면 건너가는 곳 — Z3(바위 위 · 절벽 상단) 들머리. 길(Z4 → Z3)을 안 걸어도 된다 */
const NEXT_STAGE = { x: 52, z: 11, heading: "+Z" as const };
/** 틈 가운데에서 이만큼(m) 안에 들어서면 빨려 든다 */
const ENTER_RADIUS = 1.1;
/** 틈이 열리기 전(함에 볼일이 남음) 까닭을 알리는 거리(m) — 장승 문 앞에 서면 */
const WAITING_NOTICE_RADIUS = 3;
/** 함 속의 것을 챙기기 전 틈 앞에 섰을 때의 알림 — 들어설 때 한 번, 이 간격(ms) 안에는 되풀이하지 않는다 */
const HOLD_NOTICE_GAP_MS = 6000;

const RIFT_OPEN_AT = 2.2;
const RIFT_OPEN_SECONDS = 2.0;
const RIFT_WIDTH = 2.0;
const RIFT_HEIGHT = 2.6;

// 틈 너머 그림 — 그날 밤의 강. 셰이더 문자열에는 ASCII 만 쓴다
const RIVER_NIGHT = /* glsl */ `
  // the lantern: across the water, then up the rock (loops)
  vec2 lanternAt(float t) {
    float u = fract(t / 10.0);
    vec2 a = vec2(0.12, 0.30);
    vec2 b = vec2(0.62, 0.345);
    vec2 c = vec2(0.80, 0.66);
    return u < 0.6 ? mix(a, b, smoothstep(0.0, 0.6, u)) : mix(b, c, smoothstep(0.6, 1.0, u));
  }
  vec3 riftVision(vec2 p) {
    // night sky: indigo into violet, with a faint nebula band and twinkling stars
    vec3 col = mix(vec3(0.04, 0.06, 0.15), vec3(0.11, 0.17, 0.3), p.y);
    float nebula = noise(p * 4.0 + vec2(uTime * 0.04, 0.0)) * noise(p * 9.0 - vec2(0.0, uTime * 0.03));
    col += vec3(0.22, 0.12, 0.3) * nebula * 1.4;
    float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + hash(floor(p * 160.0)) * 40.0);
    col += step(0.996, hash(floor(p * 160.0))) * 0.8 * twinkle;
    // full moon + halo
    vec2 moon = vec2(0.70, 0.80);
    float md = length((p - moon) * vec2(1.3, 1.0));
    col += vec3(0.95, 0.92, 0.8) * smoothstep(0.065, 0.055, md) + vec3(0.3, 0.32, 0.35) * exp(-md * 9.0);
    // far bank
    float bank = 0.40 + 0.02 * sin(p.x * 14.0) + 0.015 * sin(p.x * 31.0);
    if (p.y < bank) col = vec3(0.02, 0.03, 0.06);
    // river with the moon's streak
    float water = 0.355;
    if (p.y < water) {
      col = mix(vec3(0.02, 0.05, 0.10), vec3(0.05, 0.10, 0.18), p.y / water);
      float streak = exp(-abs(p.x - moon.x) * 22.0) * (0.5 + 0.5 * noise(vec2(p.x * 40.0, p.y * 90.0 - uTime * 2.0)));
      col += vec3(0.6, 0.6, 0.55) * streak * 0.5;
    }
    // the rock (Angam) on the right, rising from the water
    float rock = water + max(0.0, (p.x - 0.6)) * 1.9 - 0.02 * noise(vec2(p.y * 30.0, 1.0));
    if (p.x > 0.6 && p.y < min(rock, 0.68)) col = vec3(0.015, 0.02, 0.035);
    // the lantern and its reflection
    vec2 l = lanternAt(uTime);
    float lg = exp(-length((p - l) * vec2(1.0, 0.8)) * 70.0) * 1.6 + exp(-length(p - l) * 14.0) * 0.35;
    vec2 lr = vec2(l.x, 2.0 * water - l.y);
    float reflection = l.y < 0.4 && p.y < water ? exp(-length((p - lr) * vec2(1.6, 0.5)) * 40.0) * 0.6 : 0.0;
    col += vec3(1.0, 0.62, 0.25) * (lg + reflection);
    return col;
  }
`;

function buildRift() {
  const material = makeRiftMaterial(RIVER_NIGHT);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(RIFT_WIDTH * M, RIFT_HEIGHT * M), material);
  const [left, right] = GATE.posts;
  const ground = groundY(GATE.center.x, GATE.center.z);
  mesh.position.set(GATE.center.x * M, (ground + 0.15 + RIFT_HEIGHT / 2) * M, GATE.center.z * M);
  mesh.rotation.y = Math.atan2(-(right.z - left.z), right.x - left.x);
  mesh.visible = false;
  mesh.renderOrder = 6;
  const light = new THREE.PointLight("#FFA55A", 0, 9 * M, 2);
  light.position.set(GATE.center.x * M, (ground + 2.2) * M, GATE.center.z * M);
  return { mesh, material, light };
}

export default function GateRift() {
  const scene = useThree((state) => state.scene);
  const rift = useMemo(() => buildRift(), []);
  const stage = useRidgeStage();
  /** 틈을 지나 바위 위로 건너갔나 — 캄캄해진 순간 한 번 */
  const hasCrossed = useRef(false);
  /** 틈 앞(끌려드는 거리 안)에 서 있었나 · 「아직」 알림을 마지막으로 띄운 때(ms) */
  const hold = useRef({ wasInside: false, noticedAt: -Infinity });

  useEffect(() => {
    scene.add(rift.mesh, rift.light);
    return () => {
      scene.remove(rift.mesh, rift.light);
    };
  }, [scene, rift]);

  useEffect(() => {
    if (stage !== "rift") return undefined;
    const timers = [
      gameSetTimeout(() => {
        audio.play("전환");
        showNotice("횃불이 붙자 두 장승 사이의 바람이 일그러진다 — 갈라진 틈 너머로 그날 밤의 강이 비친다.", 5);
      }, RIFT_OPEN_AT * 1000),
      gameSetTimeout(
        () => showNotice("초롱 하나가 물을 건너온다. 불빛은 앙암바위 쪽으로 가더니 바위 위로 올라간다.", 5),
        (RIFT_OPEN_AT + 5) * 1000,
      ),
      gameSetTimeout(
        () => showNotice("강 건너 어부, 아랑사의 초롱이다. 그 밤 아랑사는 바위 위로 갔다.", 5),
        (RIFT_OPEN_AT + 10) * 1000,
      ),
    ];
    return () => timers.forEach(gameClearTimeout);
  }, [stage]);

  useFrame((frame, dt) => {
    tickRiftEntry("gate", dt);
    const now = ridge.stage();
    // 틈에 들어서면 — 바위 위(Z3)로 건너간다
    if (now === "rift" && rift.material.uniforms.uOpen.value > 0.6) {
      const dx = frame.camera.position.x / M - GATE.center.x;
      const dz = frame.camera.position.z / M - GATE.center.z;
      const isInside = Math.hypot(dx, dz) < ENTER_RADIUS;
      if (isInside && !ridgeBox.isEmptied) {
        // 틈은 한 방향이다 — 함 속의 것을 챙기기 전에는 끌어들이지 않고 까닭만 알린다
        if (!hold.current.wasInside && gameNow() - hold.current.noticedAt > HOLD_NOTICE_GAP_MS) {
          hold.current.noticedAt = gameNow();
          showNotice("틈이 아직 끌어당기지 않는다 — 아랑사의 함에 볼일이 남았다.", 3.5, {
            urgent: true,
            fleeting: true,
          });
        }
      } else if (isInside && startRiftEntry("gate")) {
        // 빨려 든다 — 시선이 틈 가운데로 천천히 당겨지고 걷기가 멈춘다. 건너가는 것은 캄캄해진 뒤
        audio.play("우르릉");
        director.cue({ 카메라: "흔들림", 세기: 0.35 });
        focusCamera({
          id: "rift-entry",
          target: pointBeyondRift(frame.camera, rift.mesh.position),
          hold: 1,
          turnIn: RIFT_ENTRY.warpIn,
          zoom: 0.55,
          replace: true,
        });
      }
      hold.current.wasInside = isInside;
    }
    // 새들이 떠났는데 함 속 구렁이상을 아직 안 챙겼으면 틈이 열리지 않는다(RidgeBirds) — 문 앞에 선 사람에게 까닭을 알린다.
    // 이 안내가 없을 땐 「3스테이지가 끝났는데 틈이 사라졌다」로 보였다(11/11 플레이테스트).
    if (now === "leaving" && ridge.elapsed() > 6 && !ridgeBox.isEmptied) {
      const dx = frame.camera.position.x / M - GATE.center.x;
      const dz = frame.camera.position.z / M - GATE.center.z;
      if (Math.hypot(dx, dz) < WAITING_NOTICE_RADIUS && gameNow() - hold.current.noticedAt > HOLD_NOTICE_GAP_MS) {
        hold.current.noticedAt = gameNow();
        showNotice("장승 사이가 일렁이다 멎는다 — 아랑사의 함에 아직 볼일이 남았다.", 4, { fleeting: true });
      }
    }
    if (!hasCrossed.current && riftEntrySince("gate") >= RIFT_ENTRY.warpIn) {
      hasCrossed.current = true;
      cancelCameraFocus();
      audio.play("전환");
      teleportPlayer(NEXT_STAGE.x, NEXT_STAGE.z, NEXT_STAGE.heading);
      // 틈은 한 방향이다 — 두고 온 물건도 함께 넘어온다
      inventory.bringAlong(NEXT_STAGE.x, NEXT_STAGE.z);
      ridge.advance("done");
      showNotice("틈을 지나자 발밑이 바뀐다 — 바위 위, 절벽 꼭대기다. 그 밤 아랑사가 오른 곳.", 5);
    }
    const isLit = now === "rift" || now === "done";
    const since = now === "rift" ? ridge.elapsed() : 999;
    const time = frame.clock.elapsedTime;

    // 문 가운데 불빛 — 횃불 불꽃은 GateAltar 가 그린다
    rift.light.intensity = isLit ? THREE.MathUtils.clamp(since / 1.5, 0, 1) * 18 : 0;

    // 틈 — 열리면 들어설 때까지 그대로 머문다(11/4: 시간이 지나도 닫히지 않는다)
    const open =
      now === "rift" ? THREE.MathUtils.smootherstep(since, RIFT_OPEN_AT, RIFT_OPEN_AT + RIFT_OPEN_SECONDS) : 0;
    rift.material.uniforms.uOpen.value = open;
    rift.material.uniforms.uTime.value = time;
    // 그림은 시간이 갈수록 가장자리부터 감긴다
    rift.material.uniforms.uTwist.value = 1 + 0.2 * time;
    rift.mesh.visible = open > 0.002;
  });

  return null;
}
