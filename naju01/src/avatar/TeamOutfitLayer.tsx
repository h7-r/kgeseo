// 팀 캐릭터 전용 덧입힘(검토 22회차) — 캡 · 해병대 반팔의 가슴 글자를 뼈에 붙이고, 바지 파츠를 몸 골격에 묶는다(teamOutfit.ts 가 번호를 푼다).
// 몸 GLB 를 새로 굽지 않고, 그 아바타의 실제 정점을 재서 맞춘다:
//   · 캡: 머리 뼈 국소 공간에서 머리(머리 뼈 웨이트가 큰 몸 정점) + 보이는 머리카락 정점을 모아, 위쪽 42% 를 다 감싸는
//     타원 돔을 만든다 — 머리카락이 돔 밖으로 튀어나오지 않게 높이를 정점마다 확인해 정한다. 앞으로 챙.
//   · 글자: 가슴 뼈(spine_03) 국소 공간에서 상의(_tint 2) 정점의 앞면을 재고, 가슴 곡률만큼 휜 판에 노란 「해병대」.
// 축은 바인드 자세에서 뼈가 본 몸의 위(+Y) · 앞(+Z)이다(glTF) — 재는 순간의 자세(걷기 · 인사)와 상관없이 같은 모양이 된다.
// 몸 · 머리카락은 뼈에 단단히 묶인 정점만 쓰므로 재는 자세는 상관없다. 설정(체형 모프 · 머리)이 바뀌면 다시 잰다.
import { useGLTF } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import { attachParts } from "./chibiBodyParts";
import type { MeshAppearanceConfig } from "./meshAppearance";
import type { Disposables, LoadedGltf, PartError, PreparedBody } from "./preparedBody";
import { getTeamPantsUrl, type TeamOutfit, type TeamPantsStyle } from "./teamOutfit";
import { DEFAULT_TOON, makeToonGradientTexture, TOON_UNIFORMS_KEY } from "./toonMaterial";
import { applyOutline, DEFAULT_OUTLINE, type OutlineConfig, type OutlineHandle } from "./toonOutline";

/** 아바타 외곽선과 같은 색(toonOutline DEFAULT_OUTLINE) */
const INK = "#2b2a33";
const CAP_COLOR = "#23252c";
const CAP_BUTTON_COLOR = "#2f323a";
const MARINE_YELLOW = "#ffd23f";
/** 캡이 덮는 머리 높이 비율(정수리부터) 🟡 */
const CAP_COVER = 0.42;

interface BoneFrame {
  bone: THREE.Bone;
  /** 뼈 국소 공간에서 오른쪽(+X) · 위 · 앞 축을 열로 가진 행렬 */
  basis: THREE.Matrix4;
}

interface CapFit {
  frame: BoneFrame;
  center: THREE.Vector3;
  radius: THREE.Vector3;
}

interface PrintFit {
  frame: BoneFrame;
  center: THREE.Vector3;
  width: number;
  bend: number;
}

/**
 * 캐릭터 재질 표식 — 세계 재질을 손보는 쪽(로비 만화풍 MangaMaterials · 나주 WorldToon)은 이 표식이 있는 재질을 건너뛴다.
 * 없으면 바지 · 캡 셰이더를 덮어써 결 무늬가 사라졌다(Codex 리뷰 a2a0fbd). 안의 값은 아무도 읽지 않는다(있는지만 본다)
 */
function markAvatarMaterial<T extends THREE.Material>(material: T): T {
  material.userData[TOON_UNIFORMS_KEY] = {};
  return material;
}

const gradient = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

function findBodyMesh(model: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!found && mesh.isSkinnedMesh && object.userData?.slot === "body") found = mesh;
  });
  return found;
}

