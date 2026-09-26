// ═══════════════════════════════════════════════════════════════
//  App.jsx — NAJU-01 그레이박스 껍데기
// ═══════════════════════════════════════════════════════════════
// 본편(../../src/App.jsx)의 껍데기와 같은 구성이다 —
//   Leva 패널 · Canvas 설정(그림자·dpr·gl·카메라) · T 키로 시작 · 조준점.
// 다른 점은 씬이 하나뿐이라 라우터가 없고, 계기판이 그레이박스 전용이라는 것뿐이다.
// ※ 본편 파일은 읽기만 한다. 이 폴더는 본편을 한 줄도 고치지 않는다.

import { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Preload } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Leva } from "leva";
import 공간그레이박스 from "./scenes/공간그레이박스.jsx";
import { 계기판, 조작안내 } from "./계기.jsx";
import { 미터, 기준, 시점 } from "./공간도면.js";
import { 기본지형 } from "./지형.js";
import 사이드킥꾸미기패널 from "./사이드킥꾸미기패널.jsx";
import { 사이드킥외형읽기 } from "./사이드킥옵션.js";
import 치비테스트패널 from "./치비테스트패널.jsx";
import { 메시외형읽기 } from "./메시외형옵션.js";
import { 기본툰 } from "./툰재질.js";
import { 기본외곽선 } from "./툰외곽선.js";

// 본편과 같은 개발용 스위치 — ?q=low · ?leva=1 · ?fx=off
const 쿼리 =
  typeof location !== "undefined"
    ? new URLSearchParams(location.search)
    : new URLSearchParams();
const 저사양 = 쿼리.get("q") === "low";
const LEVA보임 = import.meta.env.DEV || 쿼리.has("leva");
const 후처리끄기 = 쿼리.get("fx") === "off";
// 후처리 안의 개별 효과를 하나씩 끄고 비교하는 스위치.
//   ?bloom=off · ?vig=off · ?tm=on
//   ※ 이 스위치들이 있어야 "화면이 어두운데 뭐 때문이지"를 **한 번에 하나씩** 가릴 수 있다.
//     실제로 이걸 만들고 나서야 원인이 Bloom 이라는 걸 알았다.
const 블룸끄기 = 쿼리.get("bloom") === "off";
const 비네트끄기 = 쿼리.get("vig") === "off";
const 톤매핑켜기 = 쿼리.get("tm") === "on";
// ?fb=half — 후처리 버퍼를 반정밀도(HalfFloat)로 되돌려 아래 증상을 재현해 본다.
const 반정밀도버퍼 = 쿼리.get("fb") === "half";
// 무대 — 기본은 창을 꽉 채운다. ?stage=16x9 면 본편과 같은 레터박스(§4 시야 검증용).
const 무대16x9 = 쿼리.get("stage") === "16x9";
// ── 화면 배율(dpr) 상한 ────────────────────────────────────
// [무엇인가]  2 면 가로·세로 두 배 = **그릴 픽셀이 네 배**다. 레티나에서는
//   기본이 2 라, 화면을 네 번 칠하고 있는 셈이다.
// [왜 손잡이로 두나]  이 씬의 꾸준한 비용은 **픽셀 수에 정비례한다** —
//   화면 절반 이상이 땅이고, 그 땅은 픽셀마다 삼면 노이즈를 세 번 돌린다
//   (공간그레이박스 `바닥결` 주석). 1.5 로만 낮춰도 픽셀이 44 % 준다.
// [기본은 2 — 지금 화면 그대로다.]  `?dpr=1.5` · `?dpr=1` 로 견줘 보고
//   눈에 띄는 차이가 없으면 기본값을 내리면 된다.
const 배율상한 = Math.min(3, Math.max(1, +(쿼리.get("dpr") || 2) || 2));

