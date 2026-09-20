// 리타게팅한 클립에 걸어 주는 자세 보정 — 값과 계산을 한곳에 모아 둔다.
// gait.html 에서 켜고 끄며 원본 클립·원본 캐릭터와 나란히 비교할 수 있다.
import * as THREE from "three";

// 모델 기준 축 — Y 위, Z 앞, X 옆(glTF).
const 앞축 = new THREE.Vector3(0, 0, 1);
const 옆축 = new THREE.Vector3(1, 0, 0);

export const 이동모션 = new Set(["Walk_Loop", "Walk_Formal_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Crouch_Fwd_Loop"]);
const 걷기모션 = new Set(["Walk_Loop", "Walk_Formal_Loop"]);

// 모션은 보통 체형에 맞춰 만들어진 것이라, 팔이 짧고 골반이 넓은 이 캐릭터에서는
// 팔이 몸통·허벅지를 파고들고 걸을 때 허리가 과하게 숙여진다. 클립을 고치는 대신
// 믹서가 끝난 뒤 본 몇 개를 조금 돌려 준다(모든 동작에 같은 양으로 더해진다).
// 값은 전부 여기 모아 둔다. gait.html 에서 켜고 끄며 원본 클립과 비교할 수 있다.
// 무릎은 건드리지 않는다. 원본 캐릭터의 걷기도 최소 굽힘이 10.8° 라 다리를 끝까지
// 펴지 않는다 — 억지로 펴 봤더니 발의 상하 이동이 원본의 1.5배가 되어 행진하듯 걸었다.
export const 기본보정 = {
  켬: true,
  팔벌림도: 10, // 위팔을 몸에서 바깥으로 — 몸에 닿지 않을 만큼만
  // 골반 기울기·요추 곡선은 0 으로 둔다. 엉덩이를 빼려고 넣었던 값인데, 늘 켜져
  // 있으니 대기 자세에서 상체가 뒤로 젖혀져 다리가 뒤로 빠진 듯 보였다.
  // (엉덩이 빼기 자체는 이미 되돌리기로 했다.) 값은 남겨 두어 실험은 할 수 있다.
  골반기울기도: 0, // + 면 엉덩이가 뒤로(허벅지는 같은 양만큼 되돌려 다리는 제자리)
  허리곡선도: 0, // 요추(spine_01)를 골반 반대로
  // 가슴 세우기는 spine_03 에만 건다. spine_02 에 걸면 그 바로 아래 아랫배가 앞으로
  // 밀려 나온다(여성 몸체에서 확연했다). 가슴만 세우면 등은 펴지고 배는 그대로다.
  허리세움도: 8, // 걷기·달리기에서 가슴을 세운다(+ 뒤로, - 앞으로)
  // 보폭 확대는 끈다(1.0). 허벅지 각을 키우면 발이 **호를 그리며 올라가** 앞발이
  // 뒷발보다 높은 곳을 딛는 것처럼 보인다 — 실측 앞뒤발 바닥 높이차 최대: 원본 0.054,
  // 1.2 배 0.074, 1.0 배 0.051. 걸음 속도는 재생 배속으로만 맞춘다(공용.jsx WALK).
  보폭배율: 1.0,
  // 발 피치. 쉴 때 자세에서 우리 몸체는 발끝은 땅에 닿고 뒤꿈치가 약 10° 떠 있다
  // (원본은 발바닥이 평평하다). 리타게팅은 뼈의 쉴 때 회전을 기준으로 얹으므로
  // 모든 프레임이 그 발끝-내림을 물려받아, 디딜 때 발끝부터 닿아 앞발이 더 높은
  // 곳을 딛는 듯 보인다. 발목을 그만큼 되돌린다(+ = 발끝 올림).
  발피치도: 10,
  // 무릎 굽힘에서 이만큼(도)을 빼되 0 밑으로는 안 내려간다. 곱하기가 아니라 빼기라서
  // 크게 굽은 구간(80°대)은 거의 그대로고, 거의 다 편 구간(11°)만 0 에 붙어
  // '디딜 때 다리가 쭉 펴지는 찰나'가 또렷해진다.
  //   ※ 예전에 배율로 줄였더니 굽은 구간까지 얕아져 행진하듯 걸었다. 빼기로 한 이유다.
  무릎펴기도: 8,
};

const 무릎본 = ["calf_l", "calf_r"];

const 보폭본 = ["thigh_l", "thigh_r"];

