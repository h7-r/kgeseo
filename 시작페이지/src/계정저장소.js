/* ═══════════════════════════════════════════════════════
   계정 저장소 — 브라우저 안 데이터베이스(IndexedDB) = 「회원 DB」 흉내

   ★★ 먼저 알아 둘 것 ★★
   이건 **브라우저 안에만** 있는 저장소다. 서버가 없다.
   · 다른 기기에서 로그인하면 그 계정은 없다(기기마다 따로 논다).
   · 그 컴퓨터를 쓰는 사람은 개발자 도구로 이 데이터베이스를 열어 볼 수 있다.
   · 그러므로 **진짜 인증이 아니다.** 진짜 보호는 서버가 비밀번호를 확인하고
     토큰을 내줄 때 이뤄진다.
   백엔드가 붙으면 아래 「바깥에서 쓰는 것들」 함수만 서버 호출로 갈아 끼우면
   화면 쪽은 손대지 않아도 된다. 그래서 저장하는 모양을 **ERD(app_user · consent_log)
   와 같은 칸**으로 맞춰 뒀다 → 서버로 옮길 때 이름만 바꾸면 된다.

   [저장소(표) 네 개]
     계정       ↔ ERD app_user     — 한 사람 한 줄. 열쇠는 이메일, 닉네임은 겹치면 안 됨(고유 색인)
     데이터     ↔ (플레이 기록)     — 계정별 기록·설정. 같은 열쇠로 나눠 둔다
     동의기록   ↔ ERD consent_log  — 무엇에·언제·어느 약관 판에 동의했나. 지우지 않고 쌓는다
     로그인시도 ↔ (서버의 잠금 표) — 틀린 횟수와 잠긴 시각

   [ERD app_user 와 칸 맞춤]
     id              ← 아이디 (crypto.randomUUID)
     email           ← 이메일 (소문자로 다듬어서)
     social_provider ← 소셜 (이메일 가입은 null)
     password_hash   ← 비번해시  "pbkdf2_sha256$반복$소금$해시" 한 줄 (varchar(255) 안에 들어감)
     nickname        ← 이름 (+ 겹침 검사용 닉네임키 = 소문자)
     created_at      ← 가입때
     (지역·테스트 는 ERD 에 없는 화면용 칸 — 서버와 맞출 때 의논 필요)

   [비밀번호를 어떻게 두나]
   그대로 저장하지 않는다. 계정마다 다른 소금(salt)을 뽑고 PBKDF2 로
   210,000번 늘려 만든 해시만 남긴다.
   · 소금이 계정마다 다르니 같은 비밀번호라도 해시가 다르다(미리 계산한 표로 못 깬다).
   · 반복 횟수가 크면 한 번 맞춰 보는 데 시간이 걸려 무차별 대입이 느려진다.
   · 확인할 때는 **끝까지** 비교한다 — 중간에 멈추면 걸린 시간으로 몇 글자가 맞았는지 샌다.
   ═══════════════════════════════════════════════════════ */

const 디비이름 = "왜곡계정";
/* 판(버전)을 1 → 2 로 올렸다. 올리면 브라우저가 onupgradeneeded 를 불러 주고,
   거기서 새 표·색인을 만든다. 1판에서 가입한 계정은 **그대로 남는다**. */
const 판 = 2;
const 계정칸 = "계정";
const 데이터칸 = "데이터";
const 동의칸 = "동의기록";
const 시도칸 = "로그인시도";

/* 약관 판 — 약관 글이 바뀌면 이 값을 올린다. 동의기록에 같이 남아서
   「이 사람은 어느 판에 동의했나」를 나중에 알 수 있다 (ERD consent_log.version) */
export const 약관판 = "2026-09";

/* 로그인 잠금 — 5번 틀리면 5분 */
const 잠금횟수 = 5;
const 잠금시간 = 5 * 60 * 1000;

