import { useMemo } from "react";
import * as THREE from "three";

import { UNIT_BOX } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { makeRandom } from "@/engine/random";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { PAPER_D, PAPER_STYLES, PAPER_W, paperTexture, STICKY_COLORS, STICKY_TEXTS, stickyMaterials } from "./paper";

const CLIP_DARK = "#22252A";
const CLIP_METAL = "#C9CDD4";

interface Sheet {
  px: number;
  pz: number;
  py: number;
  isOffStack: boolean;
  ry: number;
  rx: number;
  rz: number;
  w: number;
  d: number;
  h: number;
  isFolder: boolean;
  isPrinted: boolean;
  texSeed: number;
}

interface PaperStackProps {
  /** [x, z] */
  pos?: [number, number];
  /** 책상 윗면 높이 */
  y?: number;
  rot?: number;
  scale?: number;
  sheets?: number;
  /** 흐트러짐(각도) */
  spread?: number;
  /** 흐트러짐(밀림) */
  slide?: number;
  /** 한 장 두께 */
  thick?: number;
  /** 무너짐 — 위로 갈수록 쏠린다 */
  lean?: number;
  seed?: number;
  paperColor?: THREE.ColorRepresentation;
  /** 누런 서류봉투 색 */
  folderColor?: THREE.ColorRepresentation;
  clipCount?: number;
  stickyCount?: number;
  /** 흰 종이에 글이 적혀 있는지 */
  printed?: boolean;
  /** 봉투에도 글을 넣을지 */
  printedFolder?: boolean;
  /** PAPER_STYLES 중 하나 */
  textStyle?: string;
  outline?: OutlineValues | null;
}

