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
import { DEFAULT_TOON, makeToonGradientTexture } from "./toonMaterial";
import { applyOutline, DEFAULT_OUTLINE } from "./toonOutline";

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
 * 외곽선 껍데기 두께(m). 몸은 화면 픽셀로 일정한 뒤집은 껍데기를 쓴다 — 캡은 작아서 몇 mm 의 세계 두께로 같은 굵기에 맞춘다
 * (drei Outlines 는 늘린 반원판에서 껍데기가 얼굴을 덮는 큰 삼각형으로 깨졌다).
 */
const HULL = 0.0035;

function Cap({ fit }: { fit: CapFit }) {
  const material = useMemo(() => new THREE.MeshToonMaterial({ color: CAP_COLOR, gradientMap: gradient }), []);
  const buttonMaterial = useMemo(
    () => new THREE.MeshToonMaterial({ color: CAP_BUTTON_COLOR, gradientMap: gradient }),
    [],
  );
  const inkMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }), []);
  const dome = useMemo(() => new THREE.SphereGeometry(1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), []);
  const brim = useMemo(() => new THREE.CylinderGeometry(1, 1, BRIM_THICKNESS, 32, 1, false, -Math.PI / 2, Math.PI), []);
  useEffect(
    () => () => {
      [material, buttonMaterial, inkMaterial, dome, brim].forEach((item) => item.dispose());
    },
    [material, buttonMaterial, inkMaterial, dome, brim],
  );
  const { center, radius, frame } = fit;
  const brimAt: [number, number, number] = [center.x, center.y + 0.003, center.z];
  const brimScale: [number, number, number] = [radius.x * 1.02, 1, radius.z * 1.65];
  const button = Math.max(0.006, radius.x * 0.07);
  return createPortal(
    <group matrixAutoUpdate={false} matrix={frame.basis}>
      {/* 돔 — 위 반구를 머리에 맞춰 늘린다. 껍데기는 아래가 열려 있어 챙 밑 안쪽이 어둡게 보인다 */}
      <mesh position={center} scale={radius} geometry={dome} material={material} />
      <mesh
        position={center}
        scale={[radius.x + HULL, radius.y + HULL, radius.z + HULL]}
        geometry={dome}
        material={inkMaterial}
      />
      {/* 챙 — 앞쪽 반원판, 살짝 아래로 */}
      <group position={brimAt} rotation={[0.14, 0, 0]}>
        <mesh scale={brimScale} geometry={brim} material={material} />
        <mesh
          scale={[brimScale[0] + HULL, 1 + (2 * HULL) / BRIM_THICKNESS, brimScale[2] + HULL]}
          geometry={brim}
          material={inkMaterial}
        />
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
      new THREE.MeshToonMaterial({
        map: texture,
        gradientMap: gradient,
        transparent: true,
        alphaTest: 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
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
      <mesh position={fit.center} geometry={geometry} material={material} />
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
  framePriority,
}: {
  prepared: PreparedBody;
  style: TeamPantsStyle;
  config: Partial<MeshAppearanceConfig>;
  framePriority: number;
}) {
  const gltf = useGLTF(getTeamPantsUrl(style, config)) as unknown as LoadedGltf;
  const material = useMemo(
    () => new THREE.MeshToonMaterial({ gradientMap: pantsGradient, side: THREE.DoubleSide }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.color.set(config.bottomColor ?? "#ffffff");
  }, [material, config.bottomColor]);
  const attached = useRef<{ body: THREE.SkinnedMesh; meshes: THREE.SkinnedMesh[] } | null>(null);
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
      mesh.userData.teamPants = style;
    }
    const outlines = meshes.map((mesh) => applyOutline(mesh, DEFAULT_OUTLINE));
    attached.current = { body, meshes };
    return () => {
      attached.current = null;
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
  framePriority,
}: {
  prepared: PreparedBody;
  outfit: TeamOutfit;
  /** 번호를 푼 렌더러 설정 — 바뀌면 다시 잰다(fitKey). 바지 파일 · 색도 여기서 */
  config: Partial<MeshAppearanceConfig>;
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
      {outfit.cap && cap && <Cap fit={cap} />}
      {outfit.marine && print && <MarinePrint fit={print} />}
      {outfit.pants && (
        // 바지 파일을 받는 동안 아바타 전체가 사라지지 않게 따로 기다린다
        <SkipOnError key={`${outfit.pants}:${config.gender}:${config.top}`} label="바지">
          <Suspense fallback={null}>
            <Pants prepared={prepared} style={outfit.pants} config={config} framePriority={framePriority} />
          </Suspense>
        </SkipOnError>
      )}
    </>
  );
}