/* 브라우저가 이 기능을 쓸 수 있나 — 사생활 보호 모드에서 막히기도 한다 */
export function 저장소쓸수있나() {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

let 열린것 = null;

function 열기() {
  if (열린것) return 열린것;
  열린것 = new Promise((맞음, 틀림) => {
    const 요청 = indexedDB.open(디비이름, 판);
    요청.onupgradeneeded = (e) => {
      const db = 요청.result;
      const 옛판 = e.oldVersion; // 처음 만드는 거면 0
      /* 1판: 계정·데이터 */
      if (!db.objectStoreNames.contains(계정칸)) db.createObjectStore(계정칸, { keyPath: "이메일" });
      if (!db.objectStoreNames.contains(데이터칸)) db.createObjectStore(데이터칸, { keyPath: "이메일" });
      /* 2판: 닉네임 고유 색인 + 동의기록 + 로그인시도 */
      if (옛판 < 2) {
        const 계정표 = 요청.transaction.objectStore(계정칸);
        /* unique: true — 같은 닉네임키로 두 번째 줄을 넣으면 저장소가 **거부**한다.
           화면에서 미리 막더라도, 두 탭에서 동시에 가입하는 경우까지 막아 주는 마지막 벽이다.
           (1판 계정은 닉네임키 칸이 없어서 색인에 안 잡힌다 — 오류 없이 넘어간다) */
        if (!계정표.indexNames.contains("닉네임키")) 계정표.createIndex("닉네임키", "닉네임키", { unique: true });
        if (!db.objectStoreNames.contains(동의칸)) {
          const 동의표 = db.createObjectStore(동의칸, { keyPath: "아이디" });
          동의표.createIndex("계정", "계정아이디"); // 한 사람의 동의를 모아 볼 때
        }
        if (!db.objectStoreNames.contains(시도칸)) db.createObjectStore(시도칸, { keyPath: "이메일" });
      }
    };
    요청.onsuccess = async () => {
      const db = 요청.result;
      /* 다른 탭이 더 새 판으로 열면 이 연결을 닫아 준다(안 닫으면 그쪽 업그레이드가 멈춘다) */
      db.onversionchange = () => { db.close(); 열린것 = null; };
      try {
        await 테스트계정심기(db);
      } catch {
        /* 테스트 계정을 못 심어도 저장소는 써야 한다 */
      }
      맞음(db);
    };
    요청.onerror = () => { 열린것 = null; 틀림(요청.error); };
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

async function 섞기(비밀번호, 소금, 횟수 = 반복) {
  const 씨앗 = await crypto.subtle.importKey("raw", new TextEncoder().encode(비밀번호), "PBKDF2", false, ["deriveBits"]);
  const 뼈 = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: 소금, iterations: 횟수, hash: "SHA-256" }, 씨앗, 256);
  return 열엿자(뼈);
}

/* 해시 한 줄 만들기/풀기 — "pbkdf2_sha256$210000$<소금>$<해시>"
   알고리즘·반복 횟수를 같이 적어 두면, 나중에 횟수를 올려도 옛 해시를 읽을 수 있다. */
const 해시줄 = (소금, 해시) => `pbkdf2_sha256$${반복}$${소금}$${해시}`;
function 해시풀기(줄) {
  if (줄.비번해시) {
    const [, 횟수, 소금, 해시] = 줄.비번해시.split("$");
    return { 횟수: Number(횟수), 소금, 해시 };
  }
  return { 횟수: 반복, 소금: 줄.소금, 해시: 줄.해시 }; // 1판에 가입한 계정(칸이 따로였다)
}

/* 같은지 비교하되 **길이만큼 끝까지** 본다 — 중간에 멈추면 시간차로 새어 나간다 */
function 같은가(ㄱ, ㄴ) {
  if (ㄱ.length !== ㄴ.length) return false;
  let 다름 = 0;
  for (let i = 0; i < ㄱ.length; i += 1) 다름 |= ㄱ.charCodeAt(i) ^ ㄴ.charCodeAt(i);
  return 다름 === 0;
}

const 다듬기 = (이메일) => String(이메일 || "").normalize("NFC").trim().toLowerCase();
const 닉네임키 = (닉네임) => String(닉네임 || "").normalize("NFC").trim().toLowerCase();

/* 바깥(화면·세션)에 내보내는 모양 — 해시·소금은 **절대** 밖으로 안 나간다 */
const 내보내기 = (줄) => ({ 아이디: 줄.아이디, 이메일: 줄.이메일, 이름: 줄.이름, 지역: 줄.지역, 가입때: 줄.가입때, 테스트: Boolean(줄.테스트) });

/* ═══════════════════════════════════════════════════════
   테스트 계정 — 이름 TEST / test123@naver.com / test123

   [왜 규칙 밖인가]
   test123 은 가입 규칙(8자·대문자·숫자…)에 안 맞는다. 그래서 **가입 화면으로는
   절대 만들 수 없고**, 여기서 저장소에 직접 심는다. 다른 사람은 이런 비밀번호로 가입 못 한다.
   · 로그인은 가입 규칙이 아니라 「비었나」만 보므로 이 계정으로 들어갈 수 있다.
   · 비밀번호는 코드에 **평문으로 두지 않는다** — 미리 계산한 PBKDF2 해시만 둔다.
   · 이메일(test123@naver.com)·닉네임(TEST)을 차지하고 있으니 남이 가입할 수 없다.
   · 비밀번호 바꾸기는 막는다(팀원이 같이 쓰는 계정이 바뀌면 곤란하다).
   · 탈퇴해 보면 지워지고, 다음에 페이지를 열 때 다시 심어진다.
   · 실서비스에선 .env 에 VITE_TEST_ACCOUNT=off 를 넣어 끈다. ★ 출시 전에 꼭 끌 것.
     (환경변수 이름은 영문만 — 한글 이름은 Vite 가 읽지 못한다. 이동표.js 게임주소 주석)
   ═══════════════════════════════════════════════════════ */
export const 테스트계정켜짐 = (import.meta.env.VITE_TEST_ACCOUNT ?? "on") !== "off";
const 테스트계정 = {
  아이디: "00000000-0000-4000-8000-000000000001", // 테스트 계정은 아이디도 고정 — 팀원 기기마다 같다
  이메일: "test123@naver.com",
  소셜: null,
  /* node 로 미리 계산: pbkdf2("test123", 소금, 210000, sha256) */
  비번해시: "pbkdf2_sha256$210000$d08f5a8867fe0f56939831965d2d0fb2$dfbbd540b205077d2a3679355039196f4cf0d30f79def7ede1c099926258c4f7",
  이름: "TEST",
  닉네임키: "test",
  지역: "전남",
  가입때: Date.UTC(2026, 8, 1),
  테스트: true,
};

function 테스트계정심기(db) {
  return new Promise((맞음) => {
    const 거래 = db.transaction([계정칸, 데이터칸], "readwrite");
    const 계정표 = 거래.objectStore(계정칸);
    const 찾기 = 계정표.get(테스트계정.이메일);
    찾기.onsuccess = () => {
      if (!테스트계정켜짐) {
        /* 꺼 두면 전에 심은 것도 치운다 — 출시 후 남아 있으면 누구나 로그인할 수 있다 */
        if (찾기.result?.테스트) { 계정표.delete(테스트계정.이메일); 거래.objectStore(데이터칸).delete(테스트계정.이메일); }
        return;
      }
      if (찾기.result) return; // 이미 있다
      계정표.put(테스트계정);
      거래.objectStore(데이터칸).put({ 이메일: 테스트계정.이메일, 기록: [], 설정: {} });
    };
    거래.oncomplete = () => 맞음();
    거래.onerror = () => 맞음();
    거래.onabort = () => 맞음();
  });
}

/* ── 로그인 잠금 ─────────────────────────────────────────
   같은 이메일로 5번 틀리면 5분 동안 로그인을 막는다(비밀번호 마구 넣어 보기 방지).
   · **없는 이메일도 똑같이** 센다 — 없는 이메일만 안 잠기면 「이건 가입 안 된 메일」이 드러난다.
   · 브라우저 저장소라 지우면 풀린다 → 여기선 실수·장난을 늦추는 정도다.
     진짜 잠금은 서버가 IP·계정 단위로 해야 한다. */
async function 시도읽기(키) {
  return (await 하기(시도칸, "readonly", (칸) => 칸.get(키))) ?? { 이메일: 키, 실패: 0, 잠김까지: 0 };
}

/** 잠겨 있으면 남은 ms, 아니면 0 */
export async function 잠김남은시간(이메일) {
  if (!저장소쓸수있나()) return 0;
  const 기록 = await 시도읽기(다듬기(이메일));
  return Math.max(0, 기록.잠김까지 - Date.now());
}

const 분초 = (ms) => { const 초 = Math.ceil(ms / 1000); return `${Math.floor(초 / 60)}분 ${String(초 % 60).padStart(2, "0")}초`; };

/* ── 바깥에서 쓰는 것들 ───────────────────────────────── */

/** 이 이메일로 이미 가입했나 */
export async function 이미있나(이메일) {
  if (!저장소쓸수있나()) return false;
  const 사람 = await 하기(계정칸, "readonly", (칸) => 칸.get(다듬기(이메일)));
  return Boolean(사람);
}

/** 이 닉네임을 누가 쓰고 있나 (대소문자 무시: Test = TEST) */
export async function 닉네임있나(닉네임) {
  if (!저장소쓸수있나()) return false;
  const 사람 = await 하기(계정칸, "readonly", (칸) => 칸.index("닉네임키").get(닉네임키(닉네임)));
  return Boolean(사람);
}

/** 회원가입. 성공하면 { 좋음: true, 사람 }, 아니면 { 좋음: false, 까닭, 칸 } */
export async function 가입({ 이메일, 비밀번호, 닉네임, 지역, 동의 = {} }) {
  if (!저장소쓸수있나()) {
    return { 좋음: false, 까닭: "이 브라우저에서는 계정을 저장할 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요." };
  }
  const 키 = 다듬기(이메일);
  const 닉키 = 닉네임키(닉네임);
  if (await 이미있나(키)) return { 좋음: false, 칸: "이메일", 까닭: "이미 가입된 이메일입니다. 로그인해 주세요." };
  if (닉키 && (await 닉네임있나(닉키))) return { 좋음: false, 칸: "닉네임", 까닭: "이미 사용 중인 닉네임입니다." };

  const 소금 = crypto.getRandomValues(new Uint8Array(16));
  const 해시 = await 섞기(비밀번호, 소금);
  const 지금 = Date.now();

  const 줄 = {
    아이디: crypto.randomUUID(),
    이메일: 키,
    소셜: null,
    비번해시: 해시줄(열엿자(소금), 해시),
    이름: String(닉네임 || "").normalize("NFC").trim() || 키.split("@")[0],
    닉네임키: 닉키 || 키.split("@")[0],
    지역: String(지역 || "").trim(),
    가입때: 지금,
    테스트: false,
  };

  /* ── 한 거래(transaction)로 세 표에 같이 쓴다 ──
     계정만 들어가고 동의기록이 빠지는 식의 **반쪽 가입**이 생기면 안 된다.
     한 거래 안의 쓰기는 전부 되거나 전부 안 된다(하나라도 실패하면 모두 되돌린다). */
  const db = await 열기();
  try {
    await new Promise((맞음, 틀림) => {
      const 거래 = db.transaction([계정칸, 데이터칸, 동의칸], "readwrite");
      /* add — 같은 열쇠(이메일)나 같은 닉네임키가 있으면 put 과 달리 **덮어쓰지 않고 실패**한다 */
      거래.objectStore(계정칸).add(줄);
      거래.objectStore(데이터칸).put({ 이메일: 키, 기록: [], 설정: {} }); // 옛 찌꺼기가 있으면 새 빈 칸으로
      const 동의표 = 거래.objectStore(동의칸);
      for (const [종류, 했나] of Object.entries(동의)) {
        동의표.add({ 아이디: crypto.randomUUID(), 계정아이디: 줄.아이디, 종류, 판: 약관판, 동의: Boolean(했나), 동의때: 지금, 철회때: null });
      }
      거래.oncomplete = 맞음;
      거래.onerror = () => 틀림(거래.error);
      거래.onabort = () => 틀림(거래.error);
    });
  } catch (문제) {
    /* ConstraintError = 고유 조건 위반. 확인과 저장 사이에 다른 탭이 먼저 가입한 경우다 */
    if (문제?.name === "ConstraintError") return { 좋음: false, 까닭: "방금 같은 이메일이나 닉네임으로 가입한 계정이 있습니다. 다시 확인해 주세요." };
    return { 좋음: false, 까닭: "가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { 좋음: true, 사람: 내보내기(줄) };
}

/* 없는 계정일 때도 해시를 **똑같이 한 번** 돌리기 위한 가짜 소금.
   안 돌리면 없는 이메일은 바로(수 ms), 있는 이메일은 늦게(수백 ms) 답해서
   걸린 시간만으로 가입 여부가 드러난다. */
const 가짜소금 = new Uint8Array(16);

/** 로그인. 성공하면 { 좋음: true, 사람 }. 실패하면 { 좋음: false, 까닭, 잠김까지? } */
export async function 로그인(이메일, 비밀번호) {
  if (!저장소쓸수있나()) return { 좋음: false, 까닭: "이 브라우저에서는 계정을 읽을 수 없습니다." };
  const 키 = 다듬기(이메일);

  /* ① 잠겨 있으면 비밀번호를 맞춰 보지도 않는다 */
  const 기록 = await 시도읽기(키);
  if (기록.잠김까지 > Date.now()) {
    return { 좋음: false, 잠김까지: 기록.잠김까지, 까닭: `로그인을 ${잠금횟수}번 실패해 잠시 잠겼습니다. ${분초(기록.잠김까지 - Date.now())} 뒤에 다시 시도해 주세요.` };
  }

  /* ② 맞춰 보기 — 계정이 없어도 해시는 똑같이 돌린다(위 가짜소금) */
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));
  const 풀린것 = 줄 ? 해시풀기(줄) : null;
  const 해시 = await 섞기(비밀번호, 풀린것 ? 열엿자거꾸로(풀린것.소금) : 가짜소금, 풀린것?.횟수 ?? 반복);
  const 맞았나 = Boolean(풀린것) && 같은가(해시, 풀린것.해시);

  if (!맞았나) {
    /* ③ 실패 — 횟수를 올리고, 다 차면 잠근다 */
    const 실패 = 기록.실패 + 1;
    const 잠김 = 실패 >= 잠금횟수;
    await 하기(시도칸, "readwrite", (칸) => 칸.put({ 이메일: 키, 실패: 잠김 ? 0 : 실패, 잠김까지: 잠김 ? Date.now() + 잠금시간 : 0 }));
    /* 없는 계정과 틀린 비밀번호를 **같은 말**로 답한다 — 어떤 메일이 가입돼 있는지 못 캐낸다 */
    if (잠김) return { 좋음: false, 잠김까지: Date.now() + 잠금시간, 까닭: `로그인을 ${잠금횟수}번 실패해 5분 동안 잠깁니다.` };
    const 남음 = 잠금횟수 - 실패;
    return { 좋음: false, 까닭: `이메일 또는 비밀번호가 올바르지 않습니다.${실패 >= 3 ? ` (${남음}번 더 틀리면 5분간 잠깁니다)` : ""}` };
  }

  /* ④ 성공 — 실패 기록을 지우고, 로그인 기록(마이페이지 「로그인 기록」)에 남긴다 */
  await 하기(시도칸, "readwrite", (칸) => 칸.delete(키));
  await 로그인기록남기기(키);
  return { 좋음: true, 사람: 내보내기(줄) };
}

/* ── 로그인 기록 ── 최근 10번만 남긴다(언제 · 어떤 브라우저·기기)
   「내가 모르는 로그인이 있었나」를 스스로 확인하는 용도다. IP 는 브라우저가 알 수 없어 서버 몫. */
function 기기이름() {
  const ua = navigator.userAgent || "";
  const 브라우저 = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "브라우저";
  const 기기 = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "기기";
  return `${브라우저} · ${기기}`;
}
async function 로그인기록남기기(키) {
  try {
    const 지금 = (await 계정데이터(키)) ?? { 이메일: 키, 기록: [], 설정: {} };
    const 로그인들 = [{ 때: Date.now(), 기기: 기기이름() }, ...(지금.로그인들 ?? [])].slice(0, 10);
    await 하기(데이터칸, "readwrite", (칸) => 칸.put({ ...지금, 로그인들 }));
  } catch {
    /* 기록을 못 남겨도 로그인은 되어야 한다 */
  }
}

/** 로그인한 채로 비밀번호 바꾸기 — **지금 비밀번호를 먼저 확인**한다(마이페이지 「비밀번호 변경」).
 *  자리를 비운 사이 남이 바꾸지 못하게 하는 흔한 장치다. */
export async function 비밀번호확인후바꾸기(이메일, 지금비밀번호, 새비밀번호) {
  if (!저장소쓸수있나()) return { 좋음: false, 까닭: "저장소를 쓸 수 없습니다." };
  const 키 = 다듬기(이메일);
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));
  if (!줄) return { 좋음: false, 까닭: "계정을 찾을 수 없습니다." };
  if (줄.테스트) return { 좋음: false, 까닭: "테스트 계정은 비밀번호를 바꿀 수 없습니다." };
  const 풀린것 = 해시풀기(줄);
  const 해시 = await 섞기(지금비밀번호, 열엿자거꾸로(풀린것.소금), 풀린것.횟수);
  if (!같은가(해시, 풀린것.해시)) return { 좋음: false, 칸: "지금비밀번호", 까닭: "지금 비밀번호가 맞지 않습니다." };
  if (지금비밀번호 === 새비밀번호) return { 좋음: false, 칸: "새비밀번호", 까닭: "지금과 다른 비밀번호를 써 주세요." };
  return 비밀번호바꾸기(키, 새비밀번호);
}

