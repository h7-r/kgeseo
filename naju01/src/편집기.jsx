// ═══════════════════════════════════════════════════════════════
//  편집기.jsx — 화면에서 요소 하나를 집어 고치는 도구
// ═══════════════════════════════════════════════════════════════
// [무엇을 만질 수 있나]
//   `배치.js` 로 심은 **인스턴스**만이다 — 나무·덤불·잎더미처럼 흩뿌린 것.
//   지형·절벽·통로는 **일부러 뺐다.** 그건 도면 숫자(`공간도면.js`)가 정하고,
//   마우스로 주무르면 그림과 걷는 판정이 갈라진다. 이 프로젝트가 가장 오래
//   싸운 버그가 그것이라, 편집으로 되살릴 이유가 없다.
//
// [조작]
//   클릭         고르기 (빈 곳 클릭 = 해제)
//   왼쪽 드래그   고른 것을 끌어 옮기기 (4 px 넘게 움직이면 시작)
//   오른쪽 드래그 시점 돌리기 — 편집 중에도 둘러볼 수 있어야 한다
//   WASD         걸어 다니기 (편집 중에도 이동은 살아 있다)
//   방향키        미세 이동 (0.25 m · Shift 를 누르면 1 m). 화면에서 본 방향 기준
//   Ctrl+C / V   복사 · 붙여넣기
//   R / Shift+R 회전 (누를 때마다 15°)
//   [ / ]       크기 −10 % / +10 %
//   Delete/X    지우기
//   Ctrl+Z      마지막 편집 되돌리기
//   Ctrl+S      `에셋/편집.json` 에 저장
//   ESC         이동 취소 · 고르기 해제
//
// [왜 저장을 파일로 하나]
//   배치는 시드 기반이라 어디서 열어도 같은 결과가 나온다. 편집만 사람마다
//   다르면 그 전제가 깨진다. 「무엇을 지웠고 무엇을 옮겼는가」만 파일에 남겨
//   팀원 화면에서도 같게 만든다(vite.config.js 의 `편집저장` 플러그인).

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { 미터, 유닛, 코어 } from "./공간도면.js";
import {
  지우기,
  고치기,
  더하기,
  편집쓰기,
  편집수,
  저장가능한가,
} from "./배치.js";

const 회전단위 = Math.PI / 12; // 15°
// 이동할 때 '땅'으로 쳐 주는 메시 이름
const 땅이름 = ["땅", "길", "비탈", "절벽면", "절벽조각.덩어리", "z.지오"];
const 밀기단위 = 0.25; // m — Shift 를 누르면 4 배

