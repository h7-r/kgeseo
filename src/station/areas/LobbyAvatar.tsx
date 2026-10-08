import { Suspense, type RefObject } from "react";

import { LOBBY_AVATAR_BODY, USES_CHIBI_RUNTIME } from "@/app/runtimeFlags";
import type { AvatarLink } from "@/engine/avatarLink";
import { FRAME_PRIORITY } from "@/engine/camera";
import BoomFade from "@/engine/movement/BoomFade";
import {
  LobbyChibi,
  LobbySidekick,
  type ChibiConfig,
  type OutlineConfig,
  type SidekickConfig,
  type ToonConfig,
} from "@/naju";

interface LobbyAvatarProps {
  playerRef: RefObject<AvatarLink> | null;
  isThirdPerson: boolean;
  enabled: boolean;
  showFirstPersonBody: boolean;
  sidekickConfig?: SidekickConfig;
  chibiConfig?: ChibiConfig;
  toonConfig?: ToonConfig;
  outlineConfig?: OutlineConfig;
}

/**
 * 로비·비밀 복도의 내 캐릭터. 주소로 런타임을 하나만 쓴다(치비·Meshy 몸체 / ?avatar=sidekick).
 * BoomFade — 3인칭 카메라가 벽에 막혀 몸 안까지 당겨오면 안 그린다(1인칭에서는 가리지 않는다).
 * 아바타는 손목표(-30) 뒤, 든 물건(-10) 앞에 돌아야 걸을 때 물건이 손에서 헤엄치지 않는다.
 */
export default function LobbyAvatar({
  playerRef,
  isThirdPerson,
  enabled,
  showFirstPersonBody,
  sidekickConfig,
  chibiConfig,
  toonConfig,
  outlineConfig,
}: LobbyAvatarProps) {
  if (USES_CHIBI_RUNTIME) {
    if (!chibiConfig || !playerRef) return null;
    return (
      <Suspense fallback={null}>
        <BoomFade>
          <LobbyChibi
            // 꺼진 씬(기차 안일 때의 역)에서는 믹서·IK·모프가 통째로 쉰다
            visible={isThirdPerson && enabled}
            // 아바타 눈높이가 EYE 와 안 맞아 1인칭 몸은 아직 기본 꺼짐(「1인칭 몸」)
            firstPersonBody={!isThirdPerson && showFirstPersonBody}
            playerRef={playerRef}
            config={chibiConfig}
            body={LOBBY_AVATAR_BODY}
            toon={toonConfig}
            outline={outlineConfig}
            framePriority={FRAME_PRIORITY.avatar}
          />
        </BoomFade>
      </Suspense>
    );
  }
  if (!playerRef) return null;
  return (
    <Suspense fallback={null}>
      <BoomFade>
        <LobbySidekick
          visible={isThirdPerson && enabled}
          playerRef={playerRef}
          config={sidekickConfig}
          framePriority={FRAME_PRIORITY.avatar}
        />
      </BoomFade>
    </Suspense>
  );
}