/** 내 데이터 내려받기 — 계정 정보 · 기록 · 설정 · 동의 이력(해시·소금은 빼고) */
export async function 내데이터(이메일) {
  if (!저장소쓸수있나()) return null;
  const 키 = 다듬기(이메일);
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));
  if (!줄) return null;
  const 데이터 = (await 계정데이터(키)) ?? {};
  const 동의 = 줄.아이디 ? await 하기(동의칸, "readonly", (칸) => 칸.index("계정").getAll(줄.아이디)) : [];
  return {
    내보낸때: new Date().toISOString(),
    계정: 내보내기(줄),
    설정: 데이터.설정 ?? {},
    플레이기록: 데이터.기록 ?? [],
    로그인기록: (데이터.로그인들 ?? []).map((ㄹ) => ({ ...ㄹ, 때: new Date(ㄹ.때).toISOString() })),
    동의기록: 동의.map(({ 종류, 판, 동의: 했나, 동의때, 철회때 }) => ({ 종류, 판, 동의: 했나, 동의때: new Date(동의때).toISOString(), 철회때: 철회때 ? new Date(철회때).toISOString() : null })),
  };
}

/** 비밀번호 바꾸기 — 재설정 흐름에서 쓴다 */
export async function 비밀번호바꾸기(이메일, 새비밀번호) {
  if (!저장소쓸수있나()) return { 좋음: false, 까닭: "저장소를 쓸 수 없습니다." };
  const 키 = 다듬기(이메일);
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));
  if (!줄) return { 좋음: false, 까닭: "가입되지 않은 이메일입니다." };
  if (줄.테스트) return { 좋음: false, 까닭: "테스트 계정은 비밀번호를 바꿀 수 없습니다." };

  const 소금 = crypto.getRandomValues(new Uint8Array(16));
  const 해시 = await 섞기(새비밀번호, 소금);
  const { 소금: _옛소금, 해시: _옛해시, ...나머지 } = 줄; // 1판 칸(소금·해시)은 치우고 새 한 줄로
  await 하기(계정칸, "readwrite", (칸) => 칸.put({ ...나머지, 비번해시: 해시줄(열엿자(소금), 해시) }));
  await 하기(시도칸, "readwrite", (칸) => 칸.delete(키)); // 바꿨으니 잠금도 푼다
  return { 좋음: true };
}