export function 편집기({
  켬,
  편집,
  편집설정,
  지면높이,
  잠금해제, // 포인터락을 풀어야 마우스로 집을 수 있다
}) {
  const { camera, scene, gl } = useThree();
  const [고른것, 고른것설정] = useState(null); // { 이름, 번호, 자리:{x,y,z}, 키 }
  const [알림, 알림설정] = useState("");
  const 되돌리기통 = useRef([]);
  const 편집참조 = useRef(편집);
  편집참조.current = 편집;
  const 복사판 = useRef(null); // Ctrl+C 로 담아 둔 것
  // 저장 상태 — 「먹힌 건지 안 먹힌 건지」가 안 보여서 만든 것
  const [저장됨, 저장됨설정] = useState(""); // 마지막으로 저장한 편집의 지문
  const [저장중, 저장중설정] = useState(false);
  const [붙었나, 붙었나설정] = useState(null); // 개발 서버에 저장 기능이 있나
  const 지문 = JSON.stringify(편집);
  const 안한변경 = 편집수(편집) > 0 && 지문 !== 저장됨;

  useEffect(() => {
    if (!켬) return;
    저장가능한가().then(붙었나설정);
  }, [켬]);

  const 저장하기 = useCallback(async () => {
    저장중설정(true);
    try {
      await 편집쓰기(편집참조.current);
      저장됨설정(JSON.stringify(편집참조.current));
      알림설정("저장했다 → 에셋/편집.json");
      붙었나설정(true);
    } catch (e) {
      알림설정("✘ " + e.message);
      붙었나설정(false);
    } finally {
      저장중설정(false);
    }
  }, []);
  const 광선 = useRef(new THREE.Raycaster());
  const 화면 = useRef(new THREE.Vector2());

  // ── 마우스 아래의 인스턴스 찾기 ──────────────────────────
  const 집기 = useCallback(
    (ev) => {
      const 상자 = gl.domElement.getBoundingClientRect();
      화면.current.set(
        ((ev.clientX - 상자.left) / 상자.width) * 2 - 1,
        -((ev.clientY - 상자.top) / 상자.height) * 2 + 1,
      );
      광선.current.setFromCamera(화면.current, camera);
      const 맞음 = 광선.current.intersectObjects(scene.children, true);
      for (const h of 맞음) {
        const o = h.object;
        if (!o.isInstancedMesh || h.instanceId === undefined) continue;
        const 무리이름 = o.userData?.무리이름;
        const 번호들 = o.userData?.번호들;
        if (!무리이름 || !번호들) continue;
        const 번호 = 번호들[h.instanceId];
        const m = new THREE.Matrix4();
        o.getMatrixAt(h.instanceId, m);
        const 자리 = new THREE.Vector3();
        const 회 = new THREE.Quaternion();
        const 크 = new THREE.Vector3();
        m.decompose(자리, 회, 크);
        // ★ 테두리는 **그 모양의 진짜 바운딩박스**로 그린다.
        //   예전에는 `키`(높이)를 세 축에 다 썼다. 나무 키가 5 m 면 가로도 5 m 인
        //   상자가 그려져서, 실제로는 폭 1.5 m 인 나무를 3 배 넘게 감쌌다 —
        //   무엇을 골랐는지 알 수가 없었다(사용자 지적).
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        return {
          이름: 무리이름,
          번호,
          x: 자리.x * 유닛,
          y: 자리.y * 유닛,
          z: 자리.z * 유닛,
          키: 크.y * 유닛,
          회전: new THREE.Euler().setFromQuaternion(회, "YXZ").y,
          // 유닛 단위의 국소 상자(모양 기준) — 그릴 때 인스턴스 크기를 곱한다
          상자: {
            크기: [
              (bb.max.x - bb.min.x) * 크.x,
              (bb.max.y - bb.min.y) * 크.y,
              (bb.max.z - bb.min.z) * 크.z,
            ],
            중심: [
              ((bb.max.x + bb.min.x) / 2) * 크.x,
              ((bb.max.y + bb.min.y) / 2) * 크.y,
              ((bb.max.z + bb.min.z) / 2) * 크.z,
            ],
          },
        };
      }
      return null;
    },
    [camera, scene, gl],
  );

  // ── 마우스 (고르기 · 끌기 · 시점 돌리기) ────────────────
  // [왜 ref 로 두나]
  //   상태(useState)를 의존성에 넣으면 렌더마다 리스너가 떨어졌다 붙는다.
  //   끌기 도중에 그러면 **드래그가 끊긴다** — 실제로 「드래그로 이동이 안 된다」의
  //   원인이었다. 순간 상태는 ref 로 들고 리스너는 한 번만 붙인다.
  const 끌기 = useRef(null); // { 시작:[x,y], 움직임:false }
  const 돌리기 = useRef(null); // 오른쪽 버튼으로 시점 돌리기
  const 고른것참조 = useRef(null);
  const 지면높이참조 = useRef(지면높이);
  고른것참조.current = 고른것;
  지면높이참조.current = 지면높이;

  useEffect(() => {
    if (!켬) return;
    const 캔 = gl.domElement;
    const 면 = new THREE.Plane();
    const 닿는곳 = new THREE.Vector3();

    // 커서 아래의 땅 자리 — 못 맞히면 지금 높이의 수평면으로 받는다
    const 땅자리 = (ev, 기준y) => {
      const 상자 = 캔.getBoundingClientRect();
      화면.current.set(
        ((ev.clientX - 상자.left) / 상자.width) * 2 - 1,
        -((ev.clientY - 상자.top) / 상자.height) * 2 + 1,
      );
      광선.current.setFromCamera(화면.current, camera);
      const 맞음 = 광선.current
        .intersectObjects(scene.children, true)
        .filter((h) => 땅이름.includes(h.object.name));
      let x, z;
      if (맞음.length) {
        x = 맞음[0].point.x * 유닛;
        z = 맞음[0].point.z * 유닛;
      } else {
        // 언덕 위에서 수평으로 보면 광선이 코어를 넘어 원경으로 날아간다.
        // 면으로 받아야 **어디를 보든 따라온다**(실측: 안 받으면 맞음 0).
        면.set(new THREE.Vector3(0, 1, 0), -기준y * 미터);
        if (!광선.current.ray.intersectPlane(면, 닿는곳)) return null;
        x = 닿는곳.x * 유닛;
        z = 닿는곳.z * 유닛;
      }
      // Playable Core 밖으로는 못 나간다(면 교점은 수백 m 밖까지 간다)
      return [
        Math.min(코어.X[1] - 0.5, Math.max(코어.X[0] + 0.5, x)),
        Math.min(코어.Z[1] - 0.5, Math.max(코어.Z[0] + 0.5, z)),
      ];
    };

    const 눌림 = (ev) => {
      // 오른쪽 버튼 = 시점 돌리기 (편집 중에도 둘러볼 수 있어야 한다)
      if (ev.button === 2) {
        돌리기.current = { x: ev.clientX, y: ev.clientY };
        캔.setPointerCapture?.(ev.pointerId);
        ev.preventDefault();
        return;
      }
      if (ev.button !== 0) return;
      const 찾음 = 집기(ev);
      if (찾음) {
        고른것설정(찾음);
        고른것참조.current = 찾음;
        끌기.current = { 시작: [ev.clientX, ev.clientY], 움직임: false };
        캔.setPointerCapture?.(ev.pointerId);
        알림설정(
          `${찾음.이름} #${찾음.번호} · (${찾음.x.toFixed(1)}, ${찾음.z.toFixed(1)}) · 키 ${찾음.키.toFixed(1)} m`,
        );
      } else {
        고른것설정(null);
        고른것참조.current = null;
        알림설정("");
      }
    };

    const 움직임 = (ev) => {
      // ① 시점 돌리기
      if (돌리기.current) {
        const dx = ev.clientX - 돌리기.current.x;
        const dy = ev.clientY - 돌리기.current.y;
        돌리기.current = { x: ev.clientX, y: ev.clientY };
        camera.rotation.order = "YXZ";
        camera.rotation.y -= dx * 0.0035;
        camera.rotation.x = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, camera.rotation.x - dy * 0.0035),
        );
        return;
      }
      // ② 고른 것 끌기 — 4 px 넘게 움직여야 시작(클릭과 구분)
      const 끌 = 끌기.current;
      const 고 = 고른것참조.current;
      if (!끌 || !고) return;
      if (!끌.움직임) {
        const d = Math.hypot(ev.clientX - 끌.시작[0], ev.clientY - 끌.시작[1]);
        if (d < 4) return;
        끌.움직임 = true;
        되돌리기통.current.push(편집참조.current);
      }
      const 자리 = 땅자리(ev, 고.y);
      if (!자리) return;
      const [x, z] = 자리;
      const y = 지면높이참조.current ? 지면높이참조.current(x, z) : 고.y;
      const 새것 = { ...고, x, y, z };
      고른것참조.current = 새것;
      고른것설정(새것);
      편집설정((e) => 고치기(e, 고.이름, 고.번호, { x, y, z }));
    };

    const 뗌 = (ev) => {
      if (돌리기.current) {
        돌리기.current = null;
        캔.releasePointerCapture?.(ev.pointerId);
        return;
      }
      if (끌기.current?.움직임) 알림설정("옮김 · Ctrl+S 로 저장");
      끌기.current = null;
      캔.releasePointerCapture?.(ev.pointerId);
    };

    const 메뉴막기 = (ev) => ev.preventDefault();
    캔.addEventListener("pointerdown", 눌림);
    캔.addEventListener("pointermove", 움직임);
    캔.addEventListener("pointerup", 뗌);
    캔.addEventListener("contextmenu", 메뉴막기);
    return () => {
      캔.removeEventListener("pointerdown", 눌림);
      캔.removeEventListener("pointermove", 움직임);
      캔.removeEventListener("pointerup", 뗌);
      캔.removeEventListener("contextmenu", 메뉴막기);
    };
  }, [켬, 집기, gl, camera, scene, 편집설정]);

  // ── 키 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!켬) return;
    const 눌림 = async (ev) => {
      // ★ `ev.key` 가 아니라 `ev.code`(물리 키)로 판단한다.
      //   한글 IME 가 켜져 있으면 R 을 눌러도 `ev.key` 는 **"ㄱ"** 으로 온다.
      //   그래서 「E 는 되는데 R·X 는 안 된다」가 나왔다 — E 토글만 code 를
      //   쓰고 있었기 때문이다. 자판 배열·IME 와 무관하려면 code 여야 한다.
      if (ev.ctrlKey || ev.metaKey) {
        if (ev.code === "KeyS") {
          ev.preventDefault();
          ev.stopPropagation(); // S(뒤로 걷기)로 새어 나가지 않게
          await 저장하기();
          return;
        }
        if (ev.code === "KeyZ") {
          ev.preventDefault();
          const 이전 = 되돌리기통.current.pop();
          if (이전) {
            편집설정(이전);
            알림설정("되돌림");
          }
          return;
        }
      }
      // ── 복사 · 붙여넣기 ──────────────────────────────────
      //   생성기는 그대로 두고 **사람이 더한 것**을 편집 파일에 쌓는다(배치.js `더함`).
      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyC") {
        if (!고른것) return;
        복사판.current = { ...고른것 };
        알림설정(`복사함 — ${고른것.이름} #${고른것.번호} · Ctrl+V 로 붙이기`);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyV") {
        const c = 복사판.current;
        if (!c) {
          알림설정("복사한 것이 없다 — 먼저 Ctrl+C");
          return;
        }
        // 원본에서 화면 오른쪽으로 한 걸음 띄워 놓는다(정확히 겹치면 안 보인다)
        const 앞 = new THREE.Vector3();
        camera.getWorldDirection(앞);
        앞.y = 0;
        if (앞.lengthSq() < 1e-6) 앞.set(0, 0, -1);
        앞.normalize();
        const 옆 = new THREE.Vector3().crossVectors(앞, camera.up).normalize();
        const 간격 = Math.max(1, c.키 * 0.6);
        const x = Math.min(코어.X[1] - 0.5, Math.max(코어.X[0] + 0.5, c.x + 옆.x * 간격));
        const z = Math.min(코어.Z[1] - 0.5, Math.max(코어.Z[0] + 0.5, c.z + 옆.z * 간격));
        const y = 지면높이 ? 지면높이(x, z) : c.y;
        되돌리기통.current.push(편집);
        const { 편집: 다음, 번호 } = 더하기(편집, c.이름, {
          x, y, z, 키: c.키, 회전: c.회전 ?? 0,
        });
        편집설정(다음);
        const 새것 = { ...c, 번호, x, y, z };
        고른것설정(새것);
        고른것참조.current = 새것;
        알림설정(`붙여넣음 — ${c.이름} #${번호} · Ctrl+S 로 저장`);
        return;
      }
      if (!고른것) return;
      const 밀기 = (값) => {
        되돌리기통.current.push(편집);
        편집설정((e) => 고치기(e, 고른것.이름, 고른것.번호, 값));
      };
      switch (ev.code) {
        case "Delete":
        case "Backspace":
        case "KeyX":
          되돌리기통.current.push(편집);
          편집설정((e) => 지우기(e, 고른것.이름, 고른것.번호));
          고른것설정(null);
          알림설정("지움 · Ctrl+S 로 저장");
          break;
        case "KeyR": {
          const 다음 = (고른것.회전 ?? 0) + (ev.shiftKey ? -회전단위 : 회전단위);
          고른것설정((v) => ({ ...v, 회전: 다음 }));
          밀기({ 회전: 다음 });
          break;
        }
        case "BracketLeft": {
          const 다음 = 고른것.키 * 0.9;
          고른것설정((v) => ({ ...v, 키: 다음 }));
          밀기({ 키: 다음 });
          break;
        }
        case "BracketRight": {
          const 다음 = 고른것.키 * 1.1;
          고른것설정((v) => ({ ...v, 키: 다음 }));
          밀기({ 키: 다음 });
          break;
        }
        // ★ 방향키로도 옮긴다. 마우스 이동(G)은 큰 이동에, 방향키는 미세 조정에.
        //   「마우스로 드래그해도 안 움직인다」는 지적이 있어서 확실한 길을 하나 더 둔다.
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          ev.preventDefault();
          const 칸 = 밀기단위 * (ev.shiftKey ? 4 : 1);
          // ★ 화면 기준으로 민다. 오른쪽 벡터는 **걷기 훅과 같은 식**(fwd × up)을
          //   쓴다. 예전에는 그 값을 음수로 써서 **좌우가 뒤집혀 있었다**
          //   (사용자 지적: 「기준이 다른 것 같다」).
          const 앞 = new THREE.Vector3();
          camera.getWorldDirection(앞);
          앞.y = 0;
          if (앞.lengthSq() < 1e-6) 앞.set(0, 0, -1);
          앞.normalize();
          const 옆 = new THREE.Vector3().crossVectors(앞, camera.up).normalize();
          const d = new THREE.Vector3();
          if (ev.code === "ArrowUp") d.copy(앞);
          if (ev.code === "ArrowDown") d.copy(앞).negate();
          if (ev.code === "ArrowRight") d.copy(옆);
          if (ev.code === "ArrowLeft") d.copy(옆).negate();
          const x = Math.min(코어.X[1] - 0.5, Math.max(코어.X[0] + 0.5, 고른것.x + d.x * 칸));
          const z = Math.min(코어.Z[1] - 0.5, Math.max(코어.Z[0] + 0.5, 고른것.z + d.z * 칸));
          const y = 지면높이 ? 지면높이(x, z) : 고른것.y;
          고른것설정((v) => ({ ...v, x, y, z }));
          밀기({ x, y, z });
          알림설정(`(${x.toFixed(1)}, ${z.toFixed(1)}) · Ctrl+S 로 저장`);
          break;
        }
        case "Escape":
          고른것설정(null);
          고른것참조.current = null;
          알림설정("");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", 눌림);
    return () => window.removeEventListener("keydown", 눌림);
  }, [켬, 고른것, 편집, 편집설정, camera, 지면높이, 저장하기]);

  // 편집 모드에 들어가면 포인터락을 푼다(마우스로 집어야 하므로)
  useEffect(() => {
    if (켬 && 잠금해제) 잠금해제();
  }, [켬, 잠금해제]);

  if (!켬) return null;
  return (
    <>
      {고른것 && (
        // ★ 테두리를 **같이 돌린다.**
        //   나무·잎더미는 거의 좌우대칭이라 15° 를 돌려도 눈에 안 띈다.
        //   실제로 「회전이 안 먹힌다」는 말이 나왔는데, 재 보니 yaw 는 정확히
        //   0° → 45° 로 가고 있었다 — **보이지 않았을 뿐**이다.
        //   상자가 같이 돌고 앞쪽에 표시가 있으면 얼마나 돌았는지 바로 읽힌다.
        <group
          position={[고른것.x * 미터, 고른것.y * 미터, 고른것.z * 미터]}
          rotation={[0, 고른것.회전 ?? 0, 0]}
          renderOrder={999}
        >
          <mesh
            position={[
              고른것.상자?.중심[0] ?? 0,
              고른것.상자?.중심[1] ?? 고른것.키 * 0.5 * 미터,
              고른것.상자?.중심[2] ?? 0,
            ]}
          >
            <boxGeometry
              args={
                고른것.상자
                  ? 고른것.상자.크기.map((v) => v * 1.06)
                  : [고른것.키 * 미터, 고른것.키 * 미터, 고른것.키 * 미터]
              }
            />
            <meshBasicMaterial
              color="#FFD166"
              wireframe
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
          {/* 앞쪽 코 — 어느 방향을 보고 있는지 알려 준다 */}
          <mesh
            position={[
              0,
              (고른것.상자?.중심[1] ?? 고른것.키 * 0.5 * 미터),
              -((고른것.상자?.크기[2] ?? 고른것.키 * 미터) * 0.53 + 0.35 * 미터),
            ]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <coneGeometry args={[0.22 * 미터, 0.7 * 미터, 4]} />
            <meshBasicMaterial
              color="#FFD166"
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
      <편집안내
        알림={알림}
        고른것={고른것}
        안한변경={안한변경}
        변경수={편집수(편집)}
        저장중={저장중}
        붙었나={붙었나}
        저장하기={저장하기}
      />
    </>
  );
}

// ── 화면 구석 안내 + 저장 버튼 ──────────────────────────────
// [왜 버튼을 두나]
//   Ctrl+S 는 **S(뒤로 걷기)와 맞물린다.** 키를 고쳐도 「눌렀는데 됐는지
//   모르겠다」는 문제는 남는다. 누를 수 있는 버튼과 **상태 표시**가 답이다.
//     · 변경 없음        → 회색
//     · 저장 안 한 변경 N → 노랑 (눌러 달라는 뜻)
//     · 저장됨           → 초록
//     · 저장 기능 없음    → 빨강 + 무엇을 해야 하는지
//
// [왜 React 요소가 아니라 DOM 을 직접 만지나]
//   이 컴포넌트는 `<Canvas>` **안**에 있다. R3F 는 자기 재조정기를 쓰므로
//   `<div>`·`<button>` 을 three 객체로 해석해 터진다
//   ("R3F: B is not part of the THREE namespace" — 실제로 그랬다).
//   react-dom 의 createPortal 도 같은 이유로 안 통한다. 그래서 DOM 을 직접 만든다.
function 편집안내({ 알림, 고른것, 안한변경, 변경수, 저장중, 붙었나, 저장하기 }) {
  const 판참조 = useRef(null);
  const 저장참조 = useRef(저장하기);
  저장참조.current = 저장하기;

  // 판은 한 번만 만든다
  useEffect(() => {
    const 판 = document.createElement("div");
    판.id = "naju-편집안내";
    판.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:60;pointer-events:none;" +
      "font:12px/1.6 ui-monospace,monospace;color:#E8EAF0;" +
      "background:rgba(16,20,28,.86);padding:10px 12px;border-radius:8px;" +
      "border:1px solid rgba(255,209,102,.35);max-width:min(52ch,64vw)";
    document.body.appendChild(판);
    판참조.current = 판;
    const 누름 = (e) => {
      const b = e.target.closest("#naju-저장버튼");
      if (b) 저장참조.current?.();
    };
    판.addEventListener("click", 누름);
    return () => {
      판.removeEventListener("click", 누름);
      판.remove();
      판참조.current = null;
    };
  }, []);

  // 내용만 갱신
  useEffect(() => {
    const 판 = 판참조.current;
    if (!판) return;
    const 색 = 저장중
      ? "#9AA3B2"
      : 붙었나 === false
        ? "#FF8A80"
        : 안한변경
          ? "#FFD166"
          : "#9BE3B4";
    const 글 = 저장중
      ? "저장 중…"
      : 붙었나 === false
        ? "저장 불가 — 서버 재시작"
        : 안한변경
          ? `저장하기 (변경 ${변경수})`
          : 변경수 > 0
            ? `저장됨 (${변경수})`
            : "변경 없음";
    const 각 =
      ((((((고른것?.회전 ?? 0) * 180) / Math.PI) % 360) + 360) % 360) | 0;
    판.innerHTML =
      '<b style="color:#FFD166">편집 모드</b>' +
      '<span style="opacity:.75"> · 클릭·드래그 고르고 옮기기 · 우클릭 드래그 시점 · WASD 걷기</span><br>' +
      '<span style="opacity:.75">방향키 밀기(Shift 크게) · R 회전 · [ ] 크기 · ' +
      "Ctrl+C/V 복사·붙여넣기 · X 지우기 · Ctrl+Z 되돌리기 · ESC 해제</span>" +
      (고른것
        ? `<br><span style="color:#9BE3B4">${고른것.이름} #${고른것.번호}</span>` +
          `<span style="color:#C9CEDA">  (${고른것.x.toFixed(1)}, ${고른것.z.toFixed(1)})` +
          ` · 키 ${고른것.키.toFixed(1)} m · ∠ ${각}°</span>`
        : "") +
      '<div style="margin-top:8px;display:flex;align-items:center;gap:8px">' +
      `<button id="naju-저장버튼" type="button"${저장중 ? " disabled" : ""} ` +
      'style="pointer-events:auto;cursor:pointer;font:inherit;color:#12161F;' +
      `background:${색};border:none;border-radius:6px;padding:5px 12px;font-weight:700">` +
      `${글}</button>` +
      '<span style="opacity:.6">또는 Ctrl+S</span></div>' +
      (알림
        ? `<div style="margin-top:6px;color:${알림.startsWith("✘") ? "#FF8A80" : "#FFD166"}">${알림}</div>`
        : "") +
      (붙었나 === false
        ? '<div style="margin-top:4px;color:#FF8A80">개발 서버에 저장 기능이 없다 — ' +
          "<b>npx vite naju01</b> 을 다시 띄워라</div>"
        : "");
  }, [알림, 고른것, 안한변경, 변경수, 저장중, 붙었나]);

  return null;
}
