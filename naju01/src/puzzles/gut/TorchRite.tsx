/**
 * 씻김굿 — 다섯 횃불(5스테이지 · P16).
 *   틈을 지나 금줄 앞에 서면 키를 넘는 횃불대 다섯이 소반을 넓게 둘러 타오른다. 소반에는 기우제 때의 제물이 그대로 있고, 넋의 자리만 비었다.
 *   아랑사가 건네지 못한 조가비 가락지 한 쌍을 소반에 올리면 굿이 열린다 — 징이 울리고 돌풍이 횃불을 차례로 끈다.
 *   횃불대마다 그림패가 걸려 있다. 그 밤부터의 일들인데, 불이 꺼져 그을린 널처럼 어둡다. 화톳불에 꽂힌 관솔불을 뽑아 들고
 *   가까이 비추면 그림이 드러난다. 일이 일어난 차례대로 횃불에 관솔불을 대면 불이 옮겨붙고, 그 장면이 잠깐 되살아나 움직인다.
 *   차례가 어긋나면 바람이 켠 불을 다 끈다.
 *   다섯이 다 켜지면 바람이 거세지며 불기둥이 치솟고, 불길이 횃불대를 타고 내려와 땅을 달려 소반에 붙는다. 소반이 타오르며
 *   가락지 한 쌍이 하늘로 떠올라 사라지고, 밤이 걷혀 날이 갠다(riteFinale).
 * 가락지는 불을 붙이기 전이면 도로 집을 수 있다(굿이 멎고 횃불이 되살아난다). 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { assetUrl } from "@/config/env";
import { gameNow } from "@/engine/input/gameClock";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { addDynamicSolid } from "../../movement/solidField";
import { ending } from "../../ending/endingState";
import { recall, track } from "../../save/puzzleMemory";
import { releaseCompanion, sendCompanionTo } from "../../companion/companionStage";
import { cancelCameraFocus, cameraFocusId, focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { CLEARED_SKY, focus } from "../../scene/immersion/focusFog";
import { cliff } from "../cliff/cliffState";
import { floorAt, planar } from "../cliff/riteScene";
import { useGroundReady } from "../cliff/useGroundReady";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { makeGlowTexture } from "../glowTexture";
import { clearNotice, interactableFor, noticeFor } from "../interaction";
import { inventory } from "../inventory";
import { PINE_TORCH_TIP, buildItemLooks, buildPineTorchGeometry } from "../itemLooks";
import { loadModel } from "../itemModel";
import { makeToonMaterial } from "../materials";
import { setPuzzlePanel } from "../puzzlePanel";
import { createTorchFire, updateTorchFire } from "../ridge/torchFlames";
import { M, groundY } from "../units";
import { usePrewarm } from "../usePrewarm";
import { HAND_SCALE, handItemAt, handReach } from "../handPlace";
import {
  BRAZIER,
  BRAZIER_STICKS,
  FINALE,
  GUST,
  RINGS_ON_TABLE,
  STAKES,
  STAKE_TAGS,
  TABLE,
  TAGS,
  TAG_HEIGHT,
  TAG_REACH,
} from "./gutShape";
import { AbisaFarewell, FAREWELL, FAREWELL_LINES, FAREWELL_SPOT } from "./abisaFarewell";
import { gut, type SavedGut } from "./gutState";
import { buildFinale, updateFinale } from "./riteFinale";
import { TAG_PLAY_SECONDS, makeTagBoards, type TagBoards } from "./tagArt";
import { FIRE_SEAT, PLAQUE_DEPTH, buildPlaqueGeometry, buildPostGeometry } from "./torchPost";

/** 이 퍼즐(장면)의 글 · 물건 — 다른 퍼즐로 넘어가면 여기서 남긴 글은 내린다(interaction noticeFor · interactableFor) */
const showNotice = noticeFor("gut");
const registerInteractable = interactableFor("gut");

const BRAZIER_MODEL = "/_sf_local/lib/ast-prop-bonfire-brazier-01.glb";
/** 소반 — 불타 없어질 때 화면에서 지울 무리 이름(scene5 의 소반) */
const TABLE_MESH_NAME = "씬5.소반";
/** 안내판이 뜨는 거리(m) */
const PANEL_RANGE = 13;
/** 횃불 하나가 붙고 꺼지는 빠르기(1/초) */
const KINDLE_SPEED = 3;
/** 불이 옮겨붙는 순간 확 솟았다 가라앉는 시간(초) */
const CATCH_FLARE_SECONDS = 1.1;
/** 소반이 타며 오그라드는 정도 — 다 탔을 때의 키 · 너비(처음의 배) */
const CHARRED_TABLE = { tall: 0.25, wide: 0.8 };
/** 관솔불을 횃불에 대는 몸짓(초) — 내미는 시간 · 불이 옮겨붙는 순간 · 거두기 시작 · 다 거둔 때 */
const REACH = { out: 0.3, catchAt: 0.32, backFrom: 0.52, done: 0.86 };
/** 관솔불을 든 채 이 거리(m) 안에서 그림패가 비친다 — 가까울수록 또렷하다 */
const SHINE = { full: 1.8, none: 5 };
/** 바람에 날리는 티끌 수 */
const MOTES = 48;
/** 꺼진 횃불의 불꽃을 치워 두는 자리 — 땅속 깊이 */
const PARKED = new THREE.Vector3(0, -1e5, 0);

const smooth = THREE.MathUtils.smoothstep;
/** 불이 잦아든 뒤(FINALE.endAt) 이만큼 지나 전체화면 엔딩 필름을 연다(초) — 새벽(dawnAt)은 불이 아직 타는 중이다(Codex) */
const FILM_AFTER = 2;
/** 아비사의 작별이 끝나고 엔딩 필름을 여는 때(끝 연출이 시작된 뒤 초) — 불이 잦아든 뒤(FINALE.endAt + FILM_AFTER)보다 늦다 */
const FILM_AT = Math.max(FINALE.endAt + FILM_AFTER, FAREWELL.endAt + 0.6);
/** 끝 연출 카메라 고정 이름 */
const FINALE_FOCUS = { table: "gut-finale-table", rings: "gut-finale-rings", farewell: "gut-finale-farewell" } as const;
/** 떠오르는 가락지를 이 높이(m)까지만 따라 올려다본다 — 더 오르면 하늘만 보인다 */
const FINALE_LOOK_UP = 6;

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
  sprite.visible = false;
  return sprite;
}

