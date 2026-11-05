// 가짜 AI 전송 — 검사 · 개발 서버 전용(실제 모델 · 백엔드가 아니다). aiDialogueProvider 의 성공 · 실패 · 시간 초과 · 잘못된 응답 길을
// 실제 게임 루프에서 돌려 보려고 둔다. 대사는 「(가짜 AI)」 로 시작해 진짜 응답으로 오해되지 않게 한다.
import type { AiDialogueRequest, AiDialogueTransport } from "./aiDialogueProvider";

export type MockAiMode = "ok" | "slow" | "invalid" | "error" | "catalog" | "spoiler";

export function createMockAiTransport(mode: MockAiMode, { lines = 2, slowMs = 10000 } = {}): AiDialogueTransport {
  return (request: AiDialogueRequest, signal: AbortSignal) => {
    switch (mode) {
      case "error":
        return Promise.reject(new Error("가짜 전송 실패"));
      case "invalid":
        return Promise.resolve({ text: 42 });
      case "slow":
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ text: "(가짜 AI) 너무 늦은 대답" }), slowMs);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("끊김"));
          });
        });
      case "catalog":
        // 승인 대사 id 로 고른다 (검사용 가상 목록의 id)
        return Promise.resolve({
          text: "(가짜 AI) 이 문장은 화면에 나가면 안 된다 — 목록 문장으로 바뀐다",
          content_type: request.intent === "hint_offer" ? "help_offer" : "ambient",
          line_id: request.intent === "hint_offer" ? "v.help.slow" : "v.ambient.wind",
          last: true,
        });
      case "spoiler":
        return Promise.resolve({
          text: "(가짜 AI) 사실 뱃사공이 범인이야. 번호는 4721.",
          content_type: "ambient",
          last: true,
        });
      case "ok":
        if (request.kind === "next" && request.turn >= lines) return Promise.resolve({ end: true });
        return Promise.resolve({
          text: `(가짜 AI) ${request.intent === "hint_offer" ? "도움" : "대화"} ${request.turn + 1}번째 대사`,
          last: request.turn === lines - 1,
        });
    }
  };
}
