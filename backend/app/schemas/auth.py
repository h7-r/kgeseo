from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.core.terms import CURRENT_TERMS_VERSION


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class NaverLoginRequest(BaseModel):
    code: str = Field(min_length=1)
    state: str = Field(min_length=1)


class GoogleUserResponse(BaseModel):
    provider: str
    subject: str
    email: str
    email_verified: bool | None = None
    name: str | None = None
    picture: str | None = None


class LocalRegisterConsent(BaseModel):
    # 소셜 가입과 같은 엄격함(11/18): "true"·1·"on" 은 동의가 아니고, 모르는 키는 거절한다.
    model_config = ConfigDict(extra="forbid")

    terms: StrictBool
    privacy: StrictBool
    age: StrictBool
    # 비우면 서버의 현재 판으로 본다. 다른 판을 적으면 register_user 가 409 terms_version_mismatch 로 거절한다.
    terms_version: str = Field(
        default=CURRENT_TERMS_VERSION, min_length=1, max_length=32
    )


class LocalRegisterRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128, repr=False)
    nickname: str
    region: str | None = Field(default=None, max_length=32)
    consent: LocalRegisterConsent


class LocalLoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class LocalAccountUser(BaseModel):
    user_id: str
    email: str
    nickname: str
    region: str | None = None
    created_at: str
    provider: str = "local"


class LocalAuthResponse(BaseModel):
    user: LocalAccountUser


class LocalExistsResponse(BaseModel):
    exists: bool


class EmailExistsRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)


class NicknameExistsRequest(BaseModel):
    nickname: str


class SocialAccountUser(LocalAccountUser):
    provider: Literal["google", "naver"]


class SocialUserResponse(BaseModel):
    user: SocialAccountUser


class SocialOnboardingRequiredResponse(BaseModel):
    result: Literal["onboarding_required"] = "onboarding_required"
    onboarding_token: str
    expires_in: int = 600
    suggested_nickname: str
    terms_version: str = CURRENT_TERMS_VERSION


class SocialOnboardingConsent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    terms: StrictBool = False
    privacy: StrictBool = False
    age: StrictBool = False


class SocialOnboardingCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    onboarding_token: str = Field(default="", repr=False)
    nickname: str = ""
    terms_version: str = ""
    consent: SocialOnboardingConsent = Field(default_factory=SocialOnboardingConsent)