function buildRite() {
  const root = new THREE.Group();
  root.name = "gut.torchRite";
  const glow = makeGlowTexture();

  // 횃불대 다섯 — 소반을 보고 둘러선다. 가로대 끝에 그림패가 걸린다(그림은 금줄 앞에 내려설 때 입힌다)
  const timber = makeToonMaterial("#FFFFFF", { vertexColors: true });
  const board = makeToonMaterial("#3A2A1D");
  const plaqueGeometry = buildPlaqueGeometry();
  const torches = STAKES.map((spot, i) => {
    const inward = Math.atan2(TABLE.x - spot.x, TABLE.z - spot.z);
    const post = new THREE.Mesh(buildPostGeometry(700 + i * 31), timber);
    post.position.copy(planar(spot.x, spot.z, -0.04));
    post.rotation.y = inward;
    post.scale.setScalar(M);
    post.castShadow = true;
    post.visible = false;
    const face = new THREE.MeshBasicMaterial({ toneMapped: false });
    const plaque = new THREE.Mesh(plaqueGeometry, [board, board, board, board, face, board]);
    const hangX = spot.x + Math.sin(inward) * (TAG_REACH + PLAQUE_DEPTH / 2);
    const hangZ = spot.z + Math.cos(inward) * (TAG_REACH + PLAQUE_DEPTH / 2);
    plaque.position.set(hangX * M, (floorAt(spot.x, spot.z) - 0.04 + TAG_HEIGHT) * M, hangZ * M);
    plaque.rotation.y = inward;
    plaque.scale.setScalar(M);
    plaque.castShadow = true;
    plaque.visible = false;
    const halo = buildGlowSprite(glow, "#FFA052", 2.2);
    halo.position.copy(planar(spot.x, spot.z, FIRE_SEAT + 0.05));
    root.add(post, plaque, halo);
    return {
      post,
      plaque,
      face,
      halo,
      top: halo.position.clone(),
      /** 겨누는 자리 — 그림패 앞면 */
      target: plaque.position.clone(),
      /** 붙은 정도 0~1 */
      burn: 0,
      /** 방금 불이 옮겨붙어 확 솟는 정도 1 → 0 */
      flare: 0,
    };
  });
  const fire = createTorchFire(torches.length);
  root.add(fire.flames.points, fire.sparks.points);

  // 화톳불 — 소반 곁, 세 발 받침 위의 쇠 화덕. 숯이 벌겋고 관솔 가지 셋이 꽂혀 있다
  const brazier = new THREE.Group();
  brazier.position.copy(planar(BRAZIER.x, BRAZIER.z));
  brazier.scale.setScalar(M);
  brazier.visible = false;
  const stickGeometry = buildPineTorchGeometry();
  const stickMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const sticks = BRAZIER_STICKS.map((spec) => {
    const stick = new THREE.Mesh(stickGeometry, stickMaterial);
    stick.rotation.set(spec.tilt[0], 0, spec.tilt[1]);
    brazier.add(stick);
    return stick;
  });
  const brazierFire = createTorchFire(1);
  const brazierGlow = buildGlowSprite(glow, "#FF8A3C", 1.3);
  root.add(brazier, brazierFire.flames.points, brazierFire.sparks.points, brazierGlow);

  // 소반 위 가락지 한 쌍 — 굿이 풀리면 불길 위로 떠오른다
  const looks = buildItemLooks();
  const tableTop = groundY(TABLE.x, TABLE.z) + TABLE.top;
  const ringMaterial = (looks.shellRings.material as THREE.MeshToonMaterial).clone();
  ringMaterial.transparent = true;
  const rings = new THREE.Mesh(looks.shellRings.geometry, ringMaterial);
  const ringsAt = new THREE.Vector3((TABLE.x + RINGS_ON_TABLE.x) * M, tableTop * M, (TABLE.z + RINGS_ON_TABLE.z) * M);
  rings.position.copy(ringsAt);
  rings.rotation.y = 0.5;
  rings.scale.setScalar(M * RINGS_ON_TABLE.scale);
  rings.visible = false;
  const ringsGlow = buildGlowSprite(glow, "#F4F1E6", 0.3);
  root.add(rings, ringsGlow);

  // 손에 든 관솔불 — 실제 불꽃과, 둘레를 비추는 빛(세기 0 으로 늘 달아 둔다)
  const handFire = createTorchFire(1);
  const handLight = new THREE.PointLight("#FFB066", 0, 7 * M, 1.7);
  // 바람에 날리는 티끌
  const motes = makeGlowPoints(MOTES, { additive: true, softness: 1.2 });
  motes.points.visible = false;
  const finale = buildFinale();
  // 끝 연출의 작별 — 가락지가 오른 뒤 물가에 서는 아비사(abisaFarewell)
  const farewell = new AbisaFarewell();
  root.add(
    handFire.flames.points,
    handFire.sparks.points,
    handLight,
    motes.points,
    finale.root,
    farewell.root,
    farewell.embers.points,
  );

  return {
    root,
    torches,
    fire,
    /** 불꽃이 솟는 자리 — 꺼진 횃불은 PARKED. 프레임마다 다시 채운다 */
    fireTops: torches.map(() => PARKED),
    farewell,
    brazier,
    sticks,
    brazierFire,
    brazierGlow,
    /** 화덕의 불 자리(유닛) — 모형을 읽은 뒤 잰다 */
    brazierTop: planar(BRAZIER.x, BRAZIER.z, BRAZIER.size * 0.9),
    boards: null as TagBoards | null,
    rings,
    ringsAt,
    ringsGlow,
    handFire,
    handLight,
    handTip: new THREE.Vector3(),
    motes,
    moteSeeds: Float32Array.from({ length: MOTES * 3 }, () => Math.random()),
    finale,
    /** 불타 없어질 소반 — 처음 필요할 때 화면에서 찾는다(findTable) */
    table: null as CharringTable[] | null,
    tableTarget: new THREE.Vector3(TABLE.x * M, (tableTop + 0.1) * M, TABLE.z * M),
  };
}

