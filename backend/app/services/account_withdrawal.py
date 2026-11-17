"""회원 탈퇴 Phase 1 — 한 트랜잭션으로 지우고 비식별화한다(계약 `docs/contracts/account_withdrawal_v0.2.md`, WD-01~14).

순서(회원 행 배타 잠금이 맨 앞 — 로그인 `start_session` 과 같은 행을 같은 순서로 잠가 교착이 새로 생기지 않는다):

1. 회원 행 잠금 · 이미 탈퇴했는지
2. 관리자면 거절(WD-12) → 이메일 비밀번호 수단이 없으면 `reauth_required`(소셜 전용, WD-10) → 비밀번호 확인
3. 사용자가 보낸 입력에서 나온 값: NPC 턴 이벤트의 `message_sha256` 과 퍼즐 `submit_answer` 이벤트의 `answer` 를 null 로(행 · 다른 키 ·
   `result_type` · `response_json` 은 그대로), NPC 턴 재전송 기록(`npc_turn_requests`, 본문은 FK CASCADE)을 지운다(미르 11/17 확정).
4. 로그인한 채 접수한 문의(`inquiries.app_user_id`, 답변은 FK CASCADE, WD-08)
5. 게임 저장 · 캐릭터 · 아이템(WD-04)
6. 그 계정의 소셜 가입 대기 행 · 이메일 로그인 실패 집계(이메일이 남은 임시 행)
7. 로그인 수단(auth_identities) · 모든 로그인 세션(WD-02 · WD-11)
8. 이메일 · 닉네임을 원래 값과 무관한 무작위 값으로, 지역 · 동의 · 최근 로그인을 NULL 로, `deleted_at` 기록(WD-01 · 02 · 13)
9. COMMIT 한 번. 어디서든 실패하면 통째로 되돌린다.

남기는 것(WD-05~07 · 09): 회원 행(id · role · is_test · created_at), `play_sessions`(owner_user_id 그대로), `interaction_events` 행,
`beta_events`, `guest_session_transfers`, `admin_audit_logs`. 회원 행을 지우지 않으므로 FK 의 SET NULL · CASCADE 가 일어나지 않고,
통계는 탈퇴 회원을 계속 그 회원(`u:{id}`)으로 센다 — 게스트로 바뀌지 않는다. 내부 계정 판정(role · is_test)도 그대로다.
"""

import secrets

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account_data import (
    GamePlaySave,
    LoginThrottle,
    UserCharacter,
    UserItem,
    UserSession,
)
from app.models.app_user import AppUser
from app.models.auth_identity import AuthIdentity
from app.models.inquiry import Inquiry
from app.models.interaction_event import InteractionEvent
from app.models.npc_turn_idempotency import NpcTurnRequest
from app.models.play_session import PlaySession
from app.models.social_onboarding_pending import SocialOnboardingPending
from app.services.local_auth import normalize_email, utc_now, verify_password
from app.services.npc_turn_service import NPC_TURN_EVENT_TYPE
from app.services.user_session import hash_session_token

ADMIN_ROLE = "admin"
LOCAL_PROVIDER = "local"
# 탈퇴 표시 값. 닉네임은 가입 규칙([가-힣A-Za-z0-9_] 2~12자)이 `#` 을 받지 않아 새 가입과 겹칠 수 없다. 이메일은 `.invalid`
# 예약 도메인(실제 메일함이 될 수 없다)이지만 가입 형식 검사는 이 도메인을 막지 않는다 — 겹치지 않음은 128비트 난수가 보장한다.
WITHDRAWN_EMAIL_DOMAIN = "withdrawn.invalid"
WITHDRAWN_NICKNAME_PREFIX = "탈퇴#"
NPC_MESSAGE_HASH_KEY = "message_sha256"
PUZZLE_ANSWER_KEY = "answer"
SUBMIT_ANSWER_EVENT_TYPE = "submit_answer"
# 탈퇴 때 null 로 바꾸는 사용자 입력 값 — 상호작용 종류 → payload_json 의 키
INPUT_KEYS = {
    NPC_TURN_EVENT_TYPE: NPC_MESSAGE_HASH_KEY,
    SUBMIT_ANSWER_EVENT_TYPE: PUZZLE_ANSWER_KEY,
}


