/**
 * director.ts — 몰입 연출의 매 프레임 틱 · 카메라 비틀기 · 콘솔 API (옛 몰입연출.jsx 「매 프레임」·「연출」 이식)
 *   `director` 는 옛 `window.__연출` 과 1:1 — 리드가 `exposeDevHook("naju", { director })` 로 붙인다(여기서 window 에 안 단다).
 *
 * [옛 이름 → 새 이름]
 *   연출 → director: 설정→settings · 큐→cue · 박자→beat · 사건→event · 씬지남→scenePassed · 씬안개→sceneFog
 *                    컷다시→replayCut · 상태→state
 *   그리기전 → beforeRender · 그린뒤 → afterRender · 빛맞춤 → adjustLights · 단서살피기 → scanClues · 틱 → tick
 *   userData: wg기본→wgBase · wg마지막→wgLast · wg기본색→wgBaseColor · 번호들→ids · 원경→isDistant
 *   메시 이름: 하늘지오→MESH_NAMES.skyDome · 구름지오→MESH_NAMES.skyClouds
 */
import * as THREE from "three";

import { MESH_NAMES } from "../../plan/meshNames";
import { UNITS_PER_METER, ZONES } from "../../plan/sitePlan";
import { audio } from "./audio";
import { playBeat, playCue, playEvent, strikeLightning, type CueContext } from "./cues";
import { endCut, replayCut, startCut } from "./entryCut";
import { focus, focusPulse, currentZone, scenePassed } from "./focusFog";
import {
  cueTable,
  LIGHTNING_COLOR,
  NIGHT_PUDDLE_COLOR,
  noise,
  peak,
  RAIN_FOG_COLOR,
  settings,
  smoothstep,
  stage,
  WHITE,
  windUniforms,
  type CueItem,
  type ImmersionTerrain,
} from "./state";
import { isPuddleAt, rainUniforms } from "./wetMaterials";

const U = UNITS_PER_METER;

// ═══════════════════════════════════════════════════════════════
//  콘솔 API — 옛 window.__연출
// ═══════════════════════════════════════════════════════════════
export const director = {
  settings,
  cue: (item: CueItem, context?: CueContext) => playCue(item, context),
  beat: (name: string, context?: CueContext) => playBeat(name, context),
  // 씬 n 이 끝났다 → 안개 한 칸 걷힘(focusFog). 콘솔 점검: director.scenePassed(3) · director.sceneFog()
  scenePassed: (n: number) => scenePassed(n),
  sceneFog: () => ({
    clearedScenes: focus.clearedScenes,
    radiusM: +focus.radiusM.toFixed(1),
    startRatio: +focus.fogStartRatio.toFixed(2),
    mistFactor: +focus.mistFactor.toFixed(2),
  }),
  event: (name: string, context?: CueContext) => playEvent(name, context),
  // 개발용: 그 구역의 첫 진입 컷을 다시 보게 한다(녹화·검수용)
  replayCut: (code: string) => replayCut(code),
  state: () => ({
    zone: stage.zone,
    cutInfo: stage.cut && { height: stage.cut.height, blocked: stage.cut.blocked },
    rain: +stage.rain.toFixed(2),
    wet: +rainUniforms.uWet.value.toFixed(2),
    puddle: +rainUniforms.uPuddle.value.toFixed(2),
    mist: +stage.mist.toFixed(2),
    wind: +stage.wind.toFixed(2),
    trauma: +stage.trauma.toFixed(2),
    cut: !!stage.cut,
    audio: audio.ctx?.state ?? "없음",
    seenClues: [...stage.seenClues],
  }),
};
export type Director = typeof director;

// ═══════════════════════════════════════════════════════════════
//  ⑤ 카메라 — 그리기 직전에만 비튼다
// ═══════════════════════════════════════════════════════════════
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
export function beforeRender(_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) {
  if (camera !== stage.camera) return;
  const cam = camera as THREE.PerspectiveCamera;
  const fx = stage.effects;
  const saved = stage.saved;
  saved.pos.copy(cam.position);
  saved.quat.copy(cam.quaternion);
  saved.fov = cam.fov;
  saved.changed = false;
  if (fx.cutPosition && fx.cutLookAt) {
    cam.position.copy(fx.cutPosition);
    cam.lookAt(fx.cutLookAt);
    saved.changed = true;
  } else {
    if (fx.gazeTarget && fx.gazeWeight > 0.001) {
      _m.lookAt(cam.position, fx.gazeTarget, _up);
      _q.setFromRotationMatrix(_m);
      cam.quaternion.slerp(_q, fx.gazeWeight);
      saved.changed = true;
    }
    if (fx.forward) {
      cam.translateZ(-fx.forward);
      saved.changed = true;
    }
    if (fx.yaw || fx.pitch || fx.roll) {
      _e.set(fx.pitch, fx.yaw, fx.roll);
      cam.quaternion.multiply(_q.setFromEuler(_e));
      saved.changed = true;
    }
  }
  if (fx.fov) {
    cam.fov = saved.fov + fx.fov;
    cam.updateProjectionMatrix();
    saved.changed = true;
  }
  if (saved.changed) cam.updateMatrixWorld(true);
}
export function afterRender(_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) {
  if (camera !== stage.camera || !stage.saved.changed) return;
  const cam = camera as THREE.PerspectiveCamera;
  const saved = stage.saved;
  cam.position.copy(saved.pos);
  cam.quaternion.copy(saved.quat);
  if (cam.fov !== saved.fov) {
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
  }
  cam.updateMatrixWorld(true);
  saved.changed = false;
}

