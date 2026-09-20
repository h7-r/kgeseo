// 개발용 진단 — 스켈레톤·스킨메시·클립·재질을 한 번에 훑어본다.
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
  console.groupCollapsed("캐릭터 진단", 요약);
  console.table(스킨메시);
  console.table(재질);
  if (클립.length) console.table(클립);
  console.groupEnd();
  return { 요약, 스킨메시, 재질, 뼈대, 클립 };
}

export function 진단등록(준비, 옵션) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  window.__캐릭터진단 = (추가) => 캐릭터진단(준비, { ...옵션, ...추가 });
}
