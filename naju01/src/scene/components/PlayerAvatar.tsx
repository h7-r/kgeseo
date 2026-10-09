import { lazy, Suspense, type RefObject } from "react";

import type { AvatarLink } from "@/engine/avatarLink";

import type { MeshAppearanceConfig } from "../../avatar/meshAppearance";
import type { SidekickConfig } from "../../avatar/sidekickOptions";
import type { ToonConfig } from "../../avatar/toonMaterial";
import type { OutlineConfig } from "../../avatar/toonOutline";

// 3인칭 캐릭터는 늦게 들여온다. 두 모듈은 실릴 때 useGLTF.preload 로 37 MB 를 받으므로
// 1인칭으로만 걸으면 통째로 버려진다 — V 를 처음 누를 때 그 갈래 하나만 싣는다.
const SidekickGameAvatar = lazy(() => import("../../avatar/SidekickGameAvatar"));
const ChibiGameAvatar = lazy(() => import("../../avatar/ChibiGameAvatar"));

interface PlayerAvatarProps {
  isMounted: boolean;
  visible: boolean;
  playerRef: RefObject<AvatarLink>;
  sidekickConfig?: SidekickConfig;
  meshConfig?: MeshAppearanceConfig | null;
  toonConfig?: ToonConfig | null;
  outlineConfig?: OutlineConfig | null;
}

/** 3인칭 캐릭터. meshConfig 가 있으면 Meshy 몸, 없으면 사이드킥. */
export default function PlayerAvatar({
  isMounted,
  visible,
  playerRef,
  sidekickConfig,
  meshConfig,
  toonConfig,
  outlineConfig,
}: PlayerAvatarProps) {
  return (
    // 제 Suspense 를 반드시 씌운다 — 안 씌우면 캐릭터 GLB 를 읽는 동안 씬 전체가 내려갔다 올라온다.
    <Suspense fallback={null}>
      {isMounted &&
        (meshConfig ? (
          <ChibiGameAvatar
            visible={visible}
            playerRef={playerRef}
            config={meshConfig}
            body="meshy"
            toon={toonConfig ?? undefined}
            outline={outlineConfig ?? undefined}
          />
        ) : (
          <SidekickGameAvatar visible={visible} playerRef={playerRef} config={sidekickConfig} />
        ))}
    </Suspense>
  );
}
