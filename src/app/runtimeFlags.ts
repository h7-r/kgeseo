import { useSyncExternalStore } from "react";

/**
 * 주소 뒤 질의값으로만 켜는 실행 스위치. 질의가 없으면 평소 동작 그대로다.
 * 저사양(?q=low)은 `@/engine/quality` 의 IS_LOW_QUALITY 를 쓴다.
 */
const query = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/** ?avatar=chibi → 치비 몸체. 그 밖에는 Meshy 몸체. */
export const LOBBY_AVATAR_BODY: "chibi" | "meshy" = query.get("avatar") === "chibi" ? "chibi" : "meshy";
/** ?avatar=sidekick 만 사이드킥 런타임, 나머지는 치비 런타임(치비·Meshy 몸체)을 쓴다. */
export const USES_CHIBI_RUNTIME = query.get("avatar") !== "sidekick";

/** ?toon=off · ?outline=off — 로비 캐릭터 연출 끄기. */
export const IS_LOBBY_TOON_DISABLED = query.get("toon") === "off";
export const IS_LOBBY_OUTLINE_DISABLED = query.get("outline") === "off";

/** 시연 화면에 개발 도구가 뜨지 않게 개발 서버에서도 기본은 숨긴다. ?leva · ?dev 로 켠다. */
export const SHOW_LEVA = query.has("leva");
export const SHOW_DEV_TOOLS = query.has("dev");

/** 캐릭터 꾸미기 패널은 지금 숨겨 둔다. ?customize 로만 켠다(외형은 App 이 직접 읽어 꺼도 유지된다). */
export const SHOW_CUSTOMIZE_PANEL = query.has("customize");

// 원인 격리용 — 문제를 좁힐 때만 붙인다.
/** ?fx=off — 후처리(Bloom·Vignette)를 통째로 끈다. */
export const IS_POSTFX_DISABLED = query.get("fx") === "off";
/** ?fx=hi — 후처리 멀티샘플만 8배로. 화질 비교용(버퍼 형식은 바꾸지 않는다 — App 의 EffectComposer 주석). */
export const IS_POSTFX_HIGH_QUALITY = query.get("fx") === "hi";
/** ?zone=off — 구역 컬링을 끄고 전부 그린다. */
export const IS_ZONE_CULLING_DISABLED = query.get("zone") === "off";

/**
 * ?input=always — 포인터 잠금 없이도 조작을 켠다.
 * 자동 검사(Playwright)에서는 잠금이 창 포커스에 달려 될 때도 안 될 때도 있다. 시점 회전은 여전히 잠금이 필요하다.
 */
export const IS_INPUT_ALWAYS_ON = query.get("input") === "always";

// 손가락으로는 Leva 슬라이더를 못 만지고 화면만 가린다.
const MOBILE_MEDIA_QUERY = "(pointer: coarse), (max-width: 768px)";

function subscribeMobile(notify: () => void) {
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
}

/** 터치 기기이거나 폭 768px 이하인가. 창을 돌리거나 크기를 바꾸면 따라간다. */
export function useIsMobile() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    () => false,
  );
}
