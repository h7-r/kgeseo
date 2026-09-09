// ═══════════════════════════════════════════════════════════════
//  원경.js — Playable Core 바깥으로 이어지는 풍경
// ═══════════════════════════════════════════════════════════════
// [왜 필요한가]
//   지금까지 무대는 **바위섬**이었다. 코어(80 × 50 m) 끝에서 세상이 끊기고,
//   뒤로는 허허벌판, 앞으로는 강. 실제 나주 영산강가에 서면 사방으로
//   들·숲·논밭·마을·산이 지평선까지 이어진다. 그게 없으면 아무리 안을 잘
//   다듬어도 "세트장 안"으로 보인다.
//
// [값싸게 만드는 원칙]
//   ① 갈 수 없는 곳이다 — **충돌도 판정도 없다.** 눈에만 있으면 된다
//   ② 멀수록 성글게. 가까운 들판만 촘촘하고 산은 실루엣 한 장이면 된다
//   ③ 멀수록 공기에 씻겨 지평선 색으로 녹는다. 이 하나가 깊이를 만든다
//   ④ 코어 가장자리에서 높이 0 으로 맞춘다 — 이어 붙인 티가 나면 안 된다
//
// [무엇을 두나]
//   들판   코어 바깥 ~250 m. 완만한 기복. 가장자리에서 코어와 높이를 맞춘다
//   논밭   네모난 뙈기. **사람이 사는 땅**이라는 신호가 이것 하나로 선다
//   숲     나무 덩이 무리. 멀어서 실루엣만 있으면 된다
//   마을   지붕 몇 채. §383 이 진부촌을 「원경·방향」으로 두라고 한 그대로다
//   산줄기 300~900 m. 겹겹이 세워 지평선을 만든다
//
// [단위] 좌표·크기는 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 미터 } from "./공간도면.js";
import { 강굽이, 건너굽이 } from "./강.js";

export const 원경결 = {
  들: "#7E8560",
  들2: "#8E8A63",
  논: "#8C9558",
  논2: "#6E7A46",
  // 물 댄 논 — 하늘을 비춘다. 이것 하나로 '논'이 논으로 읽힌다.
  물논: "#8FA0A6",
  물논2: "#7A8C96",
  밭: "#8A7B5C",
  숲: "#55663F",
  숲밝: "#6E7F4C",
  // 지붕 두 갈래 — 초가(누런 짚)와 기와(검푸른 흙). 한 색이면 상자 무더기다.
  초가: "#9A8A5C",
  기와: "#4E5058",
  // 벽 두 갈래 — 흙벽과 회벽
  흙벽: "#8E7C63",
  회벽: "#AFA694",
  산: "#6B7686",
  // 코어 흙빛 — 무대 안팎 색 온도를 잇는 데 쓴다
  코어흙: "#82885F",
};

const 섞 = (a, b, t) => a.clone().lerp(b, t);

