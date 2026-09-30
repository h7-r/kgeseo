from fastapi import APIRouter, HTTPException, status

from app.schemas.case_bundle import CaseBundleResponse
from app.services.case_bundle import get_case_bundle
from app.services.case_content import (
    CaseClientContentError,
    CaseClientContentNotFoundError,
    InvalidClientCaseIdError,
)
from app.services.case_content_validation import CaseContentLinkValidationError
from app.services.puzzle_runtime import (
    CaseRuntimeNotFoundError,
    InvalidCaseIdError,
    PuzzleRuntimeError,
)

router = APIRouter(
    prefix="/cases",
    tags=["Cases"],
)


@router.get(
    "/{case_id}/bundle",
    response_model=CaseBundleResponse,
    status_code=status.HTTP_200_OK,
)
async def get_case_bundle_endpoint(case_id: str) -> CaseBundleResponse:
    try:
        bundle = get_case_bundle(case_id)
    except (InvalidClientCaseIdError, InvalidCaseIdError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid case ID.",
        ) from error
    except (CaseClientContentNotFoundError, CaseRuntimeNotFoundError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found.",
        ) from error
    except (
        CaseClientContentError,
        PuzzleRuntimeError,
        CaseContentLinkValidationError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Case content is unavailable.",
        ) from error

    return CaseBundleResponse(success=True, data=bundle)