/** 서류 더미. 종이 한 장 = 납작한 상자 — 낱장이 겹친 모양은 모델보다 코드로 쌓아야 평면·직각이 반듯하다. */
export default function PaperStack({
  pos = [0, 0],
  y = 2.44,
  rot = 0,
  scale = 1,
  sheets = 20,
  spread = 0.3,
  slide = 0.18,
  thick = 0.022,
  lean = 0.5,
  seed = 1,
  paperColor = "#EFEDE4",
  folderColor = "#D6C49B",
  clipCount = 1,
  stickyCount = 0,
  printed = false,
  printedFolder = false,
  textStyle = "섞기",
  outline,
}: PaperStackProps) {
  const styleIndex = Math.max(0, PAPER_STYLES.indexOf(textStyle));
  const [x, z] = pos;

  const stack = useMemo(() => {
    const rnd = makeRandom(seed);
    const out: Sheet[] = [];
    const leanDir = rnd() * Math.PI * 2;
    const lx = Math.cos(leanDir) * lean;
    const lz = Math.sin(leanDir) * lean;

    // 기울기를 장마다 무작위로 주면 아래위 종이가 X 자로 엇갈려 서로 뚫는다 — 이웃한 장끼리는 조금씩만 흘린다.
    let rx = (rnd() - 0.5) * 0.05;
    let rz = (rnd() - 0.5) * 0.05;

    for (let i = 0; i < sheets; i++) {
      const t = i / Math.max(1, sheets - 1);
      const pick = rnd();
      // 12% 는 누런 서류봉투
      const isFolder = pick < 0.12;
      const w = PAPER_W * (isFolder ? 1.06 : 1);
      const d = PAPER_D * (isFolder ? 1.04 : 1);

      if (i > 0) {
        rx = Math.max(-0.05, Math.min(0.05, rx + (rnd() - 0.5) * 0.014));
        rz = Math.max(-0.05, Math.min(0.05, rz + (rnd() - 0.5) * 0.014));
      }
      const px = (rnd() - 0.5) * slide * 2 + lx * t;
      const pz = (rnd() - 0.5) * slide * 2 + lz * t;

      // 더미 한가운데서 제 몸 반쪽보다 멀리 나갔으면 미끄러져 책상에 떨어진 장이다 — 받침 없는 자리에 쌓으면 공중에 뜬다.
      const isOffStack = Math.abs(px) > w / 2 || Math.abs(pz) > d / 2;
      let support: Sheet | null = null;
      for (const p of out)
        if (
          p.isOffStack === isOffStack &&
          Math.abs(px - p.px) < p.w / 2 &&
          Math.abs(pz - p.pz) < p.d / 2 &&
          (support === null || p.py > support.py)
        )
          support = p;

      // 두 장의 기울기 차이로 모서리가 들리는 높이(최악)
      const lift = support ? 0.5 * Math.max(w, d) * (Math.abs(rx - support.rx) + Math.abs(rz - support.rz)) : 0;
      // 면이 딱 붙어 지글거리지 않게 하는 최소 틈
      const gap = thick * 0.06;
      // 종이를 먼저 얇게 해 흡수하고, 모자라면 더 띄운다.
      const h = Math.max(thick * 0.25, Math.min(thick * 0.9, thick - lift - gap));
      const needed = (support?.h ?? 0) / 2 + h / 2 + lift + gap;
      const py = support ? support.py + Math.max(thick, needed) : h / 2 + gap;

      out.push({
        px,
        pz,
        py,
        isOffStack,
        ry: (rnd() - 0.5) * spread * 2,
        rx,
        rz,
        w,
        d,
        h,
        isFolder,
        // 글은 위쪽 절반에만(아래는 어차피 안 보인다)
        isPrinted: t > 0.45 && (isFolder ? printedFolder : printed),
        texSeed: (rnd() * 8) | 0,
      });
    }
    return out;
  }, [sheets, spread, slide, thick, lean, seed, printed, printedFolder]);

  const top = stack[stack.length - 1];

  const materials = useMemo(() => {
    const make = (color: THREE.ColorRepresentation) =>
      new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT });
    return {
      paper: make(paperColor),
      folder: make(folderColor),
      clipDark: make(CLIP_DARK),
      clipMetal: make(CLIP_METAL),
      // 텍스처 바탕이 흰색이라 '텍스처 × 종이색' — 봉투색이면 누런 종이에 글씨가 된다.
      printedTop: (texSeed: number, isFolder: boolean) =>
        new THREE.MeshToonMaterial({
          color: isFolder ? folderColor : paperColor,
          gradientMap: TOON_GRADIENT,
          map: paperTexture(texSeed, styleIndex),
        }),
    };
  }, [paperColor, folderColor, styleIndex]);

  const printedMaterials = useMemo(() => {
    const map = new Map<string, THREE.MeshToonMaterial>();
    stack.forEach((sheet) => {
      if (!sheet.isPrinted) return;
      const key = `${sheet.texSeed}-${sheet.isFolder ? "f" : "p"}`;
      if (!map.has(key)) map.set(key, materials.printedTop(sheet.texSeed, sheet.isFolder));
    });
    return map;
  }, [stack, materials]);

  // 집게는 위쪽 종이 하나의 모서리를 문다.
  const clips = useMemo(() => {
    if (clipCount <= 0 || stack.length < 2) return [];
    const rnd = makeRandom(seed + 777);
    return Array.from({ length: clipCount }, () => {
      const sheet = stack[((0.6 + rnd() * 0.39) * stack.length) | 0];
      const side = rnd() < 0.5 ? 1 : -1;
      const offset = (rnd() - 0.5) * 0.5;
      const lx = offset * sheet.w;
      const lz = side * sheet.d * 0.5;
      return {
        px: sheet.px + lx * Math.cos(sheet.ry) + lz * Math.sin(sheet.ry),
        pz: sheet.pz - lx * Math.sin(sheet.ry) + lz * Math.cos(sheet.ry),
        py: sheet.py,
        ry: sheet.ry,
      };
    });
  }, [stack, clipCount, seed]);

  // 포스트잇은 맨 위 종이에 붙는다. 가끔은 모서리 밖으로 반쯤 삐져나온다.
  const stickies = useMemo(() => {
    if (stickyCount <= 0 || !top) return [];
    const rnd = makeRandom(seed + 314);
    return Array.from({ length: stickyCount }, (_, i) => {
      const size = PAPER_W * (0.3 + rnd() * 0.12);
      const lx = (rnd() - 0.5) * top.w * 0.9;
      const lz = (rnd() - 0.5) * top.d * 0.95;
      return {
        px: top.px + lx * Math.cos(top.ry) + lz * Math.sin(top.ry),
        pz: top.pz - lx * Math.sin(top.ry) + lz * Math.cos(top.ry),
        // 종이 윗면 + 포스트잇 반두께 + 작은 틈 — 파묻히면 면이 겹친다.
        py: top.py + top.h / 2 + thick * 0.35 + thick * 0.1,
        ry: top.ry + (rnd() - 0.5) * 0.5,
        w: size,
        d: size * (0.85 + rnd() * 0.3),
        colorIndex: i % STICKY_COLORS.length,
        textIndex: (rnd() * STICKY_TEXTS.length) | 0,
      };
    });
  }, [top, stickyCount, seed, thick]);

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      {stack.map((sheet, i) => {
        const base = sheet.isFolder ? materials.folder : materials.paper;
        const printedTop = sheet.isPrinted
          ? printedMaterials.get(`${sheet.texSeed}-${sheet.isFolder ? "f" : "p"}`)
          : undefined;
        // BoxGeometry 면 순서 [+X, -X, +Y, -Y, +Z, -Z] — 2번이 윗면
        const material = printedTop ? [base, base, printedTop, base, base, base] : base;
        return (
          // receiveShadow 를 안 준다. 그림자맵 텍셀보다 얇은 판이 겹쳐 제 그림자가 새까만 얼룩(섀도 아크네)으로 찍힌다.
          <mesh
            key={i}
            geometry={UNIT_BOX}
            material={material}
            position={[sheet.px, sheet.py, sheet.pz]}
            rotation={[sheet.rx, sheet.ry, sheet.rz]}
            scale={[sheet.w, sheet.h, sheet.d]}
            castShadow
          >
            <ToonOutline geometry={UNIT_BOX} outline={outline} />
          </mesh>
        );
      })}

      {clips.map((clip, i) => (
        <group key={`clip${i}`} position={[clip.px, clip.py, clip.pz]} rotation={[0, clip.ry, 0]}>
          <mesh geometry={UNIT_BOX} material={materials.clipDark} scale={[0.17, 0.1, 0.055]} castShadow>
            <ToonOutline geometry={UNIT_BOX} outline={outline} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              geometry={UNIT_BOX}
              material={materials.clipMetal}
              position={[side * 0.05, 0.075, 0]}
              rotation={[0, 0, side * 0.35]}
              scale={[0.018, 0.1, 0.018]}
              castShadow
            />
          ))}
        </group>
      ))}

      {/* 포스트잇도 종이만큼 얇아 receiveShadow 를 뺀다. */}
      {stickies.map((sticky, i) => (
        <mesh
          key={`sticky${i}`}
          geometry={UNIT_BOX}
          material={stickyMaterials(sticky.colorIndex, sticky.textIndex)}
          position={[sticky.px, sticky.py, sticky.pz]}
          rotation={[0, sticky.ry, 0]}
          scale={[sticky.w, thick * 0.7, sticky.d]}
          castShadow
        >
          <ToonOutline geometry={UNIT_BOX} outline={outline} />
        </mesh>
      ))}
    </group>
  );
}
