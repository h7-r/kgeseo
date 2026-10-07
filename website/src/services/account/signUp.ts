import { createConsentRecord } from "./consents";
import { getAccount, isStorageAvailable, openDatabase, run } from "./db";
import { formatHash, hashPassword, toHex } from "./passwordHash";
import { emptyAccountData, normalizeEmail, toNicknameKey, toSessionUser } from "./records";
import { STORE } from "./schema";
import type { AccountRecord, ConsentKind, SignUpInput, SignUpResult } from "./types";

export async function isEmailTaken(email: string | undefined): Promise<boolean> {
  if (!isStorageAvailable()) return false;
  return Boolean(await getAccount(normalizeEmail(email)));
}

/** 이 닉네임을 누가 쓰고 있나(대소문자 무시: Test = TEST) */
export async function isNicknameTaken(nickname: string | undefined): Promise<boolean> {
  if (!isStorageAvailable()) return false;
  const account = await run(STORE.accounts, "readonly", (store) =>
    store.index("nicknameKey").get(toNicknameKey(nickname)),
  );
  return Boolean(account);
}

export async function signUp({ email, password, nickname, region, consents = {} }: SignUpInput): Promise<SignUpResult> {
  if (!isStorageAvailable()) {
    return {
      ok: false,
      reason: "이 브라우저에서는 계정을 저장할 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.",
    };
  }
  const key = normalizeEmail(email);
  const nicknameKey = toNicknameKey(nickname);
  if (await isEmailTaken(key))
    return { ok: false, field: "email", reason: "이미 가입된 이메일입니다. 로그인해 주세요." };
  if (nicknameKey && (await isNicknameTaken(nicknameKey))) {
    return { ok: false, field: "nickname", reason: "이미 사용 중인 닉네임입니다." };
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const now = Date.now();

  const account: AccountRecord = {
    id: crypto.randomUUID(),
    email: key,
    socialProvider: null,
    passwordHash: formatHash(toHex(salt), hash),
    name:
      String(nickname || "")
        .normalize("NFC")
        .trim() || key.split("@")[0],
    nicknameKey: nicknameKey || key.split("@")[0],
    region: String(region || "").trim(),
    joinedAt: now,
    isTest: false,
  };

  // 계정만 들어가고 동의 기록이 빠지는 반쪽 가입이 없도록 한 거래로 세 표에 쓴다.
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE.accounts, STORE.accountData, STORE.consents], "readwrite");
      // add 는 같은 이메일·닉네임키가 있으면 덮어쓰지 않고 실패한다.
      transaction.objectStore(STORE.accounts).add(account);
      transaction.objectStore(STORE.accountData).put(emptyAccountData(key));
      const consentStore = transaction.objectStore(STORE.consents);
      for (const [kind, agreed] of Object.entries(consents) as [ConsentKind, boolean | undefined][]) {
        consentStore.add(createConsentRecord(account.id, kind, agreed, now));
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    // 확인과 저장 사이에 다른 탭이 먼저 가입하면 고유 조건 위반(ConstraintError)이 난다.
    if (error instanceof DOMException && error.name === "ConstraintError") {
      return { ok: false, reason: "방금 같은 이메일이나 닉네임으로 가입한 계정이 있습니다. 다시 확인해 주세요." };
    }
    return { ok: false, reason: "가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, user: toSessionUser(account) };
}
