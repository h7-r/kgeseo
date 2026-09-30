// 캐릭터 생성 화면의 3D 무대.
//
// [화면 전체가 하나의 공간이다]
//   캔버스는 **투명**하다. 배경은 그 아래 CSS 그라데이션 한 덩이가 화면 끝까지 그리고,
//   캔버스는 캐릭터와 접지 그림자만 얹는다. 그래서 헤더·패널 뒤로도 같은 공간이 이어지고,
//   캔버스 테두리나 검은 사각형이 공간을 자르지 않는다.
//   ※ 예전에는 gl.setClearColor(..., 1) 로 캔버스를 불투명하게 칠해 아래 배경이 통째로 가려졌다.
//
// [무엇을 재사용하나]
//   게임과 같은 렌더러(치비게임아바타)·같은 모델·같은 툰 재질. 여기서는 관찰용 카메라와 빛,
//   그리고 모델 교체 대기만 얹는다.
//
// [왜 '예열' 을 따로 두나]
//   성별·옷을 바꾸면 전신 GLB 를 새로 읽는다(10~15MB). 그냥 갈아 끼우면 읽는 동안 Suspense 가
//   캐릭터를 지워 화면이 빈다. 새 모델을 먼저 조용히 읽고, 다 읽힌 뒤에 보여 주는 착장을 바꾼다.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import ChibiGameAvatar from "../치비게임아바타.jsx";
import { 메시모델파일, 메시신발파일 } from "../메시외형옵션.js";
import { 기본툰 } from "../툰재질.js";

// 생성 화면 전용 툰 설정 — 명암 계단 경계를 아주 조금 풀어 준다.
//   캐릭터를 얼굴까지 확대해 보는 화면이라, 딱 떨어지는 계단이 낮은 폴리곤의 삼각형 모서리를 따라
//   꺾여 목선에서 톱니로 보였다. 게임 화면은 기본값(0) 그대로다.
const 생성툰 = { ...기본툰, 부드럼: 0.06 };

export const 보기목록 = [["전신", "전신"], ["머리", "머리"], ["손", "손"], ["발", "발"]];

// 이용자에게 보여 줄 자세는 게임에서 실제로 쓰는 것만 둔다(T포즈 같은 작업용 자세는 뺀다).
export const 자세목록 = [["Idle_Loop", "대기"], ["Walk_Loop", "걷기"]];

export const 품질목록 = [["낮음", "낮음"], ["보통", "보통"], ["높음", "높음"]];

// 손을 볼 때만 팔을 벌린 자세로 바꾼다 — 허리에 손을 얹은 대기 자세는 손을 가린다.
// 이용자가 고르는 값이 아니라 관찰을 위한 내부 전환이다.
// ★ **걷기를 고른 동안에는 바꾸지 않는다.**
//   걷는 자세는 팔이 앞뒤로 흔들려 손이 이미 다 보인다. 그런데도 T포즈로 갈아
//   끼우면 이용자가 골라 둔 걷기가 손 보기에서만 멋대로 멈춘다 — 「계속 걷는
//   상태로 고르고 바꾸고 싶다」는 요구와 정면으로 어긋난다.
//   그래서 대기(Idle_Loop)일 때만 손을 보려고 팔을 벌린다.
export function 관찰자세(보기, 자세) {
  return 보기 === "손" && 자세 === "Idle_Loop" ? "A_TPose" : 자세;
}

// ── 화질 ─────────────────────────────────────────────────────────────
// ★ `보통` 의 dpr 을 1.5 → 1.25 로 내렸다.
//   [근거] 정지 프레임 30~43ms 중 **dpr 을 1 로 내리면 15.7ms 가 빠진다**(실측).
//   그런데 3D 자체는 `gl.finish` 로 재면 **0.4ms** 뿐이다 — 그 비용은 그리기가
//   아니라 **투명 캔버스를 화면에 합성하는 값**이다(픽셀 수에 그대로 비례한다).
//   1.25 는 눈에 띄는 흐려짐 없이 픽셀을 30% 줄인다. 또렷한 쪽을 원하면
//   「관찰 옵션 › 화질 › 높음」이 그대로 있다.
const 품질값 = {
  낮음: { dpr: [1, 1], 그림자: 256, 흐림: 2.2 },
  보통: { dpr: [1, 1.25], 그림자: 512, 흐림: 2.6 },
  높음: { dpr: [1, 2], 그림자: 1024, 흐림: 3.0 },
};

