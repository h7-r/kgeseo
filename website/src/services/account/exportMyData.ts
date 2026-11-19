/**
 * 「데이터 관리 · 내보내기」 — 서버에 있는 내 데이터를 모아 JSON 파일 하나로(개인정보 열람 요구의 FE 몫).
 * 한 번에 주는 GET /me/export 는 아직 없어(11/18) /me 아래 다섯을 각각 읽는다. 비밀번호 해시는 서버가 어디에도 내주지 않는다.
 * 사람이 읽는 파일이라 키·값을 한국어로 둔다. 저장본의 state 는 게임이 쓰는 모양 그대로.
 */
import type { CharacterBody, GameSaveBody, OwnedItemBody } from "@/lib/myProgress";
import { categoryLabel, inquiryStatusLabel, type MyInquiry } from "@/services/inquiries";

import { PROVIDER_LABEL, type MeBody } from "./meProfile";
import { getMine, SignedOutError } from "./myProgress";

/** 서버에서 읽어 온 다섯 조각 */
export interface MyDataParts {
  me: MeBody;
  save: GameSaveBody | null;
  character: CharacterBody | null;
  items: OwnedItemBody[];
  inquiries: MyInquiry[];
}

export interface ExportedMyData {
  내보낸때: string;
  안내: string;
  계정: {
    아이디: string;
    이메일: string;
    닉네임: string;
    지역: string | null;
    가입때: string | null;
    가입방식: string[];
  };
  게임저장: { 스테이지: string; 저장때: string; 상태: unknown } | null;
  캐릭터: { 이름: string; 외형: Record<string, unknown> } | null;
  아이템: { 아이디: string; 종류: string; 이름: string; 수량: number; 출처: string; 얻은때: string }[];
  문의: {
    접수번호: string;
    유형: string;
    제목: string;
    내용: string;
    상태: string;
    접수때: string;
    답변: { 내용: string; 답변때: string }[];
  }[];
}

/** 조각들을 내려받을 파일 모양으로. 순수 함수라 테스트에서 그대로 쓴다 */
export function composeMyData(parts: MyDataParts, exportedAt: Date = new Date()): ExportedMyData {
  const { me, save, character, items, inquiries } = parts;
  return {
    내보낸때: exportedAt.toISOString(),
    안내: "이 파일은 서버에 저장된 내 데이터입니다. 시각은 UTC 입니다. 비밀번호는 서버에도 해시로만 있어 포함되지 않습니다.",
    계정: {
      아이디: me.user_id,
      이메일: me.email,
      닉네임: me.nickname,
      지역: me.region,
      가입때: me.created_at ?? null,
      가입방식: (me.providers ?? []).map((provider) => PROVIDER_LABEL[provider] ?? provider),
    },
    게임저장: save ? { 스테이지: save.stage, 저장때: save.updated_at, 상태: save.state } : null,
    캐릭터: character ? { 이름: character.display_name, 외형: character.appearance } : null,
    아이템: items.map((item) => ({
      아이디: item.item_id,
      종류: item.kind,
      이름: item.name,
      수량: item.quantity,
      출처: item.source,
      얻은때: item.acquired_at,
    })),
    문의: inquiries.map((inquiry) => ({
      접수번호: inquiry.number,
      유형: categoryLabel(inquiry.category),
      제목: inquiry.title,
      내용: inquiry.body,
      상태: inquiryStatusLabel(inquiry.status),
      접수때: inquiry.created_at,
      답변: inquiry.replies.map((reply) => ({ 내용: reply.body, 답변때: reply.created_at })),
    })),
  };
}

export type ExportMyDataResult =
  | { ok: true; data: ExportedMyData }
  /** 로그인이 풀렸다 */
  | { ok: false; reason: "signedOut" }
  /** 서버에 못 닿았다 — 다시 시도하면 된다 */
  | { ok: false; reason: "error" };

/** /me 아래 다섯을 한꺼번에 읽어 파일 모양으로. 하나라도 못 읽으면 반쪽 파일을 만들지 않는다 */
export async function exportMyData(): Promise<ExportMyDataResult> {
  try {
    const [me, save, character, items, inquiryList] = await Promise.all([
      getMine<MeBody>("/api/v1/me"),
      getMine<GameSaveBody>("/api/v1/me/game-save"),
      getMine<CharacterBody>("/api/v1/me/character"),
      getMine<OwnedItemBody[]>("/api/v1/me/items"),
      getMine<{ items: MyInquiry[] }>("/api/v1/me/inquiries"),
    ]);
    if (!me) return { ok: false, reason: "error" };
    return {
      ok: true,
      data: composeMyData({ me, save, character, items: items ?? [], inquiries: inquiryList?.items ?? [] }),
    };
  } catch (error) {
    return { ok: false, reason: error instanceof SignedOutError ? "signedOut" : "error" };
  }
}

/** 내보낸 파일 이름 — escape-legend-내데이터-2026-11-18.json */
export function exportFileName(exportedAt: Date = new Date()): string {
  return `escape-legend-내데이터-${exportedAt.toISOString().slice(0, 10)}.json`;
}

/** 값을 JSON 파일로 내려받게 한다. */
export function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  // 문서에 붙였다 떼야 download 파일 이름이 먹는 브라우저가 있다.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