// ── 들판 ────────────────────────────────────────────────────
//   코어를 도넛처럼 둘러싸는 땅. 코어 안과 강은 건너뛴다(이미 다른 게 덮는다).
//   안쪽/바깥  코어 가장자리에서 잰 **거리(m)** 구간. 이 띠만 만든다.
//     ※ 가까운 띠는 촘촘하게, 먼 띠는 성글게 두 번 부른다. 한 번에 900 m 를
//       촘촘히 깔면 삼각형이 수십만 개가 되는데, 멀리 있는 건 어차피 안 보인다.
//   기준거리  높이 경사가 완만해지는 기준. **두 띠가 같은 값을 써야** 이음매가 없다.
export function 들판만들기({
  코어, 강, 안쪽 = 0, 바깥 = 260, 칸 = 7, 기준거리 = 260, 씻김거리 = 900,
  내림 = 0, 소음, 지평색 = "#CFCBBE",
}) {
  const x0 = 코어.X[0] - 바깥;
  const x1 = 코어.X[1] + 바깥;
  const z0 = 코어.Z[0] - 바깥;
  const z1 = 코어.Z[1] + 바깥;
  const nx = Math.round((x1 - x0) / 칸);
  const nz = Math.round((z1 - z0) / 칸);

  const 들 = new THREE.Color(원경결.들);
  const 들2 = new THREE.Color(원경결.들2);
  const 논 = new THREE.Color(원경결.논);
  const 논2 = new THREE.Color(원경결.논2);
  const 밭 = new THREE.Color(원경결.밭);
  const 물논 = new THREE.Color(원경결.물논);
  const 물논2 = new THREE.Color(원경결.물논2);
  const 코어흙 = new THREE.Color(원경결.코어흙);
  const 하늘가 = new THREE.Color(지평색);
  const c = new THREE.Color();

  // 코어 가장자리에서 몇 m 떨어졌나 (0 = 코어 옆)
  const 거리 = (x, z) => {
    const dx = Math.max(코어.X[0] - x, 0, x - 코어.X[1]);
    const dz = Math.max(코어.Z[0] - z, 0, z - 코어.Z[1]);
    return Math.hypot(dx, dz);
  };
  // 공기에 씻긴 정도 0~1 — **절대 거리**로 재야 띠마다 색이 안 튄다
  const 멂 = (x, z) =>
    THREE.MathUtils.clamp(거리(x, z) / 씻김거리, 0, 1);

  // 높이 — 코어 옆에서 0, 멀수록 완만하게 굽이친다.
  //   ※ 기준거리로 정규화한다. 띠마다 다른 값을 쓰면 경계에서 높이가 어긋난다.
  const 높이 = (x, z) => {
    const t = THREE.MathUtils.clamp(거리(x, z) / 기준거리, 0, 1);
    const 굽이 =
      소음(x * 0.006, z * 0.006) * 26 + 소음(x * 0.021, z * 0.021) * 7;
    const 먼언덕 = 소음(x * 0.0016 + 9, z * 0.0016) * 55;
    let y = 굽이 * Math.pow(t, 1.6) + 먼언덕 * Math.pow(t, 2.2);
    // 강기슭 — 물가로 갈수록 강바닥으로 내려간다.
    //   ※ 들판을 물가에서 딱 끊으면 격자(7 m) 때문에 물과 뭍 사이에 빈 띠가 남고
    //     그리로 하늘돔 밑동이 비친다(광선을 쏴서 확인). 물 **밑까지** 이어 깔고
    //     그 자리를 내려 두면 물이 덮어 준다.
    const 이쪽 = 강.Z시작 + 강굽이(x);
    const 저쪽 = 강.Z시작 + 강.건너 + 4 + 건너굽이(x);
    const 기슭 = Math.max(
      THREE.MathUtils.clamp((z - (이쪽 - 12)) / 12, 0, 1),
      THREE.MathUtils.clamp(((저쪽 + 12) - z) / 12, 0, 1) * (z > 이쪽 ? 1 : 0),
    );
    y -= 1.6 * 기슭 * 기슭;
    // 두 띠가 겹치는 자리(258~265 m)에서 같은 높이면 면이 서로 아른거린다.
    //   먼 띠를 조금 내려 가까운 띠가 이기게 한다. 그 거리에서는 안 보인다.
    return y - 내림;
  };

  // 뙈기 — 네모난 논밭. 사람이 가꾼 땅이라는 신호.
  //   ※ 멀수록 크게 잡는다. 먼 띠는 격자가 38 m 라 26 m 뙈기를 그리면
  //     무늬가 격자에 걸려 사라지고 **단색 융단**이 된다.
  const 뙈기크기 = (x, z) => 26 * (1 + (거리(x, z) / 260) * 1.7);
  // 격자를 소음으로 휘어 놓는다. 곧게 두면 **바둑판**이 되는데, 실제 논밭은
  //   물길과 지형을 따라 굽어 있어서 뙈기 줄이 어긋난다.
  const 휜 = (x, z) => [
    x + 소음(x * 0.0035, z * 0.0035) * 16 + 소음(x * 0.012, z * 0.012) * 4,
    z + 소음(x * 0.0035 + 31, z * 0.0035 + 17) * 16 + 소음(x * 0.012 + 5, z * 0.012) * 4,
  ];
  const 뙈기 = (x0, z0) => {
    const [x, z] = 휜(x0, z0);
    const 크기 = 뙈기크기(x0, z0);
    const gx = Math.floor(x / 크기);
    const gz = Math.floor(z / 크기);
    let h = Math.imul(gx ^ Math.imul(gz, 0x27d4eb2d), 0x165667b1);
    h ^= h >>> 15;
    return ((h >>> 0) % 1000) / 1000;
  };

  const 위치 = [];
  const 색깔 = [];
  const 안쪽좌표 = (x, z) =>
    x > 코어.X[0] - 1 && x < 코어.X[1] + 1 && z > 코어.Z[0] - 1 && z < 코어.Z[1] + 1;
  // 강 골짜기는 **가로 전체**를 비운다. x 범위를 좁게 잡으면 그 바깥에서
  // 들판이 물 위로 올라와 강이 연못처럼 끊겨 보인다.
  // 물 속 깊은 데만 뺀다 — 기슭 6 m 는 물 밑으로 이어 깐다
  const 물 = (x, z) =>
    z > 강.Z시작 + 6 + 강굽이(x) && z < 강.Z시작 + 강.건너 - 2 + 건너굽이(x);

  // 마을로 가는 길 — 코어 동쪽 끝에서 마을까지. 길이 있어야 집 무더기가 '마을'이 된다.
  const 길시작 = [코어.X[1] + 2, 코어.Z[0] + 12];
  const 길끝 = [코어.X[1] + 72, 코어.Z[0] - 55];
  const 길거리 = (x, z) => {
    const dx = 길끝[0] - 길시작[0];
    const dz = 길끝[1] - 길시작[1];
    const L2 = dx * dx + dz * dz;
    let u = ((x - 길시작[0]) * dx + (z - 길시작[1]) * dz) / L2;
    u = Math.max(0, Math.min(1, u));
    // 살짝 굽은 길 — 곧으면 자로 그은 선이다
    const 굽 = Math.sin(u * Math.PI * 1.7) * 9;
    const cx = 길시작[0] + dx * u - dz / Math.sqrt(L2) * 굽;
    const cz = 길시작[1] + dz * u + dx / Math.sqrt(L2) * 굽;
    return Math.hypot(x - cx, z - cz);
  };

  const 점 = (x, z) => {
    let y = 높이(x, z);
    const m = 멂(x, z);
    const t = 뙈기(x, z);
    // 논둑 — 뙈기 경계. 색만 갈리면 색종이고, 둑이 서야 농지다.
    const 크기 = 뙈기크기(x, z);
    const [wx, wz] = 휜(x, z);
    const fx = ((wx % 크기) + 크기) % 크기;
    const fz = ((wz % 크기) + 크기) % 크기;
    // 둑 폭도 뙈기와 같이 커진다 — 안 그러면 멀리서 둑이 사라진다
    const 둑폭 = 1.1 * (크기 / 26);
    const 둑 = Math.min(fx, 크기 - fx, fz, 크기 - fz) < 둑폭;
    if (둑) y += 0.35;
    const 길 = 길거리(x, z) < 2.4;
    // 뙈기마다 논/밭/들을 달리 준다
    // 논 절반은 물을 대 둔다 — 하늘을 비추는 면이 있어야 논으로 읽힌다
    const 물댄논 = t < 0.34 && 뙈기(x - 21, z + 4) < 0.5;
    if (길) c.copy(밭).offsetHSL(0, -0.05, 0.06);
    else if (둑) c.copy(밭).offsetHSL(0, -0.02, -0.05);
    else if (물댄논) c.copy(섞(물논, 물논2, 뙈기(x + 13, z + 13)));
    else if (t < 0.34) c.copy(섞(논, 논2, 뙈기(x + 13, z + 13)));
    else if (t < 0.55) c.copy(밭);
    else c.copy(섞(들, 들2, 뙈기(x + 7, z - 9)));
    // 이랑 — 뙈기 안에 줄무늬. 없으면 그냥 색종이 조각이다.
    //   물 댄 논은 잔잔해야 하므로 이랑을 거의 안 준다.
    const 이랑 = Math.sin(((x + z * 0.3) * 0.9 * 26) / 뙈기크기(x, z) + t * 30) * 0.5 + 0.5;
    c.offsetHSL(0, 0, (이랑 - 0.5) * (물댄논 ? 0.012 : 0.05));
    // 코어 가까이는 무대 안쪽 흙빛으로 이어 준다 —
    //   안은 갈색 흙, 밖은 초록 들판이면 경계가 어렴풋이 보인다.
    const 이음 = 1 - THREE.MathUtils.clamp(거리(x, z) / 32, 0, 1);
    if (이음 > 0) c.lerp(코어흙, Math.pow(이음, 1.3) * 0.6);
    // 멀수록 공기에 씻긴다
    c.lerp(하늘가, Math.pow(m, 0.75) * 0.82);
    return { x, y, c: c.clone() };
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + 칸 * i;
      const az = z0 + 칸 * j;
      const bx = ax + 칸;
      const bz = az + 칸;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const d = 거리(cx, cz);
      if (d < 안쪽 || d > 바깥) continue;
      if (안쪽좌표(cx, cz) || 물(cx, cz)) continue;
      // ★ 색은 **칸마다 하나**로 굽는다.
      //   꼭짓점마다 뽑으면 이웃 뙈기 사이가 보간돼 **수채화처럼 번지고**,
      //   논둑도 길도 흐릿한 띠가 된다. 논밭은 경계가 또렷해야 논밭이다.
      //   (높이는 꼭짓점마다 그대로 — 그래야 지형이 매끄럽게 이어진다)
      const 칸색 = 점(cx, cz).c;
      const P = [점(ax, az), 점(bx, az), 점(bx, bz), 점(ax, bz)];
      const Z = [az, az, bz, bz];
      for (const k of [0, 3, 1, 1, 3, 2]) {
        위치.push(P[k].x * 미터, P[k].y * 미터, Z[k] * 미터);
        색깔.push(칸색.r, 칸색.g, 칸색.b);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(위치, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(색깔, 3));
  geo.computeVertexNormals();
  return { 지오: geo, 높이, 멂, 거리 };
}

// ── 숲 · 마을 ───────────────────────────────────────────────
//   나무 한 그루를 정성껏 만들 이유가 없다. 멀어서 실루엣만 보인다.
export function 숲마을만들기({
  코어, 강, 높이, 멂, 소음, 바깥 = 700, 숲수 = 320, 집수 = 34,
  택촌수 = 26, 시드 = 7717,
  지평색 = "#CFCBBE",
}) {
  const 난수 = makeRandom(시드);
  const 조각 = []; // 산울타리만 남는다 — 나무와 집은 무리로 세운다
  const 나무자리 = [];
  const 집자리 = []; // 진부촌 — 강 이쪽(북·내륙)
  const 택촌자리 = []; // 택촌 — 강 건너(남)
  const 하늘가 = new THREE.Color(지평색);
  const 숲 = new THREE.Color(원경결.숲);
  const 숲밝 = new THREE.Color(원경결.숲밝);
  // ※ 초가·기와 색은 이제 `원경집표본들` 이 **벽 색에 대한 비율**로 굽는다.
  //   여기서는 어느 쪽인지(모양 번호)만 정한다.
  const 흙벽 = new THREE.Color(원경결.흙벽);
  const 회벽 = new THREE.Color(원경결.회벽);
  const c = new THREE.Color();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();
  const 사원수 = new THREE.Quaternion();

  const 놓기 = (g, 색) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = 색.r;
      arr[i * 3 + 1] = 색.g;
      arr[i * 3 + 2] = 색.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    조각.push(g);
  };
  const 쓸만한가 = (x, z) => {
    // 코어에 너무 붙으면 저해상도 덩이가 코앞에 보여 조잡해진다.
    // 원경은 **멀리 있을 때만** 그럴싸하다 — 30 m 는 떨어뜨린다.
    if (x > 코어.X[0] - 20 && x < 코어.X[1] + 20 && z > 코어.Z[0] - 20 && z < 코어.Z[1] + 20)
      return false;
    if (z > 강.Z시작 - 3 + 강굽이(x) && z < 강.Z시작 + 강.건너 + 4 + 건너굽이(x))
      return false;
    return true;
  };

  // 숲 — 나무 덩이. 무리 지어 나야 숲으로 보인다.
  let 심음 = 0;
  let 시도 = 0;
  while (심음 < 숲수 && 시도 < 숲수 * 30) {
    시도++;
    // 무리의 중심을 먼저 잡고 그 둘레에 흩는다
    const cx = 코어.X[0] - 바깥 + 난수() * (바깥 * 2 + 80);
    const cz = 코어.Z[0] - 바깥 + 난수() * (바깥 * 2 + 50);
    const 무리 = 3 + Math.floor(난수() * 9);
    if (!쓸만한가(cx, cz)) continue;
    // 숲은 고르게 나지 않는다 — 산기슭·둔덕에 몰리고 평지는 논밭이 된다.
    //   높은 데일수록 무리가 앉을 확률이 높다.
    const 땅높 = 높이(cx, cz);
    if (난수() > THREE.MathUtils.clamp(0.3 + 땅높 / 40, 0, 1)) continue;
    for (let k = 0; k < 무리 && 심음 < 숲수; k++) {
      const x = cx + (난수() - 0.5) * 34;
      const z = cz + (난수() - 0.5) * 34;
      if (!쓸만한가(x, z)) continue;
      const m = 멂(x, z);
      const 키 = 4 + 난수() * 5.5;
      const y = 높이(x, z);
      c.copy(섞(숲, 숲밝, 난수())).lerp(하늘가, Math.pow(m, 0.75) * 0.82);
      const 잎색 = c.clone();
      // ★ 예전에는 여기서 줄기와 잎덩이를 **구워 합쳤다.** 그러면 320 그루가
      //   한 덩이가 되어 하나도 못 고른다(사용자 지적: 「바깥 요소도 고르게」).
      //   지금은 **자리만** 남기고 무리(InstancedMesh)로 세운다.
      //   ※ 난수는 예전과 **똑같은 횟수·순서로** 굴린다. 안 그러면 숲 자리가
      //     통째로 달라져서 지금까지 맞춰 놓은 원경 그림이 어긋난다.
      const 잎흔들 = [];
      for (let b = 0; b < 2; b++) {
        난수(); 난수(); 난수(); // 예전 Euler 세 몫
        잎흔들.push(난수()); // 예전 눌림 몫
        난수(); 난수(); // 예전 자리 흔들림 두 몫
      }
      나무자리.push({
        x, y, z,
        키,
        회전: 잎흔들[0] * Math.PI * 2,
        모양: Math.floor(잎흔들[1] * 6) % 6,
        색: 잎색.getHex(),
      });
      심음++;
    }
  }

  // ── 산울타리 ──
  //   뙈기 경계에 덤불이 줄지어 서면 **중경**(40~260 m)이 채워진다.
  //   지금까지 그 거리는 색만 갈린 평면이라 눈이 걸릴 데가 없었다.
  {
    const 뙈기크기 = (x, z) => {
      const dx = Math.max(코어.X[0] - x, 0, x - 코어.X[1]);
      const dz = Math.max(코어.Z[0] - z, 0, z - 코어.Z[1]);
      return 26 * (1 + (Math.hypot(dx, dz) / 260) * 1.7);
    };
    for (let i = 0; i < 900; i++) {
      const x = 코어.X[0] - 300 + 난수() * 680;
      const z = 코어.Z[0] - 300 + 난수() * 650;
      if (!쓸만한가(x, z)) continue;
      const m = 멂(x, z);
      const 크기 = 뙈기크기(x, z);
      const wx = x + 소음(x * 0.0035, z * 0.0035) * 16 + 소음(x * 0.012, z * 0.012) * 4;
      const wz = z + 소음(x * 0.0035 + 31, z * 0.0035 + 17) * 16 + 소음(x * 0.012 + 5, z * 0.012) * 4;
      const fx = ((wx % 크기) + 크기) % 크기;
      const fz = ((wz % 크기) + 크기) % 크기;
      // 경계에서 2 m 안쪽에만, 그것도 드문드문(줄이 끊겨야 자연스럽다)
      if (Math.min(fx, 크기 - fx, fz, 크기 - fz) > 2) continue;
      if (난수() > 0.45) continue;
      const y = 높이(x, z);
      const 키 = 1.6 + 난수() * 2.4;
      const g = new THREE.IcosahedronGeometry(키 * 0.4 * 미터, 0);
      사원수.setFromEuler(new THREE.Euler(난수(), 난수() * 6.3, 난수()));
      배율.set(1, 0.7 + 난수() * 0.4, 1);
      자리.set(x * 미터, (y + 키 * 0.42) * 미터, z * 미터);
      행렬.compose(자리, 사원수, 배율);
      g.applyMatrix4(행렬);
      c.copy(섞(숲, 숲밝, 난수() * 0.7)).lerp(하늘가, Math.pow(m, 0.75) * 0.82);
      놓기(g, c.clone());
    }
  }

  // 마을 — 지붕 몇 채. §383 이 진부촌을 「원경·방향」으로 두라고 한 그대로다.
  //   북동쪽(내륙)에 모아 둔다. 흩어 놓으면 마을로 안 보인다.
  const 마을x = 코어.X[1] + 72;
  const 마을z = 코어.Z[0] - 55;
  for (let i = 0; i < 집수; i++) {
    const x = 마을x + (난수() - 0.5) * 90;
    const z = 마을z + (난수() - 0.5) * 70;
    if (!쓸만한가(x, z)) continue;
    const m = 멂(x, z);
    const y = 높이(x, z);
    const w = 4 + 난수() * 4;
    const d = 3.5 + 난수() * 3;
    const h = 2.4 + 난수() * 1.2;
    const 방 = 난수() * 6.3;
    // 벽 색 — 예전과 같은 순서로 굴린다
    c.copy(섞(흙벽, 회벽, 난수())).lerp(하늘가, Math.pow(m, 0.75) * 0.8);
    const 벽색 = c.clone();
    const 지붕높 = 1.1 + 난수() * 0.8; // 예전 지붕 높이 몫
    // ★ 진부촌은 **초가집 마을**이다(사용자 지시). 예전에는 기와를 38 % 섞었다.
    //   난수는 그대로 굴린다 — 안 굴리면 뒤따르는 집들의 자리가 통째로 밀린다.
    const 짚결 = 난수();
    // ★ 여기도 굽지 않고 자리만 남긴다(위 나무 주석 참고).
    //   표본은 「벽 색 × 지붕 비율」 네 벌이라, 지붕이 초가/기와로 갈린다.
    집자리.push({
      x, y, z,
      키: h + 지붕높 + 0.6, // 용마루까지의 키
      회전: 방,
      폭비: w / (h + 지붕높 + 0.6),
      깊이비: d / (h + 지붕높 + 0.6),
      모양: (짚결 < 0.5 ? 0 : 2) + (난수() < 0.5 ? 0 : 1),
      색: 벽색.getHex(),
    });
  }

  // ── 택촌 — **강 건너** 마을 ─────────────────────────────
  // [왜 필요한가]
  //   ④ Scene 01 의 필수 장소 요소가 「진부촌 방향과 택촌 방향을 **구분할 수
  //   있어야 한다**」이고, `F-02` 가 「영산강을 사이에 두고 진부촌과 택촌이
  //   마주한다」이다. 그런데 마을이 강 이쪽에만 28 채 있고 건너편은 0 채였다
  //   (실측). 그러면 두 방향이 안 갈린다.
  //   아랑사가 택촌의 젊은 어부이므로, 포구에서 강 너머로 그의 마을이
  //   보여야 「강을 사이에 둔 두 마을」이 읽힌다.
  // [왜 이 루프가 맨 끝인가]
  //   앞의 숲·진부촌 루프가 굴리는 난수를 한 톨도 안 건드리려고 **뒤에** 붙였다.
  //   중간에 끼우면 숲 자리가 통째로 다시 깔린다.
  const 택촌x = (코어.X[0] + 코어.X[1]) / 2;
  const 택촌z = 강.Z시작 + 강.건너 + 26; // 저편 물가에서 뭍으로 더 들어간 자리
  for (let i = 0; i < 택촌수; i++) {
    const x = 택촌x + (난수() - 0.5) * 76;
    const z = 택촌z + (난수() - 0.5) * 22;
    if (!쓸만한가(x, z)) continue;
    const m = 멂(x, z);
    const y = 높이(x, z);
    const w = 4 + 난수() * 4;
    const d2 = 3.5 + 난수() * 3;
    const h = 2.4 + 난수() * 1.2;
    // 강을 바라보게 조금 모아 준다 — 어촌은 물가를 향해 앉는다
    const 방 = Math.PI + (난수() - 0.5) * 1.4;
    c.copy(섞(흙벽, 회벽, 난수())).lerp(하늘가, Math.pow(m, 0.75) * 0.8);
    const 벽색 = c.clone();
    const 지붕높 = 1.1 + 난수() * 0.8;
    const 짚결 = 난수();
    택촌자리.push({
      x, y, z,
      키: h + 지붕높 + 0.6,
      회전: 방,
      폭비: w / (h + 지붕높 + 0.6),
      깊이비: d2 / (h + 지붕높 + 0.6),
      모양: (짚결 < 0.5 ? 0 : 2) + (난수() < 0.5 ? 0 : 1),
      색: 벽색.getHex(),
    });
  }

  // 산울타리만 굽는다. 나무·집은 자리로 돌려주고 무리로 세운다.
  let 합본 = null;
  if (조각.length) {
    합본 = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
  }
  return { 지오: 합본, 나무자리, 집자리, 택촌자리 };
}

// ── 원경 표본 ────────────────────────────────────────────────
// [왜 색을 흰색으로 굽나]
//   원경은 거리에 따라 **지평색 쪽으로 섞어** 색을 정한다. 그 값은 그루마다
//   다르므로 `instanceColor` 로 준다. 표본의 꼭짓점 색은 **비율**만 담는다 —
//   흰색(1,1,1)이 「인스턴스 색 그대로」, 0.72 가 「그보다 어둡게」다.
//   ※ 줄기는 원래 제 색(#6B5A4C)에서 따로 흐려졌다. 지금은 잎 색의 0.72 배라
//     아주 멀리서는 원래보다 조금 어둡다 — 300 m 밖 줄기는 한 픽셀이라
//     눈으로는 구분되지 않는다(실측으로 확인했다).

// 원경 나무 — 밑동이 원점, 키 1. 줄기 + 잎덩이 둘.
export function 원경나무표본들(수 = 6, 시드 = 4801) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  const 칠 = (g, v) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) a[i] = v;
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  };
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 줄기 = new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5, 1).toNonIndexed();
    줄기.translate(0, 0.21, 0);
    조각.push(칠(줄기, 0.72));
    for (const [높, 반, 눌] of [[0.5, 0.34, 1.0], [0.76, 0.24, 0.9]]) {
      const g = new THREE.IcosahedronGeometry(반, 0).toNonIndexed();
      g.scale(1, 눌 * (0.85 + 난수() * 0.35), 1);
      g.rotateY(난수() * Math.PI * 2);
      g.translate((난수() - 0.5) * 0.12, 높, (난수() - 0.5) * 0.12);
      조각.push(칠(g, 1));
    }
    const 합 = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
    합.computeVertexNormals();
    표본.push(합);
  }
  return 표본;
}

