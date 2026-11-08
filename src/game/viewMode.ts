// 지금 시점(1인칭 · 3인칭) — App 이 상태를 들고 있고 여기로 옮겨 적는다. 튜토리얼(「시점 바꾸기」 단계가 실제로 1인칭이 됐는지)과
// 시점 규칙(viewRule)이 읽는다. 아무것도 가져오지 않아 어느 쪽에서 불러도 순환이 없다.
let thirdPerson = true;

export const isThirdPersonView = () => thirdPerson;
export function setThirdPersonView(value: boolean) {
  thirdPerson = value;
}
