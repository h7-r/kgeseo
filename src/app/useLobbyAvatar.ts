import { useState } from "react";

import { PLAYER_MESHY_APPEARANCE_KEY, PLAYER_SIDEKICK_APPEARANCE_KEY } from "@/engine/storage";
import {
  DEFAULT_MESH_CONFIG,
  DEFAULT_OUTLINE,
  DEFAULT_SIDEKICK_CONFIG,
  DEFAULT_TOON,
  readMeshAppearance,
  readSidekickAppearance,
  type ChibiConfig,
  type OutlineConfig,
  type SidekickConfig,
  type ToonConfig,
} from "@/naju";

import { IS_LOBBY_OUTLINE_DISABLED, IS_LOBBY_TOON_DISABLED, USES_CHIBI_RUNTIME } from "./runtimeFlags";

/**
 * 로비 아바타 외형. 저장소는 마운트 때 한 번만 읽는다(캐릭터 생성 화면이 적고 / 로 넘어온다).
 * 런타임은 주소로 하나만 쓴다 — 안 쓰는 쪽은 저장소를 읽지 않고, 씬·패널에도 넘기지 않는다(isSidekick/isChibi).
 */
export function useLobbyAvatar() {
  const [sidekickConfig, setSidekickConfig] = useState<SidekickConfig>(() =>
    USES_CHIBI_RUNTIME ? DEFAULT_SIDEKICK_CONFIG : readSidekickAppearance(PLAYER_SIDEKICK_APPEARANCE_KEY),
  );
  const [chibiConfig, setChibiConfig] = useState<ChibiConfig>(() =>
    USES_CHIBI_RUNTIME ? readMeshAppearance(PLAYER_MESHY_APPEARANCE_KEY) : DEFAULT_MESH_CONFIG,
  );
  const [toonConfig, setToonConfig] = useState<ToonConfig>(() => ({
    ...DEFAULT_TOON,
    enabled: !IS_LOBBY_TOON_DISABLED,
  }));
  const [outlineConfig, setOutlineConfig] = useState<OutlineConfig>(() => ({
    ...DEFAULT_OUTLINE,
    enabled: !IS_LOBBY_OUTLINE_DISABLED,
  }));
  return {
    sidekickConfig,
    setSidekickConfig,
    chibiConfig,
    setChibiConfig,
    toonConfig,
    setToonConfig,
    outlineConfig,
    setOutlineConfig,
  };
}

export type LobbyAvatarState = ReturnType<typeof useLobbyAvatar>;