// 시작 카메라 — V1 자리, 도면 기본값 기준.
//   Leva 에 저장된 값이 다르면 첫 프레임에 씬이 알아서 다시 앉힌다.
const 시작 = 시점[0];
const 시작높이 = (기본지형.지면(시작.X, 시작.Z).y + 기준.눈높이) * 미터;
// 꾸미기 패널은 개발용이다. 개발 서버이거나 ?customize 가 있을 때만 보인다.
const 꾸미기패널보임 = import.meta.env.DEV || 쿼리.has("customize");
// 3인칭 캐릭터 — 기본은 Meshy 캐릭터, ?avatar=sidekick 이면 예전 사이드킥.
const 사이드킥으로 = 쿼리.get("avatar") === "sidekick";
// 애니메이션풍 렌더 — 기본 켬. ?toon=off / ?outline=off 로 원본 PBR 과 비교한다.
const 툰끄기 = 쿼리.get("toon") === "off";
const 외곽선끄기 = 쿼리.get("outline") === "off";
// 캐릭터는 툰으로 두고 세계만 원본 질감으로 되돌려 비교할 때 ?worldtoon=off
const 세계툰끄기 = 쿼리.get("worldtoon") === "off";
const 메시저장키 = "naju01.meshy.appearance.v1";
const 사이드킥저장키 = "naju01.sidekick.appearance.v2";
// v1은 성별·새 의상 번호가 없던 저장값이다. v2가 없으면 v1을 읽어 보정한다.
const 이전저장키 = "naju01.sidekick.appearance.v1";

