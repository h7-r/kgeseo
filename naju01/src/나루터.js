// ═══════════════════════════════════════════════════════════════
//  나루터.js — Z1 의 배 대는 자리
// ═══════════════════════════════════════════════════════════════
// [왜 필요한가]
//   Z1 의 이름이 **「나루터 · 시작 테라스」** 인데 물가에 아무것도 없었다.
//   그러면 그냥 강가 자갈밭이고, §5 Scene 01 이 여기를 「시작 지점」으로
//   삼은 이유가 화면에서 읽히지 않는다. 말뚝과 널 몇 장이면 충분하다 —
//   "여기서 배를 탄다"는 것만 전해지면 된다.
//
// [배]
//   처음에는 「배는 §7 아트 게이트 뒤에」라고 미뤄 뒀다. 그런데 말뚝과 널만
//   있으면 **아직 나루터가 아니다** — 배가 있어야 「여기서 강을 건넌다」가
//   한눈에 읽힌다. 그래서 `나룻배만들기` 로 한 척 띄웠다.
//   호화롭게 만들지 않는다. 영산강 나룻배는 **밑이 평평하고 양끝이 뭉툭한**
//   널배다. 그 실루엣만 맞으면 된다.
//
// [걷는 판정]
//   물 위라 사람이 갈 수 없는 자리다(`지면` 이 물로 돌려줌 → 낙하 복귀).
//   그래서 충돌을 두지 않는다. 눈으로만 있는 것이다.
//
// [단위] 좌표·크기는 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 색입히기 } from "./바닥.js";
import { 미터 } from "./공간도면.js";

export const 나루결 = {
  말뚝: "#6A5947",
  말뚝어둠: "#3A3026",
  널: "#7E6E58",
  널어둠: "#453A2C",
};

const 풀기 = (g) => {
  const n = g.toNonIndexed();
  g.dispose();
  return n;
};

// X = 나루가 놓일 가로 범위 · 물가 = 물이 시작하는 Z · 뻗음 = 물 쪽으로 나가는 길이
export function 나루만들기({ X, 물가, 뻗음 = 3.2, 바닥높이, 시드 = 8801 }) {
  const 난수 = makeRandom(시드);
  const 조각 = [];
  const c = new THREE.Color();
  const 말밝 = new THREE.Color(나루결.말뚝);
  const 말어 = new THREE.Color(나루결.말뚝어둠);
  const 널밝 = new THREE.Color(나루결.널);
  const 널어 = new THREE.Color(나루결.널어둠);

  const 놓기 = (g, 자리, 회전, 색) => {
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(자리[0] * 미터, 자리[1] * 미터, 자리[2] * 미터),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(회전[0], 회전[1], 회전[2]),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    조각.push(색입히기(g, 색));
  };

  const 가운데 = (X[0] + X[1]) / 2;
  const 반폭 = (X[1] - X[0]) / 2;

  // ── 말뚝 ── 물가에서 물 쪽으로 두 줄. 길이·기울기를 흩어야 박은 것으로 보인다.
  const 말뚝자리 = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const z = 물가 - 0.4 + 뻗음 * t;
    for (const 쪽 of [-1, 1]) {
      const x = 가운데 + 쪽 * (반폭 - 0.25 - 난수() * 0.2);
      const 키 = 1.0 + 난수() * 0.75 + t * 0.35; // 물 쪽일수록 길게 박힌다
      const 굵기 = 0.09 + 난수() * 0.05;
      말뚝자리.push({ x, z, 키 });
      놓기(
        풀기(
          new THREE.CylinderGeometry(굵기 * 미터, 굵기 * 1.2 * 미터, 키 * 미터, 6, 1),
        ),
        [x, 바닥높이 - 0.35 + 키 / 2, z],
        [(난수() - 0.5) * 0.13, 난수() * Math.PI, (난수() - 0.5) * 0.13],
        c.copy(말어).lerp(말밝, 0.35 + 난수() * 0.6).clone(),
      );
    }
  }

  // ── 널 ── 말뚝 위에 걸친 판자 몇 장. 사이를 벌려 놔야 널로 보인다.
  const 널수 = 4;
  for (let i = 0; i < 널수; i++) {
    const 폭 = (반폭 * 2 - 0.5) / 널수;
    const x = 가운데 - 반폭 + 0.25 + 폭 * (i + 0.5);
    const 길이 = 뻗음 + 0.9;
    놓기(
      풀기(
        new THREE.BoxGeometry(폭 * 0.82 * 미터, 0.07 * 미터, 길이 * 미터),
      ),
      [x, 바닥높이 + 0.34 + (난수() - 0.5) * 0.03, 물가 - 0.6 + 길이 / 2],
      [(난수() - 0.5) * 0.02, (난수() - 0.5) * 0.02, 0],
      c.copy(널어).lerp(널밝, 0.4 + 난수() * 0.55).clone(),
    );
  }

  // ── 가로대 ── 널을 받치는 나무. 없으면 판자가 떠 있는 것처럼 보인다.
  for (const t of [0.08, 0.62]) {
    놓기(
      풀기(new THREE.BoxGeometry(반폭 * 2 * 미터, 0.12 * 미터, 0.14 * 미터)),
      [가운데, 바닥높이 + 0.25, 물가 - 0.4 + 뻗음 * t],
      [0, 0, 0],
      c.copy(말어).lerp(말밝, 0.5).clone(),
    );
  }

  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}


