/**
 * 첫 장면 인물 자리를 다른 연출이 읽는 곳 — 동행 자기소개가 「저기 물가에 누가 있어요」 때 아비사 쪽을 보여 준다.
 * FirstSceneActors 가 매 프레임 적는다(배치 전 · 언마운트 뒤에는 null). 월드 유닛.
 */
import type * as THREE from "three";

export const firstScenePoints = {
  abisaHead: null as THREE.Vector3 | null,
  /** 구렁이 경계 알림을 봤다(이번 판) — 동행 소개가 「물가에 누가 있어요」 대신 의뢰 쪽 말을 고른다 */
  isSerpentNoticed: false,
  /**
   * 구렁이가 그 자리에 있고 플레이어가 경계 거리 안에 있다 — 알림과 따로 매 프레임 적는다. 경계 알림은 다른 사람이 말하는 동안 미뤄져
   * isSerpentNoticed 가 늦게 켜지므로, 동행의 빛 물고기 한마디가 마주침을 알아채고 그칠 때 이것을 본다(Codex 리뷰)
   */
  isSerpentClose: false,
};
