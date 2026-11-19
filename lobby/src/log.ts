// 운영 로그 — 설계 v0.19 1절 기록 규칙. 입장 성공·실패 유형, 방 수, 오류, 지연만 남긴다.
// 티켓·쿠키 원문, 계정 ID, 닉네임, 위치·인사 내용은 넣지 않는다.
export type LogFields = Record<string, string | number | boolean | null>;
export type Logger = (event: string, fields?: LogFields) => void;

export const jsonLineLogger: Logger = (event, fields = {}) => {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), service: "waegok-lobby", event, ...fields })}\n`,
  );
};

export const silentLogger: Logger = () => {};