export function 파일열쇠만들기(설정) {
  return `${설정.gender}|${설정.top}|${설정.bottom}|${설정.shoes}`;
}

// ── 다음에 고를 옷을 **미리 받아 둔다** ─────────────────────────────────
// [왜]
//   옷은 파츠가 아니라 전신 GLB 를 통째로 갈아 끼우는 방식이라, 처음 고르는
//   조합은 9.5~14.7MB 를 그 자리에서 받는다(몇 초). 그동안 화면은 예전 모습
//   그대로라 "눌렀는데 안 바뀐다" 로 보였다. 그래서 예전에는 「불러오는 중」
//   배지를 띄웠는데, 그건 기다림을 **설명**할 뿐 없애지 못한다.
// [무엇을 하나]
//   한 벌을 보여 준 뒤 한가해지면, 그 성별이 고를 수 있는 **나머지 조합**을
//   조용히 받아 둔다. 두 번째부터는 누르는 즉시 바뀐다.
// ★ 성별이 바뀌면 그 성별 것으로 다시 잡는다. 반대 성별까지 미리 받지는
//   않는다 — 100MB 를 다 받을 이유가 없고, 성별은 자주 오가지 않는다.
// ★ **한 번에 하나씩, 한가할 때만** 받는다.
//   [겪은 것] 여덟 개를 한꺼번에 preload 했더니 브라우저의 동시 연결(6개)이
//   꽉 차서, 바로 그때 이용자가 누른 옷의 응답이 **3.0초**나 밀렸다(실측).
//   미리 받기가 첫 선택을 더 느리게 만드는 역효과였다.
//   그래서 ① 내려받기를 하나 끝내고 다음으로 가고 ② 그 사이사이를
//   `requestIdleCallback` 으로 띄워 이용자가 만지는 동안에는 쉬게 한다.
//   작은 신발부터 받아 두면 몸이 오는 동안 짝이 준비된다.
const 조합들 = [
  { top: -1, bottom: -1 },
  { top: 0, bottom: -1 },
  { top: -1, bottom: 0 },
  { top: 0, bottom: 0 },
];
const 한가할때 = (일) => {
  if (typeof requestIdleCallback === "function") return requestIdleCallback(() => 일(), { timeout: 6000 });
  return setTimeout(일, 900);
};
function 미리받기시작(성별, 살아있나, 건너뛸열쇠) {
  // 파일 이름은 성별·상의·하의 조합만 본다(신발 번호는 파일을 안 가른다).
  const [옛성별, 옛상의, 옛하의] = String(건너뛸열쇠 ?? "").split("|");
  const 목록 = [];
  조합들.forEach((c) => {
    // 지금 보고 있는 조합은 이미 손에 있다 — 건너뛴다.
    if (성별 === 옛성별 && String(c.top) === 옛상의 && String(c.bottom) === 옛하의) return;
    const 설정 = { gender: 성별, ...c, shoes: 0 };
    목록.push(메시신발파일(설정), 메시모델파일(설정));
  });
  const 한걸음 = () => {
    if (!살아있나()) return;
    const 길 = 목록.shift();
    if (!길) return;
    try {
      // 받아서 **풀어 두기까지** 한다 — 내려받기만 해 두면 고를 때 해석(0.5초)을
      //   그대로 치른다. preload 는 끝을 알려 주지 않으므로, 한 개가 오갈 만큼
      //   띄웠다가 다음으로 간다(연결을 몰아 쓰지 않으려는 것이라 정확할 필요는 없다).
      useGLTF.preload(길);
    } catch {
      /* 미리 받기는 실패해도 화면은 그대로 돈다 */
    }
    setTimeout(() => 한가할때(한걸음), 1200);
  };
  한가할때(한걸음);
}

function 열쇠풀기(열쇠) {
  const [gender, top, bottom, shoes] = 열쇠.split("|");
  return { gender, top: Number(top), bottom: Number(bottom), shoes: Number(shoes) };
}

// 아바타는 게임 플레이어 상태를 읽는다. 생성 화면에는 플레이어가 없으니 '가만히 서 있는' 상태를 준다.
function 정지상태() {
  return {
    position: new THREE.Vector3(),
    footY: 0,
    groundY: 0,
    facing: 0,
    moving: false,
    running: false,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
    speed: 0,
    attackSerial: 0,
    attackMotion: "Punch_Jab",
  };
}

