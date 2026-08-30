"""The closed value sets the web needs to build its filter controls.

One request at start-up instead of a copy of every enum hard-coded in the client —
districts especially, which the parser owns and will grow.
"""

from typing import get_args

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.ingestion.parse.districts import DISTRICTS
from app.modules.listings.schemas import SourceKind
from app.modules.properties.schemas import ContactClassification, PropertyStatus

router = APIRouter(tags=["meta"])


class MetaOut(BaseModel):
    districts: list[str]
    statuses: list[PropertyStatus]
    source_kinds: list[SourceKind]
    contact_classifications: list[ContactClassification]


@router.get("/meta", response_model=MetaOut)
async def meta(_: CurrentUser) -> MetaOut:
    return MetaOut(
        districts=sorted(DISTRICTS),
        statuses=list(get_args(PropertyStatus)),
        source_kinds=list(get_args(SourceKind)),
        contact_classifications=list(get_args(ContactClassification)),
    )
