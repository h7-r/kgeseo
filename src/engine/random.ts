/**
 * 시드가 같으면 늘 같은 수열을 내는 난수(Lehmer). 0 초과 1 미만.
 * createRandom 과 수열이 달라, 이 수열로 맞춘 소리·무늬를 createRandom 으로 바꾸면 결과가 달라진다.
 */
export function createLehmerRandom(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

/** 시드가 같으면 늘 같은 수열을 내는 난수(mulberry32). 0 이상 1 미만. */
export function createRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
