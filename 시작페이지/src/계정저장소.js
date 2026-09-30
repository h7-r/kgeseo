/* ═══════════════════════════════════════════════════════
   계정 저장소 — 브라우저 안 데이터베이스(IndexedDB)

   ★★ 먼저 알아 둘 것 ★★
   이건 **브라우저 안에만** 있는 저장소다. 서버가 없다.
   · 다른 기기에서 로그인하면 그 계정은 없다(기기마다 따로 논다).
   · 그 컴퓨터를 쓰는 사람은 개발자 도구로 이 데이터베이스를 열어 볼 수 있다.
   · 그러므로 **진짜 인증이 아니다.** 진짜 보호는 서버가 비밀번호를 확인하고
     토큰을 내줄 때 이뤄진다.
   게임 쪽 계정 서버가 붙으면 이 파일의 함수 네 개(가입·로그인·탈퇴·
   계정데이터)만 서버 호출로 갈아 끼우면 화면 쪽은 손대지 않아도 된다.

   [왜 localStorage 가 아니라 IndexedDB 인가]
   · localStorage 는 문자열 하나뿐이라 계정이 늘면 통째로 읽고 쓰게 된다.
   · IndexedDB 는 **저장소를 나눠** 쓸 수 있다 — 계정 목록과 계정별 데이터를
     따로 두면 「내 기록」이 남의 기록과 섞일 일이 없다.
   · 용량 한도도 훨씬 크다(플레이 기록·설정이 쌓여도 된다).

   [비밀번호를 어떻게 두나]
   그대로 저장하지 않는다. 계정마다 다른 소금(salt)을 뽑고 PBKDF2 로
   210,000번 늘려 만든 해시만 남긴다.
   · 소금이 계정마다 다르니 같은 비밀번호라도 해시가 다르다.
     (미리 계산해 둔 표로 한꺼번에 깨는 걸 막는다)
   · 반복 횟수가 크면 한 번 맞춰 보는 데 시간이 걸려 무차별 대입이 느려진다.
   · 확인할 때는 **한 글자씩 끝까지** 비교한다 — 중간에 멈추면 걸린 시간으로
     몇 글자가 맞았는지 새어 나간다.
   ═══════════════════════════════════════════════════════ */

const 디비이름 = "왜곡계정";
const 판 = 1;
const 계정칸 = "계정";
const 데이터칸 = "데이터";