// 원경 집 — 밑동이 원점, 용마루까지 키 1. 벽 + 네모뿔 지붕.
//   네 벌 = 지붕 두 가지(초가·기와) × 밝기 두 단계. 지붕 색은 벽 색에 대한
//   **비율**로 굽는다 — 그래야 마을이 한 채씩 세어진다.
export function 원경집표본들(시드 = 6203) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  const 칠 = (g, r, gg, bb) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = r;
      a[i * 3 + 1] = gg;
      a[i * 3 + 2] = bb;
    }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  };
  // 지붕/벽 비율 — **네 벌 모두 초가**다. 짚은 볕에 바래는 정도가 제각각이라
  //   누런 쪽과 잿빛으로 삭은 쪽 사이를 네 단계로 나눈다. 한 색이면 마을이
  //   복사해 붙인 것처럼 보인다.
  const 지붕비 = [
    [0.92, 0.80, 0.52], // 갓 이은 짚 — 누렇다
    [0.84, 0.74, 0.50],
    [0.76, 0.70, 0.53], // 한 해 묵은 짚
    [0.68, 0.64, 0.52], // 삭아 잿빛이 도는 짚
  ];
  for (let i = 0; i < 4; i++) {
    const 벽높 = 0.62 + 난수() * 0.06; // 키 1 중 벽이 차지하는 몫
    const 조각 = [];
    const 벽 = new THREE.BoxGeometry(1, 벽높, 1).toNonIndexed();
    벽.translate(0, 벽높 / 2, 0);
    조각.push(칠(벽, 1, 1, 1));
    // 초가지붕 — 네모뿔이 아니라 **둥근 짚더미**다. 기와는 각이 서지만
    //   짚은 이엉을 얹어 두툼하게 부풀고 처마가 벽 밖으로 넉넉히 나온다.
    //   허리를 부풀려야 「뾰족한 고깔」이 아니라 「짚을 인 지붕」으로 읽힌다.
    const 지높 = 1 - 벽높;
    const 지 = new THREE.ConeGeometry(0.86, 지높, 8, 3).toNonIndexed();
    const p = 지.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 지높 / 2; // 0(처마) ~ 지높(마루)
      const t = THREE.MathUtils.clamp(y / 지높, 0, 1);
      // 허리(t≈0.45)에서 가장 부풀고 마루로 갈수록 오므라든다
      const 부품 = 1 + Math.sin(Math.PI * Math.pow(t, 0.85)) * 0.17;
      p.setX(k, p.getX(k) * 부품);
      p.setZ(k, p.getZ(k) * 부품);
    }
    지.rotateY(난수() * Math.PI * 2);
    지.translate(0, 벽높 + 지높 / 2, 0);
    조각.push(칠(지, ...지붕비[i]));
    const 합 = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
    합.computeVertexNormals();
    표본.push(합);
  }
  return 표본;
}

