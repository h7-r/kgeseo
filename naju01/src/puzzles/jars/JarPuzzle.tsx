/**
 * 장독대 항아리 퍼즐 — 기우제 제물 「쌀」.
 * 장독대 위 항아리 여섯은 크기가 다르고 저마다 다른 음이 난다(크기와 음높이는 상관없다).
 * 가까이 가면 바탕음이 잦아들고 8초마다 절벽 바위 틈의 낙숫물(기우제 전엔 비가 오지 않는다)이 자리 왼쪽부터 순서대로 항아리를 친다.
 * [E] 로 항아리를 들고, 놓을 자리에 [E] 를 누르면 거기 끼워지고 나머지가 밀려난다.
 * 빗방울이 정답 가락을 치도록 늘어놓으면 가장 큰 항아리의 뚜껑이 열리고 쌀을 챙길 수 있다.
 *
 * 판정(P03, 서버 판정 input): 항아리를 놓을 때마다 자리 순서를 서버로 보낸다(najuProgress). 서버가 correct ·
 * already_completed 라고 답할 때만 뚜껑이 열린다 — 정답은 서버(server.json)에만 있다.
 * 서버로 보낼 수 없으면(대응표 확정 전 · 세션 없음) 개발 빌드에서만 jarLocalJudge.dev 로 판정하고,
 * 배포 빌드에서는 열지 않고 「연결 필요」를 띄운다. 연결이 끊기면 같은 이벤트를 [E] 로 다시 보낸다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { NAJU_LOCAL } from "../../progress/najuLocalIds";
import { najuProgress } from "../../progress/najuProgress";
import { createPuzzleSubmission, verdictNotice, type PuzzleVerdict } from "../../progress/puzzleSubmission";
import { recall, track } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { setMusicDuck } from "../../transition/loadingVideo";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { jarOrderAnswer } from "./jarAnswer";
import { jarPuzzle, useJarStage } from "./jarState";
import { JAR_SITE, JAR_SLAB } from "./site";

type Note = "도" | "미" | "솔" | "높은 도" | "높은 미" | "높은 솔";

/** 이웃한 음이 적어도 단3도(반음 셋) 떨어지게 — 반음·온음 차이는 빗소리 속에서 잘 안 갈린다 */
const PITCH: Record<Note, number> = {
  도: 261.63,
  미: 329.63,
  솔: 392.0,
  "높은 도": 523.25,
  "높은 미": 659.25,
  "높은 솔": 783.99,
};
/**
 * 처음 놓인 순서(왼쪽부터). 크기와 음높이는 상관없다. 쌀은 가장 큰 항아리에.
 * 정답은 이 파일에 두지 않는다(서버 판정). 개발용 로컬 판정은 jarLocalJudge.dev.ts.
 */
const JARS: { height: number; note: Note }[] = [
  { height: 0.55, note: "높은 도" },
  { height: 0.48, note: "도" },
  { height: 0.62, note: "높은 솔" },
  { height: 0.75, note: "미" },
  { height: 0.44, note: "높은 미" },
  { height: 0.58, note: "솔" },
];
const RICE_JAR = 3;
/** 자리 사이(미터) */
const SLOT_GAP = 0.72;
/** 자리 가운데(돌판 가운데에서 x, 미터) */
const SLOT_OFFSETS = JARS.map((_, k) => (k - (JARS.length - 1) / 2) * SLOT_GAP);

