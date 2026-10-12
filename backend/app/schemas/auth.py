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
    terms: bool
    privacy: bool
    age: bool
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


class SocialUserResponse(BaseModel):
    provider: Literal["google", "naver"]
    email: str
    nickname: str
    picture: str | None = None


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