// ═══════════════════════════════════════════════════════════════
//  매 프레임
// ═══════════════════════════════════════════════════════════════
const _c1 = new THREE.Color();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

type SceneLight = THREE.AmbientLight | THREE.HemisphereLight | THREE.DirectionalLight;
const isSceneLight = (o: THREE.Object3D): o is SceneLight =>
  ((o as THREE.AmbientLight).isAmbientLight ||
    (o as THREE.HemisphereLight).isHemisphereLight ||
    (o as THREE.DirectionalLight).isDirectionalLight) === true;

/** 씬의 빛을 시간대 배율·해색으로 맞춘다. 바깥(Leva)이 세기를 바꾸면 그 값을 새 기본으로 삼는다. */
function adjustLights(scene: THREE.Scene, k: number, sunColor: THREE.Color) {
  if (stage.time - stage.lightsFoundAt > 2) {
    stage.lightsFoundAt = stage.time;
    stage.lights = [];
    scene.traverse((o) => {
      if (isSceneLight(o)) stage.lights.push(o);
    });
  }
  for (const l of stage.lights) {
    const u = l.userData;
    if (u.wgBase === undefined || Math.abs(l.intensity - u.wgLast) > 1e-4) {
      u.wgBase = l.intensity;
      u.wgBaseColor = l.color.clone();
    }
    l.intensity = u.wgBase * k;
    u.wgLast = l.intensity;
    if ((l as THREE.DirectionalLight).isDirectionalLight) l.color.copy(u.wgBaseColor).multiply(sunColor);
  }
}

/** 단서발견(임시): 씬 무리(씬N.*)의 물체에 근접m 안으로 처음 다가가면 박자/사건을 건다 */
function scanClues(scene: THREE.Scene, position: THREE.Vector3) {
  const spec = cueTable.단서 ?? {};
  if (stage.time - stage.cluesFoundAt > 3) {
    stage.cluesFoundAt = stage.time;
    stage.clueGroups = [];
    scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !/^씬\d\./.test(o.name) || o.userData.isDistant) return;
      if ((spec.제외 ?? []).some((w) => o.name.includes(w))) return;
      stage.clueGroups.push(im);
    });
  }
  if (stage.time < stage.clueCooldown) return;
  const R2 = ((spec.근접m ?? 2.5) * U) ** 2;
  for (const o of stage.clueGroups) {
    const A = o.instanceMatrix.array;
    const ids = o.userData.ids as ArrayLike<number> | undefined;
    for (let i = 0; i < o.count; i++) {
      _v.set(A[i * 16 + 12], A[i * 16 + 13], A[i * 16 + 14]).applyMatrix4(o.matrixWorld);
      const dx = _v.x - position.x;
      const dz = _v.z - position.z;
      if (dx * dx + dz * dz > R2) continue;
      const key = `${o.name}#${ids?.[i] ?? i}`;
      if (stage.seenClues.has(key)) continue;
      stage.seenClues.add(key);
      stage.clueCooldown = stage.time + 4;
      const target = _v.clone();
      target.y += 0.8 * U;
      const event = spec.사건?.[o.name];
      if (event) playEvent(event, { target });
      else playBeat("단서발견", { target });
      return;
    }
  }
}

export interface TickArgs {
  scene: THREE.Scene;
  camera: THREE.Camera;
  terrain: ImmersionTerrain;
  /** 플레이어 자리(유닛) */
  position: THREE.Vector3;
  dt: number;
  /** 조작 가능한 상태(검수 카메라 고정 등이면 false) — 컷·단서를 건다 */
  active: boolean;
}

type ColorMaterialMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

