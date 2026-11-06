// 방 수 상한 카운터 — 설계 v0.19 5절 「상한 구현」.
// 방 생성 시작 때 비동기 작업 전에 자리를 확보하고, 확보한 방만 초기화 실패나 폐기 때 한 번 해제한다.
// 상한에서 거절된 방은 해제할 자리가 없다. 생성 실패 정리와 onDispose 가 둘 다 불려도 두 번 줄이지 않는다.
export interface RoomSlot {
  /** 처음 부를 때만 자리를 돌려주고 true. 이미 돌려줬으면 false */
  release(): boolean;
  readonly released: boolean;
}

export class RoomCap {
  #used = 0;
  readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /** 자리가 있으면 확보해 돌려주고, 없으면 null */
  tryAcquire(): RoomSlot | null {
    if (this.#used >= this.max) return null;
    this.#used += 1;
    let released = false;
    return {
      release: () => {
        if (released) return false;
        released = true;
        this.#used -= 1;
        return true;
      },
      get released() {
        return released;
      },
    };
  }

  get used(): number {
    return this.#used;
  }
}
