/** 홀로그램에서 나주를 고르고 [E] 를 누르면 쏜다. 진입 연출이 받아 암전 뒤 /naju01/ 로 넘긴다. */
export const NAJU_ENTER_EVENT = "kgeseo:naju-enter";

export interface NajuEnterDetail {
  /** naju01 주소에 그대로 붙일 질의(`""` 또는 `"?avatar=sidekick"`) */
  query: string;
}

declare global {
  interface WindowEventMap {
    [NAJU_ENTER_EVENT]: CustomEvent<NajuEnterDetail>;
  }
}