/** 바인드 자세에서 그 뼈가 본 몸의 오른쪽 · 위 · 앞 축 */
function restFrame(mesh: THREE.SkinnedMesh, bone: THREE.Bone): BoneFrame | null {
  const index = mesh.skeleton.bones.indexOf(bone);
  const inverse = mesh.skeleton.boneInverses[index];
  if (index < 0 || !inverse) return null;
  const toBone = new THREE.Matrix4().multiplyMatrices(inverse, mesh.bindMatrix);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(toBone);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(toBone);
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  forward.crossVectors(right, up).normalize();
  return { bone, basis: new THREE.Matrix4().makeBasis(right, up, forward) };
}

/**
 * 메시 정점을 그 뼈의 축 좌표(오른쪽 · 위 · 앞)로. pick 이 거짓인 정점은 뺀다. 지금 자세 · 모프가 들어간 자리를 재고
 * 뼈 국소로 옮기므로 뼈에 단단히 묶인 정점은 자세와 상관없다.
 */
function measure(mesh: THREE.Mesh, frame: BoneFrame, pick: (index: number) => boolean, into: THREE.Vector3[]) {
  const toFrame = new THREE.Matrix4()
    .copy(frame.basis)
    .invert()
    .multiply(new THREE.Matrix4().copy(frame.bone.matrixWorld).invert())
    .multiply(mesh.matrixWorld);
  const count = mesh.geometry.getAttribute("position").count;
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    if (!pick(i)) continue;
    mesh.getVertexPosition(i, point);
    into.push(point.clone().applyMatrix4(toFrame));
  }
}

/** 그 정점에서 이 뼈들이 차지하는 웨이트 합 */
function weightOn(mesh: THREE.SkinnedMesh, boneIndices: readonly number[]) {
  const index = mesh.geometry.getAttribute("skinIndex");
  const weight = mesh.geometry.getAttribute("skinWeight");
  return (i: number) => {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) if (boneIndices.includes(index.getComponent(i, k))) sum += weight.getComponent(i, k);
    return sum;
  };
}

function fitCap(prepared: PreparedBody): CapFit | null {
  const body = findBodyMesh(prepared.model);
  const head = prepared.headBone;
  if (!body || !head) return null;
  const frame = restFrame(body, head);
  if (!frame) return null;
  const onHead = weightOn(body, [body.skeleton.bones.indexOf(head)]);
  const headPoints: THREE.Vector3[] = [];
  measure(body, frame, (i) => onHead(i) >= 0.5, headPoints);
  if (headPoints.length < 20) return null;
  const points = [...headPoints];
  for (const part of prepared.parts) {
    if (part.slot !== "hair" || !part.object.visible) continue;
    part.object.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) measure(mesh, frame, () => true, points);
    });
  }
  const top = Math.max(...points.map((p) => p.y));
  const chin = Math.min(...headPoints.map((p) => p.y));
  const rim = top - CAP_COVER * (top - chin);
  const above = points.filter((p) => p.y >= rim);
  const span = (axis: "x" | "z") => {
    const values = above.map((p) => p[axis]);
    return [Math.min(...values), Math.max(...values)] as const;
  };
  const [minX, maxX] = span("x");
  const [minZ, maxZ] = span("z");
  const center = new THREE.Vector3((minX + maxX) / 2, rim, (minZ + maxZ) / 2);
  const radius = new THREE.Vector3(((maxX - minX) / 2) * 1.06 + 0.004, 0, ((maxZ - minZ) / 2) * 1.06 + 0.004);
  // 높이 — 모든 정점이 타원 돔 안에 들도록(가장자리 정점은 테두리가 덮으니 뺀다)
  let height = radius.x * 0.6;
  for (const p of above) {
    const inside = 1 - ((p.x - center.x) / radius.x) ** 2 - ((p.z - center.z) / radius.z) ** 2;
    if (inside > 0.03) height = Math.max(height, (p.y - rim) / Math.sqrt(inside));
  }
  radius.y = height * 1.03 + 0.003;
  return { frame, center, radius };
}

