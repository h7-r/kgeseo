from pydantic import BaseModel, Field


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
    terms_version: str = Field(default="2026-09", min_length=1, max_length=32)


class LocalRegisterRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)
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
