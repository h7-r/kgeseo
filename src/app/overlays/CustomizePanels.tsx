import { Suspense } from "react";

import { USES_CHIBI_RUNTIME } from "@/app/runtimeFlags";
import { PLAYER_MESHY_APPEARANCE_KEY, PLAYER_SIDEKICK_APPEARANCE_KEY } from "@/engine/appearanceKeys";
import { LobbyChibiPanel, LobbySidekickPanel } from "@/naju";

import type { LobbyAvatar } from "../useLobbyAvatar";

interface CustomizePanelsProps {
  avatar: LobbyAvatar;
}

/** 캐릭터 꾸미기 패널(왼쪽). 런타임에 맞는 하나만 띄운다. */
export default function CustomizePanels({ avatar }: CustomizePanelsProps) {
  return (
    <Suspense fallback={null}>
      {USES_CHIBI_RUNTIME ? (
        <LobbyChibiPanel
          config={avatar.chibiConfig}
          setConfig={avatar.setChibiConfig}
          storageKey={PLAYER_MESHY_APPEARANCE_KEY}
          toonConfig={avatar.toonConfig}
          setToonConfig={avatar.setToonConfig}
          outlineConfig={avatar.outlineConfig}
          setOutlineConfig={avatar.setOutlineConfig}
        />
      ) : (
        <LobbySidekickPanel
          config={avatar.sidekickConfig}
          setConfig={avatar.setSidekickConfig}
          storageKey={PLAYER_SIDEKICK_APPEARANCE_KEY}
          side="left"
          topOffset={14}
        />
      )}
    </Suspense>
  );
}
