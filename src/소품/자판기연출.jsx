// 자판기연출.jsx — 밸브가 돌면 **화면이 자판기로 넘어가** 밀리는 걸 보여 준다
//
// [왜 컷신인가]
//   자판기는 복도 저쪽에 있다. 밸브를 돌린 자리에서는 등 뒤에서 열리는 셈이라,
//   **열렸다는 사실 자체를 못 본다.** 그래서 잠깐 화면을 그리로 넘긴다.
//
// [순서]
//   ① 감(0.9초)   서 있던 자리 → 자판기 보는 자리로 부드럽게 넘어간다
//   ② 밀림(2.2초) 자판기가 밀린다. 그 동안 바닥에서 먼지가 일고 화면이 떤다
//   ③ 옴(0.9초)   원래 자리·시선으로 정확히 되돌아온다
//   연출 동안은 걷기·마우스가 멈춘다(자판기밀기.js 의 연출중 → App 의 active).
//
// [되돌아오는 자리를 왜 저장하나]
//   컷신이 끝나고 조금이라도 다른 자리에 서 있으면 플레이어는 **순간이동당한**
//   느낌을 받는다. 들어갈 때의 자리·시선을 그대로 적어 두고 그 자리로 돌린다
//   (자물쇠 [E] 조작의 시점당기기와 같은 이유·같은 방식).
import { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  밀기진행,
  밀기설정,
  밀림,
  칸번호,
  연출시작,
  연출끝,
  연출중,
  열림흉내내나,
} from "./자판기밀기.js";
import { 밸브열림 } from "./배전반배선.js";
import { 소리재생 } from "../소리.js";
import { 그림자흔들기 } from "../공용.jsx";

// ── 먼지 알갱이 한 장 텍스처 ─────────────────────────────
//   ★ 네모난 점은 '픽셀'로 보인다. 가운데가 밝고 가장자리로 스러지는
//     동그라미여야 먼지로 읽힌다. 한 번 만들어 계속 쓴다.
let _먼지그림 = null;
function 먼지그림() {
  if (_먼지그림) return _먼지그림;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,0.95)");
  r.addColorStop(0.45, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _먼지그림 = t;
  return t;
}

// 알갱이 하나하나의 상태 — 배열 하나에 몰아 둔다(프레임마다 새로 안 만든다)
function 먼지통(수) {
  return {
    자리: new Float32Array(수 * 3),
    속도: new Float32Array(수 * 3),
    남은: new Float32Array(수), // 0 이면 죽은 것(안 그린다)
    수명: new Float32Array(수),
  };
}

