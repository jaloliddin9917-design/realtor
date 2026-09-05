"""Response and request models for the properties API."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.listings.schemas import SourceKind

SortKey = Literal["last_seen", "first_seen", "price_asc", "price_desc"]
PropertyStatus = Literal["new", "active", "inactive"]
ContactClassification = Literal["owner", "agent", "unknown"]


class PriceOut(BaseModel):
    amount_minor: int | None
    currency: str | None
    usd_minor: int | None


class OwnerOut(BaseModel):
    contact_id: uuid.UUID
    kind: str
    identifier: str
    display_name: str | None
    classification: ContactClassification
    agency_score: float
    confidence: float | None


class StatusEventOut(BaseModel):
    id: int
    from_status: str | None
    to_status: str
    actor_type: str
    actor_id: uuid.UUID | None
    note: str | None
    created_at: datetime


class PropertyRow(BaseModel):
    id: uuid.UUID
    status: PropertyStatus
    district: str | None
    rooms: int | None
    floor: int | None
    total_floors: int | None
    area_sqm: float | None
    latitude: float | None
    longitude: float | None
    location_radius_m: int | None
    location_label: str | None
    building_type: str | None
    is_furnished: bool | None
    renovation: str | None
    year_built: int | None
    price_usd_min_minor: int | None
    source_removed: bool
    needs_recheck: bool
    first_seen_at: datetime
    last_seen_at: datetime
    listing_count: int
    source_kinds: list[str]
    probable_owner: OwnerOut | None
    photo_url: str | None
    last_status_event: StatusEventOut | None


class PropertyPage(BaseModel):
    items: list[PropertyRow]
    total: int
    page: int
    page_size: int


class PinOut(BaseModel):
    id: uuid.UUID
    latitude: float
    longitude: float
    price_usd_min_minor: int | None
    rooms: int | None
    status: PropertyStatus
    source_removed: bool


class PhotoOut(BaseModel):
    position: int
    url: str
    width: int | None
    height: int | None


class ContactOut(BaseModel):
    id: uuid.UUID
    kind: str
    identifier: str
    display_name: str | None
    classification: ContactClassification
    agency_score: float


class SourceRef(BaseModel):
    id: uuid.UUID
    kind: SourceKind
    name: str


class ListingOut(BaseModel):
    id: uuid.UUID
    source: SourceRef
    external_id: str
    url: str | None
    title: str
    description: str
    price: PriceOut
    rooms: int | None
    area_sqm: float | None
    floor: int | None
    total_floors: int | None
    district: str | None
    latitude: float | None
    longitude: float | None
    location_radius_m: int | None
    location_precise: bool | None
    location_label: str | None
    building_type: str | None
    is_furnished: bool | None
    renovation: str | None
    year_built: int | None
    attributes: dict[str, Any]
    address_text: str | None
    posted_at: datetime | None
    first_seen_at: datetime
    last_seen_at: datetime
    source_removed: bool
    owner_marker: bool
    agent_marker: bool
    parse_confidence: float
    photos: list[PhotoOut]
    contacts: list[ContactOut]


class DuplicateOut(BaseModel):
    property_id: uuid.UUID
    score: float


class PropertyDetail(PropertyRow):
    listings: list[ListingOut]
    status_events: list[StatusEventOut]
    duplicates: list[DuplicateOut]


class StatusIn(BaseModel):
    status: Literal["active", "inactive"]
    note: str | None = Field(None, max_length=500)
