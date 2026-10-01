// 캐릭터명 규칙 — 정규화·글자 수·형식 검사를 한곳에 모은다.
//
// [왜 한곳인가]
//   서버가 정하는 진짜 규칙은 아직 없다. 지금은 PRD 의 2~12자를 따르되, 규칙이 확정되면
//   `nameRules` prop 하나만 갈아 끼우면 화면 전체가 따라오도록 계산을 여기 모아 둔다.
//   글자 수는 코드 포인트로 센다 — `"가".length` 는 1 이지만 이모지는 2 가 되어,
//   `.length` 로 세면 같은 이름이 화면과 서버에서 다른 길이가 된다.

export const 기본이름규칙 = {
  최소: 2,
  최대: 12,
  // 한글·영문·숫자와 가운데 한 칸 공백만. 서버 규칙이 오면 이 값을 바꿔 넘기면 된다.
  허용: "^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]+( [가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]+)*$",
  허용설명: "한글·영문·숫자를 쓸 수 있습니다.",
};

// 앞뒤 공백을 떼고, 가운데 연속 공백을 한 칸으로 줄이고, 한글 조합형을 완성형으로 맞춘다.
// (NFC 를 안 맞추면 눈으로 같은 "가" 가 서버에서 다른 문자열이 된다.)
export function 이름정규화(값) {
  const 글 = typeof 값 === "string" ? 값 : "";
  return 글.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function 글자수(값) {
  return [...이름정규화(값)].length;
}

// 화면에 바로 보여 줄 수 있는 형식 검사 결과. 서버 판정(중복·금칙어)은 여기서 하지 않는다.
export function 형식검사(값, 규칙 = 기본이름규칙) {
  const 이름 = 이름정규화(값);
  const 수 = [...이름].length;
  if (수 === 0) return { ok: false, 비었음: true, 메시지: "캐릭터명을 입력해 주세요." };
  if (수 < 규칙.최소) return { ok: false, 메시지: `${규칙.최소}자 이상 입력해 주세요.` };
  if (수 > 규칙.최대) return { ok: false, 메시지: `${규칙.최대}자까지 쓸 수 있습니다.` };
  if (규칙.허용) {
    // 규칙이 깨져 있으면 형식 검사를 건너뛴다 — 입력을 아예 막아 버리는 쪽이 더 나쁘다.
    let 정규식;
    try {
      정규식 = new RegExp(규칙.허용, "u");
    } catch {
      정규식 = null;
    }
    if (정규식 && !정규식.test(이름)) return { ok: false, 메시지: 규칙.허용설명 ?? "쓸 수 없는 문자가 있습니다." };
  }
  return { ok: true, 이름 };
}

export function 규칙보정(규칙) {
  const r = 규칙 && typeof 규칙 === "object" ? 규칙 : {};
  const 최소 = Number.isFinite(Number(r.최소)) ? Math.max(1, Number(r.최소)) : 기본이름규칙.최소;
  const 최대 = Number.isFinite(Number(r.최대)) ? Math.max(최소, Number(r.최대)) : 기본이름규칙.최대;
  return {
    최소,
    최대,
    허용: typeof r.허용 === "string" ? r.허용 : 기본이름규칙.허용,
    허용설명: typeof r.허용설명 === "string" ? r.허용설명 : 기본이름규칙.허용설명,
  };
}
