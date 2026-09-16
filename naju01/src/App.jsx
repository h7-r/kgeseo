// ═══════════════════════════════════════════════════════════════
//  App.jsx — NAJU-01 그레이박스 껍데기
// ═══════════════════════════════════════════════════════════════
// 본편(../../src/App.jsx)의 껍데기와 같은 구성이다 —
//   Leva 패널 · Canvas 설정(그림자·dpr·gl·카메라) · T 키로 시작 · 조준점.
// 다른 점은 씬이 하나뿐이라 라우터가 없고, 계기판이 그레이박스 전용이라는 것뿐이다.
// ※ 본편 파일은 읽기만 한다. 이 폴더는 본편을 한 줄도 고치지 않는다.

import { useRef, useState, useEffect } from "react";
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
// 무대 — 기본은 창을 꽉 채운다. ?stage=16x9 면 본편과 같은 레터박스(§4 시야 검증용).
const 무대16x9 = 쿼리.get("stage") === "16x9";

// 시작 카메라 — V1 자리, 도면 기본값 기준.
//   Leva 에 저장된 값이 다르면 첫 프레임에 씬이 알아서 다시 앉힌다.
const 시작 = 시점[0];
const 시작높이 = (기본지형.지면(시작.X, 시작.Z).y + 기준.눈높이) * 미터;

export default function App() {
  const controlsRef = useRef(null);
  const 보고 = useRef(null); // 씬 → 계기판으로 넘기는 상자(리렌더 없이)
  const [locked, setLocked] = useState(false);
  const [시점모드, set시점모드] = useState("1인칭");
  const [아바타종류, set아바타종류] = useState("사이드킥");
  const [외형, set외형] = useState({ hair: 1, top: 1, bottom: 1, shoes: 1 });
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
        dpr={저사양 ? 1 : [1, 2]}
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
          아바타종류={아바타종류}
          외형={외형}
        />
        {!저사양 && !후처리끄기 && (
          <EffectComposer multisampling={4} enableNormalPass={false}>
            {/* ACES 톤매핑 — **기본은 꺼 둔다(본편과 같은 상태).**
                ?tm=on 으로 켜서 비교할 수 있다.
                한때 "본편에 톤매핑이 빠져서 화면이 어둡다"고 봤는데 **오진이었다.**
                어두움의 범인은 Bloom 이었고(아래), 톤매핑을 넣고 빼는 차이는
                하이라이트가 조금 눌리는 정도다. 화풍 선택지로만 남긴다. */}
            {톤매핑켜기 && <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />}
            {/* ⚠ 헤드리스(SwiftShader)로 찍어 보면 **특정 시점에서 화면이 통째로
                까맣게 나온다.** V1(나루터)에서 동쪽을 볼 때가 그렇고, 절벽·자갈밭
                시점은 멀쩡하다. ?bloom=off 로 끄면 바로 정상이 된다.
                소프트웨어 렌더러 한정 문제일 수 있어 **실제 GPU에서 확인이 필요하다.**
                본편도 같은 Bloom 을 쓰므로, 재현되면 본편에도 해당한다. */}
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
      <div style={아바타패널}>
        <button
          type="button"
          onClick={() =>
            set아바타종류(
              (v) =>
                ({
                  사이드킥: "게임",
                  게임: "메쉬",
                  메쉬: "모듈",
                  모듈: "사이드킥",
                })[v],
            )
          }
          style={아바타버튼}
        >
          외형: {{ 사이드킥: "Sidekick 테스트", 게임: "새 게임 리그", 메쉬: "Meshy 원형", 모듈: "모듈 초안" }[아바타종류]}
        </button>
        {아바타종류 === "모듈" && (
          <div style={선택줄}>
            {[["hair", "머리"], ["top", "상의"], ["bottom", "하의"], ["shoes", "신발"]].map(([key, label]) => (
              <button key={key} type="button" style={작은버튼} onClick={() => set외형((old) => ({ ...old, [key]: old[key] % 4 + 1 }))}>
                {label} {외형[key]}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* ※ 화면 한복판의 조준점은 걷어냈다 — 쏘거나 겨냥하는 게임이 아니라
          **놓여 있을 이유가 없고**, 풍경을 볼 때 계속 눈에 걸린다.
          되살리려면 아래 `조준점` 스타일을 그대로 쓰면 된다. */}
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

// 안 쓰는 중 — 위 주석 참고(겨냥이 필요한 장치가 생기면 되살린다)
const 조준점 = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 5,
  height: 5,
  marginLeft: -2.5,
  marginTop: -2.5,
  borderRadius: "50%",
  background: "rgba(240,244,250,.55)",
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

const 아바타패널 = { position: "absolute", right: 14, top: 52, zIndex: 20, display: "grid", gap: 5 };
const 아바타버튼 = { ...시점버튼, position: "static", textAlign: "left" };
const 선택줄 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 };
const 작은버튼 = { border: "1px solid rgba(170,190,220,.25)", borderRadius: 5, padding: "4px 6px", background: "rgba(14,18,26,.68)", color: "#DDE7F6", font: '11px/1.2 ui-monospace, Menlo, monospace', cursor: "pointer" };
