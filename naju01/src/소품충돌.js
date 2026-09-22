// 소품 충돌 — 인스턴스 무리(배치.js `무리만들기` 결과)에서 걸을 때 막히는 기둥 목록을 뽑는다.
//
// [왜]
//   지형의 `막힘` 은 도면의 시야 차단물 4개(건물·수목대)만 안다. 바위·나무·울타리·집 같은
//   소품은 그리기만 하고 판정이 없어 캐릭터가 그대로 통과했다.
// [어떻게]
//   무리마다 표본 지오메트리의 경계 상자와 인스턴스 행렬로 XZ 원기둥 {x, z, r, y0, y1}(미터)을
//   만든다. 나무는 줄기만 막아야 하니 반지름을 상자 폭의 일부만 쓰고(잎은 지나간다), 가로대처럼
//   길쭉한 것은 긴 축을 따라 원 여러 개를 늘어놓는다. 2 m 격자에 넣어 프레임마다 근처만 본다.
import * as THREE from "three";
import { 유닛 } from "./공간도면.js";

// 무리 이름(마지막 마디) → 상자 폭 대비 반지름 비율. 없으면 기본값, `null` 이면 안 막는다.
const 반지름비 = {
  나무: 0.14, // 줄기
  바위덩어리: 0.7, 비탈바위: 0.7, 틈바위: 0.7,
  기둥: 0.7, 가로대: 0.5,
  집: 0.95, 택촌: 0.95, 나루터: 0.8, 나룻배: 0.8,
  돌탑: 0.7, 천막: 0.85, 그물틀: 0.6, 통발: 0.6, 화톳불: 0.6,
  평상: 0.85, 솟대: 0.35, 지게: 0.5, 물동이: 0.5, 걸상: 0.6,
  돌무지: 0.7, 말뚝: 0.4, 소반: 0.5, 구렁이: 0.5,
  // 밟고 지나가거나 바닥에 붙은 것들, 헤치고 지나가는 초목
  길가돌: null, 발치너덜: null, 디딤돌: null, 댕기: null, 부러진가지: null, 짚신: null,
  흙덩이: null, 발자국: null, 배자국: null, 금줄: null,
  덤불: null, 잡초: null, 꽃: null, 풀: null, 수풀: null, 잎더미: null, 자갈: null, 절벽틈덤불: null,
  명패: null, 횃불: null,
};
const 기본반지름비 = 0.6;
const 격자 = 2; // m

export function 소품충돌만들기(무리들) {
  const 기둥들 = [];
  const 상자 = new THREE.Box3();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 회전 = new THREE.Quaternion();
  const 크기 = new THREE.Vector3();
  const 축 = new THREE.Vector3();
  for (const 묶음 of 무리들 ?? []) {
    const 마디 = 묶음.이름.split(".").pop();
    const 비 = 반지름비[마디] === undefined ? 기본반지름비 : 반지름비[마디];
    if (비 === null) continue;
    for (const { 지오, 행렬들 } of 묶음.무리) {
      if (!지오.boundingBox) 지오.computeBoundingBox();
      상자.copy(지오.boundingBox);
      const 폭 = new THREE.Vector3().subVectors(상자.max, 상자.min);
      const 중심 = new THREE.Vector3().addVectors(상자.max, 상자.min).multiplyScalar(0.5);
      for (let i = 0; i < 행렬들.length; i += 16) {
        행렬.fromArray(행렬들, i).decompose(자리, 회전, 크기);
        const sx = Math.abs(크기.x), sy = Math.abs(크기.y), sz = Math.abs(크기.z);
        const 높이 = 폭.y * sy * 유닛;
        if (높이 < 0.35) continue; // 발목 아래는 넘어간다
        const 가로 = 폭.x * sx, 세로 = 폭.z * sz;
        const 짧은 = Math.min(가로, 세로), 긴 = Math.max(가로, 세로);
        const r = Math.max(0.12, 짧은 * 0.5 * 비 * 유닛);
        const y0 = (자리.y + 상자.min.y * sy) * 유닛;
        const y1 = y0 + 높이;
        // 길쭉하면 긴 축을 따라 원을 늘어놓는다(울타리 가로대·천막 등)
        const 조각수 = 긴 / Math.max(짧은, 1e-3) > 2.2 ? Math.ceil(긴 / Math.max(짧은, 1e-3)) : 1;
        축.set(가로 >= 세로 ? 1 : 0, 0, 가로 >= 세로 ? 0 : 1);
        for (let k = 0; k < 조각수; k++) {
          const t = 조각수 === 1 ? 0 : (k / (조각수 - 1) - 0.5) * (긴 - 짧은);
          const p = 축.clone().multiplyScalar(t).add(new THREE.Vector3(중심.x * sx, 0, 중심.z * sz));
          p.applyQuaternion(회전).add(자리);
          기둥들.push({ x: p.x * 유닛, z: p.z * 유닛, r, y0, y1, 이름: 묶음.이름 });
        }
      }
    }
  }
  // 격자
  const 칸 = new Map();
  const 키 = (x, z) => `${Math.floor(x / 격자)},${Math.floor(z / 격자)}`;
  const 여유 = 0.8; // 플레이어 반경보다 넉넉히 — 칸 경계 바로 밖의 기둥도 잡힌다
  기둥들.forEach((c) => {
    const x0 = Math.floor((c.x - c.r - 여유) / 격자), x1 = Math.floor((c.x + c.r + 여유) / 격자);
    const z0 = Math.floor((c.z - c.r - 여유) / 격자), z1 = Math.floor((c.z + c.r + 여유) / 격자);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = `${gx},${gz}`;
      if (!칸.has(k)) 칸.set(k, []);
      칸.get(k).push(c);
    }
  });
  // (px, pz, 발밑y, 반경) 모두 미터. 막히면 그 소품 이름을 돌려준다.
  const 막힘 = (px, pz, y = 0, 반경 = 0.3) => {
    const 목록 = 칸.get(키(px, pz));
    if (!목록) return null;
    for (const c of 목록) {
      // 발이 소품 꼭대기 근처(25cm 아래)까지 올라왔으면 올라선 것으로 본다
      if (y > c.y1 - 0.25 || y < c.y0 - 1.0) continue;
      const dx = px - c.x, dz = pz - c.z, d = c.r + 반경;
      if (dx * dx + dz * dz < d * d) return c.이름;
    }
    return null;
  };
  return { 막힘, 개수: 기둥들.length, 기둥들 };
}
