// ═══════════════════════════════════════════════════════════════
//  에셋.js — 밖에서 만들어 온 3D 파일을 이 공간의 규약에 맞춰 들이는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 이 파일이 필요한가 — 스케일]
//   Meshy 같은 AI 3D 툴이 주는 모델은 **크기가 제멋대로**다.
//   어떤 건 1.0, 어떤 건 100 이 나온다. 그런데 이 프로젝트는
//   **1 유닛 ≈ 0.30 m** 라는 규약 위에 서 있고, 도면의 모든 숫자가 미터다.
//   받아 온 것을 눈대중으로 맞추기 시작하면 「저 나무가 5 m 인지 50 m 인지」를
//   아무도 답할 수 없게 된다 — §3 의 「사람으로 보이는가」 판정이 무너진다.
//
//   그래서 **모든 외부 에셋은 여기를 통과한다.** 바운딩 박스를 재서
//   「이 물건의 실제 높이는 몇 m」를 못 박은 뒤에 씬에 놓는다.
//
// [지형처럼 '이미 제자리에 있는' 것은 정규화하지 않는다]
//   리텍스처는 기하를 그대로 돌려주므로 좌표가 이미 맞다. `그대로: true`.
//   여기서 크기를 건드리면 **판정과 어긋난다.**

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { 미터 } from "./공간도면.js";

const 로더 = new GLTFLoader();

export function GLB읽기(주소) {
  return new Promise((맞음, 틀림) => 로더.load(주소, 맞음, undefined, 틀림));
}

// 버퍼(ArrayBuffer)에서 바로 읽는다 — 도구가 파일을 건네줄 때 쓴다
export function GLB풀기(버퍼) {
  return new Promise((맞음, 틀림) =>
    로더.parse(버퍼, "", 맞음, 틀림),
  );
}

// ── 씬 하나를 지오메트리 한 덩이로 ─────────────────────────
//   여러 메시로 쪼개져 오는 경우가 흔하다. 재질이 하나면 합쳐서 드로우콜을 줄인다.
export function 첫메시(gltf) {
  let 찾음 = null;
  gltf.scene.traverse((o) => {
    if (o.isMesh && !찾음) 찾음 = o;
  });
  return 찾음;
}

// ── 실치수로 맞춘다 ────────────────────────────────────────
//   기준 = "높이" | "폭" | "깊이" | "최대"
//   목표m = 그 축의 실제 길이(미터)
//   바닥맞춤 = true 면 물건의 밑면이 y = 0 에 오도록 내린다(땅에 심기 좋게)
export function 실치수맞춤(지오, { 기준 = "높이", 목표m, 바닥맞춤 = true } = {}) {
  지오.computeBoundingBox();
  const b = 지오.boundingBox;
  const 크기 = {
    폭: b.max.x - b.min.x,
    높이: b.max.y - b.min.y,
    깊이: b.max.z - b.min.z,
  };
  크기.최대 = Math.max(크기.폭, 크기.높이, 크기.깊이);
  const 현재 = 크기[기준];
  if (!(현재 > 0)) return 지오; // 납작하거나 빈 것 — 그냥 둔다
  const 배 = (목표m * 미터) / 현재;
  지오.scale(배, 배, 배);
  // 가로 한가운데 · 세로는 밑면을 원점에 둔다
  지오.computeBoundingBox();
  const c = 지오.boundingBox;
  지오.translate(
    -(c.max.x + c.min.x) / 2,
    바닥맞춤 ? -c.min.y : -(c.max.y + c.min.y) / 2,
    -(c.max.z + c.min.z) / 2,
  );
  return 지오;
}