function fitPrint(prepared: PreparedBody): PrintFit | null {
  const body = findBodyMesh(prepared.model);
  const chest = prepared.model.getObjectByName("spine_03") as THREE.Bone | undefined;
  const tint = body?.geometry.getAttribute("_tint");
  if (!body || !chest || !tint) return null;
  const frame = restFrame(body, chest);
  if (!frame) return null;
  const bones = ["spine_03", "spine_02"].map((name) => body.skeleton.bones.findIndex((bone) => bone.name === name));
  const onChest = weightOn(body, bones);
  const points: THREE.Vector3[] = [];
  // 상의 표식(2) — 반올림해 본다(경계 삼각형은 중간값)
  measure(body, frame, (i) => Math.round(tint.getX(i)) === 2 && onChest(i) >= 0.6, points);
  if (points.length < 50) return null;
  const ys = points.map((p) => p.y);
  const xs = points.map((p) => p.x);
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const centerX = (minX + maxX) / 2;
  const y = minY + 0.62 * (maxY - minY);
  const band = points.filter((p) => Math.abs(p.y - y) < 0.02);
  const middle = band.filter((p) => Math.abs(p.x - centerX) < 0.03);
  if (!middle.length) return null;
  const front = Math.max(...middle.map((p) => p.z));
  const width = 0.36 * (maxX - minX);
  // 가슴 곡률 — 앞면 정점의 (가운데에서 떨어진 거리)² 에 대한 들어감으로 휜 정도를 맞춘다
  let num = 0;
  let den = 0;
  for (const p of band) {
    const x = p.x - centerX;
    if (Math.abs(x) > width * 0.7 || p.z < front - 0.06) continue;
    num += (front - p.z) * x * x;
    den += x ** 4;
  }
  const bend = den > 0 ? Math.max(0, Math.min(12, num / den)) : 0;
  return { frame, center: new THREE.Vector3(centerX, y, front + 0.004), width, bend };
}

function makeMarineTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 200;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = () => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = MARINE_YELLOW;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '900 150px "Paperlogy", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
    g.fillText("해병대", canvas.width / 2, canvas.height / 2 + 6, canvas.width - 24);
    texture.needsUpdate = true;
  };
  draw();
  // 글꼴이 늦게 오면 다시 그린다
  void document.fonts?.ready.then(draw);
  return texture;
}

/** 챙 두께(m) */
const BRIM_THICKNESS = 0.009;
/**
 * 챙 크기 — 돔 테두리 대비 옆 폭 · 앞으로 나온 정도. 옆 폭을 돔보다 좁게 둬 챙 양 끝이 돔 옆벽 안으로 들어간다 — 일반 캡처럼
 * 앞쪽(약 140°)에만 챙이 보인다(돔보다 넓으면 옆을 따라 귀 쪽까지 띠가 생기고 끝에 턱이 졌다)
 */
const BRIM_WIDEN = 0.86;
const BRIM_REACH = 1.7;
/** 테두리에서 바깥 끝까지 숙이는 기울기(높이/길이) */
const BRIM_DROOP = 0.16;
/** 양옆 끝이 아래로 휘는 정도(돔 반폭 대비) — 일반 캡의 둥근 챙 */
const BRIM_CURL = 0.32;
/** 돔 밑면(안감) 색 — 챙 밑으로 올려다볼 때 보인다 */
const CAP_LINING_COLOR = "#1a1c22";
/**
 * 외곽선 껍데기 두께(m). 몸은 화면 픽셀로 일정한 뒤집은 껍데기를 쓴다 — 캡은 작아서 몇 mm 의 세계 두께로 같은 굵기에 맞춘다
 * (drei Outlines 는 늘린 반원판에서 껍데기가 얼굴을 덮는 큰 삼각형으로 깨졌다).
 */
const HULL = 0.0035;