/** 이 거리(미터) 안에 들면 바탕음이 잦아든다 */
const LISTEN_RADIUS = 6;
/** 든 채로 이만큼(미터) 멀어지면 항아리를 제자리에 내려놓는다 */
const CARRY_RADIUS = 8;
/** 빗방울이 다시 오는 간격(초) */
const RAIN_PERIOD = 8;
/** 내려놓은 뒤 이만큼(초) 지나 바뀐 순서로 빗방울이 온다 */
const RAIN_AFTER_PLACE = 1.2;
/** 빗방울 사이(초) */
const NOTE_GAP = 1.0;
/** 빗방울이 떨어지는 시간(초) — 닿을 때 소리가 난다 */
const DROP_SECONDS = 0.35;
const DROP_HEIGHT = 2.6;
/** 든 항아리 자리(미터) — 눈 앞으로 · 오른쪽으로 · 뚜껑이 눈보다 이만큼 아래 */
const HOLD_DISTANCE = 1.1;
const HOLD_SIDE = 0.4;
const HOLD_DROP = 0.5;
/** 뚜껑이 열리는 시간(초) */
const LID_SECONDS = 1.1;
/** 열린 뚜껑이 쉬는 자리(항아리 키 기준) — 앞(+z, 절벽 반대쪽) 돌판 위, 안쪽 면을 항아리 배에 붙이고 기운다 */
const LID_REST = { y: 0.25, z: 0.5, tilt: 1.2 };

/** 옹기 옆선(높이 1 기준) — 넓은 어깨, 좁은 입 */
const JAR_PROFILE: [number, number][] = [
  [0, 0],
  [0.24, 0],
  [0.33, 0.12],
  [0.4, 0.42],
  [0.37, 0.72],
  [0.25, 0.9],
  [0.2, 0.94],
  [0.22, 1.0],
];
const LID_PROFILE: [number, number][] = [
  [0.26, 0],
  [0.25, 0.035],
  [0.14, 0.075],
  [0, 0.085],
];

const COLORS = { onggi: "#5A3B2A", lid: "#4A3022", slab: "#7D7A72", drop: "#DCE8F0" };
/** 물방울 하나(미터) — 빗방울 · 튀는 잔물방울이 함께 쓴다 */
const DROP_GEOMETRY = new THREE.SphereGeometry(0.008, 8, 6);
/** 뚜껑에 맞아 튀는 잔물방울 수 · 중력(m/s²) */
const SPLASH_COUNT = 9;
const GRAVITY = 9.8;

interface Jar {
  group: THREE.Group;
  lid: THREE.Group;
  /** 소리 · 빗방울이 닿는 뚜껑 위(유닛) — 항아리를 옮기면 매 프레임 따라 고친다 */
  top: THREE.Vector3;
  /** [E] 로 겨누는 가운데(유닛) */
  center: THREE.Vector3;
  drop: THREE.Mesh;
  /** 뚜껑에 맞고 튀는 잔물방울 — 자리 · 속도는 항아리 자기 좌표(미터) */
  splash: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[];
  /** 빗방울이 떨어진 뒤 흐른 시간. 음수면 쉼 */
  dropAge: number;
  /** 덜컥임 0~1 */
  wobble: number;
}

type JarMaterials = Record<keyof typeof COLORS, THREE.Material>;

const slabTop = () => groundY(JAR_SITE.x, JAR_SITE.z) + JAR_SLAB.height;

/** 자리 k 의 바닥 가운데(유닛) */
const slotPoint = (k: number, target = new THREE.Vector3()) =>
  target.set((JAR_SITE.x + SLOT_OFFSETS[k]) * M, slabTop() * M, JAR_SITE.z * M);

const scratch = {
  look: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  target: new THREE.Vector3(),
  side: new THREE.Vector3(),
};

function lathe(profile: [number, number][], scale: number) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)),
    18,
  );
}

/** 빗방울이 뚜껑에 닿는 순간 — 잔물방울이 둘레로 튀어 오른다. 크기도 제각각 */
function startSplash(jar: Jar, height: number) {
  jar.splash.forEach(({ mesh, velocity }, k) => {
    const angle = (k / jar.splash.length) * Math.PI * 2 + Math.random() * 0.6;
    const out = 0.35 + Math.random() * 0.55;
    velocity.set(Math.cos(angle) * out, 0.7 + Math.random() * 0.9, Math.sin(angle) * out);
    mesh.position.set(Math.cos(angle) * 0.012, height * 1.09, Math.sin(angle) * 0.012);
    mesh.scale.setScalar(0.45 + Math.random() * 0.6);
    mesh.visible = true;
  });
}