export function 자판기연출({
  켬 = true,
  미리보기 = false,
  거리 = 3.4, // 자판기가 밀릴 z 거리
  시간 = 2.2, // 미는 데 걸리는 시간
  감시간 = 0.9, // 화면이 넘어가는 시간
  대상ref, // 자판기를 담은 그룹(여기 position.z 를 만진다)
  보는점, // () => [x,y,z] 카메라가 설 자리
  보는곳, // () => [x,y,z] 바라볼 곳
  먼지자리, // () => [x,y,z] 먼지가 이는 자리(자판기 밑)
  먼지수 = 90,
  먼지색 = "#cfc7b6",
  먼지크기 = 0.22,
  먼지세기 = 1,
  먼지퍼짐 = 2.2, // 자판기 밑 어디까지 넓게 일어날지
  흔들림 = 0.04,
}) {
  const { camera } = useThree();
  const 단계 = useRef("쉼"); // 쉼 · 감 · 밀림 · 옴
  // ★ 벽시계 시각. dt 를 쌓으면 프레임이 끊긴 만큼 연출이 늘어난다
  //   (카메라가 옮겨 가면 구역 최적화가 방·복도를 새로 올려 실제로 끊긴다).
  const 시작 = useRef(0);
  const 꾹 = useRef(0); // 마지막으로 꾹 밀린 시각(그때 화면이 튄다)
  const 지난때 = () => (performance.now() - 시작.current) / 1000;
  const 옛 = useRef(null); // 들어가기 전 자리·시선
  const 옛밸브 = useRef(false);
  const 옛칸 = useRef(-1); // 꾹 밀린 횟수 — 바뀌는 순간 먼지를 확 터뜨린다

  // ── 먼지 ──
  const 통 = useMemo(() => 먼지통(먼지수), [먼지수]);
  const 지오 = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(먼지수 * 3), 3));
    g.setAttribute("크기", new THREE.BufferAttribute(new Float32Array(먼지수), 1));
    return g;
  }, [먼지수]);
  const 재질 = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: 먼지색,
        size: 먼지크기,
        map: 먼지그림(),
        transparent: true,
        opacity: 0.42,
        // ★ 깊이를 쓰지 않는다 — 알갱이끼리 순서를 다투면 깜빡인다.
        depthWrite: false,
        sizeAttenuation: true,
        // ★ toneMapped 를 끄면 **화면 후처리(Bloom)가 먼지를 빛으로 본다.**
        //   먼지가 반짝여서 불티처럼 보였다 — 다른 물건과 같은 톤을 타게 켠다.
        toneMapped: true,
      }),
    [먼지색, 먼지크기],
  );
  useEffect(
    () => () => {
      지오.dispose();
      재질.dispose();
    },
    [지오, 재질],
  );
  const 점ref = useRef(null);

  const 뿜기 = (몇, 자리) => {
    let 냄 = 0;
    for (let i = 0; i < 먼지수 && 냄 < 몇; i++) {
      if (통.남은[i] > 0) continue;
      const k = i * 3;
      // 자판기 밑을 따라 길게 — 한 점에서 터지면 폭발처럼 보인다
      통.자리[k] = 자리[0] + (Math.random() - 0.5) * 0.5;
      통.자리[k + 1] = 자리[1] + Math.random() * 0.25;
      통.자리[k + 2] = 자리[2] + (Math.random() - 0.5) * 먼지퍼짐;
      통.속도[k] = (Math.random() - 0.2) * 0.9; // 복도 쪽으로 더 많이
      통.속도[k + 1] = 0.35 + Math.random() * 0.8;
      통.속도[k + 2] = (Math.random() - 0.5) * 1.1;
      통.수명[i] = 0.9 + Math.random() * 1.1;
      통.남은[i] = 통.수명[i];
      냄++;
    }
  };

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt); // 창을 잠깐 떠났다 오면 dt 가 크다 — 묶는다
    // 미리보기는 **컷신 없이** 그냥 밀린다(자리 맞출 때 쓰는 스위치라
    //   새로 고칠 때마 컷신이 돌면 성가시다).
    const 열 = 켬 ? (미리보기 || 열림흉내내나() || 밸브열림() ? 1 : 0) : 0;

    // ── 먼지 굴리기(연출이 끝난 뒤에도 남은 것은 계속 뜬다) ──
    let 산것 = 0;
    for (let i = 0; i < 먼지수; i++) {
      if (통.남은[i] <= 0) continue;
      const k = i * 3;
      통.남은[i] -= d;
      if (통.남은[i] <= 0) continue;
      // 공기 저항 — 확 퍼졌다가 이내 느려지며 위로 뜬다
      통.속도[k] *= 1 - d * 1.6;
      통.속도[k + 2] *= 1 - d * 1.6;
      통.속도[k + 1] += d * 0.12; // 먼지는 가라앉지 않고 살짝 뜬다
      통.자리[k] += 통.속도[k] * d;
      통.자리[k + 1] += 통.속도[k + 1] * d;
      통.자리[k + 2] += 통.속도[k + 2] * d;
      산것++;
    }
    const pos = 지오.attributes.position;
    let n = 0;
    for (let i = 0; i < 먼지수; i++) {
      if (통.남은[i] <= 0) continue;
      const k = i * 3;
      pos.setXYZ(n, 통.자리[k], 통.자리[k + 1], 통.자리[k + 2]);
      n++;
    }
    지오.setDrawRange(0, n);
    pos.needsUpdate = true;
    void 산것;
    if (점ref.current) 점ref.current.visible = n > 0;

    // ── 컷신 시작 판정 — 밸브가 돌아간 **그 순간**(올라가는 모서리) 한 번만 ──
    if (
      !미리보기 &&
      열 &&
      !옛밸브.current &&
      단계.current === "쉼" &&
      연출시작()
    ) {
      옛.current = { p: camera.position.clone(), q: camera.quaternion.clone() };
      단계.current = "감";
      시작.current = performance.now();
      옛칸.current = -1;
    }
    옛밸브.current = !!열;

    // ── 단계 굴리기 ──
    const o = 대상ref?.current;
    if (단계.current === "쉼") {
      // 컷신이 아닐 때(미리보기·되돌리기)도 자판기는 제 자리로 간다
      밀기진행(열, d, 시간, 거리);
      const z = 밀림();
      if (o && Math.abs(o.position.z - z) > 1e-5) o.position.z = z;
      return;
    }

    if (단계.current === "감") {
      const t = Math.min(1, 지난때() / Math.max(0.05, 감시간));
      const s = t * t * (3 - 2 * t); // 부드럽게 들어가고 나온다
      const p = 보는점?.();
      const q = 보는곳?.();
      if (p && q && 옛.current) {
        camera.position.lerpVectors(옛.current.p, _점.set(p[0], p[1], p[2]), s);
        _틀.lookAt(camera.position, _본.set(q[0], q[1], q[2]), camera.up);
        _각.setFromRotationMatrix(_틀);
        camera.quaternion.slerpQuaternions(옛.current.q, _각, s);
      }
      if (t >= 1) {
        단계.current = "밀림";
        시작.current = performance.now();
        소리재생("자판기꺼짐", { 볼륨: 0.9 }); // 자판기가 밀려나기 시작 — 전원 끄는 소리
      }
      return;
    }

    if (단계.current === "밀림") {
      // 벽시계로 진행도를 정한다 — 「시간」 초에 정확히 끝난다
      const 진 = 밀기설정(지난때() / Math.max(0.1, 시간), 거리);
      if (o) o.position.z = 밀림();
      // 먼지 — 미는 내내 조금씩 일고, **꾹 밀리는 순간** 확 터진다.
      const f = 먼지자리?.();
      const 칸 = 칸번호(진);
      if (f) {
        const 몇 = Math.max(0, Math.round(먼지세기 * (1 - 진 * 0.6) * 2));
        if (몇 > 0) 뿜기(몇, f);
        if (칸 !== 옛칸.current) {
          옛칸.current = 칸;
          뿜기(Math.round(먼지세기 * 14), f); // 한 번 꾹 → 먼지 한 뭉치
          꾹.current = performance.now();
          // ★ 그림자는 **힘이 실리는 순간에만** 따라오게 한다.
          //   그림자 한 번이 화면 한 장보다 비싸서(공용.jsx 그림자관리 참고),
          //   미는 내내 켜 두면 컷신이 그대로 렉처럼 보인다.
          그림자흔들기(0.1);
        }
      }
      // 화면 떨림 — 무거운 것이 바닥을 긁는 느낌. 끝으로 갈수록 잦아든다.
      const p = 보는점?.();
      const q = 보는곳?.();
      if (p && q) {
        // 꾹 밀린 직후 0.18초 동안만 튄다 — 내내 떨면 카메라가 고장 난 것 같다
        const 지남 = (performance.now() - 꾹.current) / 1000;
        const 튐 = Math.max(0, 1 - 지남 / 0.18);
        const 세 = 흔들림 * 튐 * Math.sin(지남 * 90);
        camera.position.set(
          p[0] + 세 * 0.6,
          p[1] + 세,
          p[2] + 세 * 0.3,
        );
        _틀.lookAt(camera.position, _본.set(q[0], q[1], q[2]), camera.up);
        camera.quaternion.setFromRotationMatrix(_틀);
      }
      if (진 >= 1) {
        단계.current = "옴";
        시작.current = performance.now();
        그림자흔들기(0.3); // 다 밀린 자리에서 그림자를 한 번 맞춰 둔다
      }
      return;
    }

    if (단계.current === "옴") {
      const t = Math.min(1, 지난때() / Math.max(0.05, 감시간));
      const s = t * t * (3 - 2 * t);
      if (옛.current) {
        const p = 보는점?.();
        if (p) camera.position.lerpVectors(_점.set(p[0], p[1], p[2]), 옛.current.p, s);
        camera.quaternion.slerpQuaternions(_각2.copy(camera.quaternion), 옛.current.q, s);
      }
      if (t >= 1) {
        if (옛.current) {
          camera.position.copy(옛.current.p);
          camera.quaternion.copy(옛.current.q);
        }
        옛.current = null;
        단계.current = "쉼";
        연출끝(); // ★ 다 되돌아온 **뒤에야** 조작을 돌려 준다
      }
    }
  });

  // ★ 먼지는 **구역 최적화에 안 잘리는 자리**(방·복도 그룹 밖)에 놓아야 한다.
  //   복도 안에 두면 컷신 카메라가 복도를 벗어나는 순간 먼지만 사라진다.
  return (
    <points
      ref={점ref}
      geometry={지오}
      material={재질}
      frustumCulled={false}
    />
  );
}

const _점 = new THREE.Vector3();
const _본 = new THREE.Vector3();
const _틀 = new THREE.Matrix4();
const _각 = new THREE.Quaternion();
const _각2 = new THREE.Quaternion();

export { 연출중 };