/**
 * 곡선 챙(닫힌 입체). 돔 테두리의 앞 호에 그대로 붙어 있고(뿌리는 돔 벽 안쪽 1.2cm 부터), 바깥으로 갈수록 살짝 숙이며 양옆이
 * 아래로 휜다. 예전엔 평평한 반원판을 돔 한가운데를 축으로 숙여, 돔 앞 벽에서 챙이 테두리보다 1cm 남짓 내려가 그 틈으로
 * 이마가 비쳤다(미르 11/8). offset 은 외곽선 껍데기용 — 바깥 · 위아래로 그만큼 키운다.
 */
function makeBrimGeometry(radius: THREE.Vector3, offset: number) {
  const across = 28;
  const along = 10;
  const outerX = radius.x * BRIM_WIDEN + offset;
  const outerZ = radius.z * BRIM_REACH + offset;
  const rimZ = (x: number) => {
    const t = 1 - (x / radius.x) ** 2;
    return t > 0 ? radius.z * Math.sqrt(t) : 0;
  };
  const edgeZ = (x: number) => {
    const t = 1 - (x / outerX) ** 2;
    return t > 0 ? outerZ * Math.sqrt(t) : 0;
  };
  const positions: number[] = [];
  const rows = across + 1;
  const cols = along + 1;
  for (const layer of [0, 1]) {
    for (let i = 0; i < rows; i += 1) {
      const x = (i / across) * 2 * outerX - outerX;
      const inner = rimZ(x) - 0.012 - offset;
      const outer = Math.max(inner + 1e-4, edgeZ(x));
      for (let j = 0; j < cols; j += 1) {
        const z = inner + ((outer - inner) * j) / along;
        // 테두리 호에서 바깥 끝까지 0 → 1. 테두리 안쪽(뿌리)은 평평하게 테두리 높이
        const reach = outer - rimZ(x);
        const t = reach > 1e-4 ? Math.min(1, Math.max(0, (z - rimZ(x)) / reach)) : 0;
        const drop = t * reach * BRIM_DROOP + t ** 1.5 * BRIM_CURL * radius.x * (x / outerX) ** 2;
        const y = layer === 0 ? offset - drop : -BRIM_THICKNESS - offset - drop;
        positions.push(x, y, z);
      }
    }
  }
  const top = (i: number, j: number) => i * cols + j;
  const bottom = (i: number, j: number) => rows * cols + i * cols + j;
  const index: number[] = [];
  for (let i = 0; i < across; i += 1) {
    for (let j = 0; j < along; j += 1) {
      // 윗면(+y) · 아랫면(−y)
      index.push(top(i, j), top(i, j + 1), top(i + 1, j), top(i + 1, j), top(i, j + 1), top(i + 1, j + 1));
      index.push(
        bottom(i, j),
        bottom(i + 1, j),
        bottom(i, j + 1),
        bottom(i + 1, j),
        bottom(i + 1, j + 1),
        bottom(i, j + 1),
      );
    }
    // 바깥 끝(+z) · 뿌리(−z, 돔 안)
    index.push(
      top(i, along),
      bottom(i, along),
      top(i + 1, along),
      top(i + 1, along),
      bottom(i, along),
      bottom(i + 1, along),
    );
    index.push(top(i, 0), top(i + 1, 0), bottom(i, 0), top(i + 1, 0), bottom(i + 1, 0), bottom(i, 0));
  }
  for (let j = 0; j < along; j += 1) {
    // 양 끝 벽(−x · +x)
    index.push(top(0, j), bottom(0, j), top(0, j + 1), top(0, j + 1), bottom(0, j), bottom(0, j + 1));
    index.push(
      top(across, j),
      top(across, j + 1),
      bottom(across, j),
      top(across, j + 1),
      bottom(across, j + 1),
      bottom(across, j),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function Cap({ fit, outline }: { fit: CapFit; outline: OutlineConfig }) {
  const material = useMemo(
    () => markAvatarMaterial(new THREE.MeshToonMaterial({ color: CAP_COLOR, gradientMap: gradient })),
    [],
  );
  const buttonMaterial = useMemo(
    () => markAvatarMaterial(new THREE.MeshToonMaterial({ color: CAP_BUTTON_COLOR, gradientMap: gradient })),
    [],
  );
  const liningMaterial = useMemo(
    () =>
      markAvatarMaterial(
        new THREE.MeshToonMaterial({ color: CAP_LINING_COLOR, gradientMap: gradient, side: THREE.DoubleSide }),
      ),
    [],
  );
  const inkMaterial = useMemo(
    () => markAvatarMaterial(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })),
    [],
  );
  // 아바타 외곽선 설정을 따른다(끄면 캡 껍데기도 숨긴다)
  useEffect(() => {
    inkMaterial.color.set(outline.color);
    inkMaterial.visible = outline.enabled;
  }, [inkMaterial, outline.color, outline.enabled]);
  const dome = useMemo(() => new THREE.SphereGeometry(1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), []);
  // 돔 밑면 — 머리와 돔 테두리 사이의 빈 곳을 막는다(머리 안쪽은 머리 표면에 가려 안 보인다)
  const lining = useMemo(() => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), []);
  const { center, radius, frame } = fit;
  const brim = useMemo(() => makeBrimGeometry(radius, 0), [radius]);
  const brimHull = useMemo(() => makeBrimGeometry(radius, HULL), [radius]);
  useEffect(
    () => () => {
      [material, buttonMaterial, liningMaterial, inkMaterial, dome, lining].forEach((item) => item.dispose());
    },
    [material, buttonMaterial, liningMaterial, inkMaterial, dome, lining],
  );
  useEffect(
    () => () => {
      brim.dispose();
      brimHull.dispose();
    },
    [brim, brimHull],
  );
  const button = Math.max(0.006, radius.x * 0.07);
  return createPortal(
    <group matrixAutoUpdate={false} matrix={frame.basis}>
      {/* 돔 — 위 반구를 머리에 맞춰 늘린다 */}
      <mesh position={center} scale={radius} geometry={dome} material={material} castShadow receiveShadow />
      <mesh
        position={center}
        scale={[radius.x + HULL, radius.y + HULL, radius.z + HULL]}
        geometry={dome}
        material={inkMaterial}
      />
      <mesh
        position={[center.x, center.y + 0.0005, center.z]}
        scale={[radius.x, 1, radius.z]}
        geometry={lining}
        material={liningMaterial}
        receiveShadow
      />
      {/* 챙 — 테두리 앞 호에 붙은 곡선 챙 */}
      <group position={center}>
        <mesh geometry={brim} material={material} castShadow receiveShadow />
        <mesh geometry={brimHull} material={inkMaterial} />
      </group>
      {/* 꼭대기 단추 */}
      <mesh position={[center.x, center.y + radius.y - button * 0.3, center.z]} material={buttonMaterial}>
        <sphereGeometry args={[button, 12, 8]} />
      </mesh>
    </group>,
    frame.bone,
  );
}

