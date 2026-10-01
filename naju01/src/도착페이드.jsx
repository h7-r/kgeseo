// ═══════════════════════════════════════════════════════════════
//  도착페이드.jsx — 허브에서 넘어왔을 때 검은 화면에서 밝아지기
// ═══════════════════════════════════════════════════════════════
// [왜 나주 쪽에 있나]
//   진입 연출(src/소품/나주진입연출.jsx)은 `/naju01/index.html` 로 **주소를 통째로
//   옮긴다.** 그 순간 허브 쪽 오버레이는 DOM 째 사라지므로, 「도착 후 페이드 인」은
//   넘어온 쪽이 해야 한다. 첫 프레임이 언제 그려지는지도 여기서만 알 수 있다.
//
// [언제 밝아지나]
//   R3F 는 Canvas children 을 **Suspense 하나로** 묶는다. 그래서 GLB 가 다 읽히고
//   지형이 다 지어지기 전에는 children 이 아예 안 붙는다 — 즉 이 컴포넌트의 첫
//   useFrame 이 곧 「세계가 그려질 준비가 끝난 시각」이다. 실측으로 확인했다
//   (docs/성능-재는법.md 의 스크린샷 기준 시각과 같은 자리에 온다).
//
// [안전망]
//   무슨 이유로든 프레임이 안 오면 화면이 **영영 까맣다.** 그게 제일 나쁜 실패라
//   시간 상한을 두고, 넘으면 그냥 밝힌다.

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

// 허브(본편)에서 넘어왔는가. 진입 연출이 주소에 `?from=hub` 를 실어 보낸다.
//   직접 주소를 쳐서 들어오거나 새로고침할 때는 페이드가 없다 — 개발 중에
//   매번 0.5초를 기다리지 않아도 된다.
export const 허브에서왔나 = (쿼리) => 쿼리.get("from") === "hub";

// 밝아지는 데 걸리는 시간(ms). 연출 담당(해랑)이 정한 값 — 검정 → 투명, ease-out.
export const 페이드시간 = 500;
// 첫 프레임이 이때까지 안 오면 그냥 밝힌다. 까만 화면으로 잠기는 것보다 낫다.
const 안전망 = 15000;

// ── Canvas **안**에 둔다 ──────────────────────────────────
// ※ 이름 앞머리 `NJ` 는 린트 때문이다 — react-hooks 규칙이 "컴포넌트 이름은 대문자로
//   시작" 을 ASCII 로만 판정해서, 한글 이름 컴포넌트를 전부 훅 위반으로 잡는다
//   (캐릭터생성 쪽 `CC` 앞머리와 같은 이유).
// 실제로 그려진 프레임을 세고, 두 장째에 알린다. useFrame 콜백은 그 프레임을
// 그리기 **전**에 돌기 때문에, 한 장만 세면 아직 아무것도 안 그려진 상태다.
export function NJ첫프레임알림({ 알림 }) {
  const 센것 = useRef(0);
  const 알렸나 = useRef(false);
  useFrame(() => {
    if (알렸나.current) return;
    센것.current += 1;
    if (센것.current < 2) return;
    알렸나.current = true;
    알림();
  });
  return null;
}

// ── Canvas **밖**에 둔다 ──────────────────────────────────
// 처음부터 검게 덮고 있다가, `밝히기` 가 참이 되면 0.5초에 걸쳐 걷힌다.
// 다 걷히면 DOM 에서 빠진다(투명한 판이 남아 클릭을 먹는 일이 없게).
export function NJ도착덮개({ 밝히기 }) {
  const [끝났나, 끝났나설정] = useState(false);

  useEffect(() => {
    if (!밝히기 || 끝났나) return undefined;
    const 시계 = setTimeout(() => 끝났나설정(true), 페이드시간 + 60);
    return () => clearTimeout(시계);
  }, [밝히기, 끝났나]);

  if (끝났나) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        // 계기판·시점 버튼(20)보다 위, 하지만 Leva 패널은 덮지 않아도 된다.
        zIndex: 40,
        background: "#000",
        opacity: 밝히기 ? 0 : 1,
        transition: `opacity ${페이드시간}ms ease-out`,
        pointerEvents: "none",
      }}
    />
  );
}

// 첫 프레임 신호와 안전망을 하나로 묶어 준다. App 은 이것만 쓰면 된다.
// (이름이 `useNJ…` 인 것도 위 `NJ` 와 같은 린트 이유다 — 훅 이름은 `use` + 대문자여야 한다.)
export function useNJ도착페이드(켬) {
  const [밝히기, 밝히기설정] = useState(!켬);

  useEffect(() => {
    if (!켬 || 밝히기) return undefined;
    const 시계 = setTimeout(() => 밝히기설정(true), 안전망);
    return () => clearTimeout(시계);
  }, [켬, 밝히기]);

  return [밝히기, () => 밝히기설정(true)];
}
