// 개발용 진단 — 스켈레톤·스킨메시·클립·재질을 한 번에 훑어본다.
//
// ★ 월드 좌표로 걸음을 잴 때 '앞'은 시점에 따라 축이 다르다. 아바타는 facing 만큼
//   y 축 회전하므로 정면(facing 0)에서 앞 = +z, **측면(facing π/2)에서 앞 = +x** 다.
//   측면 시점에서 z 로 앞뒤를 재면 좌우 폭을 재게 된다 — 실제로 그렇게 잰 표를
//   앞뒤 보폭으로 읽은 적이 있다. 뼈 각도(무릎·허벅지)나 발 높이처럼 축과 무관한
//   지표를 우선 쓰고, 앞뒤가 필요하면 facing 으로 되돌려 잰다.
//
// 콘솔에 자동으로 쏟지 않는다. 필요할 때 브라우저 콘솔에서 부른다:
//   __캐릭터진단()            요약을 console.table 로
//   __캐릭터진단().뼈대       본 계층
// 개발 서버(import.meta.env.DEV)에서만 window 에 올린다.

function 뼈계층(bone, depth = 0, out = []) {
  out.push({ 깊이: depth, 이름: bone.name, 부모: bone.parent?.name ?? "", 자식: bone.children.length });
  bone.children.forEach((child) => {
    if (child.isBone) 뼈계층(child, depth + 1, out);
  });
  return out;
}

// 관절 한 곳의 스키닝을 훑는다. 위쪽 본 → 아래쪽 본 가중치가 관절을 지나며
// 부드럽게 넘어가야 한다. 한쪽이 1 에서 0 으로 뚝 떨어지면 굽힐 때 살이 접힌다.
//   ※ 좌우를 섞어 재면 안 된다. 본과 같은 쪽 정점만 골라야 한다(실제로 이걸
//     빼먹어 '혼합 가중치 0' 이라는 잘못된 결론을 낸 적이 있다).
export function 관절프로파일(mesh, 위본, 아래본, THREE) {
  const skeleton = mesh.skeleton;
  const 위 = skeleton.getBoneByName(위본);
  const 아래 = skeleton.getBoneByName(아래본);
  if (!위 || !아래) return null;
  skeleton.pose();
  // 본의 월드 행렬은 **뿌리부터** 갱신해야 한다. 해당 본만 갱신하면 부모가 지난
  // 프레임 포즈로 남아 관절 좌표가 엉뚱한 곳에 잡힌다.
  let 뿌리 = skeleton.bones[0];
  while (뿌리.parent && 뿌리.parent.isBone) 뿌리 = 뿌리.parent;
  (뿌리.parent ?? 뿌리).updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const 자리 = (bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inv);
  const 관절 = 자리(아래);
  const 위자리 = 자리(위);
  const position = mesh.geometry.getAttribute("position");
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) return null;
  const box = new THREE.Box3().setFromBufferAttribute(position);
  const 키 = box.max.y - box.min.y;
  // 팔은 T포즈에서 가로로 뻗어 있어 높이로 자르면 관절을 안 지난다. 늘 뼈 축으로 자르고,
  // 좌우는 x 부호가 아니라 **뼈 축선까지의 거리**로 가른다(반대쪽 팔다리가 섞이지 않는다).
  const 축 = 관절.clone().sub(위자리).normalize();
  const 반경 = 키 * 0.1;
  const 점 = new THREE.Vector3();
  const 옆 = new THREE.Vector3();
  const 줄 = [];
  for (let s = -3; s <= 3; s += 1) {
    const 거리 = 키 * 0.03 * s;
    let 위합 = 0;
    let 아래합 = 0;
    let n = 0;
    for (let i = 0; i < position.count; i += 1) {
      점.fromBufferAttribute(position, i).sub(관절);
      const 따라 = 점.dot(축);
      if (Math.abs(따라 - 거리) > 키 * 0.006) continue;
      옆.copy(점).addScaledVector(축, -따라);
      if (옆.length() > 반경) continue;
      for (let k = 0; k < 4; k += 1) {
        const w = skinWeight.getComponent(i, k);
        if (w <= 1e-4) continue;
        const name = skeleton.bones[skinIndex.getComponent(i, k)].name;
        if (name.startsWith(위본.replace(/_[lr]$/, ""))) 위합 += w;
        else if (name.startsWith(아래본.replace(/_[lr]$/, ""))) 아래합 += w;
      }
      n += 1;
    }
    if (n) 줄.push({ 관절대비: +거리.toFixed(3), 정점: n, [위본]: +(위합 / n).toFixed(3), [아래본]: +(아래합 / n).toFixed(3) });
  }
  return 줄;
}