export default function App() {
  const controlsRef = useRef(null);
  const 보고 = useRef(null); // 씬 → 계기판으로 넘기는 상자(리렌더 없이)
  const [locked, setLocked] = useState(false);
  const [시점모드, set시점모드] = useState("1인칭");
  const [사이드킥설정, set사이드킥설정] = useState(() => 사이드킥외형읽기(사이드킥저장키, 이전저장키));
  const [메시설정, set메시설정] = useState(() => (사이드킥으로 ? null : 메시외형읽기(메시저장키)));
  const [툰설정, set툰설정] = useState(() => ({ ...기본툰, 켬: !툰끄기, 세계: !세계툰끄기 }));
  const [외곽선설정, set외곽선설정] = useState(() => ({ ...기본외곽선, 켬: !외곽선끄기 }));
  // 계기판·조작안내는 화면을 꽤 가린다. 그림을 볼 때는 H 로 치운다.
  const [계기보임, set계기보임] = useState(true);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "KeyT" && !locked) controlsRef.current?.lock();
      if (e.code === "KeyH" && !e.repeat) set계기보임((v) => !v);
      // 시점 전환은 카메라 회전값을 만지지 않는다. 보는 방향이 틀어지는 문제를
      // 피하기 위해 맵 전용 캐릭터 표시만 켜고 끈다.
      // ★ 수식키가 눌린 V 는 **인칭 전환이 아니다.**
      //   ⌘V / Ctrl+V 는 편집기의 붙여넣기다(편집기.jsx). 가드가 없어서
      //   붙여넣기를 누르면 붙지는 않고 시점만 1인칭↔3인칭으로 뒤집혔다.
      //   같은 파일의 `KeyE` 는 이미 이 가드를 쓰고 있었다.
      if (
        e.code === "KeyV" &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      )
        set시점모드((v) => (v === "1인칭" ? "3인칭" : "1인칭"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  return (
    <div
      className={`stage${무대16x9 ? " 무대16x9" : ""}`}
      style={{ position: "relative" }}
    >
      <Leva hidden={!LEVA보임} theme={{ sizes: { numberInputMinWidth: "68px" } }} />
      <Canvas
        shadows={저사양 ? false : "percentage"}
        dpr={저사양 ? 1 : [1, 배율상한]}
        gl={{
          antialias: !저사양 && 후처리끄기,
          toneMappingExposure: 1.15,
          // 900 m 밖 산줄기까지 그리려면 far 를 크게 잡아야 하는데, 그러면
          // 가까운 것들의 깊이 정밀도가 무너져 면이 서로 뚫고 나온다.
          // 로그 깊이 버퍼가 그 문제를 없앤다.
          logarithmicDepthBuffer: true,
          powerPreference: "high-performance",
        }}
        /* far — 본편은 400 유닛이면 됐지만(실내), 여기는 야외다.
           §4 가 V1 에서 「건너편 뱃길」을 보라고 했고, 그 너머로 산줄기까지
           이어져야 세상이 코어에서 끊기지 않는다. 900 m ≈ 3000 유닛. */
        camera={{
          position: [시작.X * 미터, 시작높이, 시작.Z * 미터],
          fov: 기준.FOV,
          near: 0.3,
          far: 4000,
        }}
      >
        <Preload all />
        <공간그레이박스
          active={locked}
          controlsRef={controlsRef}
          onLockChange={setLocked}
          보고={보고}
          삼인칭={시점모드 === "3인칭"}
          사이드킥설정={사이드킥설정}
          메시설정={메시설정}
          툰설정={툰설정}
          외곽선설정={외곽선설정}
        />
          {/* ★ frameBufferType 을 **반드시** 지정한다.
              [무엇이 문제였나]  지정하지 않으면 이 라이브러리는 반정밀도(HalfFloat) 버퍼를 고른다.
                그러면 이 씬은 **3D 화면이 통째로 까맣게** 나온다(UI·라벨만 보인다).
                실제 GPU 에서 확인했다 — Apple M5 Max · ANGLE Metal 렌더러, 헤드리스가 아니다.
                ?bloom=off 로 끄면 멀쩡해서 오랫동안 Bloom 탓으로 보였지만, 실제로는 버퍼 탓이다.
                Bloom 을 켠 채 버퍼만 바이트로 바꾸면 정상으로 돌아온다(멀티샘플 수는 무관).
              [왜 본편은 멀쩡했나]  본편은 처음부터 frameBufferType 을 지정해 두고 있었다.
              [되돌리기]  ?fb=half 로 예전 상태를 재현할 수 있다. */}
        {!저사양 && !후처리끄기 && (
          <EffectComposer
            multisampling={4}
            enableNormalPass={false}
            frameBufferType={반정밀도버퍼 ? THREE.HalfFloatType : THREE.UnsignedByteType}
          >
            {/* ACES 톤매핑 — **기본은 꺼 둔다(본편과 같은 상태).**
                ?tm=on 으로 켜서 비교할 수 있다.
                한때 "본편에 톤매핑이 빠져서 화면이 어둡다"고 봤는데 **오진이었다.**
                어두움의 범인은 Bloom 이었고(아래), 톤매핑을 넣고 빼는 차이는
                하이라이트가 조금 눌리는 정도다. 화풍 선택지로만 남긴다. */}
            {톤매핑켜기 && <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />}
            {/* ※ 한때 "Bloom 을 켜면 화면이 통째로 까맣다"는 증상이 있었다. 원인은 Bloom 이 아니라
                **후처리 버퍼 형식**이었다(위 frameBufferType 주석). 실제 GPU(Apple M5 Max ·
                ANGLE Metal)에서 재현했고, 버퍼를 바이트로 두면 Bloom 을 켠 채로 정상이다. */}
            {!블룸끄기 && (
              <Bloom intensity={0.35} luminanceThreshold={0.9} mipmapBlur />
            )}
            {/* 본편과 같은 값으로 맞춘다(offset 0.36 · darkness 0.28) */}
            {!비네트끄기 && <Vignette eskil={false} offset={0.36} darkness={0.28} />}
          </EffectComposer>
        )}
      </Canvas>

      {계기보임 && <계기판 보고={보고} />}
      {계기보임 && !locked && <조작안내 />}
      {/* 다 숨겼을 때 되돌리는 법을 잊지 않게 작은 자국만 남긴다 */}
      {!계기보임 && <div style={숨김표시}>[H] 계기판</div>}
      <button
        type="button"
        onClick={() => set시점모드((v) => (v === "1인칭" ? "3인칭" : "1인칭"))}
        style={시점버튼}
      >
        [V] {시점모드}
      </button>
      {꾸미기패널보임 && 메시설정 && (
        <치비테스트패널
          설정={메시설정}
          set설정={set메시설정}
          저장키={메시저장키}
          툰설정={툰설정}
          set툰설정={set툰설정}
          외곽선설정={외곽선설정}
          set외곽선설정={set외곽선설정}
        />
      )}
      {꾸미기패널보임 && !메시설정 && (
        <사이드킥꾸미기패널
          설정={사이드킥설정}
          set설정={set사이드킥설정}
          저장키={사이드킥저장키}
          이전저장키={이전저장키}
        />
      )}
    </div>
  );
}

const 숨김표시 = {
  position: "absolute",
  left: 12,
  top: 12,
  zIndex: 20,
  padding: "3px 8px",
  borderRadius: 6,
  background: "rgba(14,18,26,.45)",
  color: "#8B94A6",
  font: '11px/1.4 ui-monospace, Menlo, monospace',
  pointerEvents: "none",
};

const 시점버튼 = {
  position: "absolute",
  right: 14,
  top: 14,
  zIndex: 20,
  border: "1px solid rgba(170,190,220,.35)",
  borderRadius: 7,
  padding: "6px 9px",
  background: "rgba(14,18,26,.72)",
  color: "#E8EFFA",
  font: '12px/1.2 ui-monospace, Menlo, monospace',
  cursor: "pointer",
};