class WithdrawalRefused(Exception):
    """아무것도 바꾸지 않고 거절했다(트랜잭션은 되돌린 뒤). `code` 는 계약의 오류 code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def withdrawn_email() -> str:
    """원래 이메일 · 회원 id 와 무관한 128비트 난수 — 되돌릴 수 없고 다른 탈퇴 값과도 겹치지 않는다(VARCHAR 254 안)."""

    return f"deleted+{secrets.token_hex(16)}@{WITHDRAWN_EMAIL_DOMAIN}"


def withdrawn_nickname() -> str:
    """64비트 난수, 21자(VARCHAR 32 안). 가입 닉네임 규칙을 통과하지 못하는 꼴이라 새 가입과 겹치지 않는다."""

    return f"{WITHDRAWN_NICKNAME_PREFIX}{secrets.token_hex(8)}"


def _login_throttle_key(email: str) -> str:
    # user_session._throttle_keys 의 이메일 키와 같은 값(로그인 실패 집계 행)
    return hash_session_token(f"email:{normalize_email(email)}")


async def withdraw_member(db: AsyncSession, user_id: str, password: str | None) -> None:
    """회원 탈퇴. 성공하면 커밋까지 마친다. 거절이면 `WithdrawalRefused`(되돌린 뒤), 그 밖의 실패는 되돌리고 다시 던진다."""

    try:
        user = await db.scalar(
            select(AppUser)
            .where(AppUser.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if user is None or user.deleted_at is not None:
            raise WithdrawalRefused("already_withdrawn")
        if user.role == ADMIN_ROLE:
            raise WithdrawalRefused("admin_cannot_withdraw")

        identities = list(
            (
                await db.scalars(
                    select(AuthIdentity).where(AuthIdentity.app_user_id == user_id)
                )
            ).all()
        )
        local = next(
            (
                identity
                for identity in identities
                if identity.provider == LOCAL_PROVIDER and identity.password_hash
            ),
            None,
        )
        if local is None:
            # 소셜 전용 — 10분 안 소셜 재로그인 확인은 OAuth 작업 때(WD-10)
            raise WithdrawalRefused("reauth_required")
        if not password or not verify_password(password, local.password_hash):
            raise WithdrawalRefused("invalid_password")
        original_email = user.email
        social = [
            (identity.provider, identity.provider_subject)
            for identity in identities
            if identity.provider != LOCAL_PROVIDER
        ]

        # 이 회원이 가진 회차 — 잠금 읽기라 이 트랜잭션 스냅숏 뒤에 커밋된 회차도 본다
        play_session_ids = list(
            (
                await db.scalars(
                    select(PlaySession.id)
                    .where(PlaySession.owner_user_id == user_id)
                    .with_for_update(read=True)
                )
            ).all()
        )
        if play_session_ids:
            input_events = (
                await db.scalars(
                    select(InteractionEvent)
                    .where(
                        InteractionEvent.play_session_id.in_(play_session_ids),
                        InteractionEvent.interaction_type.in_(INPUT_KEYS),
                    )
                    .with_for_update()
                )
            ).all()
            for event in input_events:
                key = INPUT_KEYS[event.interaction_type]
                payload = event.payload_json
                if isinstance(payload, dict) and payload.get(key) is not None:
                    # 행 · 다른 키(trigger · focus_object_id · 멈춘 시간 등) · 판정 결과는 남긴다 — 통계 · 회차 기록은 그대로
                    event.payload_json = {**payload, key: None}
            await db.execute(
                delete(NpcTurnRequest).where(
                    NpcTurnRequest.play_session_id.in_(play_session_ids)
                )
            )

        await db.execute(delete(Inquiry).where(Inquiry.app_user_id == user_id))
        await db.execute(
            delete(GamePlaySave).where(GamePlaySave.app_user_id == user_id)
        )
        await db.execute(
            delete(UserCharacter).where(UserCharacter.app_user_id == user_id)
        )
        await db.execute(delete(UserItem).where(UserItem.app_user_id == user_id))
        for provider, subject in social:
            await db.execute(
                delete(SocialOnboardingPending).where(
                    SocialOnboardingPending.provider == provider,
                    SocialOnboardingPending.provider_subject == subject,
                )
            )
        await db.execute(
            delete(LoginThrottle).where(
                LoginThrottle.key_hash == _login_throttle_key(original_email)
            )
        )
        await db.execute(
            delete(AuthIdentity).where(AuthIdentity.app_user_id == user_id)
        )
        await db.execute(delete(UserSession).where(UserSession.app_user_id == user_id))

        now = utc_now()
        result = await db.execute(
            update(AppUser)
            .where(AppUser.id == user_id, AppUser.deleted_at.is_(None))
            .values(
                email=withdrawn_email(),
                nickname=withdrawn_nickname(),
                region=None,
                terms_version=None,
                terms_accepted_at=None,
                privacy_accepted_at=None,
                age_confirmed_at=None,
                last_login_at=None,
                deleted_at=now,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise RuntimeError("withdrawal did not update exactly one member row")
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