function MarinePrint({ fit }: { fit: PrintFit }) {
  const texture = useMemo(() => makeMarineTexture(), []);
  const material = useMemo(
    () =>
      markAvatarMaterial(
        new THREE.MeshToonMaterial({
          map: texture,
          gradientMap: gradient,
          transparent: true,
          alphaTest: 0.35,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      ),
    [texture],
  );
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(fit.width, fit.width * 0.39, 24, 1);
    const position = plane.getAttribute("position");
    // 가슴 둘레를 따라 뒤로 휜다(가운데가 가장 앞)
    for (let i = 0; i < position.count; i += 1) position.setZ(i, -fit.bend * position.getX(i) ** 2);
    plane.computeVertexNormals();
    return plane;
  }, [fit.width, fit.bend]);
  useEffect(
    () => () => {
      texture.dispose();
      material.dispose();
    },
    [texture, material],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return createPortal(
    <group matrixAutoUpdate={false} matrix={fit.frame.basis}>
      <mesh position={fit.center} geometry={geometry} material={material} receiveShadow />
    </group>,
    fit.frame.bone,
  );
}

/** 바지 파일이 없거나 못 받아도 바지만 빠지고 아바타(로비 화면)는 그대로 — useGLTF 는 실패하면 오류를 던진다 */
class SkipOnError extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn(`[TeamOutfitLayer] ${this.props.label} 를 그리지 못했다`, error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 아바타 몸과 같은 명암 계단(툰) */
const pantsGradient = makeToonGradientTexture(DEFAULT_TOON.steps, DEFAULT_TOON.threshold);

/**
 * 바지 — 따로 구운 파츠 GLB(tools/team_pants_build.py)를 신발처럼 몸 골격에 묶는다(attachParts: 뼈 이름으로 다시 묶기).
 * 몸 표면을 복제해 만든 것이라 몸과 같은 모프 이름을 갖고 있어, 매 프레임 몸의 모프 값(다리 두께 · 골반 · 체형)을 옮겨
 * 체형 슬라이더를 따라간다. 결 무늬(회색)에 하의 색을 곱하고, 외곽선은 아바타와 같은 껍데기(applyOutline)다.
 */
function Pants({
  prepared,
  style,
  config,
  outline,
  framePriority,
}: {
  prepared: PreparedBody;
  style: TeamPantsStyle;
  config: Partial<MeshAppearanceConfig>;
  outline: OutlineConfig;
  framePriority: number;
}) {
  const gltf = useGLTF(getTeamPantsUrl(style, config)) as unknown as LoadedGltf;
  const material = useMemo(
    () => markAvatarMaterial(new THREE.MeshToonMaterial({ gradientMap: pantsGradient, side: THREE.DoubleSide })),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.color.set(config.bottomColor ?? "#ffffff");
  }, [material, config.bottomColor]);
  const attached = useRef<{ body: THREE.SkinnedMesh; meshes: THREE.SkinnedMesh[] } | null>(null);
  // 외곽선은 아바타 설정을 따른다(끄기 · 굵기 · 색) — 붙일 때 지금 값으로, 바뀌면 핸들을 고친다
  const outlineRef = useRef(outline);
  const outlineHandles = useRef<OutlineHandle[]>([]);
  useEffect(() => {
    outlineRef.current = outline;
    outlineHandles.current.forEach((handle) => handle.update(outline));
  }, [outline]);
  useEffect(() => {
    const body = findBodyMesh(prepared.model);
    if (!body) return;
    const errors: PartError[] = [];
    const disposables: Disposables = { geometries: [], materials: [] };
    const meshes = attachParts(gltf, body, errors, disposables);
    if (errors.length) console.warn("[TeamOutfitLayer] 바지 파츠 뼈가 몸에 없다", errors);
    const originals = new Map<string, THREE.SkinnedMesh>();
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) originals.set(object.name, object);
    });
    for (const mesh of meshes) {
      const original = originals.get(mesh.name);
      // 새 메시는 모프 이름을 모른다(번호만) — 원본 이름표를 옮긴다. 결 무늬는 원본 재질의 텍스처
      if (original?.morphTargetDictionary) mesh.morphTargetDictionary = { ...original.morphTargetDictionary };
      const map = (original?.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
      if (map && material.map !== map) {
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        material.map = map;
        material.needsUpdate = true;
      }
      mesh.material = material;
      mesh.frustumCulled = false;
      // 몸 · 신발처럼 그림자를 드리우고 받는다(attachParts 는 둘 다 끈 채 만든다 — Codex 리뷰 a2a0fbd)
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.teamPants = style;
    }
    const outlines = meshes.map((mesh) => applyOutline(mesh, outlineRef.current));
    outlineHandles.current = outlines;
    attached.current = { body, meshes };
    return () => {
      attached.current = null;
      outlineHandles.current = [];
      outlines.forEach((outline) => outline.remove());
      meshes.forEach((mesh) => mesh.parent?.remove(mesh));
      disposables.geometries.forEach((geometry) => geometry.dispose());
    };
  }, [gltf, prepared, material, style]);
  // 몸의 체형 모프 값을 이름으로 옮긴다(몸 GLB 와 바지 파츠의 모프 순서가 같다는 보장은 없다)
  useFrame(() => {
    const current = attached.current;
    const bodyInfluences = current?.body.morphTargetInfluences;
    const bodyDictionary = current?.body.morphTargetDictionary;
    if (!current || !bodyInfluences || !bodyDictionary) return;
    for (const mesh of current.meshes) {
      const influences = mesh.morphTargetInfluences;
      const dictionary = mesh.morphTargetDictionary;
      if (!influences || !dictionary) continue;
      for (const [name, index] of Object.entries(dictionary)) {
        const source = bodyDictionary[name];
        influences[index] = source === undefined ? 0 : (bodyInfluences[source] ?? 0);
      }
    }
  }, framePriority);
  return null;
}

