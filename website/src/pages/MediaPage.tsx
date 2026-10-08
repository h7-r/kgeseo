import Stage from "@/components/Stage";
import PageFooter from "@/layout/PageFooter";
import { FOOTER_ALLOWANCE } from "@/lib/layout";
import CharacterShowcase, { CHARACTER_SHOWCASE_HEIGHT } from "@/sections/media/CharacterShowcase";
import GameplayVideos, { FEATURED_HEIGHT, GALLERY_HEIGHT } from "@/sections/media/GameplayVideos";
import ImmersiveExperience from "@/sections/media/ImmersiveExperience";
import MediaHero from "@/sections/media/MediaHero";

// 칸 사이 틈을 고르게 맞춘다. 위 칸의 바닥 + 틈으로 다음 칸 자리를 잡아 높이가 바뀌어도 틈은 그대로다.
// 히어로와 밝은 바탕은 화면 끝까지 닿는 면끼리 맞붙는 자리라 디자인 좌표를 그대로 쓴다.
const MEDIA_SECTION_GAP = 144;
const HERO_TOP = 129;
const IMMERSIVE_TOP = 1113;
const CHARACTERS_TOP = 2203; // 밝은 바탕 바닥(2059) + 144
const GALLERY_TOP = CHARACTERS_TOP + CHARACTER_SHOWCASE_HEIGHT + MEDIA_SECTION_GAP;
const FEATURED_TOP = GALLERY_TOP + GALLERY_HEIGHT + MEDIA_SECTION_GAP;
// 쪽번호는 큰 카드 바로 아래 붙는 카드의 일부라 틈을 따로 준다.
const PAGER_TOP = FEATURED_TOP + FEATURED_HEIGHT + 58;
const FOOTER_TOP = PAGER_TOP + 72 + 80;

/** 게임영상 및 캐릭터 페이지. */
export default function MediaPage() {
  return (
    <Stage height={FOOTER_TOP + FOOTER_ALLOWANCE}>
      <MediaHero top={HERO_TOP} />
      <ImmersiveExperience top={IMMERSIVE_TOP} />
      <CharacterShowcase top={CHARACTERS_TOP} />
      <GameplayVideos top={GALLERY_TOP} featuredTop={FEATURED_TOP} pagerTop={PAGER_TOP} />
      <PageFooter />
    </Stage>
  );
}
