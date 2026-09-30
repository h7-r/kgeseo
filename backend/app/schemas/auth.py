from pydantic import BaseModel, Field


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class GoogleUserResponse(BaseModel):
    provider: str
    subject: str
    email: str
    email_verified: bool
    name: str | None = None
    picture: str | None = None