export function 캐릭터진단(준비, 옵션 = {}) {
  const { model, targetSkin, clipFor, clipCount } = 준비;
  const 스킨메시 = [];
  const 재질 = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const 목록 = Array.isArray(object.material) ? object.material : [object.material];
    스킨메시.push({
      이름: object.name,
      종류: object.isSkinnedMesh ? "SkinnedMesh" : "Mesh",
      정점: object.geometry.getAttribute("position")?.count ?? 0,
      면: (object.geometry.index?.count ?? 0) / 3,
      스켈레톤: object.isSkinnedMesh ? (object.skeleton?.bones.length ?? 0) : "-",
      모프: object.morphTargetInfluences?.length ?? 0,
      슬롯: object.userData.slot ?? object.userData.chibi_part ?? "",
    });
    목록.forEach((m) => 재질.push({
      메시: object.name, 재질: m.name || "(이름없음)", 형: m.type,
      맵: m.map?.name || (m.map ? "있음" : "없음"),
      normalMap: !!m.normalMap, roughness: m.roughness ?? "-", metalness: m.metalness ?? "-",
      투명: m.transparent, alphaTest: m.alphaTest, side: m.side,
    }));
  });

  const 뼈대 = targetSkin?.skeleton ? 뼈계층(targetSkin.skeleton.bones[0]) : [];
  const 클립 = (옵션.클립이름 ?? []).map((name) => {
    const clip = clipFor?.(name);
    return clip ? { 이름: name, 길이초: Number(clip.duration.toFixed(3)), 트랙: clip.tracks.length } : { 이름: name, 길이초: "-", 트랙: 0 };
  });

  const 요약 = {
    스킨메시수: 스킨메시.filter((m) => m.종류 === "SkinnedMesh").length,
    메시수: 스킨메시.length,
    본수: targetSkin?.skeleton?.bones.length ?? 0,
    클립수: clipCount ?? 0,
    재질수: 재질.length,
  };
  const 관절 = {};
  if (옵션.THREE && targetSkin) {
    [["무릎", "thigh_l", "calf_l"], ["팔꿈치", "upperarm_l", "lowerarm_l"],
     ["고관절", "pelvis", "thigh_l"], ["어깨", "clavicle_l", "upperarm_l"]]
      .forEach(([이름, 위, 아래]) => {
        const 줄 = 관절프로파일(targetSkin, 위, 아래, 옵션.THREE);
        if (줄) 관절[이름] = 줄;
      });
  }
  console.groupCollapsed("캐릭터 진단", 요약);
  console.table(스킨메시);
  console.table(재질);
  if (클립.length) console.table(클립);
  Object.entries(관절).forEach(([이름, 줄]) => {
    console.groupCollapsed(`관절 스키닝 — ${이름}`);
    console.table(줄);
    console.groupEnd();
  });
  console.groupEnd();
  return { 요약, 스킨메시, 재질, 뼈대, 클립, 관절 };
}

export function 진단등록(준비, 옵션) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  window.__캐릭터진단 = (추가) => 캐릭터진단(준비, { ...옵션, ...추가 });
}
