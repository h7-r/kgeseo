/* ═══════════════════════════════════════════════════════
   비밀번호 재설정 흐름 — 인증코드 발급 · 확인 (메일 서버가 붙기 전까지의 흉내)

   [흐름]  비밀번호 찾기 → (코드 발급) → 인증중: 코드 입력 → 인증완료: 새 비밀번호
   · 코드는 crypto.getRandomValues 로 뽑은 **무작위 6자리**, 10분 뒤 만료
   · 인증을 통과해야만 새 비밀번호 단계가 열린다(전엔 주소만 치면 아무 계정이나 바꿀 수 있었다)
   · 틀리게 5번 넣으면 코드를 버린다 → 처음부터 다시(무작위 대입 방지)
   · 탭 안(sessionStorage)에만 둔다 — 탭을 닫으면 사라진다

   ★ 진짜 서비스에선 코드를 **메일로만** 보내고 서버가 확인한다. 지금은 메일 서버가 없어서
     화면에 「테스트용 코드」로 보여 준다(인증폼의 안내 상자). 서버가 붙으면 이 파일만 바꾸면 된다.
   ═══════════════════════════════════════════════════════ */
const 열쇠 = "재설정";
const 유효시간 = 10 * 60 * 1000;
const 최대시도 = 5;

const 읽기 = () => {
  try { return JSON.parse(sessionStorage.getItem(열쇠) || "null"); } catch { return null; }
};
const 쓰기 = (v) => {
  try { v ? sessionStorage.setItem(열쇠, JSON.stringify(v)) : sessionStorage.removeItem(열쇠); } catch { /* 막혀도 흐름은 계속 */ }
};

/** 새 코드 발급 — 비밀번호 찾기에서 부른다 */
export function 코드발급(메일) {
  const 수 = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const 코드 = String(수).padStart(6, "0");
  쓰기({ 메일: String(메일).trim().toLowerCase(), 코드, 만료: Date.now() + 유효시간, 시도: 0, 인증됨: false });
  return 코드;
}

/** 지금 진행 중인 재설정 (만료됐으면 null) */
export function 재설정상태() {
  const v = 읽기();
  if (!v) return null;
  if (Date.now() > v.만료) { 쓰기(null); return null; }
  return v;
}

/** 코드 확인 — { 좋음, 까닭? } */
export function 코드확인(메일, 코드) {
  const v = 재설정상태();
  if (!v) return { 좋음: false, 까닭: "인증 시간이 지났습니다. 비밀번호 찾기부터 다시 해 주세요." };
  if (v.메일 !== String(메일).trim().toLowerCase()) return { 좋음: false, 칸: "이메일", 까닭: "인증코드를 받은 이메일과 다릅니다." };
  if (v.코드 !== String(코드).trim()) {
    const 시도 = v.시도 + 1;
    if (시도 >= 최대시도) { 쓰기(null); return { 좋음: false, 까닭: "인증코드를 5번 틀렸습니다. 비밀번호 찾기부터 다시 해 주세요." }; }
    쓰기({ ...v, 시도 });
    return { 좋음: false, 칸: "인증코드", 까닭: `인증코드가 맞지 않습니다. (${최대시도 - 시도}번 남음)` };
  }
  쓰기({ ...v, 인증됨: true });
  return { 좋음: true };
}

/** 재설정 끝 — 코드를 버린다 */
export const 재설정끝 = () => 쓰기(null);