// 보정은 런타임에 본을 돌리지 않고 **리타게팅된 클립의 키프레임에 한 번** 넣는다.
// 매 프레임 본을 돌리면 믹서가 값을 다시 쓰지 않는 프레임에 보정이 겹쳐 쌓여
// 팔이 머리 위로 올라가 버린다(실제로 그랬다).
//   [뼈 이름, 모델 기준 축, 각도, 이동 동작에만 적용할지]
const 자세보정 = (값) => [
  ["upperarm_l", 앞축, 값.팔벌림도, false],
  ["upperarm_r", 앞축, -값.팔벌림도, false],
  ["pelvis", 옆축, 값.골반기울기도, false],
  // 골반을 기울이면 자식인 다리까지 같이 뒤로 돈다 → 몸이 앞으로 쏠린 듯 보인다.
  // 허벅지를 같은 양만큼 되돌려 다리는 제자리에 두고 골반·엉덩이만 기울인다.
  ["thigh_l", 옆축, -값.골반기울기도, false],
  ["thigh_r", 옆축, -값.골반기울기도, false],
  ["spine_01", 옆축, -값.허리곡선도, false],
  ["spine_03", 옆축, -값.허리세움도, true],
  ["foot_l", 옆축, -값.발피치도, false],
  ["foot_r", 옆축, -값.발피치도, false],
];

// 쉴 때 자세에서 그 뼈의 부모까지 쌓인 회전 — 모델 기준 축을 부모 기준으로 옮길 때 쓴다.
function 부모쉴때회전(bone) {
  const out = new THREE.Quaternion();
  for (let node = bone.parent; node && node.isBone; node = node.parent) out.premultiply(node.quaternion);
  return out;
}

export function 보정쿼터니언(skin, 값) {
  skin.skeleton.pose();
  const out = new Map();
  자세보정(값).forEach(([name, 축, 도, 이동만]) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (!bone || !도) return;
    const axis = 축.clone().applyQuaternion(부모쉴때회전(bone).invert()).normalize();
    out.set(name, { 회전: new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(도)), 이동만 });
  });
  무릎본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) out.set(name, { ...(out.get(name) ?? {}), 무릎: bone.quaternion.clone(), 이동만: true });
  });
  보폭본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) out.set(name, { ...(out.get(name) ?? {}), 보폭: bone.quaternion.clone(), 이동만: true });
  });
  return out;
}

// 클립 전체의 평균 회전 — 보폭을 키울 때 '가운데'로 삼는다.
// 쉴 때 자세를 가운데로 쓰면 안 된다: 걷기 클립의 허벅지는 평균이 앞으로 치우쳐
// 있어서, 쉴 때 기준으로 키우면 **앞으로만 더 나가고 뒤로는 안 뻗는다**.
function 평균회전(track) {
  const 합 = new THREE.Quaternion(0, 0, 0, 0);
  const q = new THREE.Quaternion();
  const 기준 = new THREE.Quaternion().fromArray(track.values, 0);
  let n = 0;
  for (let i = 0; i < track.values.length; i += 4) {
    q.fromArray(track.values, i);
    const 부호 = q.dot(기준) < 0 ? -1 : 1;
    합.x += q.x * 부호;
    합.y += q.y * 부호;
    합.z += q.z * 부호;
    합.w += q.w * 부호;
    n += 1;
  }
  if (!n) return 기준;
  합.set(합.x / n, 합.y / n, 합.z / n, 합.w / n);
  return 합.normalize();
}

// 중심 자세에서 벗어난 각을 배율만큼 키우거나 줄인다(축은 그대로).
function 각도배율(track, 중심, 배율) {
  const 쉴때 = 중심;
  const 쉴때역 = 쉴때.clone().invert();
  const q = new THREE.Quaternion();
  const 축 = new THREE.Vector3();
  for (let i = 0; i < track.values.length; i += 4) {
    const r = 쉴때역.clone().multiply(q.fromArray(track.values, i));
    const 각 = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(r.w), -1, 1));
    if (각 < 1e-5) continue;
    const sin = Math.sqrt(Math.max(0, 1 - r.w * r.w));
    축.set(r.x, r.y, r.z).divideScalar(sin * Math.sign(r.w || 1));
    r.setFromAxisAngle(축.normalize(), 각 * 배율 * Math.sign(r.w || 1));
    쉴때.clone().multiply(r).toArray(track.values, i);
  }
}

// 허벅지가 앞으로 나간 정도(0~1) — 키마다. 쉴 때 대비 옆축 회전의 앞 성분으로 본다.
function 앞뻗음(thighTrack, 쉴때) {
  const 쉴때역 = 쉴때.clone().invert();
  const q = new THREE.Quaternion();
  const out = new Float32Array(thighTrack.values.length / 4);
  for (let i = 0, k = 0; i < thighTrack.values.length; i += 4, k += 1) {
    const r = 쉴때역.clone().multiply(q.fromArray(thighTrack.values, i));
    // 옆축(x) 둘레 회전각. 다리를 앞으로 차올리면 이 값이 한쪽 부호가 된다.
    const 각 = 2 * Math.atan2(r.x, r.w) * (180 / Math.PI);
    out[k] = 각;
  }
  // 부호가 어느 쪽이 '앞'인지는 클립마다 재지 않고, 평균보다 앞으로 간 쪽을 앞으로 본다.
  const 평균 = out.reduce((a, b) => a + b, 0) / out.length;
  const 폭 = Math.max(1e-3, ...out.map((v) => Math.abs(v - 평균)));
  return { 값: out, 평균, 폭 };
}

