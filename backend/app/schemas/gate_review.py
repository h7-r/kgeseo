"""관리자 승인 입력 계약. HTTP 인증 연결 전에는 라우터에 노출하지 않는다."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TargetType = Literal["case_content", "dialogue_pack"]


class ApprovalTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    target_type: TargetType
    target_id: str = Field(min_length=1, max_length=64)
    content_version: int = Field(ge=1, strict=True)

    @field_validator("target_id")
    @classmethod
    def nonblank_target(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise ValueError(
                "target_id must not be blank or have surrounding whitespace"
            )
        return value


class GateReviewCreate(ApprovalTarget):
    gate: Literal["G1", "G2", "G3"]
    target_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    decision: Literal["approved", "revise", "escalate", "rejected", "hold"]
    reason: str | None = None
    supersedes: str | None = None

    # review_id, reviewed_at, reviewer는 입력받지 않는다.
