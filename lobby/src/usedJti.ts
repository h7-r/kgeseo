// 이미 쓴 티켓 ID(jti → exp). 프로세스 하나의 메모리에만 둔다(설계 3.2절).
// 만료(now >= exp)된 항목만 정리한다. 방이 꽉 찼거나 연결을 포기해도 사용 기록은 만료까지 남는다.
export class UsedJtiRegistry {
  readonly #entries = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now() / 1000) {
    this.#now = now;
  }

  /**
   * 처음이면 등록하고 true, 이미 있으면 false. 확인과 등록 사이에 await 이 없어야 한다 —
   * 이 메서드 하나로 묶어 둔다.
   */
  claim(jti: string, exp: number): boolean {
    if (this.#entries.has(jti)) return false;
    this.#entries.set(jti, exp);
    return true;
  }

  has(jti: string): boolean {
    return this.#entries.has(jti);
  }

  /** 만료된 항목을 지운다. 지운 수 */
  sweep(): number {
    const now = this.#now();
    let removed = 0;
    for (const [jti, exp] of this.#entries) {
      if (now >= exp) {
        this.#entries.delete(jti);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#entries.size;
  }
}
