import type * as THREE from "three";

/**
 * 실제 렌더러(GPU) 이름. GPU 를 못 쓰면 브라우저가 에러 없이 CPU 로 그리므로 이름을 화면에 찍어 판별한다.
 * WEBGL_debug_renderer_info 가 없으면 브라우저가 감춘 것이라 일반 RENDERER 값을 쓴다.
 */
export function readGpuName(gl: THREE.WebGLRenderer): string {
  try {
    const ctx = gl.getContext();
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    const name: unknown = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
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

export function isSoftwareRenderer(name: string) {
  const n = name.toLowerCase();
  return SOFTWARE_RENDERER_WORDS.some((w) => n.includes(w));
}