function CC모델예열({ 설정, 열쇠, 알림 }) {
  const 몸 = 메시모델파일(설정);
  const 신발 = 메시신발파일(설정);
  useGLTF(몸);
  useGLTF(신발);
  useEffect(() => {
    알림(열쇠);
  }, [알림, 열쇠, 몸, 신발]);
  return null;
}

// ── 캐릭터를 감싸는 상자 — **정점을 훑지 않고** 잰다 ────────────────────
// [무엇이 문제였나]
//   `new THREE.Box3().setFromObject(무리)` 한 줄이 옷을 갈아입을 때마다 **0.5초**를
//   먹고 있었다. three 의 `expandByObject` 는 객체에 `boundingBox` 칸이 있으면
//   `object.computeBoundingBox()` 를 부르는데, **SkinnedMesh 의 그것은 정점을 하나씩
//   돌며 모프 10개를 섞고 뼈 4개로 스키닝까지 해 보는 함수**다. 몸은 정점이 9.8만
//   개라 한 번에 576ms 가 나갔다(실측 — 프로파일 자기시간 1위).
//   게다가 옷을 갈아입으면 메시가 새로 만들어져 `boundingBox` 가 다시 비므로,
//   **갈아입을 때마다** 그 값을 치렀다.
// [어떻게 고쳤나]
//   지오메트리의 상자(`geometry.boundingBox`)를 세계 행렬로 옮겨 합친다.
//   · 지오메트리 상자는 **한 번 구우면 지오메트리에 남는다.** 지오메트리는 GLB
//     캐시가 들고 있어 같은 옷으로 돌아와도 다시 굽지 않는다.
//   · 스키닝·모프를 안 본다 → 쉴 때 자세 기준의 상자다. 카메라 잡는 용도라
//     그게 오히려 낫다(동작에 따라 상자가 흔들리면 화면이 미세하게 출렁인다).
const _조각상자 = new THREE.Box3();
function 무리상자(무리, 받을상자) {
  받을상자.makeEmpty();
  무리.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    if (!b) return;
    _조각상자.copy(b).applyMatrix4(o.matrixWorld);
    받을상자.union(_조각상자);
  });
  return 받을상자;
}

// 씬에서 캐릭터를 찾아 크기와 주요 부위 위치를 잰다. 카메라를 어디에 둘지 정하는 데만 쓴다.
const _잰상자 = new THREE.Box3();
function 캐릭터재기(scene, 키배율) {
  let 무리 = null;
  scene.traverse((o) => {
    if (!무리 && o.name === "NAJU-chibi-avatar" && o.visible) 무리 = o;
  });
  if (!무리) return null;
  무리.updateWorldMatrix(false, true);
  const 상자 = 무리상자(무리, _잰상자);
  if (상자.isEmpty() || !Number.isFinite(상자.min.y)) return null;
  const 높이 = 상자.max.y - 상자.min.y;
  if (!(높이 > 0.05)) return null;
  let 뼈대 = null;
  무리.traverse((o) => {
    if (!뼈대 && o.isSkinnedMesh) 뼈대 = o.skeleton;
  });
  const 자리 = (이름) => {
    const b = 뼈대?.getBoneByName(이름);
    return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null;
  };
  const 손왼 = 자리("hand_l");
  const 손오 = 자리("hand_r");
  return {
    높이,
    // 키 배율을 뺀 '기본 키'. 키를 줄였을 때 카메라까지 따라 당겨지면 변화가 안 보인다.
    기준높이: 높이 / Math.max(0.01, 키배율),
    머리: 자리("head") ?? new THREE.Vector3(0, 높이 * 0.88, 0),
    손: 손왼 && 손오 ? 손왼.clone().add(손오).multiplyScalar(0.5) : new THREE.Vector3(0, 높이 * 0.5, 0),
    손폭: 손왼 && 손오 ? 손왼.distanceTo(손오) : 높이 * 0.6,
    발: new THREE.Vector3(0, 상자.min.y + 높이 * 0.05, 0),
    가슴: 자리("spine_03") ?? new THREE.Vector3(0, 높이 * 0.66, 0),
  };
}