/* 브라우저가 이 기능을 쓸 수 있나 — 사생활 보호 모드에서 막히기도 한다 */
export function 저장소쓸수있나() {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

let 열린것 = null;

function 열기() {
  if (열린것) return 열린것;
  열린것 = new Promise((맞음, 틀림) => {
    const 요청 = indexedDB.open(디비이름, 판);
    요청.onupgradeneeded = () => {
      const db = 요청.result;
      /* 계정 목록 — 이메일이 열쇠다(한 사람 한 계정) */
      if (!db.objectStoreNames.contains(계정칸)) db.createObjectStore(계정칸, { keyPath: "이메일" });
      /* 계정별 데이터 — 같은 열쇠로 나눠 둔다. 탈퇴하면 같이 지운다. */
      if (!db.objectStoreNames.contains(데이터칸)) db.createObjectStore(데이터칸, { keyPath: "이메일" });
    };
    요청.onsuccess = () => 맞음(요청.result);
    요청.onerror = () => 틀림(요청.error);
  });
  return 열린것;
}

/* IndexedDB 는 콜백으로 돌아간다 — 약속(Promise)으로 감싸 읽기 쉽게 만든다 */
async function 하기(칸이름, 모드, 일) {
  const db = await 열기();
  return new Promise((맞음, 틀림) => {
    const 거래 = db.transaction(칸이름, 모드);
    const 요청 = 일(거래.objectStore(칸이름));
    요청.onsuccess = () => 맞음(요청.result);
    요청.onerror = () => 틀림(요청.error);
  });
}

/* ── 비밀번호 다루기 ──────────────────────────────────── */

const 반복 = 210_000;

function 열엿자(바이트배열) {
  return [...new Uint8Array(바이트배열)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function 열엿자거꾸로(글) {
  const 결과 = new Uint8Array(글.length / 2);
  for (let i = 0; i < 결과.length; i += 1) 결과[i] = parseInt(글.slice(i * 2, i * 2 + 2), 16);
  return 결과;
}

async function 섞기(비밀번호, 소금) {
  const 씨앗 = await crypto.subtle.importKey("raw", new TextEncoder().encode(비밀번호), "PBKDF2", false, ["deriveBits"]);
  const 뼈 = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: 소금, iterations: 반복, hash: "SHA-256" },
    씨앗,
    256,
  );
  return 열엿자(뼈);
}

/* 같은지 비교하되 **길이만큼 끝까지** 본다.
   중간에 return 하면 맞춘 글자 수에 따라 걸리는 시간이 달라져,
   그 시간차로 비밀번호를 한 글자씩 알아낼 수 있다. */
function 같은가(ㄱ, ㄴ) {
  if (ㄱ.length !== ㄴ.length) return false;
  let 다름 = 0;
  for (let i = 0; i < ㄱ.length; i += 1) 다름 |= ㄱ.charCodeAt(i) ^ ㄴ.charCodeAt(i);
  return 다름 === 0;
}

const 다듬기 = (이메일) => String(이메일 || "").trim().toLowerCase();

/* ── 바깥에서 쓰는 것들 ───────────────────────────────── */

/** 이 이메일로 이미 가입했나 */
export async function 이미있나(이메일) {
  if (!저장소쓸수있나()) return false;
  const 사람 = await 하기(계정칸, "readonly", (칸) => 칸.get(다듬기(이메일)));
  return Boolean(사람);
}

/** 회원가입. 성공하면 { 좋음: true, 사람 }, 아니면 { 좋음: false, 까닭 } */
export async function 가입({ 이메일, 비밀번호, 닉네임, 지역 }) {
  if (!저장소쓸수있나()) {
    return { 좋음: false, 까닭: "이 브라우저에서는 계정을 저장할 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요." };
  }
  const 키 = 다듬기(이메일);
  if (await 이미있나(키)) {
    return { 좋음: false, 까닭: "이미 가입된 이메일입니다. 로그인해 주세요." };
  }

  const 소금 = crypto.getRandomValues(new Uint8Array(16));
  const 해시 = await 섞기(비밀번호, 소금);

  const 사람 = {
    이메일: 키,
    이름: (닉네임 || "").trim() || 키.split("@")[0],
    지역: (지역 || "").trim(),
    가입때: Date.now(),
  };

  await 하기(계정칸, "readwrite", (칸) => 칸.put({ ...사람, 소금: 열엿자(소금), 해시 }));
  /* 계정별 칸을 비워 둔 채로 만들어 둔다 — 남의 칸에 섞여 들어갈 일이 없다 */
  await 하기(데이터칸, "readwrite", (칸) => 칸.put({ 이메일: 키, 기록: [], 설정: {} }));

  return { 좋음: true, 사람 };
}

/** 로그인. 성공하면 { 좋음: true, 사람 } */
export async function 로그인(이메일, 비밀번호) {
  if (!저장소쓸수있나()) {
    return { 좋음: false, 까닭: "이 브라우저에서는 계정을 읽을 수 없습니다." };
  }
  const 키 = 다듬기(이메일);
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));

  /* 없는 계정과 틀린 비밀번호를 **같은 말**로 답한다.
     "그런 이메일 없습니다" 라고 알려 주면, 어떤 이메일이 가입돼 있는지
     하나씩 물어 알아낼 수 있다. */
  const 틀림 = { 좋음: false, 까닭: "이메일 또는 비밀번호가 올바르지 않습니다." };
  if (!줄) return 틀림;

  const 해시 = await 섞기(비밀번호, 열엿자거꾸로(줄.소금));
  if (!같은가(해시, 줄.해시)) return 틀림;

  return { 좋음: true, 사람: { 이메일: 줄.이메일, 이름: 줄.이름, 지역: 줄.지역, 가입때: 줄.가입때 } };
}

/** 비밀번호 바꾸기 — 재설정 흐름에서 쓴다 */
export async function 비밀번호바꾸기(이메일, 새비밀번호) {
  if (!저장소쓸수있나()) return { 좋음: false, 까닭: "저장소를 쓸 수 없습니다." };
  const 키 = 다듬기(이메일);
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));
  if (!줄) return { 좋음: false, 까닭: "가입되지 않은 이메일입니다." };

  const 소금 = crypto.getRandomValues(new Uint8Array(16));
  const 해시 = await 섞기(새비밀번호, 소금);
  await 하기(계정칸, "readwrite", (칸) => 칸.put({ ...줄, 소금: 열엿자(소금), 해시 }));
  return { 좋음: true };
}

/** 탈퇴 — 계정과 **그 계정의 데이터까지** 지운다 */
export async function 탈퇴(이메일) {
  if (!저장소쓸수있나()) return { 좋음: false, 까닭: "저장소를 쓸 수 없습니다." };
  const 키 = 다듬기(이메일);
  await 하기(계정칸, "readwrite", (칸) => 칸.delete(키));
  await 하기(데이터칸, "readwrite", (칸) => 칸.delete(키));
  return { 좋음: true };
}

/** 이 계정의 데이터 읽기 (기록·설정 등) */
export async function 계정데이터(이메일) {
  if (!저장소쓸수있나()) return null;
  return 하기(데이터칸, "readonly", (칸) => 칸.get(다듬기(이메일)));
}

/** 이 계정의 데이터 쓰기 — 넘긴 항목만 덮어쓴다 */
export async function 계정데이터저장(이메일, 바꿀것) {
  if (!저장소쓸수있나()) return null;
  const 키 = 다듬기(이메일);
  const 지금 = (await 계정데이터(키)) ?? { 이메일: 키, 기록: [], 설정: {} };
  const 새것 = { ...지금, ...바꿀것, 이메일: 키 };
  await 하기(데이터칸, "readwrite", (칸) => 칸.put(새것));
  return 새것;
}

/** 가입된 계정 수 — 개발 중 확인용 */
export async function 계정수() {
  if (!저장소쓸수있나()) return 0;
  return 하기(계정칸, "readonly", (칸) => 칸.count());
}