/** 탈퇴 — 계정과 **그 계정의 데이터까지** 지운다. 동의기록은 「철회」로 남긴다 */
export async function 탈퇴(이메일) {
  if (!저장소쓸수있나()) return { 좋음: false, 까닭: "저장소를 쓸 수 없습니다." };
  const 키 = 다듬기(이메일);
  const 줄 = await 하기(계정칸, "readonly", (칸) => 칸.get(키));
  if (줄?.아이디) {
    const 동의들 = await 하기(동의칸, "readonly", (칸) => 칸.index("계정").getAll(줄.아이디));
    for (const 한줄 of 동의들) await 하기(동의칸, "readwrite", (칸) => 칸.put({ ...한줄, 철회때: 한줄.철회때 ?? Date.now() }));
  }
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

/** 서버로 옮길 때 쓰는 모양 — ERD app_user 칸 이름으로 바꿔 준다 (비밀번호 해시는 서버 이관 때만) */
export const ERD모양 = (줄) => ({
  id: 줄.아이디,
  email: 줄.이메일,
  social_provider: 줄.소셜 ?? null,
  password_hash: 줄.비번해시 ?? null,
  nickname: 줄.이름,
  birth_year: null, // 지금 화면은 「만 14세 이상」 확인만 받는다
  created_at: new Date(줄.가입때).toISOString(),
});