// 어느 부위를 얼마나 크게 담을지.
function 담을것(보기, 잰값) {
  const H = 잰값.기준높이;
  if (보기 === "머리") return { 중심: 잰값.머리.clone(), 높이: H * 0.30 };
  // 손은 좌우를 함께 봐야 비교가 된다 — 두 손 사이 거리에 맞춰 물러난다.
  if (보기 === "손") return { 중심: 잰값.손.clone(), 높이: Math.max(H * 0.34, 잰값.손폭 * 1.05) };
  if (보기 === "발") return { 중심: 잰값.발.clone(), 높이: H * 0.26 };
  // 이름 단계 — 가슴만 담으면 머리가 잘린다. 가슴과 머리 사이를 중심으로 잡고 넉넉히 담는다.
  if (보기 === "상반신") return { 중심: 잰값.가슴.clone().lerp(잰값.머리, 0.55), 높이: H * 0.62 };
  // 전신은 키를 키운 만큼만 더 담는다(줄일 때는 그대로 둬야 작아진 것이 보인다).
  return { 중심: new THREE.Vector3(0, H * 0.5, 0), 높이: H * 1.08 * Math.max(1, 잰값.높이 / H) };
}

// 카메라를 궤도 위에 놓고, **UI 를 뺀 빈 자리**의 한가운데에 캐릭터를 담는다.
//   안전영역 = 좌·우·상·하로 UI 가 덮는 픽셀. 패널 폭이 달라져도 머리·손·발이 그 뒤로 숨지 않는다.
function CC카메라({ 조작, 보기, 키배율, 안전영역, 덜움직이기, 측정열쇠 }) {
  // three 객체는 반응형 값으로 잡지 않고 필요할 때 꺼내 쓴다(보행비교 GAIT카메라와 같은 방식).
  const get = useThree((s) => s.get);
  const 상태 = useRef({ 중심: new THREE.Vector3(0, 0.9, 0), 담을높이: 1.9, 채움: false });
  const 바람 = useRef({ 중심: new THREE.Vector3(0, 0.9, 0), 높이: 1.9 });
  const 키 = useRef(1);
  const 안전 = useRef(안전영역);
  const 셈 = useRef(0);
  const 주광 = useRef();
  const 보조광 = useRef();

  useEffect(() => {
    키.current = 키배율;
  }, [키배율]);
  useEffect(() => {
    안전.current = 안전영역;
  }, [안전영역]);

  // ── 부위를 바꾼 뒤에는 **잠깐 동안 계속 다시 잰다** ────────────────────
  // [무엇이 문제였나]
  //   `손` 보기를 고르면 자세가 대기(허리에 손)에서 팔을 벌린 자세로 **바뀐다**
  //   (관찰자세). 그런데 카메라는 고른 그 순간에 한 번만 쟀다 — 아직 팔이
  //   허리에 있는 자세의 손 좌표를 담아 버린 것이다. 자세가 다 바뀌고 나면
  //   손은 그 자리에 없다. 통통 극단에서는 **손이 화면 밖으로 나갔다**(실측).
  // [어떻게] 부위·착장이 바뀌면 다시 재야 할 프레임 수를 세어 둔다. 자세가
  //   건너가는 0.5초 남짓 동안 계속 따라가다가 멎는다. 전신 보기는 예전처럼
  //   키 슬라이더를 따라가야 하므로 늘 다시 잰다(아래 useFrame).
  const 다시잴프레임 = useRef(0);
  useEffect(() => {
    const { scene } = get();
    다시잴프레임.current = 40; // 10프레임마다 재니 40프레임 ≈ 0.7초
    const 잰값 = 캐릭터재기(scene, 키.current);
    if (!잰값) return;
    바람.current = 담을것(보기, 잰값);
    if (!상태.current.채움 || 덜움직이기) {
      상태.current.중심.copy(바람.current.중심);
      상태.current.담을높이 = 바람.current.높이;
      상태.current.채움 = true;
    }
  }, [보기, 측정열쇠, get, 덜움직이기]);

  useFrame((_, delta) => {
    const { camera, scene, size } = get();
    const s = 상태.current;
    셈.current += 1;
    if (다시잴프레임.current > 0) 다시잴프레임.current -= 1;
    // 전신은 키 슬라이더를 따라가야 해서 늘, 그 밖의 부위는 자세가 건너가는
    //   동안만 다시 잰다(위 「잠깐 동안 계속 다시 잰다」).
    if ((!s.채움 || 보기 === "전신" || 다시잴프레임.current > 0) && 셈.current % 10 === 0) {
      const 잰값 = 캐릭터재기(scene, 키.current);
      if (잰값) {
        바람.current = 담을것(보기, 잰값);
        if (!s.채움) {
          s.중심.copy(바람.current.중심);
          s.담을높이 = 바람.current.높이;
          s.채움 = true;
        }
      }
    }
    const 비율 = 덜움직이기 ? 1 : 1 - Math.exp(-delta * 7);
    s.중심.lerp(바람.current.중심, 비율);
    s.담을높이 += (바람.current.높이 - s.담을높이) * 비율;

    // 1) UI 를 뺀 빈 자리
    const a = 안전.current;
    const 폭px = Math.max(160, size.width - a.왼쪽 - a.오른쪽);
    const 높이px = Math.max(160, size.height - a.위 - a.아래);
    // 2) 그 자리에 담을 높이 → 화면 전체가 보여야 하는 세계 높이 → 거리
    const 세계높이 = s.담을높이 * (size.height / 높이px);
    const 거리 = (세계높이 / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 조작.current.줌;
    const 세계폭 = 세계높이 * (size.width / size.height);

    // 3) 궤도 위 카메라
    const { 좌우, 위아래 } = 조작.current;
    const 높이각 = THREE.MathUtils.clamp(위아래, -0.40, 0.75);
    const 앞 = new THREE.Vector3(
      Math.sin(좌우) * Math.cos(높이각),
      Math.sin(높이각),
      Math.cos(좌우) * Math.cos(높이각),
    );
    const 자리 = s.중심.clone().addScaledVector(앞, 거리);
    // 4) 빈 자리의 한가운데로 화면을 옮긴다(카메라와 목표를 같이 밀면 시선 방향은 그대로다).
    const cx = (a.왼쪽 + 폭px / 2) / size.width - 0.5;
    const cy = 0.5 - (a.위 + 높이px / 2) / size.height;
    // 앞 = 목표에서 카메라로 가는 방향이라 **시선은 그 반대**다. 화면 오른쪽은 cross(위, 앞) 이다.
    //   (cross(앞, 위) 로 잡으면 좌우가 뒤집혀 캐릭터가 UI 쪽으로 밀려간다.)
    const 오른 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), 앞).normalize();
    const 위 = new THREE.Vector3().crossVectors(앞, 오른).normalize();
    const 밀기 = 오른.clone().multiplyScalar(-cx * 세계폭).add(위.clone().multiplyScalar(-cy * 세계높이));
    const 목표 = s.중심.clone().add(밀기);
    자리.add(밀기);

    camera.position.set(자리.x, Math.max(0.1, 자리.y), 자리.z);
    camera.lookAt(목표);
    camera.near = Math.max(0.05, 거리 * 0.05);
    camera.far = 거리 * 14 + 24;
    camera.updateProjectionMatrix();

    // 5) 빛 — 공간의 빛 방향은 고정하고 보조광만 카메라를 따라간다.
    //    전부 카메라에 붙이면 어느 각도에서나 평평해져 얼굴 굴곡이 사라진다.
    if (주광.current) {
      주광.current.target.position.copy(s.중심);
      주광.current.target.updateMatrixWorld();
    }
    if (보조광.current) {
      보조광.current.position.copy(camera.position).addScaledVector(위, 0.4);
      보조광.current.target.position.copy(s.중심);
      보조광.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      {/* 주광 — 왼쪽 위 앞. 얼굴과 몸의 굴곡을 만든다. */}
      <directionalLight ref={주광} position={[-2.4, 3.4, 2.6]} intensity={1.30} color="#FFF6EA" />
      {/* 윤곽광 — 뒤 오른쪽. 머리·어깨를 배경에서 떼어 낸다. */}
      <directionalLight position={[2.6, 2.2, -3.0]} intensity={0.85} color="#9AD8E8" />
      {/* 보조광 — 카메라를 따라가며 그림자 쪽이 검게 죽지 않을 만큼만 채운다. */}
      <directionalLight ref={보조광} intensity={0.28} color="#CFE6F2" />
      <hemisphereLight args={["#DCEAF5", "#1A2B38", 0.46]} />
      <ambientLight intensity={0.18} />
    </>
  );
}

function CC보임감시({ 바뀜 }) {
  useEffect(() => {
    const 듣기 = () => 바뀜(!document.hidden);
    document.addEventListener("visibilitychange", 듣기);
    return () => document.removeEventListener("visibilitychange", 듣기);
  }, [바뀜]);
  return null;
}

// 개발용 손잡이 — 헤드리스 검사에서 씬을 직접 재려고 연다.
function CC손잡이({ 표시열쇠 }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
    window.__캐릭터생성 = { get, THREE, 표시열쇠 };
    return () => { delete window.__캐릭터생성; };
  }, [get, 표시열쇠]);
  return null;
}