/** 잔물방울 — 포물선으로 날다가 뚜껑 둘레 아래로 떨어지면 사라진다. 나는 쪽으로 살짝 늘어진다 */
function updateSplash(jar: Jar, height: number, dt: number) {
  for (const { mesh, velocity } of jar.splash) {
    if (!mesh.visible) continue;
    velocity.y -= GRAVITY * dt;
    mesh.position.addScaledVector(velocity, dt);
    const speed = velocity.length();
    const base = mesh.scale.x;
    mesh.scale.y = base * (1 + Math.min(1.6, speed * 0.6));
    mesh.lookAt(scratch.look.copy(mesh.position).add(velocity));
    mesh.rotateX(Math.PI / 2);
    if (mesh.position.y < height * 0.85) mesh.visible = false;
  }
}

/** 항아리 여섯 — 몸통 · 뚜껑 · 빗방울 · 잔물방울을 한 무리로 */
function buildJars(materials: JarMaterials) {
  return JARS.map(({ height }, index): Jar => {
    const group = new THREE.Group();
    slotPoint(index, group.position);
    group.scale.setScalar(M);
    group.add(new THREE.Mesh(lathe(JAR_PROFILE, height), materials.onggi));
    const lid = new THREE.Group();
    lid.position.y = height;
    lid.add(new THREE.Mesh(lathe(LID_PROFILE, height), materials.lid));
    group.add(lid);
    // 빗방울 — 길쭉한 물방울. 떨어지는 동안 빗줄기처럼 늘어진다
    const drop = new THREE.Mesh(DROP_GEOMETRY, materials.drop);
    drop.scale.set(1, 4.5, 1);
    drop.visible = false;
    group.add(drop);
    const splash = Array.from({ length: SPLASH_COUNT }, () => {
      const mesh = new THREE.Mesh(DROP_GEOMETRY, materials.drop);
      mesh.visible = false;
      group.add(mesh);
      return { mesh, velocity: new THREE.Vector3() };
    });
    return { group, lid, top: new THREE.Vector3(), center: new THREE.Vector3(), drop, splash, dropAge: -1, wobble: 0 };
  });
}

/** 이미 열린 항아리의 시계 시작값(초) — 뚜껑 연출이 끝난 뒤로 잡는다 */
const RESTORED_JAR_CLOCK = 1000;

