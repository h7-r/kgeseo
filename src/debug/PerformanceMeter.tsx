import { useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { IS_LOW_QUALITY } from "@/engine/quality";

import { crashLog } from "./crashLog";
import { exposeDevHook } from "./devHooks";

/**
 * 실제 렌더러(GPU) 이름. GPU 를 못 쓰면 브라우저가 에러 없이 CPU 로 그리므로 이름을 화면에 찍어 판별한다.
 * WEBGL_debug_renderer_info 가 없으면 브라우저가 감춘 것이라 일반 RENDERER 값을 쓴다.
 */
function readGpuName(gl: THREE.WebGLRenderer): string {
  try {
    const context = gl.getContext();
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    const name: unknown = extension
      ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    return String(name || "알 수 없음");
  } catch {
    return "읽기 실패";
  }
}

// 이름에 이 단어가 있으면 CPU 로 그리는 중이다.
const SOFTWARE_RENDERER_WORDS = [
  "swiftshader", // 크롬
  "llvmpipe", // 리눅스
  "software",
  "microsoft basic",
  "generic renderer",
];

function isSoftwareRenderer(name: string) {
  const lowered = name.toLowerCase();
  return SOFTWARE_RENDERER_WORDS.some((word) => lowered.includes(word));
}

interface PerformanceMeterProps {
  visible?: boolean;
}

/**
 * fps·드로우콜·삼각형·메모리 계기판 + 블랙박스 기록. 병목이 물체 수인지, 모델 무게인지, 누수인지 가른다.
 * R3F 밖에 글자를 그려야 해서 DOM 노드를 직접 붙이고 textContent 만 바꾼다(setState 면 초당 수십 번 리렌더).
 */
export default function PerformanceMeter({ visible = true }: PerformanceMeterProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    exposeDevHook("scene", scene);
    exposeDevHook("camera", camera);
    exposeDevHook("gl", gl);
  }, [scene, camera, gl]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const totals = useRef({ t: 0, frames: 0, calls: 0, triangles: 0, minFps: 999 });

  // gl.info 는 렌더 시작 때 스스로 0 이 되는데, useFrame 은 렌더 직전이라 엉뚱한 값이 읽힌다. 직접 리셋한다.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  const gpu = useMemo(() => {
    const name = readGpuName(gl);
    return { name, isSoftware: isSoftwareRenderer(name) };
  }, [gl]);

  useEffect(() => {
    if (!visible) return;
    const panel = document.createElement("div");
    // GPU 를 못 잡았으면 빨간 테두리 — 캡처만 봐도 안다
    const danger = gpu.isSoftware;
    panel.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:9999;padding:6px 10px;" +
      "font:12px/1.5 ui-monospace,Menlo,monospace;" +
      (danger ? "color:#ffd9d9;" : "color:#cfe3ff;") +
      "background:rgba(12,16,24,.88);border-radius:6px;" +
      (danger ? "border:2px solid #e2544a;" : "border:1px solid #2c3648;") +
      "max-width:340px;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(panel);
    panelRef.current = panel;
    return () => {
      panel.remove();
      panelRef.current = null;
    };
  }, [visible, gpu]);

  useFrame((_, dt) => {
    const info = gl.info;
    const n = totals.current;
    // gl.info 숫자는 GPU 가 죽어도 계속 오른다. isContextLost() 만 믿을 수 있다.
    if (!crashLog.contextLost) {
      try {
        if (gl.getContext().isContextLost()) crashLog.contextLost = true;
      } catch {
        crashLog.contextLost = true;
      }
    }
    n.calls += info.render.calls;
    n.triangles += info.render.triangles;
    info.reset();
    n.t += dt;
    n.frames++;
    // 평균 fps 는 끊김을 감춘다. 창 안에서 가장 느린 한 프레임을 따로 남긴다.
    if (dt > 0) n.minFps = Math.min(n.minFps, 1 / dt);
    if (!panelRef.current || n.t < 0.5) return;
    const fps = n.frames / n.t;
    // GPU 가 실제로 칠하는 버퍼 크기(CSS 크기 × DPR). 저사양 노트북이 죽는 1순위 원인이다.
    const bw = gl.domElement.width;
    const bh = gl.domElement.height;
    const megapixels = (bw * bh) / 1e6;
    const fillRate = megapixels * fps;
    panelRef.current.textContent =
      `${fps.toFixed(0)} fps  (${(1000 / fps).toFixed(1)} ms)  최저 ${n.minFps.toFixed(0)}\n` +
      `드로우콜 ${Math.round(n.calls / n.frames)}\n` +
      `삼각형   ${(n.triangles / n.frames / 1000).toFixed(0)}k\n` +
      `해상도 ${bw}×${bh} (${megapixels.toFixed(2)}MP · DPR ${window.devicePixelRatio})\n` +
      `픽셀처리 ${fillRate.toFixed(0)} MP/s\n` +
      `지오메트리 ${info.memory.geometries} · 텍스처 ${info.memory.textures}\n` +
      `셰이더 ${info.programs ? info.programs.length : "-"}\n` +
      `모드 ${IS_LOW_QUALITY ? "저사양(q=low)" : "일반"}\n` +
      `GPU: ${gpu.name}` +
      (gpu.isSoftware ? "\n⚠ GPU 미사용 — CPU로 그리는 중\n   크롬 설정 > 시스템 >\n   '하드웨어 가속 사용' 켜기" : "");

    const p = camera.position;
    crashLog.gpu = gpu.name;
    crashLog.resolution = `${bw}×${bh} (DPR ${window.devicePixelRatio})` + (IS_LOW_QUALITY ? " · 저사양" : "");
    const calls = Math.round(n.calls / n.frames);
    crashLog.record({
      t: (Date.now() - crashLog.startedAt) / 1000,
      fps: Math.round(fps),
      minFps: Math.round(n.minFps),
      calls,
      triangles: Math.round(n.triangles / n.frames),
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
      position: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
    });
    crashLog.save();
    // fps 는 멀쩡한데 드로우콜만 바닥 = GPU 가 아니라 그릴 게 없어진 것(구역 컬링).
    // 기준은 지금 올라온 지오메트리 수 — 작은 씬(기차 안)으로 갈아타면 드로우콜이 원래 적다.
    if (calls < 20 && fps > 20 && info.memory.geometries > 200) {
      crashLog.sceneEmptied = true;
    }

    n.t = 0;
    n.frames = 0;
    n.calls = 0;
    n.triangles = 0;
    n.minFps = 999;
  });

  return null;
}