export default function CC캐릭터프리뷰({
  설정,
  보기 = "전신",
  자세 = "Idle_Loop",
  품질 = "보통",
  안전영역 = { 왼쪽: 0, 오른쪽: 0, 위: 0, 아래: 0 },
  조작알림,
  읽는중알림,
}) {
  const 상태참조 = useRef(정지상태());
  // 카메라 조작값은 이 컴포넌트가 들고 있고, 바깥(도크 단추)에는 손잡이만 넘긴다.
  //   ※ 바깥에서 받은 ref 를 여기서 바꾸면 리액트 규칙 검사에 걸린다(그리고 추적이 어렵다).
  const 조작 = useRef({ 좌우: -0.30, 위아래: 0.06, 줌: 1 });
  const 끌기 = useRef(null);
  const 손가락 = useRef(new Map());
  const 벌림 = useRef(0);
  const 감쌈 = useRef(null);
  const 파일열쇠 = 파일열쇠만들기(설정);
  const [표시열쇠, set표시열쇠] = useState(파일열쇠);
  const [보임, set보임] = useState(() => typeof document === "undefined" || !document.hidden);

  const 덜움직이기 = useMemo(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  const 표시설정 = useMemo(() => ({ ...설정, ...열쇠풀기(표시열쇠) }), [설정, 표시열쇠]);
  const 읽는중 = 파일열쇠 !== 표시열쇠;

  useEffect(() => {
    읽는중알림?.(읽는중);
  }, [읽는중, 읽는중알림]);

  // 보여 줄 한 벌이 붙고 한가해지면 나머지 조합을 한 개씩 미리 받는다
  //   (위 「한 번에 하나씩」). 성별이 바뀌면 옛 줄은 멈추고 새 성별로 다시 건다.
  const 성별 = 설정.gender;
  useEffect(() => {
    let 살아있음 = true;
    미리받기시작(성별, () => 살아있음, 표시열쇠);
    return () => { 살아있음 = false; };
    // 표시열쇠는 '지금 보고 있는 것'을 건너뛰는 데만 쓴다 — 바뀔 때마다 다시 걸 필요는 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [성별]);

  const 예열끝 = useCallback((열쇠) => {
    set표시열쇠((이전) => (열쇠 === 이전 ? 이전 : 열쇠));
  }, []);

  useEffect(() => {
    조작알림?.({
      돌리기: (라디안) => { 조작.current.좌우 += 라디안; },
      초기화: () => { 조작.current = { 좌우: -0.30, 위아래: 0.06, 줌: 1 }; },
    });
  }, [조작알림]);

  const 줌바꾸기 = useCallback((배) => {
    조작.current.줌 = THREE.MathUtils.clamp(조작.current.줌 * 배, 0.45, 2.2);
  }, []);

  useEffect(() => {
    const 요소 = 감쌈.current;
    if (!요소) return undefined;
    const 휠 = (e) => {
      e.preventDefault();
      줌바꾸기(Math.exp(e.deltaY * 0.0012));
    };
    요소.addEventListener("wheel", 휠, { passive: false });
    return () => 요소.removeEventListener("wheel", 휠);
  }, [줌바꾸기]);

  const 두손가락거리 = () => {
    const [a, b] = [...손가락.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const 누름 = (e) => {
    손가락.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (손가락.current.size === 2) 벌림.current = 두손가락거리();
    else 끌기.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const 움직임 = (e) => {
    if (!손가락.current.has(e.pointerId)) return;
    손가락.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (손가락.current.size >= 2) {
      const 새 = 두손가락거리();
      if (벌림.current > 0 && 새 > 0) 줌바꾸기(벌림.current / 새);
      벌림.current = 새;
      return;
    }
    if (!끌기.current) return;
    const dx = e.clientX - 끌기.current.x;
    const dy = e.clientY - 끌기.current.y;
    끌기.current = { x: e.clientX, y: e.clientY };
    조작.current.좌우 -= dx * 0.008;
    조작.current.위아래 = THREE.MathUtils.clamp(조작.current.위아래 + dy * 0.005, -0.40, 0.75);
  };
  const 뗌 = (e) => {
    손가락.current.delete(e.pointerId);
    if (손가락.current.size < 2) 벌림.current = 0;
    if (손가락.current.size === 0) 끌기.current = null;
  };

  const 품질설정 = 품질값[품질] ?? 품질값.보통;
  const 실제자세 = 관찰자세(보기, 자세);
  // ★ 아바타에 넘기는 설정은 **memo 로 묶는다.**
  //   JSX 안에서 `설정={{ ...표시설정, motion: 실제자세 }}` 로 만들면 렌더마다 새 객체가
  //   되어, 값이 하나도 안 바뀐 프레임에도 아바타 쪽 `설정` 의존 효과가 다시 돌았다.
  const 아바타설정 = useMemo(() => ({ ...표시설정, motion: 실제자세 }), [표시설정, 실제자세]);

  return (
    <div
      ref={감쌈}
      style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab" }}
      onPointerDown={누름}
      onPointerMove={움직임}
      onPointerUp={뗌}
      onPointerCancel={뗌}
    >
      <Canvas
        shadows={false}
        frameloop={보임 ? "always" : "never"}
        dpr={품질설정.dpr}
        camera={{ fov: 30, position: [0, 1, 3.6], near: 0.1, far: 60 }}
        // 캔버스는 투명하다 — 아래 CSS 배경이 화면 전체에 그대로 이어져야 한다.
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl, scene }) => {
          gl.setClearAlpha(0);
          scene.background = null;
        }}
        style={{ background: "transparent" }}
      >
        <CC보임감시 바뀜={set보임} />
        <CC손잡이 표시열쇠={표시열쇠} />
        <CC카메라
          조작={조작}
          보기={보기}
          키배율={표시설정.heightScale ?? 1}
          안전영역={안전영역}
          덜움직이기={덜움직이기}
          측정열쇠={표시열쇠}
        />
        <Suspense fallback={null}>
          <ChibiGameAvatar 보이기 플레이어참조={상태참조} 설정={아바타설정} 크기={1} 몸체="meshy" 툰={생성툰} />
          {/* 접지 — 발 밑은 또렷하고 둘레로 넓게 흐려진다. 두 장을 겹쳐 '검은 원 한 장' 을 피한다.
              매 프레임 다시 굽는다(frames=1 로 캐시하면 걷는 동안 그림자가 멈춘다). */}
          {/* ── 접지 그림자 두 장 ──────────────────────────────────────
                 발 밑은 또렷하게, 둘레는 넓고 흐리게 — 두 장을 겹쳐 '검은 원
                 한 장'을 피한다. 매 프레임 다시 굽는다(frames=1 로 캐시하면
                 걷는 동안 그림자가 멈춘다).
              ★ 넓은 쪽은 **해상도를 반의반으로** 줄였다.
                 [근거] 이 둘이 프레임마다 씬을 10번 더 그려서 정지 프레임의
                 25~30%(9.3~10.3ms)를 먹는다(실측). 그런데 넓은 쪽은 blur 4.5 로
                 흐려 놓는 장이라 해상도가 화면에 드러나지 않는다 — 여기서 줄이는
                 것이 보이는 것을 하나도 잃지 않고 비용만 깎는 자리다. */}
          <ContactShadows position={[0, 0.002, 0]} opacity={0.5} scale={3.2} blur={품질설정.흐림} far={1.6}
                          resolution={품질설정.그림자} color="#04080E" />
          <ContactShadows position={[0, 0.001, 0]} opacity={0.24} scale={7} blur={4.5} far={2.4}
                          resolution={Math.max(96, Math.round(품질설정.그림자 / 4))} color="#04080E" />
        </Suspense>
        <Suspense fallback={null}>
          <CC모델예열 설정={설정} 열쇠={파일열쇠} 알림={예열끝} key={파일열쇠} />
        </Suspense>
      </Canvas>
    </div>
  );
}