/** 타들어 가는 소반 한 덩이 — 제 재질(그을릴 수 있게 떼어 낸 것) · 처음 빛깔 · 처음 놓인 자리 */
interface CharringTable {
  mesh: THREE.InstancedMesh;
  materials: THREE.MeshStandardMaterial[];
  colors: THREE.Color[];
  placed: THREE.Matrix4;
}

/**
 * 화면에서 소반을 찾아 그을릴 수 있게 재질을 떼어 낸다. 소반은 씬이 놓은 인스턴스 무리라 다른 무리와 재질을 나눠 쓴다
 */
function findTable(scene: THREE.Scene) {
  const found: CharringTable[] = [];
  scene.traverse((node) => {
    const mesh = node as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.name.includes(TABLE_MESH_NAME) || mesh.count === 0) return;
    const shared = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = shared.map((material) => material.clone() as THREE.MeshStandardMaterial);
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
    const placed = new THREE.Matrix4();
    mesh.getMatrixAt(0, placed);
    found.push({ mesh, materials, colors: materials.map((material) => material.color.clone()), placed });
  });
  return found;
}

const squash = new THREE.Matrix4();
const squashed = new THREE.Matrix4();
/** 탄 정도(0~1)만큼 소반을 검게 그을리고 주저앉힌다. 다 타면 감춘다 */
function charTable(table: CharringTable[], charred: number) {
  const wide = THREE.MathUtils.lerp(1, CHARRED_TABLE.wide, charred);
  squash.makeScale(wide, THREE.MathUtils.lerp(1, CHARRED_TABLE.tall, charred * charred), wide);
  for (const { mesh, materials, colors, placed } of table) {
    mesh.visible = charred < 1;
    materials.forEach((material, k) => material.color.copy(colors[k]).multiplyScalar(1 - 0.94 * charred));
    mesh.setMatrixAt(0, squashed.multiplyMatrices(placed, squash));
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 그림패에 그림을 입힌다 — 영상 두 편을 그려 장면을 뜨느라 잠깐 걸린다 */
function paintTags(rite: ReturnType<typeof buildRite>) {
  const boards = makeTagBoards();
  rite.torches.forEach((torch, stake) => {
    torch.face.map = boards.textures[STAKE_TAGS[stake]];
    torch.face.needsUpdate = true;
  });
  rite.boards = boards;
}

/** 걷는 지형이 준비된 뒤에 차린다 */
export default function TorchRite() {
  const ground = useGroundReady();
  return ground ? <TorchRiteScene key={ground} /> : null;
}

function TorchRiteScene() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const rite = useMemo(() => buildRite(), []);
  const pending = useRef<{ at: number; run: () => void }[]>([]);
  const told = useRef({ arrived: false });
  /** 관솔불을 횃불에 대는 중 — 어느 횃불대 · 흐른 시간(초) · 불이 옮겨붙었나 */
  const reach = useRef<{ stake: number; time: number; hasCaught: boolean } | null>(null);
  /** 되살아나 움직이는 그림패 — 그림 번호와 불이 붙은 때(초) */
  const playing = useRef<{ tag: number; at: number }[]>([]);
  /** 플레이어(카메라) 자리(유닛) — 끝 연출 카메라가 「내가 선 곳의 바닥부터」 잡는 데 쓴다 */
  const playerAt = useRef(new THREE.Vector3());

  const actions = useMemo(() => {
    const later = (seconds: number, run: () => void) => pending.current.push({ at: gameNow() / 1000 + seconds, run });
    const isHolding = () => inventory.hand()?.kind === "pineTorch";
    const hasEmber = () => inventory.has("pineTorch") || isHolding();
    const dropEmber = () => {
      if (isHolding()) inventory.releaseHand();
      else inventory.consume("pineTorch");
    };
    /** 소지품의 관솔불을 손에 든다 */
    const holdEmber = () => {
      const stick = inventory.held().find((item) => item.kind === "pineTorch");
      if (stick) inventory.takeOut(stick.uid);
    };

    /** 가락지 한 쌍을 소반에 올렸다 — 굿이 열리고 돌풍이 횃불을 차례로 끈다 */
    const begin = () => {
      pending.current = [];
      gut.begin();
      audio.play("사기");
      audio.play("징");
      later(GUST.at, () => {
        audio.play("전환");
        audio.play("우르릉");
        director.cue({ 바람: 2.6, 초: GUST.calmBy - GUST.at });
        director.cue({ 카메라: "흔들림", 세기: 0.07 });
      });
      showNotice("가락지 한 쌍을 소반에 올렸다. 징이 울린다 — 강에서 돌풍이 몰아쳐 횃불 다섯이 차례로 꺼진다.", 6);
      later(6.5, () =>
        showNotice(
          "횃불대마다 그림패가 걸려 있다. 그 밤부터의 일들이다 — 불이 꺼져 그을린 널처럼 어둡다. 일어난 차례대로 다시 불을 붙여야 맺힌 것이 풀린다.",
          8,
        ),
      );
      later(15, () => showNotice("소반 곁 화톳불에 관솔불이 꽂혀 있다. 뽑아 들고 가까이 비추면 그림이 드러난다.", 6));
    };

    /** 가락지를 도로 집었다 — 굿이 멎고 횃불이 되살아난다 */
    const takeBack = () => {
      if (!inventory.add("shellRings")) {
        showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 집자.", 3.2, { urgent: true, fleeting: true });
        return;
      }
      pending.current = [];
      if (hasEmber()) dropEmber();
      gut.pause();
      audio.play("사기");
      showNotice("가락지 한 쌍을 도로 집었다. 징 소리가 멎고 꺼졌던 횃불이 되살아난다.", 4.5);
    };

    /** 화톳불에 꽂힌 관솔불을 뽑아 손에 든다 */
    const takeEmber = () => {
      if (isHolding()) {
        showNotice("관솔불을 들고 있다. 그림패 가까이 가면 그림이 비치고, 꺼진 횃불에 대면 불이 옮겨붙는다.", 4.5);
        return;
      }
      if (!inventory.has("pineTorch") && !inventory.add("pineTorch")) {
        showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 집자.", 3.2, { urgent: true, fleeting: true });
        return;
      }
      // 뽑아서 바로 손에 든다 — 들고 있어야 둘레가 밝고, 횃불에 댈 수 있다
      holdEmber();
      audio.play("불붙음");
      showNotice("화톳불에서 불붙은 관솔 가지를 뽑아 들었다. 둘레가 밝아진다 — 그림패에 가까이 비춰 보자.", 5);
    };

    /**
     * 다섯 불이 차례대로 다 켜졌다 — 굿이 풀린다(riteFinale 이 그린다). 여기부터 엔딩(미르 11/11 · 나주엔딩 01회차 Codex):
     * 끝 연출 동안 HUD 를 걷고 카메라를 소반 → 떠오르는 가락지로 잡는다(걷기 · 겨냥 · E/F 가 멈춘다). 연출 글은 아래 자막 띠로
     * 장면과 같은 때에(알림 줄을 안 거친다). 불이 잦아들면(release 뒤 FINALE.endAt + 2 s) 전체화면 엔딩 필름 → 클리어 화면.
     * 굿을 맺는 해설(씻김굿 · 진부촌 · 끝 물음)은 필름이 한다.
     */
    const release = () => {
      if (gut.stage() !== "rite") return;
      gut.release();
      if (hasEmber()) dropEmber();
      // 그림패마다 띄운 글이 줄에 남아 있으면 강가로 돌아왔을 때 뒤늦게 뜬다
      for (const tag of TAGS) clearNotice(tag.told);
      ending.beginFinale();
      focusFinale();
      audio.play("징");
      audio.play("우르릉");
      audio.play("불길");
      director.cue({ 카메라: "흔들림", 세기: 0.16 });
      director.cue({ 바람: 2.8, 초: FINALE.descendAt + 1.5 });
      // 자막은 화면이 못 하는 말만(미르 11/11) — 불길이 내려와 달리는 대목은 글 없이 화면이 말한다
      ending.caption("흩어진 이야기가 이어졌어요.", 5);
      later(FINALE.runAt, () => audio.play("불붙음"));
      later(FINALE.igniteAt, () => {
        audio.play("불길");
        audio.play("우르릉");
        director.cue({ 카메라: "흔들림", 세기: 0.14 });
        ending.caption("끝내 건네지 못한 가락지 한 쌍이에요.", 5.5);
      });
      later(FINALE.dawnAt, () => {
        gut.dawn();
        audio.play("전환");
      });
      later(FINALE.ringsAt + 3, () =>
        ending.caption("이제 그 마음을 보내 드려요.", FAREWELL.first - FINALE.ringsAt - 3 - 0.2),
      );
      // 작별 — 물은 사람(아비사)이 답을 듣고 제 일을 기억해 낸다. 모형을 못 읽었으면 글만 낸다
      later(FAREWELL.first, () => ending.caption(FAREWELL_LINES[0], FAREWELL.second - FAREWELL.first - 0.2));
      later(FAREWELL.second, () => ending.caption(FAREWELL_LINES[1], FAREWELL.leaveAt - FAREWELL.second + 1));
      later(FAREWELL.leaveAt, () => ending.noteFarewellShown());
      later(FILM_AT, () => {
        // 어느 구간에 있든 거둔다 — 프레임이 느리면 고정은 프레임 시간으로 흘러 아직 소반 구간일 수 있다(Codex 리뷰)
        const focusId = cameraFocusId();
        if (focusId === FINALE_FOCUS.table || focusId === FINALE_FOCUS.rings || focusId === FINALE_FOCUS.farewell)
          cancelCameraFocus();
        ending.openFilm();
      });
    };

    /**
     * 끝 연출 카메라 — 소반을 보다가, 가락지가 떠오르면 따라 올려다본다. 넘어가는 때는 연출과 같은 게임 시계로 예약한다
     * (고정은 프레임 시간을 쌓아 느린 기기에서 뒤처진다 — then 으로 이으면 가락지 장면을 놓쳤다, Codex 리뷰).
     * 둘 다 필름이 열릴 때 거둔다(그보다 길게 잡아 둔다)
     */
    const focusFinale = () => {
      const ringsAt = new THREE.Vector3();
      const groundAt = new THREE.Vector3();
      const holdUntilFilm = FILM_AT + 4;
      const sinceReleased = () => (gut.stage() === "dawn" ? FINALE.dawnAt + gut.elapsed() : gut.elapsed());
      // 「내가 선 곳의 바닥부터 소반까지」(해랑 11/13) — 플레이어 쪽 바닥에서 시작해 불길이 땅을 달려 소반에 붙을 때까지
      // 시선이 바닥을 따라 소반 위로 미끄러진다. 넓게(zoom 1.3) 잡아 바닥 불길 · 횃불대 · 소반이 한 화면에 들어온다
      const px = playerAt.current.x / M;
      const pz = playerAt.current.z / M;
      const groundStart = new THREE.Vector3(
        THREE.MathUtils.lerp(px, TABLE.x, 0.3) * M,
        (groundY(THREE.MathUtils.lerp(px, TABLE.x, 0.3), THREE.MathUtils.lerp(pz, TABLE.z, 0.3)) + 0.3) * M,
        THREE.MathUtils.lerp(pz, TABLE.z, 0.3) * M,
      );
      const tableTop = rite.tableTarget.clone().add(new THREE.Vector3(0, 0.7 * M, 0));
      focusCamera({
        id: FINALE_FOCUS.table,
        target: () => {
          const since = sinceReleased();
          const u = THREE.MathUtils.smootherstep(since, FINALE.runAt - 1.2, FINALE.igniteAt + 0.4);
          return groundAt.lerpVectors(groundStart, tableTop, u);
        },
        hold: holdUntilFilm,
        turnIn: 1.2,
        zoom: 1.3,
      });
      // 가락지가 떠오르면 소반이 화면 아래에 남은 채 따라 올려다본다 — 「바닥에서 위로 올라감」이 보이게 시선은 가락지보다 조금 아래를
      later(FINALE.ringsAt - 0.4, () =>
        focusCamera({
          id: FINALE_FOCUS.rings,
          target: () => {
            const u = THREE.MathUtils.clamp((sinceReleased() - FINALE.ringsAt) / 7.5, 0, 1);
            const rise = Math.min(FINALE_LOOK_UP, FINALE.ringsRise * u * u * (3 - 2 * u) * 0.7);
            return ringsAt.copy(rite.tableTarget).add(new THREE.Vector3(0, (1.0 + rise) * M, 0));
          },
          hold: holdUntilFilm,
          turnIn: 1.8,
          zoom: 1.15,
          replace: true,
        }),
      );
      // 가락지가 한참 오른 뒤 물가의 아비사를 돌아본다 — 빈 하늘을 오래 보지 않는다. 불씨가 되어 오르는 동안은 시선도 천천히 따라 오른다
      later(FAREWELL.lookAt, () => {
        if (!rite.farewell.isReady) return;
        focusCamera({
          id: FINALE_FOCUS.farewell,
          target: () => rite.farewell.lookTarget,
          hold: holdUntilFilm,
          turnIn: 1.8,
          replace: true,
        });
      });
    };

    /** 관솔불이 횃불에 닿았다. 그 그림패가 다음 차례면 붙고, 아니면 바람이 켠 불을 다 끈다 */
    const tryLight = (stake: number) => {
      if (gut.stage() !== "rite") return;
      const tag = STAKE_TAGS[stake];
      if (tag !== gut.state().lit) {
        gut.blowOut();
        audio.play("전환");
        director.cue({ 바람: 2.2, 초: 1.6 });
        director.cue({ 카메라: "흔들림", 세기: 0.06 });
        showNotice("차례가 어긋났다. 바람이 불어 켠 불이 다 꺼진다 — 그 밤부터의 일을 처음부터 다시 짚어 보자.", 5.5, {
          urgent: true,
        });
        return;
      }
      gut.light();
      rite.torches[stake].flare = 1;
      playing.current.push({ tag, at: gameNow() / 1000 });
      audio.play("불붙음");
      audio.play("단서");
      showNotice(TAGS[tag].told, 6);
      if (gut.state().lit === TAGS.length) later(TAG_PLAY_SECONDS, release);
    };

    /** 꺼진 횃불로 관솔불을 내민다 — 닿는 순간 tryLight 가 판정한다 */
    const reachTo = (stake: number) => {
      if (reach.current) return;
      if (!isHolding()) holdEmber();
      reach.current = { stake, time: 0, hasCaught: false };
    };

    return { later, isHolding, hasEmber, dropEmber, begin, takeBack, takeEmber, tryLight, reachTo, release };
  }, [rite]);

  usePrewarm(rite.root);

  useEffect(() => {
    scene.add(rite.root);
    return () => {
      scene.remove(rite.root);
      rite.farewell.release();
      setPuzzlePanel("gut-rite", null);
      gut.setGlow(0);
      gut.setWind(0);
      focus.clear = 0;
      handReach.amount = 0;
      if (rite.table) charTable(rite.table, 0);
    };
  }, [scene, rite]);

  // 이어 하기
  useEffect(() => {
    const saved = recall<SavedGut | null>("gut", null);
    if (saved) gut.restore(saved);
    return track("gut", () => gut.state());
  }, []);

  // 화톳불 — 모형을 읽어 숯 자리를 재고 관솔 가지를 꽂는다. 발에 걸리게 한다
  useEffect(() => {
    let isAlive = true;
    void loadModel(assetUrl(BRAZIER_MODEL), BRAZIER.size).then((source) => {
      if (!isAlive || !source) return;
      const copy = source.clone(true);
      copy.traverse((node) => (node.castShadow = true));
      // 화덕 자리에서 잰 높이(미터) — 무리에 달기 전이라 모형 자체의 크기다
      const box = new THREE.Box3().setFromObject(copy);
      const mouth = box.max.y - 0.06;
      rite.brazier.add(copy);
      rite.sticks.forEach((stick, k) => stick.position.set(BRAZIER_STICKS[k].x, mouth - 0.16, BRAZIER_STICKS[k].z));
      rite.brazierTop.setY(rite.brazier.position.y + mouth * M);
    });
    const ground = floorAt(BRAZIER.x, BRAZIER.z);
    const removeSolid = addDynamicSolid({
      x: BRAZIER.x,
      z: BRAZIER.z,
      yaw: 0,
      halfX: BRAZIER.size * 0.28,
      halfZ: BRAZIER.size * 0.28,
      bottom: ground - 0.2,
      top: ground + BRAZIER.size,
      // 화덕이 보일 때만 막는다 — 늘 켜 두면 굿판에 오기 전(돌탑을 끌고 오가는 기우제 터)에도 소반 옆에 보이지 않는 벽이
      // 서 있었다(베타 11/13 「석탑 지역 길막힘」)
      get enabled() {
        return rite.brazier.visible;
      },
      walkable: false,
    });
    return () => {
      isAlive = false;
      removeSolid();
    };
  }, [rite]);

  useEffect(() => {
    const isHere = () => cliff.stage() === "crossed";
    const removers = [
      registerInteractable({
        id: "gut-table",
        position: rite.tableTarget,
        label: "소반",
        radius: 0.45 * M,
        reach: 2.8 * M,
        enabled: () => isHere() && gut.stage() === "waiting",
        handLabel: (kind) => (kind === "shellRings" ? "소반에 가락지 한 쌍 올리기" : null),
        receive: () => actions.begin(),
        use: () =>
          showNotice(
            "소반에 기우제 때 올린 제물이 그대로 있다. 굿판은 차려졌는데 넋의 자리가 비었다 — 아랑사가 끝내 건네지 못한 것을 올리자.",
            6,
          ),
      }),
      registerInteractable({
        id: "gut-rings",
        position: rite.tableTarget,
        label: "가락지 도로 집기",
        radius: 0.45 * M,
        reach: 2.8 * M,
        // 불을 하나라도 붙인 뒤에는 집지 못한다 — 소반을 스치다 켠 불을 다 잃지 않게
        enabled: () => gut.stage() === "rite" && gut.state().lit === 0,
        use: () => actions.takeBack(),
      }),
      registerInteractable({
        id: "gut-brazier",
        position: rite.brazierTop,
        label: "화톳불의 관솔불",
        radius: 0.45 * M,
        reach: 2.6 * M,
        // 가락지를 올려 굿이 열리고 돌풍이 횃불을 끈 뒤에야 뽑는다
        enabled: () => gut.stage() === "rite" && gut.elapsed() > GUST.calmFrom,
        use: () => actions.takeEmber(),
      }),
      ...rite.torches.map((torch, stake) => {
        const tag = TAGS[STAKE_TAGS[stake]];
        return registerInteractable({
          id: `gut-torch-${stake}`,
          position: torch.target,
          label: `꺼진 횃불 · 그림패 「${tag.title}」`,
          radius: 0.6 * M,
          reach: 3.2 * M,
          keepHand: true,
          // 관솔불을 뽑아 든 뒤에야 쓴다
          enabled: () =>
            gut.stage() === "rite" && actions.hasEmber() && STAKE_TAGS[stake] >= gut.state().lit && !reach.current,
          handLabel: (kind) => (kind === "pineTorch" ? `「${tag.title}」 횃불에 관솔불 대기` : null),
          receive: () => actions.reachTo(stake),
          use: () => showNotice(tag.look, 5.5),
        });
      }),
    ];
    return () => removers.forEach((remove) => remove());
  }, [rite, actions]);

  const up = useMemo(() => new THREE.Vector3(), []);
  /** 작별 동안 동행을 비켜 세웠다 */
  const isCompanionAside = useRef(false);
  useEffect(
    () => () => {
      if (isCompanionAside.current) releaseCompanion();
    },
    [],
  );
  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = clock.elapsedTime;
    playerAt.current.copy(camera.position);
    const nowSeconds = gameNow() / 1000;
    // 때가 된 일을 치른다 — 치르는 일이 새 일을 걸 수 있어, 먼저 목록에서 빼고 나서 부른다
    const due = pending.current.filter((job) => job.at <= nowSeconds);
    if (due.length) {
      pending.current = pending.current.filter((job) => job.at > nowSeconds);
      due.forEach((job) => job.run());
    }
    const { stage, lit } = gut.state();
    const isHere = cliff.stage() === "crossed";
    const isRite = stage === "rite";
    const isOver = stage === "released" || stage === "dawn";
    // 이어 하기로 굿이 끝난 뒤에 돌아왔는데 관솔불이 손 · 소지품에 남아 있으면 거둔다(마지막 점화 직후 새로 고침, Codex)
    if (isOver && actions.hasEmber()) actions.dropEmber();
    const since = gut.elapsed();
    /** 굿이 풀린 지 몇 초 — 그 전이면 −1 */
    const releasedFor = stage === "released" ? since : stage === "dawn" ? FINALE.dawnAt + since : -1;
    const isHolding = actions.isHolding();

    // 작별의 아비사 — 금줄 앞에 내려서면 만들어 두고, 끝 연출 동안만 그 초의 모습으로(이어 하기 · 다시 보기에서는 안 그린다)
    if (isHere) rite.farewell.build(scene);
    rite.farewell.update(ending.phase() === "finale" ? releasedFor : -1);
    // 작별 동안 동행은 플레이어 뒤(아비사 반대쪽)로 비켜 선다 — 따라오던 자리가 아비사 앞이라 화면을 가렸다(11/11 촬영)
    const isFarewellOn =
      ending.phase() === "finale" && releasedFor > FAREWELL.lookAt - 1.2 && releasedFor < FAREWELL.endAt;
    if (isFarewellOn && !isCompanionAside.current) {
      isCompanionAside.current = true;
      const px = camera.position.x / M;
      const pz = camera.position.z / M;
      const away = Math.hypot(px - FAREWELL_SPOT.x, pz - FAREWELL_SPOT.z) || 1;
      sendCompanionTo(
        px + ((px - FAREWELL_SPOT.x) / away) * 1.3 + ((pz - FAREWELL_SPOT.z) / away) * 0.5,
        pz + ((pz - FAREWELL_SPOT.z) / away) * 1.3 - ((px - FAREWELL_SPOT.x) / away) * 0.5,
      );
    } else if (!isFarewellOn && isCompanionAside.current) {
      isCompanionAside.current = false;
      releaseCompanion();
    }

    // 그림패 — 금줄 앞에 내려선 첫 프레임(틈을 건너느라 화면이 캄캄한 때)에 그려 둔다
    if (isHere && !rite.boards) paintTags(rite);

    const distance = Math.hypot(camera.position.x / M - TABLE.x, camera.position.z / M - TABLE.z);
    if (isHere && stage === "waiting" && !told.current.arrived && distance < 8) {
      told.current.arrived = true;
      actions.later(7.5, () => {
        if (gut.stage() === "waiting")
          showNotice(
            "키를 넘는 횃불대 다섯이 소반을 둘러 타오르고, 소반에는 기우제 때의 제물이 그대로 있다. 굿판은 차려졌는데 넋의 자리가 비었다.",
            7,
          );
      });
    }

    // 굿이 풀리는 연출 — 불기둥 · 달리는 불 · 타는 소반 · 떠오르는 가락지
    const finale = updateFinale(rite.finale, releasedFor, time, { gl, camera });
    // 바람 — 가락지를 올릴 때의 돌풍, 불기둥이 솟을 때. 금줄 천자락과 티끌이 따른다
    const gust = isRite ? smooth(since, GUST.at, GUST.at + 0.4) * (1 - smooth(since, GUST.calmFrom, GUST.calmBy)) : 0;
    const wind = Math.max(gust, finale.wind);
    gut.setWind(wind);
    // 날이 갠 정도 — 안개가 물러나고 먼 데까지 빛깔이 돈다
    focus.clear += ((stage === "dawn" ? CLEARED_SKY : 0) - focus.clear) * (1 - Math.exp(-dt * 0.4));

    // 횃불 — 굿이 열리기 전에는 다 타오르고, 돌풍에 차례로 꺼진다. 굿 중에는 제 차례에 붙인 것만, 풀린 뒤에는 다 탄다
    const called = isHere ? 1 : gut.calledFires();
    let glow = 0;
    /** 방금 붙은 횃불이 확 솟는 정도 — 가장 큰 것 하나가 불 전체를 한 번 키운다 */
    let caught = 0;
    rite.torches.forEach((torch, stake) => {
      torch.flare = Math.max(0, torch.flare - dt / CATCH_FLARE_SECONDS);
      caught = Math.max(caught, torch.flare * torch.flare);
      const isBlown = since > GUST.at + 0.25 + stake * GUST.each;
      const isBurning = isRite ? STAKE_TAGS[stake] < lit || (lit === 0 && !isBlown) : called > 0;
      const goal = isBurning ? (isRite || isOver ? 1 : called) : 0;
      torch.burn += Math.sign(goal - torch.burn) * Math.min(Math.abs(goal - torch.burn), dt * KINDLE_SPEED);
      glow += torch.burn / rite.torches.length;
      torch.post.visible = called > 0;
      torch.plaque.visible = called > 0;
      torch.halo.visible = torch.burn > 0.01;
      const blaze = Math.max(finale.surge, torch.flare * torch.flare);
      torch.halo.material.opacity = torch.burn * (0.42 + 0.45 * blaze) * (0.8 + 0.2 * Math.sin(time * 7 + stake * 1.7));
      torch.halo.scale.setScalar((2.2 + 4.5 * blaze) * M);
      // 그림패 — 불이 꺼지면 그을린 널처럼 어둡다. 관솔불을 들고 다가서면 비치고, 제 불이 붙으면 환하다
      const reachTo = Math.hypot(camera.position.x - torch.target.x, camera.position.z - torch.target.z) / M;
      const shine = isHolding ? 1 - smooth(reachTo, SHINE.full, SHINE.none) : 0;
      torch.face.color.setScalar(0.13 + 0.95 * Math.max(torch.burn, 0.85 * shine, focus.clear / CLEARED_SKY));
    });
    // 되살아난 그림패 — 불이 붙은 뒤 잠깐 그 장면이 움직인다
    if (rite.boards) {
      const boards = rite.boards;
      playing.current = playing.current.filter(({ tag, at }) => {
        boards.play(tag, nowSeconds - at);
        return nowSeconds - at < TAG_PLAY_SECONDS + 0.2;
      });
    }
    gut.setGlow(glow + 0.5 * caught + 2 * finale.surge + 1.6 * finale.tableFire + 3 * finale.flash);
    const level = isRite || isOver ? 1 : called;
    const isSettled = releasedFor > FINALE.endAt;
    rite.torches.forEach((torch, stake) => (rite.fireTops[stake] = torch.burn > 0.5 ? torch.top : PARKED));
    updateTorchFire(
      rite.fire,
      rite.fireTops,
      time,
      {
        lit: level,
        big: (isSettled ? 0.15 : 0.35) + 0.65 * finale.surge + 0.55 * caught,
        flare: Math.max(1.4 * finale.surge, caught),
      },
      glow > 0,
      gl,
      camera,
    );

    // 화톳불 — 숯불과 잔불. 불붙은 관솔 가지는 뽑아 들면 화덕에서 사라진다
    rite.brazier.visible = called > 0;
    rite.brazierGlow.visible = called > 0;
    rite.brazierGlow.position.copy(rite.brazierTop);
    rite.brazierGlow.material.opacity = called * (0.55 + 0.12 * Math.sin(time * 5.1));
    rite.sticks[0].visible = !actions.hasEmber() && !isOver;
    updateTorchFire(
      rite.brazierFire,
      [rite.brazierTop],
      time,
      { lit: 0.8 * called, big: 0.35 * called, flare: 0 },
      called > 0,
      gl,
      camera,
    );

    // 관솔불을 횃불에 대는 몸짓 — 손의 관솔불이 횃불 머리까지 나갔다가 돌아온다. 닿는 순간 불이 옮겨붙는다
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const reaching = reach.current;
    if (reaching) {
      reaching.time += dt;
      const out = smooth(reaching.time, 0, REACH.out) * (1 - smooth(reaching.time, REACH.backFrom, REACH.done));
      handReach.target
        .copy(rite.torches[reaching.stake].top)
        .addScaledVector(up, -(PINE_TORCH_TIP * HAND_SCALE + 0.04) * M);
      handReach.amount = out;
      if (!reaching.hasCaught && reaching.time >= REACH.catchAt) {
        reaching.hasCaught = true;
        actions.tryLight(reaching.stake);
      }
      if (reaching.time >= REACH.done || !isHolding) {
        reach.current = null;
        handReach.amount = 0;
      }
    }
    // 손에 든 관솔불 — 끝에서 실제 불꽃이 솟고, 든 동안 둘레를 비춘다
    handItemAt(camera, rite.handTip).addScaledVector(up, PINE_TORCH_TIP * HAND_SCALE * M);
    const catching = reaching ? Math.exp(-Math.abs(reaching.time - REACH.catchAt) * 9) : 0;
    updateTorchFire(
      rite.handFire,
      [rite.handTip],
      time,
      { lit: isHolding ? 0.36 : 0, big: isHolding ? 0.12 + 1.1 * catching : 0, flare: 1.6 * catching },
      isHolding,
      gl,
      camera,
    );
    rite.handLight.intensity +=
      ((isHolding ? 8 + Math.sin(time * 9) : 0) - rite.handLight.intensity) * Math.min(1, dt * 6);
    rite.handLight.position.copy(rite.handTip);

    // 바람에 날리는 티끌 — 강 쪽(남)에서 바위 쪽으로 낮게 쓸려 간다
    rite.motes.points.visible = wind > 0.03;
    if (rite.motes.points.visible) {
      for (let i = 0; i < MOTES; i++) {
        const u = (time * (0.5 + rite.moteSeeds[i * 3] * 0.5) + rite.moteSeeds[i * 3 + 1]) % 1;
        const x = TABLE.x + (rite.moteSeeds[i * 3 + 2] - 0.5) * 12 + Math.sin(time * 2 + i) * 0.3;
        const z = TABLE.z + 6 - u * 12;
        rite.motes.position.setXYZ(
          i,
          x * M,
          (floorAt(x, z) + 0.15 + 2.2 * rite.moteSeeds[i * 3] + Math.sin(u * 9 + i) * 0.2) * M,
          z * M,
        );
        rite.motes.size.setX(i, (0.03 + 0.03 * rite.moteSeeds[i * 3 + 1]) * M);
        rite.motes.alpha.setX(i, Math.sin(Math.PI * u) * 0.5 * wind);
        rite.motes.color.setXYZ(i, 0.8, 0.82, 0.9);
      }
      rite.motes.commit();
      rite.motes.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
    }
    // 작별의 불씨 — 몸에서 떨어져 떠오르는 점도 화면 크기에 맞춘다
    rite.farewell.embers.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);

    // 가락지 — 소반에 올린 뒤로 놓여 있다. 굿이 풀리면 불길 위로 떠올라 돌며 하늘로 사라진다
    rite.rings.visible = (isRite || isOver) && finale.ringsFade < 1;
    rite.rings.position.copy(rite.ringsAt).setY(rite.ringsAt.y + finale.ringsRise * M);
    rite.rings.rotation.y = 0.5 + finale.ringsRise * 0.9;
    (rite.rings.material as THREE.MeshToonMaterial).opacity = 1 - finale.ringsFade;
    rite.ringsGlow.visible = rite.rings.visible;
    rite.ringsGlow.position.copy(rite.rings.position).setY(rite.rings.position.y + 0.03 * M);
    rite.ringsGlow.scale.setScalar((0.3 + 0.9 * Math.min(1, finale.ringsRise / 2)) * M);
    rite.ringsGlow.material.opacity =
      (finale.ringsRise > 0 ? 0.85 : 0.16) * (0.8 + 0.2 * Math.sin(time * 2.1)) * (1 - finale.ringsFade);

    // 소반 — 불이 붙으면 검게 그을리며 주저앉고, 다 타면 상도 제물도 사라져 그을린 자리만 남는다
    gut.setTableChar(finale.charred);
    if (finale.charred > 0 && !rite.table?.length) rite.table = findTable(scene);
    if (rite.table) charTable(rite.table, finale.charred);

    // 안내판
    if (!isHere || isOver || distance > PANEL_RANGE) setPuzzlePanel("gut-rite", null);
    else if (isRite)
      setPuzzlePanel("gut-rite", {
        title: "씻김굿 — 다섯 횃불",
        rule: "횃불대마다 그림패가 걸려 있다. 화톳불의 관솔불을 뽑아 들고 가까이 비추면 그림이 보인다. 그 일들이 일어난 차례대로 횃불에 관솔불을 댄다. 차례가 어긋나면 바람이 켠 불을 다 끈다.",
        rows: [
          { label: "켜진 불", value: `${lit} / ${TAGS.length}`, ok: lit === TAGS.length },
          {
            label: "관솔불",
            value: isHolding ? "들고 있다" : actions.hasEmber() ? "소지품에 있다" : "화톳불에 꽂혀 있다",
            ok: isHolding,
          },
        ],
        distance,
      });
    else
      setPuzzlePanel("gut-rite", {
        title: "넋상",
        rule: "굿판은 차려졌는데 넋의 자리가 비었다. 아랑사가 끝내 건네지 못한 것 — 조가비 가락지 한 쌍을 소반에 올린다.",
        distance,
      });
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuGutDev", {
      state: () => gut.state(),
      /** 가락지를 올린 것으로 친다 */
      begin: () => {
        inventory.consume("shellRings");
        actions.begin();
      },
      takeBack: () => actions.takeBack(),
      /** 끝 연출을 건너뛰고 날이 갠 뒤로 간다 */
      finish: () => gut.restore({ ...gut.state(), stage: "dawn" }),
      ember: () => actions.takeEmber(),
      /** 횃불대 stake 에 관솔불을 댄다(몸짓 없이 바로) */
      light: (stake: number) => actions.tryLight(stake),
      spots: () => ({
        table: rite.tableTarget.clone().divideScalar(M),
        brazier: rite.brazierTop.clone().divideScalar(M),
        torches: rite.torches.map((torch) => torch.target.clone().divideScalar(M)),
        tags: [...STAKE_TAGS],
      }),
      reset: () => gut.reset(),
    });
  }, [rite, actions]);

  return null;
}