// ── 산줄기 ──────────────────────────────────────────────────
//   300~900 m. 겹겹이 세워 지평선을 만든다. 빛을 안 받는 평면 실루엣이다 —
//   멀리 있는 것에 음영을 주면 오히려 가깝게 보인다.
//   높이 — 들판 높이 함수. 산 밑자락을 여기에 앉혀야 들판 속에 파묻히거나 뜨지 않는다.
export function 산줄기만들기({ 겹 = 4, 소음, 지평색 = "#CFCBBE", 높이: 들높이 }) {
  const 조각 = [];
  // 가까운 산은 숲이 보여 푸르고 어둡고, 멀수록 공기에 씻겨 파랗고 밝다
  const 팔레트 = ["#4F5E4A", "#5A6A63", "#6B7686", "#7C8798"];
  const 하늘가 = new THREE.Color(지평색);
  const c = new THREE.Color();

  for (let 겹번 = 0; 겹번 < 겹; 겹번++) {
    const t = 겹번 / Math.max(1, 겹 - 1);
    const R = 300 + 겹번 * 190; // 반지름(m)
    const 최고 = 45 + 겹번 * 55;
    c.set(팔레트[Math.min(겹번, 팔레트.length - 1)]).lerp(하늘가, 0.18 + t * 0.62);
    const 위치 = [];
    const 색깔 = [];
    const N = 200;
    const 높이 = (a) =>
      (소음(Math.cos(a) * R * 0.004 + 겹번 * 11, Math.sin(a) * R * 0.004) * 0.5 +
        0.5) *
        최고 +
      최고 * 0.25;
    for (let i = 0; i < N; i++) {
      const a1 = (i / N) * Math.PI * 2;
      const a2 = ((i + 1) / N) * Math.PI * 2;
      const p1 = [Math.cos(a1) * R + 40, Math.sin(a1) * R + 25];
      const p2 = [Math.cos(a2) * R + 40, Math.sin(a2) * R + 25];
      // 밑자락을 들판에 앉힌다(조금 아래로 — 틈이 나면 안 된다)
      const 밑1 = (들높이 ? 들높이(p1[0], p1[1]) : 0) - 6;
      const 밑2 = (들높이 ? 들높이(p2[0], p2[1]) : 0) - 6;
      const h1 = 밑1 + 6 + 높이(a1);
      const h2 = 밑2 + 6 + 높이(a2);
      // 안쪽(코어 쪽)에서 보이도록 감는다
      const 점 = [
        [p1[0], 밑1, p1[1]], [p2[0], 밑2, p2[1]], [p2[0], h2, p2[1]],
        [p1[0], 밑1, p1[1]], [p2[0], h2, p2[1]], [p1[0], h1, p1[1]],
      ];
      for (const [px, py, pz] of 점) {
        위치.push(px * 미터, py * 미터, pz * 미터);
        색깔.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(위치, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(색깔, 3));
    조각.push(g);
  }
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}
