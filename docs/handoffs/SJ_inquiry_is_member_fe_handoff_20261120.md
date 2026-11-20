# 문의 접수 `is_member` — FE 인수인계(세진 → 해랑, 11/20)

## 왜

화면은 로그인으로 보이는데 서버 세션이 만료 · 폐기됐으면, 서버는 문의를 **비회원으로 저장**한다(401 없음 — 기존 정책 그대로).
지금 접수 완료 카드는 `isSignedIn={Boolean(user)}`(`website/src/sections/support/InquiryPanel.tsx:182`, 브라우저 sessionStorage 표시)로
「마이페이지 「내 문의」에서 볼 수 있습니다」와 「마이페이지에서 내 문의 보기」 버튼을 고르므로, 이 경우 사용자는 「내 문의」에 없는 문의를 찾게 된다.

## 서버가 주는 것

`POST /api/v1/inquiries` 201 응답에 **필수 boolean `is_member`** 가 붙는다(계약 `backend/docs/contracts/admin_api_v0.3_phase3.md` 공개 API 절).

```json
{ "id": "…", "number": "INQ-20261120-00012", "created_at": "2026-11-20T05:10:00", "is_member": false }
```

| 값 | 뜻 | 완료 안내 |
|---|---|---|
| `true` | 저장된 문의가 회원 계정에 연결됨 | 「답변이 등록되면 마이페이지 「내 문의」에서 볼 수 있습니다」 + 「내 문의 보기」 버튼 |
| `false` | 비회원 문의로 저장됨 | 「운영팀이 적어 주신 이메일로 따로 답변드립니다(자동 발송 아님)」 + 접수 번호 메모 안내, 버튼 없음 |

- 값은 실제 저장된 `inquiries.app_user_id` 로 정한다. 요청 본문의 이메일이 회원 이메일과 같아도 세션이 없으면 `false` 다.
- 회원 id · 이메일 · 닉네임 · 세션 값은 응답에 없다. 기존 세 필드는 그대로다.

## FE 변경 제안(최소)

1. `website/src/services/inquiries.ts` `submitInquiry`: 응답의 `is_member` 를 결과에 싣는다.
   ```ts
   type SubmitResult = { ok: true; id: string; number: string; createdAt: number; isMember: boolean | null } | …
   // body.is_member 가 boolean 이면 그 값, 아니면 null(구 서버)
   ```
2. `InquiryPanel.tsx`: 영수증(`setReceipt`)에 접수 때의 `isMember` 를 함께 저장하고, `ReceiptCard` 의 `isSignedIn` 대신 쓴다.
   - `isMember === null`(서버가 아직 구 버전)일 때만 지금처럼 `Boolean(user)` 로 대체한다.
   - 「추가 접수하기」로 여러 건을 접수하면 건마다 다를 수 있다 — 카드는 **마지막 접수의 값**을 쓴다(접수 건별로 저장).
3. `isMember === false && user` 이면 화면 로그인이 이미 끝난 것이다:
   - `endLocalSession()`(`website/src/services/session.ts:169`)으로 화면 로그인 표시를 정리한다(다른 `/me` 401 처리와 같은 방식).
   - 카드에 한 줄: 「로그인이 만료되어 비회원으로 접수되었습니다. 답변은 적어 주신 이메일로 따로 드립니다.」
4. 반대 경우(`isMember === true` 인데 화면은 로그아웃)는 「내 문의」 안내를 보여 주면 된다(로그인 표시 복구는 이번 범위 밖).

## 배포 순서 · 호환

- BE 먼저 배포 → FE. 구 FE 는 `is_member` 를 읽지 않으므로 BE 만 먼저 나가도 화면 변화 없음.
- FE 가 먼저 나가면 `is_member` 가 없으므로 `null` → 지금 동작(대체값) 그대로.

## FE 확인 항목(제안)

- 유효 로그인으로 접수 → 「내 문의」 안내 + 버튼, 마이페이지에 문의가 보임.
- 로그아웃 상태 접수 → 이메일 답변 안내, 버튼 없음.
- 로그인 표시가 남은 채 서버 세션 만료(개발 서버에서 세션 쿠키 삭제 또는 DB 세션 만료) → 만료 안내, 버튼 없음, 화면 로그인 표시 해제.
- 구 서버(필드 없음) 응답 → 지금과 같은 표시.