/**
 * 아바타 안에 둔다. fitKey(설정)가 바뀌면 두 프레임 뒤(모프 · 뼈 배율이 들어간 뒤) 다시 잰다.
 * framePriority 는 아바타보다 뒤 — 그 프레임의 자세가 다 잡힌 다음에 잰다.
 */
export default function TeamOutfitLayer({
  prepared,
  outfit,
  config,
  outline = DEFAULT_OUTLINE,
  framePriority,
}: {
  prepared: PreparedBody;
  outfit: TeamOutfit;
  /** 번호를 푼 렌더러 설정 — 바뀌면 다시 잰다(fitKey). 바지 파일 · 색도 여기서 */
  config: Partial<MeshAppearanceConfig>;
  /** 아바타 외곽선 설정(끄기 · 굵기 · 색) */
  outline?: OutlineConfig;
  framePriority: number;
}) {
  const fitKey = config;
  // 잰 결과는 어느 몸 · 설정으로 쟀는지와 함께 둔다 — 바뀐 뒤 다시 재기 전(두 프레임)에는 그리지 않는다
  const [fits, setFits] = useState<{
    prepared: PreparedBody;
    fitKey: unknown;
    cap: CapFit | null;
    print: PrintFit | null;
  } | null>(null);
  const pending = useRef(2);
  useEffect(() => {
    pending.current = 2;
  }, [prepared, outfit.cap, outfit.marine, fitKey]);
  useFrame(() => {
    if (pending.current <= 0) return;
    pending.current -= 1;
    if (pending.current > 0) return;
    prepared.model.updateMatrixWorld(true);
    setFits({
      prepared,
      fitKey,
      cap: outfit.cap ? fitCap(prepared) : null,
      print: outfit.marine ? fitPrint(prepared) : null,
    });
  }, framePriority);
  const current = fits && fits.prepared === prepared && fits.fitKey === fitKey ? fits : null;
  const cap = current?.cap ?? null;
  const print = current?.print ?? null;
  return (
    <>
      {outfit.cap && cap && <Cap fit={cap} outline={outline} />}
      {outfit.marine && print && <MarinePrint fit={print} />}
      {outfit.pants && (
        // 바지 파일을 받는 동안 아바타 전체가 사라지지 않게 따로 기다린다
        <SkipOnError key={`${outfit.pants}:${config.gender}:${config.top}`} label="바지">
          <Suspense fallback={null}>
            <Pants
              prepared={prepared}
              style={outfit.pants}
              config={config}
              outline={outline}
              framePriority={framePriority}
            />
          </Suspense>
        </SkipOnError>
      )}
    </>
  );
}