// 쉴 때 자세에서 벗어난 각에서 일정 각도를 뺀다(0 밑으로는 안 내려간다).
//   `가중` 을 주면 키마다 그 비율만큼만 뺀다 — 앞으로 뻗은 다리만 펴고
//   뒤로 미는 다리는 그대로 둬야 뒤꿈치가 제때 떨어지고 체중이 앞발로 넘어간다.
//   (전부 폈더니 뒷발에 오래 실려 몸이 딛은 발보다 앞에 머물렀다.)
function 각도빼기(track, 쉴때, 도, 가중 = null) {
  if (!도) return;
  const 뺄각 = THREE.MathUtils.degToRad(도);
  const 쉴때역 = 쉴때.clone().invert();
  const q = new THREE.Quaternion();
  const 축 = new THREE.Vector3();
  for (let i = 0, k = 0; i < track.values.length; i += 4, k += 1) {
    const r = 쉴때역.clone().multiply(q.fromArray(track.values, i));
    const 부호 = Math.sign(r.w || 1);
    const 각 = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(r.w), -1, 1));
    if (각 < 1e-5) continue;
    const 비율 = 가중 ? 가중[k] : 1;
    if (비율 <= 0) continue;
    const sin = Math.sqrt(Math.max(0, 1 - r.w * r.w));
    축.set(r.x, r.y, r.z).divideScalar(sin * 부호);
    r.setFromAxisAngle(축.normalize(), Math.max(0, 각 - 뺄각 * 비율) * 부호);
    쉴때.clone().multiply(r).toArray(track.values, i);
  }
}

// 트랙 이름은 "upperarm_l.quaternion" 일 수도 ".bones[upperarm_l].quaternion" 일 수도 있다.
const 트랙본이름 = /(?:\.bones\[)?([^.[\]]+)\]?\.quaternion$/;

export function 클립보정(clip, 보정, 이름, 값) {
  const 이동중 = 이동모션.has(이름);
  const 걷는중 = 걷기모션.has(이름);
  // 뼈 이름 → 트랙. 무릎은 같은 쪽 허벅지 트랙을 봐야 앞뒤를 안다.
  const 트랙표 = new Map();
  clip.tracks.forEach((track) => {
    const m = 트랙본이름.exec(track.name);
    if (m) 트랙표.set(m[1], track);
  });
  // 허벅지는 보폭 확대 뒤의 값으로 앞뒤를 재야 하므로 무릎보다 먼저 처리한다.
  const 순서 = [...clip.tracks].sort((a, b) => {
    const ka = 트랙본이름.exec(a.name)?.[1] ?? "";
    const kb = 트랙본이름.exec(b.name)?.[1] ?? "";
    return (ka.startsWith("calf") ? 1 : 0) - (kb.startsWith("calf") ? 1 : 0);
  });
  순서.forEach((track) => {
    const 이름 = 트랙본이름.exec(track.name);
    if (!이름) return;
    const 규칙 = 보정.get(이름[1]);
    if (!규칙 || (규칙.이동만 && !이동중)) return;
    const q = new THREE.Quaternion();
    if (규칙.무릎) {
      const 옆 = 이름[1].endsWith("_l") ? "l" : "r";
      const 허벅지 = 트랙표.get(`thigh_${옆}`);
      const 허벅지규칙 = 보정.get(`thigh_${옆}`);
      let 가중 = null;
      if (허벅지 && 허벅지규칙?.보폭 && 허벅지.values.length === track.values.length) {
        const { 값: 각들, 평균, 폭 } = 앞뻗음(허벅지, 허벅지규칙.보폭);
        // 어느 부호가 '앞'인가는 클립에서 읽는다: 무릎이 가장 곧은 키(디디는 순간)에
        // 허벅지가 평균에서 벗어난 방향이 앞이다.
        const 쉴때역 = 규칙.무릎.clone().invert();
        let 곧은키 = 0;
        let 최소 = Infinity;
        for (let i = 0, k = 0; i < track.values.length; i += 4, k += 1) {
          const r = 쉴때역.clone().multiply(q.fromArray(track.values, i));
          const 굽힘 = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(r.w), -1, 1));
          if (굽힘 < 최소) { 최소 = 굽힘; 곧은키 = k; }
        }
        const 방향 = Math.sign(각들[곧은키] - 평균) || 1;
        // 평균보다 앞으로 나간 만큼 0~1. 뒤로 간 키는 0 — 그대로 둔다.
        가중 = Float32Array.from(각들, (v) => THREE.MathUtils.clamp((방향 * (v - 평균)) / 폭, 0, 1));
      }
      각도빼기(track, 규칙.무릎, 값.무릎펴기도, 가중);
      return;
    }
    // 허벅지는 보폭 확대(걷기 클립만)와 골반 되돌림(늘)이 같이 걸린다.
    if (규칙.보폭 && 걷는중) 각도배율(track, 평균회전(track), 값.보폭배율);
    if (!규칙.회전) return;
    for (let i = 0; i < track.values.length; i += 4) {
      q.fromArray(track.values, i).premultiply(규칙.회전);
      q.toArray(track.values, i);
    }
  });
  return clip;
}
