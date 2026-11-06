/**
 * 퍼즐 세 스테이지와 그 HUD 를 한 자리에 모은다. 씬(NajuScene)의 무리를 읽어 바꿔 끼우는 것들이라 씬 뒤에 붙인다.
 * 순서가 곧 붙는 순서다 — 뒤 스테이지가 앞 스테이지의 상태를 구독하므로 바꾸지 않는다.
 */
import DialogueLayer from "../dialogue/DialogueLayer";
import Hotbar from "../puzzles/Hotbar";
import InteractionHud from "../puzzles/InteractionHud";
import InteractionLoop from "../puzzles/InteractionLoop";
import HintBoxHud from "../puzzles/HintBoxHud";
import WorldItems from "../puzzles/WorldItems";
import AirStations from "../puzzles/cave/AirStations";
import BreathHud from "../puzzles/cave/BreathHud";
import CaveWorld from "../puzzles/cave/CaveWorld";
import FishBurrows from "../puzzles/cave/FishBurrows";
import Fishes from "../puzzles/cave/Fishes";
import InnerChamber from "../puzzles/cave/InnerChamber";
import LegendTraces from "../puzzles/cave/LegendTraces";
import RingDoor from "../puzzles/cave/RingDoor";
import SeaLife from "../puzzles/cave/SeaLife";
import ClamDig from "../puzzles/fishTrap/ClamDig";
import FishTrapPuzzle from "../puzzles/fishTrap/FishTrapPuzzle";
import HearthFire from "../puzzles/fishTrap/HearthFire";
import PullGaugeHud from "../puzzles/fishTrap/PullGaugeHud";
import SmokeGuide from "../puzzles/fishTrap/SmokeGuide";
import JarPuzzle from "../puzzles/jars/JarPuzzle";
import BoatBottles from "../puzzles/makgeolli/BoatBottles";
import BirdHints from "../puzzles/ridge/BirdHints";
import BoxOpening from "../puzzles/ridge/BoxOpening";
import GateAltar from "../puzzles/ridge/GateAltar";
import GateRift from "../puzzles/ridge/GateRift";
import PaperReadHud from "../puzzles/ridge/PaperReadHud";
import RidgeBirds from "../puzzles/ridge/RidgeBirds";
import RiftEntryHud from "../puzzles/ridge/RiftEntryHud";
import RidgeCart from "../puzzles/ridge/RidgeCart";
import StumpStairs from "../puzzles/ridge/StumpStairs";
import TetheredCarriers from "../puzzles/ridge/TetheredCarriers";
import WindCurtain from "../puzzles/ridge/WindCurtain";
import FloatingStones from "../puzzles/ritual/FloatingStones";
import RitualCircle from "../puzzles/ritual/RitualCircle";
import StormRain from "../puzzles/ritual/StormRain";

/** Canvas 안 — 퍼즐 장치 · 소지품 물건 · 겨냥 */
export function PuzzleWorld() {
  return (
    <>
      {/* 1스테이지 나루터 — 통발과 빛 물고기(puzzles/fishTrap) */}
      <ClamDig />
      <FishTrapPuzzle />
      <HearthFire />
      <SmokeGuide />
      {/* 3스테이지 증언 능선 — 바람 장막 · 수레와 궤 · 돌새 · 진부촌 문 시공간 틈(puzzles/ridge) */}
      <WindCurtain />
      <RidgeCart />
      <TetheredCarriers />
      <StumpStairs />
      <RidgeBirds />
      <BirdHints />
      <GateAltar />
      <GateRift />
      <BoxOpening />
      {/* 2스테이지 바위 아래 — 장독대 · 술병 · 기우제(puzzles/jars · makgeolli · ritual) */}
      <JarPuzzle />
      <BoatBottles />
      <RitualCircle />
      <FloatingStones />
      <StormRain />
      {/* 강 밑 물굴 — 뜬 돌 넷을 다 건지면 강물이 갈라진다(puzzles/cave) */}
      <CaveWorld />
      <AirStations />
      <FishBurrows />
      <LegendTraces />
      <SeaLife />
      <Fishes />
      <RingDoor />
      <InnerChamber />
      <WorldItems />
      <InteractionLoop />
    </>
  );
}

/** Canvas 밖 DOM — 겨냥 안내 · 빠른 칸 · 게이지 · 숨 · 동행 대화창(퍼즐 설명 · 알림) · 종이 읽기 · 힌트함 · 틈 건너기 */
export function PuzzleHud() {
  return (
    <>
      <InteractionHud />
      <Hotbar />
      <PullGaugeHud />
      <BreathHud />
      <DialogueLayer />
      <PaperReadHud />
      <HintBoxHud />
      <RiftEntryHud />
    </>
  );
}