export function tick({ scene, camera, terrain, position, dt, active }: TickArgs) {
  dt = Math.min(dt, 0.1);
  stage.time += dt;
  const t = stage.time;
  const paused = focus.paused;
  const code = currentZone() ?? stage.zone ?? cueTable.기본구역;
  const zq = cueTable.구역?.[code] ?? {};
  const tod = cueTable.시간대[zq.시간대 ?? "한낮"] ?? cueTable.시간대.한낮;

  // ── 구역 바뀜 → 전환 박자 · 소리 섞기 ──
  if (code !== stage.zone) {
    if (stage.zone) playBeat("전환");
    stage.zone = code;
    Object.assign(audio.targets, {
      바람: zq.소리?.바람 ?? 0.5,
      물: zq.소리?.물 ?? 0.5,
      새: zq.소리?.새 ?? 0,
      벌레: zq.소리?.벌레 ?? 0,
      개구리: zq.소리?.개구리 ?? 0,
    });
    audio.mix();
    audio.setReverb(zq.울림 ?? 0.25);
  }
  // ── 첫 진입 → 시점 컷 → 진입 박자 ──
  if (active && !paused && !stage.cut && !stage.visitedZones.has(code)) {
    stage.visitedZones.add(code);
    if (!(settings.시점컷 && zq.진입컷 !== false && startCut(code, terrain, position))) playBeat("진입");
  }

  // ── 날씨 목표 ──
  if (stage.eventRain && t > stage.eventRain.end) stage.eventRain = null;
  if (stage.eventWind && t > stage.eventWind.end) stage.eventWind = null;
  if (stage.eventMist && t > stage.eventMist.end) stage.eventMist = null;
  // 비는 **비 오는 구역 안에서만**(밖으로 6 m 에 걸쳐 잦아든다). 길(T)에 들어서면 구역 판정은 그대로라
  //   코드가 아니라 실제 자리로 잰다. 사건 비는 그 사건이 난 구역에 내린다. (10/13 미르: 「전체 씬에서 들린다」)
  const xm = position.x / U;
  const zm = position.z / U;
  const zoneRect = (c: string | null): [number, number, number, number] | null => {
    const z = ZONES.find((v) => v.code === c);
    return z ? [z.x[0] - 2, z.z[0] - 2, z.x[1] + 2, z.z[1] + 2] : null;
  };
  const outsideDistance = (r: [number, number, number, number]) =>
    Math.hypot(Math.max(r[0] - xm, 0, xm - r[2]), Math.max(r[1] - zm, 0, zm - r[3]));
  let rainTarget = 0;
  let rainRect: [number, number, number, number] | null = null;
  const candidates: [string | null, number][] = stage.eventRain
    ? [[stage.eventRain.zone, stage.eventRain.strength]]
    : Object.entries(cueTable.구역 ?? {})
        .filter(([, v]) => v?.날씨 === "비")
        .map(([c, v]) => [c, v?.비세기 ?? 0.7]);
  for (const [c, strength] of candidates) {
    const r = zoneRect(c);
    if (!r) continue;
    const k = strength * (1 - Math.min(1, outsideDistance(r) / 6));
    if (k > rainTarget) {
      rainTarget = k;
      rainRect = r;
    }
  }
  if (rainRect && rainTarget > 0.05) rainUniforms.uWetRect.value.set(rainRect[0], rainRect[1], rainRect[2], rainRect[3]);
  // 씬이 지날수록 물안개도 옅게(사건 물안개는 그대로)
  const mistTarget = stage.eventMist ? stage.eventMist.strength : (zq.물안개 ?? 0) * (focus.mistFactor ?? 1);
  const windTarget = (zq.바람 ?? 0.5) * (stage.eventWind ? stage.eventWind.factor : 1);
  const a = 1 - Math.exp(-dt / 1.6);
  stage.rain += (rainTarget - stage.rain) * a;
  stage.mist += (mistTarget - stage.mist) * a;
  stage.wind += (windTarget - stage.wind) * a;
  const rainAudible = settings.날씨 ? stage.rain : 0;
  if (Math.abs(audio.targets.비 - rainAudible) > 0.03) {
    audio.targets.비 = rainAudible;
    audio.mix();
  }
  audio.targets.바람 = (zq.소리?.바람 ?? 0.5) * (0.6 + 0.6 * stage.wind);
  windUniforms.uWindTime.value = t;
  // ×1.8 (10/14 미르: 「걸을 때 나뭇가지가 멈춘 것처럼 보인다」) — 흔들림이 몇 cm 라 걸으면 화면 이동에 묻혔다
  windUniforms.uWindAmp.value = settings.바람 ? stage.wind * (0.7 + 0.45 * noise(t * 0.35, 7)) * 1.8 : 0;
  // 젖음 · 고임 — 비가 오면 차고 그치면 천천히 마른다
  rainUniforms.uRain.value = rainAudible;
  rainUniforms.uWgTime.value = t;
  // ★ 날씨가 「비」인 구역은 **이미 한참 내린 뒤**로 둔다 — 들어서는 순간부터 젖어 있고 고여 있다(차오르는 연출 없음, 10/13 미르).
  //   차오르고 마르는 시간 흐름은 **사건 비**(구렁이 등)에만 쓴다.
  const rainZones = Object.entries(cueTable.구역 ?? {}).filter(([, v]) => v?.날씨 === "비");
  if (!stage.eventRain && rainZones.length) {
    const [c, v] = rainZones.reduce((p, q) => (outsideDistance(zoneRect(q[0])!) < outsideDistance(zoneRect(p[0])!) ? q : p));
    const r = zoneRect(c)!;
    rainUniforms.uWetRect.value.set(r[0], r[1], r[2], r[3]);
    rainUniforms.uWet.value = settings.날씨 ? 1 : 0;
    rainUniforms.uPuddle.value = settings.날씨 ? (v?.고임 ?? 0.9) : 0;
  } else {
    rainUniforms.uWet.value =
      rainAudible > 0.05 ? Math.min(1, rainUniforms.uWet.value + (dt / 8) * (0.4 + rainAudible)) : Math.max(0, rainUniforms.uWet.value - dt / 40);
    rainUniforms.uPuddle.value =
      rainAudible > 0.05
        ? Math.min(1, rainUniforms.uPuddle.value + (dt / 25) * (0.4 + rainAudible))
        : Math.max(0, rainUniforms.uPuddle.value - dt / 60);
  }
  // 번개 — 밤 구역 · 비 0.5 이상이면 8~20초마다
  if (rainAudible > 0.5 && tod.빛 < 0.6 && !paused) {
    if (!stage.nextLightning) stage.nextLightning = t + 4 + Math.random() * 8;
    if (t > stage.nextLightning) {
      strikeLightning(0.8 + Math.random() * 0.4);
      stage.nextLightning = t + 8 + Math.random() * 12;
    }
  } else stage.nextLightning = 0;
  let flashK = 0;
  if (stage.flashes) {
    for (const b of stage.flashes) {
      const u = (t - b.start) / b.seconds;
      if (u >= 0 && u <= 1) flashK = Math.max(flashK, b.strength * (1 - u));
    }
    if (stage.flashes.every((b) => t > b.start + b.seconds)) stage.flashes = null;
  }
  // 물방울 똑 — 처마·잎에서 (비 세기 비례)
  if (rainAudible > 0.15 && audio.ctx && Math.random() < dt * 6 * rainAudible) audio.play("똑");
  // 첨벙 발소리 — 웅덩이를 밟으며 걸을 때
  const body = stage.player;
  if (body?.moving && body.grounded !== false && rainUniforms.uPuddle.value > 0.1) {
    stage.footstep = (stage.footstep ?? 0) + dt;
    if (stage.footstep > (body.running ? 0.32 : 0.46)) {
      stage.footstep = 0;
      if (isPuddleAt(position.x / U, position.z / U, terrain)) audio.play("첨벙");
    }
  }

  // ── ① 시간대 ──
  if (!stage.current)
    stage.current = { fog: new THREE.Color(tod.안개), sky: new THREE.Color(tod.하늘색), light: tod.빛, sunColor: new THREE.Color(tod.해색) };
  const cur = stage.current;
  const b = 1 - Math.exp(-dt / 0.9);
  cur.fog.lerp(_c1.set(tod.안개), b);
  cur.sky.lerp(_c1.set(tod.하늘색), b);
  cur.sunColor.lerp(_c1.set(tod.해색), b);
  cur.light += (tod.빛 - cur.light) * b;
  const sky = scene.getObjectByName(MESH_NAMES.skyDome) as ColorMaterialMesh | undefined;
  const clouds = scene.getObjectByName(MESH_NAMES.skyClouds);
  if (paused) {
    adjustLights(scene, 1, WHITE);
    if (sky) {
      sky.visible = true;
      sky.material.color.set("#ffffff");
    }
    if (clouds) clouds.visible = true;
  } else {
    adjustLights(scene, cur.light * (1 - 0.3 * stage.rain) + flashK * 2.2, flashK > 0.05 ? WHITE : cur.sunColor);
    if (sky) {
      sky.visible = tod.하늘보임 !== false;
      sky.material.color.copy(cur.sky);
    }
    if (clouds) clouds.visible = tod.구름 !== false;
    if (scene.fog) {
      scene.fog.color.copy(cur.fog);
      if (stage.rain > 0.01 && settings.날씨) scene.fog.color.lerp(RAIN_FOG_COLOR, 0.4 * stage.rain); // 비 오면 잿빛으로
      if (flashK > 0.01) scene.fog.color.lerp(LIGHTNING_COLOR, 0.6 * flashK);
      // 웅덩이에 비치는 색 — 낮은 하늘(안개)빛, 밤은 짙은 남색
      const brightness = cur.fog.r * 0.3 + cur.fog.g * 0.59 + cur.fog.b * 0.11;
      rainUniforms.uPuddleCol.value.copy(scene.fog.color).lerp(brightness > 0.35 ? WHITE : NIGHT_PUDDLE_COLOR, brightness > 0.35 ? 0.25 : 0.6);
      // 구역이 바뀔 때 — 밤은 어둠이 조이고(focusFog), 낮은 하얗게 번진다
      const pulse = focusPulse();
      if (pulse > 0) {
        const squeeze = Math.sin(Math.PI * Math.pow(1 - pulse, 0.6));
        if (brightness > 0.35) scene.fog.color.lerp(WHITE, squeeze * 0.75 * (1 - focus.opening)); // 훑기 컷 동안은 하얗게 번지지 않는다
      }
      if ((scene.background as THREE.Color | null)?.isColor) (scene.background as THREE.Color).copy(scene.fog.color);
    }
  }

  // ── 단서 ──
  if (active && !paused && !stage.cut) scanClues(scene, position);

  // ── ⑤ 카메라 효과 계산 ──
  const fx = stage.effects;
  stage.trauma = Math.max(0, stage.trauma - dt * 0.8);
  const shake = stage.trauma * stage.trauma * settings.흔들림;
  fx.yaw = shake * 0.045 * noise(t * 17, 1);
  fx.pitch = shake * 0.035 * noise(t * 19, 2);
  fx.roll = shake * 0.05 * noise(t * 13, 3);
  let fov = 0;
  stage.zooms = stage.zooms.filter((z) => t - z.start < z.seconds);
  for (const z of stage.zooms) fov -= 12 * z.strength * peak((t - z.start) / z.seconds, 0.25, 0.5);
  fx.forward = 0;
  if (stage.dolly) {
    const u = (t - stage.dolly.start) / stage.dolly.seconds;
    if (u >= 1) stage.dolly = null;
    else {
      const k = peak(u, 0.55, 0.3);
      const f0 = (camera as THREE.PerspectiveCamera).fov;
      const f = f0 + 22 * k;
      const D = 6 * U;
      fx.forward = D * (1 - Math.tan(THREE.MathUtils.degToRad(f0 / 2)) / Math.tan(THREE.MathUtils.degToRad(f / 2)));
      fov += f - f0;
    }
  }
  fx.fov = fov;
  if (stage.gaze) {
    const u = (t - stage.gaze.start) / stage.gaze.seconds;
    if (u >= 1) {
      stage.gaze = null;
      fx.gazeWeight = 0;
      fx.gazeTarget = null;
    } else {
      fx.gazeTarget = stage.gaze.target;
      fx.gazeWeight = 0.35 * peak(u, 0.3, 0.45);
    }
  }
  // 공간 훑기 컷 동안 안개를 걷는다 — 들어갈 땐 빨리(≈0.4 초), 끝나면 천천히 다시 내려앉는다(≈1.2 초) (10/14)
  {
    const target = stage.cut ? 1 : 0; // 옛 식의 `설정.날씨 !== null` 은 늘 참이라 뺐다
    stage.opening += (target - stage.opening) * (1 - Math.exp(-dt * (target > stage.opening ? 6 : 2.4)));
    if (stage.opening < 0.002 && !target) stage.opening = 0;
    focus.opening = stage.opening;
  }
  if (stage.cut) {
    const c = stage.cut;
    const u = (t - c.start) / c.seconds;
    if (u >= 1 || paused) endCut();
    else {
      const e = smoothstep(u);
      const angle = c.angle0 - 1.1 * e;
      fx.cutPosition = _w.set((c.cx + Math.cos(angle) * c.radius) * U, (c.floor + c.height - 2.5 * e) * U, (c.cz + Math.sin(angle) * c.radius) * U);
      fx.cutLookAt = new THREE.Vector3(c.cx * U, (c.floor + 1.2) * U, c.cz * U);
    }
  }

  // ── 소리 ──
  audio.tick(t);
  audio.updateListener(camera);
}
