/**
 * 배포본에서 빼는 폴더 — AI허브 「한국적 일상 3D」(public/_aihub_local, 이용 범위 답변 전 로컬 미리보기 전용, 약 360MB)는
 * 개발 기계에만 있고 배포 빌드엔 넣지 않는다. vite 는 public/ 을 통째로 복사하므로 빌드가 끝난 뒤 산출물에서 지운다.
 */
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

const LOCAL_ONLY = ["_aihub_local"];

export function dropLocalOnlyPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "drop-local-only",
    apply: "build",
    configResolved(config) {
      // outDir 은 root 기준 상대 경로일 수 있다(naju01 은 "dist-naju01")
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const name of LOCAL_ONLY) {
        const target = join(outDir, name);
        if (!existsSync(target)) continue;
        rmSync(target, { recursive: true, force: true });
        console.log(`[drop-local-only] 배포본에서 뺌: ${target}`);
      }
    },
  };
}
