/**
 * 구간 단추로 건너뛰었을 때 스크롤에 묶인 등장 효과(차례로 나오는 글·커지는 그림·멈춤 구간 글)를
 * 끝난 모습으로 한 번에 보여 준다. 건너뛴 사람은 그 구간을 바로 읽으려는 것이라 더 굴려야 나오면 안 된다.
 * 맨 위로 돌아오면 풀어서, 처음부터 내려오는 사람은 원래 연출을 그대로 본다.
 */
const REVEALED_CLASS = "is-section-jumped";
/** 이보다 위(px)로 올라오면 원래 연출로 돌린다 */
const RESET_ABOVE = 40;

let isWatching = false;
/** 맨 위에서 출발한 건너뛰기는 첫 몇 칸이 아직 맨 위라, 한 번 벗어난 뒤부터만 되돌린다. */
let hasLeftTop = false;

function resetAtTop() {
  if (window.scrollY > RESET_ABOVE) {
    hasLeftTop = true;
    return;
  }
  if (!hasLeftTop) return;
  document.documentElement.classList.remove(REVEALED_CLASS);
  window.removeEventListener("scroll", resetAtTop);
  isWatching = false;
}

export function revealAllSections(targetTop: number | undefined) {
  // 맨 위로 가는 단추(홈)는 원래 연출이 시작되는 자리라 풀어 둔다.
  if (targetTop == null || targetTop <= RESET_ABOVE) {
    document.documentElement.classList.remove(REVEALED_CLASS);
    return;
  }
  document.documentElement.classList.add(REVEALED_CLASS);
  hasLeftTop = window.scrollY > RESET_ABOVE;
  if (isWatching) return;
  isWatching = true;
  window.addEventListener("scroll", resetAtTop, { passive: true });
}