export default function JarPuzzle() {
  const stage = useJarStage();
  const materials = useMemo(
    (): JarMaterials => ({
      onggi: makeToonMaterial(COLORS.onggi, { side: THREE.DoubleSide }),
      lid: makeToonMaterial(COLORS.lid, { side: THREE.DoubleSide }),
      slab: makeToonMaterial(COLORS.slab),
      drop: new THREE.MeshBasicMaterial({
        color: COLORS.drop,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    }),
    [],
  );
  const jars = useMemo(() => buildJars(materials), [materials]);
  const slab = useMemo(() => {
    const geometry = new THREE.BoxGeometry(JAR_SLAB.width, JAR_SLAB.height, JAR_SLAB.depth);
    geometry.translate(0, JAR_SLAB.height / 2, 0);
    return geometry;
  }, []);
  // [E] 로 겨누는 자리 표시점 — 항아리를 든 동안만 쓴다
  const slotTargets = useMemo(
    () => SLOT_OFFSETS.map((_, k) => slotPoint(k).add(new THREE.Vector3(0, 0.45 * M, 0))),
    [],
  );

  // 진행 — 렌더와 무관한 값이라 ref 로 둔다
  /** 자리 k 에 놓인 항아리 번호. 든 항아리도 내려놓기 전까지는 제 자리를 차지한다(빈자리) */
  const orderRef = useRef(
    recall(
      "jars.order",
      JARS.map((_, index) => index),
    ),
  );
  // 이어 하기: 이미 열렸으면 쌀을 또 내놓지 않고 뚜껑을 연 채로 시작한다.
  const wasOpen = jarPuzzle.stage() === "open";
  const heldRef = useRef<number | null>(null);
  const isSolvedRef = useRef(wasOpen);
  const rainAtRef = useRef(-Infinity);
  const nextRainAtRef = useRef(0);
  const isListeningRef = useRef(false);
  const lidOpenedAtRef = useRef(wasOpen ? 0 : -1);
  const isRiceGivenRef = useRef(wasOpen);
  const clockRef = useRef(wasOpen ? RESTORED_JAR_CLOCK : 0);
  useEffect(() => track("jars.order", () => orderRef.current), []);
  /** 서버 판정을 기다리는 동안은 항아리를 들 수 없다(보낸 순서와 놓인 순서가 어긋나지 않게) */
  const isJudgingRef = useRef(false);
  /** P03 제출 — 연결이 끊긴 이벤트는 여기 쥐고 [E] 로 같은 이벤트를 다시 보낸다 */
  const submission = useMemo(() => createPuzzleSubmission(najuProgress), []);

  useEffect(
    () => () => {
      for (const jar of jars) jar.group.traverse((node) => (node as THREE.Mesh).geometry?.dispose());
      for (const material of Object.values(materials)) material.dispose();
      slab.dispose();
      // 자리를 떠난 채로 내려도 소리는 되돌린다
      if (isListeningRef.current) {
        audio.setAmbientLevel(1);
        setMusicDuck(1);
      }
    },
    [jars, materials, slab],
  );

  useEffect(() => {
    /** 뚜껑을 여는 쪽은 여기 하나 — 서버 correct · already_completed · 개발용 로컬 판정. 두 번 불려도 한 번만 연다 */
    const solve = () => {
      if (isSolvedRef.current) return;
      isSolvedRef.current = true;
      // 바뀐 순서로 빗방울이 정답 가락을 다 친 뒤에 뚜껑이 열린다
      lidOpenedAtRef.current =
        Math.max(nextRainAtRef.current, clockRef.current) + (JARS.length - 1) * NOTE_GAP + DROP_SECONDS + 0.7;
    };
    const settle = async (verdict: PuzzleVerdict, order: readonly number[]) => {
      if (verdict.kind === "correct" || verdict.kind === "already-completed") {
        solve();
        return;
      }
      // 서버를 쓸 수 없을 때만, 개발 빌드에서만 — 배포 빌드에는 이 분기와 정답 파일이 들어가지 않는다
      if (import.meta.env.DEV) {
        if (verdict.kind === "unavailable") {
          const { isLocalJarOrderCorrect } = await import("./jarLocalJudge.dev");
          if (isLocalJarOrderCorrect(order.map((jar) => JARS[jar].note))) solve();
          return;
        }
      }
      // incorrect 는 조용히(빗방울 가락으로 듣는다). 그 밖에는 안내만 — 완료로 보지 않는다
      const notice = verdictNotice(verdict);
      if (notice) showNotice(notice, 4.5);
    };
    const judge = async (order: readonly number[]) => {
      isJudgingRef.current = true;
      try {
        const verdict = await submission.submit({
          action: "input",
          zone: NAJU_LOCAL.zones.Z2,
          object: NAJU_LOCAL.objects.P03,
          answer: jarOrderAnswer(order),
        });
        await settle(verdict, order);
      } finally {
        isJudgingRef.current = false;
      }
    };
    /** 연결이 끊겨 쥔 같은 이벤트를 다시 보낸다(새 이벤트를 만들지 않는다) */
    const retry = async () => {
      if (isJudgingRef.current) return;
      const order = [...orderRef.current];
      isJudgingRef.current = true;
      try {
        const verdict = await submission.retry();
        if (verdict) await settle(verdict, order);
      } finally {
        isJudgingRef.current = false;
      }
    };
    const canHandle = () => !isSolvedRef.current && !isJudgingRef.current && !submission.canRetry();
    const lift = (jar: number) => {
      if (heldRef.current !== null || !canHandle()) return;
      heldRef.current = jar;
      audio.jar(PITCH[JARS[jar].note], jars[jar].top, true);
      showNotice("항아리를 들었다. 놓을 자리를 보고 [E]", 2.6);
    };
    /** 자리 k 에 끼운다 — 그 자리부터 오른쪽(또는 왼쪽) 항아리가 한 칸씩 밀린다 */
    const place = (slot: number) => {
      const jar = heldRef.current;
      if (jar === null) return;
      heldRef.current = null;
      const next = orderRef.current.filter((entry) => entry !== jar);
      next.splice(slot, 0, jar);
      orderRef.current = next;
      audio.jar(PITCH[JARS[jar].note], slotTargets[slot], true);
      nextRainAtRef.current = clockRef.current + RAIN_AFTER_PLACE;
      void judge(next);
    };
    const slabCenter = slotTargets[0].clone().lerp(slotTargets[slotTargets.length - 1], 0.5);
    const disposers = [
      ...jars.map((jar, index) =>
        registerInteractable({
          id: `jar-${index}`,
          position: jar.center,
          label: "항아리 들기",
          radius: Math.max(0.25, 0.45 * JARS[index].height) * M,
          reach: 2.6 * M,
          enabled: () => heldRef.current === null && canHandle(),
          use: () => lift(index),
        }),
      ),
      // 연결이 끊겨 판정을 못 받았을 때만 — 항아리는 잠그고 이것만 [E] 로 쓴다
      registerInteractable({
        id: "jar-sync-retry",
        position: slabCenter,
        label: "판정 다시 받기",
        radius: 0.9 * M,
        reach: 3 * M,
        enabled: () => submission.canRetry() && !isJudgingRef.current,
        use: () => void retry(),
      }),
      ...slotTargets.map((position, slot) =>
        registerInteractable({
          id: `jar-slot-${slot}`,
          position,
          label: "여기에 내려놓기",
          radius: 0.32 * M,
          reach: 3 * M,
          enabled: () => heldRef.current !== null,
          use: () => place(slot),
        }),
      ),
    ];
    if (import.meta.env.DEV)
      exposeDevHook("najuJarsDev", {
        lift,
        place,
        order: () => orderRef.current.map((jar) => JARS[jar].note),
      });
    return () => disposers.forEach((dispose) => dispose());
  }, [jars, slotTargets, submission]);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const time = (clockRef.current += dt);

    // 귀 기울이기 — 가까이 들면 바탕음이 잦아들고 빗방울이 들린다
    const dx = camera.position.x / M - JAR_SITE.x;
    const dz = camera.position.z / M - JAR_SITE.z;
    const distanceSq = dx * dx + dz * dz;
    const isListening = stage === "locked" && distanceSq < LISTEN_RADIUS * LISTEN_RADIUS;
    if (isListening !== isListeningRef.current) {
      isListeningRef.current = isListening;
      audio.setAmbientLevel(isListening ? 0.06 : 1);
      setMusicDuck(isListening ? 0.15 : 1);
      if (isListening) {
        nextRainAtRef.current = time + 2; // 들어서자마자 한 번 들려준다
        showNotice("바깥 소리가 잦아든다. 절벽 바위 틈에서 떨어지는 물방울이 항아리를 치는 소리만 또렷하다.", 4.5);
      }
    }
    if (heldRef.current !== null && distanceSq > CARRY_RADIUS * CARRY_RADIUS) {
      heldRef.current = null; // 제 자리(빈자리)로 돌아간다
      showNotice("항아리를 제자리에 내려놓았다.");
    }

    // 빗방울 — 자리 순서로 하나씩. 든 항아리 자리는 비어 소리가 안 난다
    if (isListening && time >= nextRainAtRef.current) {
      rainAtRef.current = time;
      nextRainAtRef.current = time + RAIN_PERIOD;
    }
    orderRef.current.forEach((jar, slot) => {
      const dropAt = rainAtRef.current + slot * NOTE_GAP;
      if (jar !== heldRef.current && time >= dropAt && time - dt < dropAt) jars[jar].dropAge = 0;
    });

    // 항아리 자리 — 든 것은 눈 앞으로, 나머지는 제 자리로 미끄러진다
    const follow = 1 - Math.exp(-dt * 12);
    jars.forEach((jar, index) => {
      const height = JARS[index].height;
      if (index === heldRef.current) {
        // 화면 아래 오른쪽에 들려 있게 — 가운데를 가리면 놓을 자리가 안 보인다
        camera.getWorldDirection(scratch.forward).setY(0).normalize();
        scratch.target
          .copy(camera.position)
          .addScaledVector(scratch.forward, HOLD_DISTANCE * M)
          .addScaledVector(scratch.side.set(-scratch.forward.z, 0, scratch.forward.x), HOLD_SIDE * M)
          .setY(camera.position.y - (HOLD_DROP + height) * M);
      } else {
        slotPoint(orderRef.current.indexOf(index), scratch.target);
      }
      jar.group.position.lerp(scratch.target, follow);
      jar.top.set(0, height * 1.09 * M, 0).add(jar.group.position);
      jar.center.set(0, height * 0.55 * M, 0).add(jar.group.position);

      // 빗방울 — 떨어져 뚜껑에 닿으면 울리고 잔물방울이 튄다
      if (jar.dropAge >= 0) {
        const before = jar.dropAge;
        jar.dropAge += dt;
        const fall = Math.min(1, jar.dropAge / DROP_SECONDS);
        jar.drop.visible = fall < 1;
        jar.drop.position.y = height * 1.09 + DROP_HEIGHT * (1 - fall * fall);
        if (before < DROP_SECONDS && jar.dropAge >= DROP_SECONDS) {
          audio.jar(PITCH[JARS[index].note], jar.top, true);
          jar.wobble = Math.max(jar.wobble, 0.25);
          startSplash(jar, height);
        }
        if (jar.dropAge - DROP_SECONDS >= 0.6) jar.dropAge = -1;
      }
      updateSplash(jar, height, dt);
      // 빗방울에 덜컥임 — 금방 잦아든다
      jar.wobble = Math.max(0, jar.wobble - dt * 2.2);
      const shake = Math.sin(time * 38) * jar.wobble;
      jar.group.rotation.z = shake * 0.025;
      if (index === RICE_JAR && lidOpenedAtRef.current >= 0 && time >= lidOpenedAtRef.current) return;
      jar.lid.rotation.z = shake * 0.06;
      jar.lid.position.y = height + Math.max(0, shake) * 0.012;
    });

    // 뚜껑 열림 — 앞으로 미끄러져 돌판에 떨어지고 항아리 배에 기대 선다(허공에 뜨지 않는다)
    if (lidOpenedAtRef.current >= 0 && time >= lidOpenedAtRef.current) {
      const jar = jars[RICE_JAR];
      const height = JARS[RICE_JAR].height;
      const t = THREE.MathUtils.clamp((time - lidOpenedAtRef.current) / LID_SECONDS, 0, 1);
      const ease = THREE.MathUtils.smootherstep(t, 0, 1);
      jar.lid.position.set(
        ease * 0.1 * height,
        THREE.MathUtils.lerp(height, LID_REST.y * height, ease) + Math.sin(ease * Math.PI) * 0.18 * height,
        ease * LID_REST.z * height,
      );
      jar.lid.rotation.x = ease * LID_REST.tilt;
      jar.lid.rotation.z = Math.sin(ease * Math.PI) * -0.25;
      if (t >= 1 && !isRiceGivenRef.current) {
        isRiceGivenRef.current = true;
        jarPuzzle.open();
        audio.play("단서");
        inventory.spawn("rice", jar.top.clone().setY(jar.top.y - 0.06 * M));
        showNotice("뚜껑이 열렸다. 항아리 안에 쌀이 가득하다.");
      }
    }
  });

  return (
    <group>
      <mesh
        geometry={slab}
        material={materials.slab}
        position={[JAR_SITE.x * M, groundY(JAR_SITE.x, JAR_SITE.z) * M, JAR_SITE.z * M]}
        scale={M}
      />
      {jars.map((jar, index) => (
        <primitive key={index} object={jar.group} />
      ))}
    </group>
  );
}
