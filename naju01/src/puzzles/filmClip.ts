/**
 * 게임 속 영상 판 — 영상 파일(mp4)을 3D 판에 올린다. 함의 「그날 밤」(ridge/boxClip) · 선바위의 「바위 위의 밤」(cliff/moonClip)이 쓴다.
 * 판 가장자리는 알파 마스크로 풀어 배경(빛기둥 · 밤하늘)과 잇는다 — 네모난 테두리가 각지게 보이던 것(해랑 11/13).
 * 시각은 영상이 기준이다 — 부르는 쪽은 제 시계를 넘기고, 영상이 틀어지고 있으면 영상의 시각을 돌려받아 자막 · 소리 큐를 맞춘다.
 * 영상을 못 틀었으면(파일 없음 · 받는 중) 넘긴 시각을 그대로 돌려줘 장면은 그대로 흐른다.
 * 소리는 없다(영상에 소리 트랙이 없다) — 효과음은 부르는 쪽의 큐가 낸다. 멈춤(gamePause)은 문서 밖 video 도 등록해 두면 같이 세운다.
 * 판은 후처리 뒤에 따로 그린다(useFilmClipLayer) — 만화 먹선(world/mangaStyle)은 깊이가 끊기는 곳에 선을 긋는데, 판이 깊이를 쓰면
 * 둘레에 네모 선이 생기고 안 쓰면 뒤 바위 · 나무의 선이 영상 위에 비친다. 둘 다 피하려면 먹선이 지나간 뒤에 그리는 수밖에 없다.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { isGameFrozen, trackMedia } from "@/engine/input/gamePause";
import { IS_LOW_QUALITY } from "@/engine/quality";

import { IS_POSTFX_DISABLED } from "../app/runtimeFlags";
import { M } from "./units";

/** 후처리(EffectComposer)가 켜져 있나 — App 과 같은 조건. 켜져 있으면 컴포저가 그린 뒤 판을 덧그린다 */
const HAS_POSTFX = !IS_LOW_QUALITY && !IS_POSTFX_DISABLED;

/** 가장자리 — 판 너비 · 높이의 이 비율만큼 안쪽에서부터 투명해진다 */
const FEATHER = { x: 0.14, y: 0.2 };
/** 모서리 둥글기 — 초타원 지수(2 면 타원, 클수록 네모에 가깝다) */
const CORNER = 2.6;
/** 영상 시각이 넘긴 시각과 이보다 어긋나면 맞춘다(초) — 멈췄다 돌아온 뒤 · 받다가 끊긴 뒤 */
const SLIP = 1.0;
const MASK = { width: 256, height: 128 };

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** 가장자리 마스크 — 가운데는 불투명, 네 변은 풀리고 모서리는 둥글게 사라진다(알파맵은 초록 채널을 읽는다) */
function makeEdgeMask() {
  const canvas = document.createElement("canvas");
  canvas.width = MASK.width;
  canvas.height = MASK.height;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const image = g.createImageData(MASK.width, MASK.height);
  for (let y = 0; y < MASK.height; y++) {
    const v = (y + 0.5) / MASK.height;
    for (let x = 0; x < MASK.width; x++) {
      const u = (x + 0.5) / MASK.width;
      const edge = smooth(Math.min(u, 1 - u) / FEATHER.x) * smooth(Math.min(v, 1 - v) / FEATHER.y);
      const radius = (Math.abs(2 * u - 1) ** CORNER + Math.abs(2 * v - 1) ** CORNER) ** (1 / CORNER);
      const round = 1 - smooth((radius - 0.7) / 0.3);
      const alpha = Math.round(255 * edge * round);
      const i = (y * MASK.width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = alpha;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export interface FilmClip {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  video: HTMLVideoElement;
  /** 영상을 받아 둔다 — 장면이 뜨기 전에 불러 틀 때 멈칫하지 않게 */
  prepare: () => void;
  /** 한 프레임 — seconds 는 부르는 쪽 시계. 영상이 틀어지고 있으면 영상의 시각을 돌려준다 */
  draw: (seconds: number) => number;
  /** 세우고 처음으로 */
  stop: () => void;
  dispose: () => void;
}

/** 영상 판 — url 은 public 아래 주소, 판 크기는 미터 */
export function createFilmClip(url: string, plane: { width: number; height: number }): FilmClip {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "none";
  video.src = url;
  const untrack = trackMedia(video);

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaMap: makeEdgeMask(),
    transparent: true,
    opacity: 0,
    // 깊이는 쓴다 — 화면의 먹선(만화 효과)은 깊이 차이로 긋는데, 안 쓰면 판 뒤 나무 · 바위의 선이 영상 위에 비쳤다.
    // 늘 맨 위에 그리는 것은 그대로다(「늘 통과」)
    depthWrite: true,
    depthTest: true,
    depthFunc: THREE.AlwaysDepth,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plane.width * M, plane.height * M), material);
  mesh.visible = false;
  mesh.renderOrder = 8;

  let isPrepared = false;
  const prepare = () => {
    if (isPrepared) return;
    isPrepared = true;
    video.preload = "auto";
    video.load();
  };

  const draw = (seconds: number) => {
    prepare();
    const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (!hasData) return seconds;
    if (video.paused && !video.ended && !isGameFrozen()) void video.play().catch(() => {});
    if (video.ended) return Math.max(seconds, video.currentTime);
    if (Math.abs(video.currentTime - seconds) > SLIP) {
      video.currentTime = seconds;
      return seconds;
    }
    return video.currentTime;
  };

  const stop = () => {
    video.pause();
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) video.currentTime = 0;
  };

  const dispose = () => {
    stop();
    untrack();
    video.removeAttribute("src");
    video.load();
    texture.dispose();
    material.alphaMap?.dispose();
    material.dispose();
    mesh.geometry.dispose();
  };

  return { mesh, material, video, prepare, draw, stop, dispose };
}

/**
 * 판을 화면에 올린다 — 후처리가 켜져 있으면 컴포저가 다 그린 뒤(useFrame 우선순위 2) 따로 그려 먹선 · 블룸을 안 탄다.
 * 후처리가 없으면(저사양 · ?fx=off) 먹선도 없으니 그냥 장면에 넣는다. 보이지 않는 동안은 그리지 않는다.
 */
export function useFilmClipLayer(clip: FilmClip) {
  const scene = useThree((state) => state.scene);
  const overlay = useMemo(() => {
    const layer = new THREE.Scene();
    layer.add(clip.mesh);
    return layer;
  }, [clip]);
  useEffect(() => {
    if (HAS_POSTFX) return undefined;
    scene.add(clip.mesh);
    return () => {
      scene.remove(clip.mesh);
    };
  }, [scene, clip]);
  useFrame(({ gl, camera }) => {
    if (!HAS_POSTFX || !clip.mesh.visible) return;
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(overlay, camera);
    gl.autoClear = autoClear;
  }, HAS_POSTFX ? 2 : 0);
}