// ── 나룻배 ─────────────────────────────────────────────────
// [모양]
//   영산강 나룻배는 통나무를 파낸 배가 아니라 **널을 이어 붙인 평저선**이다.
//     · 밑이 평평하고, 양 끝이 들려 있다(로커)
//     · 끝이 뾰족하지 않고 **뭉툭하게 잘려** 있다 — 이게 실루엣의 핵심이다
//     · 옆널이 바깥으로 벌어진다
//   그래서 뾰족한 카누가 아니라 **납작한 상자에 가까운** 옆모습이 나와야 한다.
//
// [만드는 법]
//   길이 방향으로 단면을 훑어 가며 띠(스트립)를 잇는다. 밑널 한 장, 옆널 두 장,
//   양끝 마구리 두 장, 그 위에 뱃전(가로대)과 앉을 널 셋.
//   면마다 각진 노멀이 나오도록 **인덱스를 안 쓴다** — 널을 이어 붙인 느낌이 산다.
//
// [단위·자리]
//   좌표·크기는 미터. `물높이` 는 수면 y(강.js 는 0 을 기준으로 물결친다).
//   `잠김` 만큼 배가 물에 잠긴다 — 안 잠기면 물 위에 얹힌 종이배로 보인다.
export function 나룻배만들기({
  x = 0,
  z = 0,
  방향 = 0,
  길이 = 4.4,
  폭 = 1.15,
  깊이 = 0.44,
  물높이 = 0,
  잠김 = 0.13,
  시드 = 4477,
}) {
  const 난수 = makeRandom(시드);
  const 위치 = [];
  const 색깔 = [];
  const c = new THREE.Color();
  const 밝 = new THREE.Color(나루결.널);
  const 어 = new THREE.Color(나루결.널어둠);
  const 말밝 = new THREE.Color(나루결.말뚝);
  const 말어 = new THREE.Color(나루결.말뚝어둠);

  const 칠 = (밝음, 어둠, 세기) =>
    c.copy(어둠).lerp(밝음, 세기).clone();

  // ※ 선체는 손으로 찍은 삼각형이라 uv 가 없다. 상자·원기둥은 uv 를 갖고 온다.
  //   섞으면 `mergeGeometries` 가 「uv 가 전부 있거나 전부 없어야 한다」며 거부한다.
  //   실제로 그렇게 터졌다 — 붙이기 전에 uv 를 떼어 형식을 맞춘다.
  const uv떼기 = (g) => {
    g.deleteAttribute("uv");
    g.deleteAttribute("uv1");
    return g;
  };

  const 점찍기 = (p, 색) => {
    위치.push(p[0] * 미터, p[1] * 미터, p[2] * 미터);
    색깔.push(색.r, 색.g, 색.b);
  };
  const 사각 = (a, b, d, e, 색) => {
    점찍기(a, 색); 점찍기(b, 색); 점찍기(d, 색);
    점찍기(a, 색); 점찍기(d, 색); 점찍기(e, 색);
  };

  // 국소 좌표 — z 가 길이 방향(뱃머리 +z), x 가 폭, y 가 위
  const N = 16;
  const 단면 = (t) => {
    const s = Math.sin(Math.PI * t); // 가운데 1 · 양끝 0
    const 끝 = 1 - s;
    return {
      z: -길이 / 2 + 길이 * t,
      // 끝이 **뭉툭하다** — 0 으로 좁히면 카누가 된다
      반폭: (폭 / 2) * (0.42 + 0.58 * Math.pow(s, 0.5)),
      바닥: 끝 * 0.20, // 로커 — 양끝이 들린다
      윗: 끝 * 0.20 + 깊이 * (0.88 + 0.32 * 끝), // 뱃전도 끝에서 솟는다
      벌림: 0.09 + 0.05 * s, // 옆널이 바깥으로
    };
  };

  // ① 밑널
  for (let i = 0; i < N; i++) {
    const a = 단면(i / N);
    const b = 단면((i + 1) / N);
    const 색 = 칠(밝, 어, 0.30 + 난수() * 0.22);
    사각(
      [-a.반폭, a.바닥, a.z],
      [a.반폭, a.바닥, a.z],
      [b.반폭, b.바닥, b.z],
      [-b.반폭, b.바닥, b.z],
      색,
    );
  }

  // ② 옆널 — 널 두 단으로 나눠 이어 붙인 티를 낸다
  for (const 쪽 of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const a = 단면(i / N);
      const b = 단면((i + 1) / N);
      for (const [u0, u1] of [[0, 0.55], [0.55, 1]]) {
        const 색 = 칠(밝, 어, 0.30 + 난수() * 0.3 + u0 * 0.18);
        const 자리 = (q, u) => [
          쪽 * (q.반폭 + q.벌림 * u),
          q.바닥 + (q.윗 - q.바닥) * u,
          q.z,
        ];
        사각(자리(a, u0), 자리(a, u1), 자리(b, u1), 자리(b, u0), 색);
      }
    }
  }

  // ③ 양끝 마구리 — 뭉툭하게 잘린 면. 이게 나룻배의 얼굴이다.
  for (const t of [0, 1]) {
    const q = 단면(t);
    const 색 = 칠(밝, 어, 0.24 + 난수() * 0.2);
    사각(
      [-q.반폭, q.바닥, q.z],
      [q.반폭, q.바닥, q.z],
      [q.반폭 + q.벌림, q.윗, q.z],
      [-(q.반폭 + q.벌림), q.윗, q.z],
      색,
    );
  }

  // ④ 뱃전 — 위 테두리를 안쪽으로 접어 닫는다(열린 모서리가 종잇장으로 보인다)
  for (const 쪽 of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const a = 단면(i / N);
      const b = 단면((i + 1) / N);
      const 색 = 칠(말밝, 말어, 0.4 + 난수() * 0.4);
      const 밖 = (q) => [쪽 * (q.반폭 + q.벌림), q.윗, q.z];
      const 안 = (q) => [쪽 * (q.반폭 + q.벌림 - 0.1), q.윗 - 0.015, q.z];
      사각(밖(a), 안(a), 안(b), 밖(b), 색);
    }
  }

  // ⑤ 바닥널 — **수면보다 위**에 깐다
  // [왜 필요한가]
  //   선체 밑널은 `잠김` 만큼 물에 잠긴다. 그러면 수면(y = 0)이 **배 안쪽을
  //   가로질러**, 배 안에 물이 차오른 것처럼 보인다(실제로 그렇게 보였다).
  //   물가 근처에서는 땅 판까지 같이 올라온다 — 둘 다 같은 이유다.
  //   진짜 배도 밑바닥 위에 널을 한 겹 깔아 발을 올린다(멍에 위의 널).
  //   그 널을 **수면보다 확실히 위**에 두면 물도 땅도 가려진다.
  const 바닥널높이 = (q) => Math.max(q.바닥 + 0.05, 잠김 + 0.06);
  for (let i = 0; i < N; i++) {
    const a = 단면(i / N);
    const b = 단면((i + 1) / N);
    const ya = 바닥널높이(a);
    const yb = 바닥널높이(b);
    // 옆널에 살짝 못 미치게 — 딱 붙이면 아른거린다
    const wa = a.반폭 * 0.96;
    const wb = b.반폭 * 0.96;
    const 색 = 칠(밝, 어, 0.22 + 난수() * 0.2);
    사각([-wa, ya, a.z], [wa, ya, a.z], [wb, yb, b.z], [-wb, yb, b.z], 색);
  }

  // ⑥ 앉을 널 셋 — 사람이 타는 물건이라는 표시
  const 지오들 = [];
  for (const t of [0.3, 0.52, 0.74]) {
    const q = 단면(t);
    const 판 = uv떼기(
      new THREE.BoxGeometry(
        (q.반폭 + q.벌림 * 0.6) * 2 * 미터,
        0.05 * 미터,
        0.17 * 미터,
      ).toNonIndexed(),
    );
    판.translate(0, (q.윗 - 0.07) * 미터, q.z * 미터);
    지오들.push(색입히기(판, 칠(밝, 어, 0.45 + 난수() * 0.3)));
  }

  // ⑦ 삿대 — 뱃전 안쪽에 붙여 뉘어 둔다(노와 안 엉키게)
  {
    const 대 = uv떼기(
      new THREE.CylinderGeometry(0.035 * 미터, 0.045 * 미터, 3.4 * 미터, 6, 1).toNonIndexed(),
    );
    대.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(-(폭 * 0.32) * 미터, (잠김 + 0.12) * 미터, 0.15 * 미터),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.06, 0.1, 0)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    지오들.push(색입히기(대, 칠(말밝, 말어, 0.5 + 난수() * 0.35)));
  }

  // ⑧ 노 두 자루 — 양쪽 뱃전에 **가로로** 걸쳐 둔다
  // [자세]
  //   젓는 노는 배와 나란히 눕는 게 아니라 **뱃전을 가로질러** 걸린다.
  //   손잡이는 배 안쪽, 물갈퀴는 반대쪽 뱃전 **너머 물 위로** 나간다.
  //   처음에 배 길이 방향으로 뉘었더니 두 자루가 가운데서 X 자로 엇갈렸다 —
  //   「걸쳐 둔 노」가 아니라 「던져 놓은 막대」로 보였다.
  for (const 쪽 of [-1, 1]) {
    const 중 = 단면(0.5);
    const 뱃전 = 중.반폭 + 중.벌림;
    const 자루길이 = 2.6;
    const 손잡이안쪽 = 0.5; // 반대편 뱃전 안쪽으로 들어오는 길이
    // 국소 +X 로 뻗는 노를 만들고, 통째로 자리에 얹는다
    const 조각모음 = [];
    const 자루 = uv떼기(
      new THREE.CylinderGeometry(0.028 * 미터, 0.036 * 미터, 자루길이 * 미터, 6, 1).toNonIndexed(),
    );
    자루.rotateZ(Math.PI / 2); // 길이를 x 축으로
    자루.translate((자루길이 / 2 - 손잡이안쪽) * 미터, 0, 0);
    조각모음.push(색입히기(자루, 칠(말밝, 말어, 0.45 + 난수() * 0.35)));
    // 물갈퀴 — 끝에서 납작하고 넓게
    const 날 = uv떼기(new THREE.BoxGeometry(0.72 * 미터, 0.03 * 미터, 0.21 * 미터).toNonIndexed());
    날.translate((자루길이 - 손잡이안쪽 + 0.3) * 미터, -0.02 * 미터, 0);
    조각모음.push(색입히기(날, 칠(밝, 어, 0.34 + 난수() * 0.3)));

    const 노 = mergeGeometries(조각모음, false);
    조각모음.forEach((g) => g.dispose());
    노.applyMatrix4(
      new THREE.Matrix4().compose(
        // 뱃전에 얹히는 자리 — 두 자루가 앞뒤로 어긋나게 놓아 안 겹친다
        new THREE.Vector3(-쪽 * 뱃전 * 0.55 * 미터, (중.윗 - 0.03) * 미터, 쪽 * 0.55 * 미터),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            0,
            쪽 > 0 ? 0 : Math.PI, // 좌현·우현으로 뻗는 방향
            -0.12, // 바깥쪽이 물 쪽으로 살짝 내려간다
          ),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    지오들.push(노);
  }

  const 몸 = new THREE.BufferGeometry();
  몸.setAttribute("position", new THREE.Float32BufferAttribute(위치, 3));
  몸.setAttribute("color", new THREE.Float32BufferAttribute(색깔, 3));
  몸.computeVertexNormals();
  지오들.unshift(몸);

  const 합본 = mergeGeometries(지오들, false);
  지오들.forEach((g) => g.dispose());
  // 자리·방향으로 옮긴다. `잠김` 만큼 물에 담근다.
  합본.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x * 미터, (물높이 - 잠김) * 미터, z * 미터),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 방향, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return 합본;
}
