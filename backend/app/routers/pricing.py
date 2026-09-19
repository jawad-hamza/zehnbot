"""What the plans cost. Limits (bots, messages) are code, in config.PLANS; the prices and the words around
them are the operator's to change, and the public marketing page (on another website) reads them from here."""
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.config import PLANS
from app.dependencies import get_db, require_superadmin
from app.models.setting import PlatformSetting
from app.models.user import User

public_router = APIRouter()
admin_router = APIRouter()

KEY = "plans_pricing"
DEFAULTS = {
    "currency": "$",
    "recommended": "starter",
    "plans": {
        "free": {"price": 0, "blurb": "Try it on one site."},
        "starter": {"price": 19, "blurb": "A small business with one or two sites."},
        "pro": {"price": 49, "blurb": "Busy sites, or an agency with several clients."},
        "business": {"price": 149, "blurb": "Agencies running many client sites."},
    },
}


class PlanPrice(BaseModel):
    price: float = Field(ge=0, le=100_000)
    blurb: str = Field(default="", max_length=120)

    @field_validator("price")
    @classmethod
    def _two_decimals(cls, v: float) -> float:
        return round(v, 2)

    @field_validator("blurb")
    @classmethod
    def _trimmed(cls, v: str) -> str:
        return v.strip()


class PricingSettings(BaseModel):
    currency: str = Field(default="$", min_length=1, max_length=4)
    recommended: Optional[str] = None
    plans: Dict[str, PlanPrice]

    @field_validator("currency")
    @classmethod
    def _plain_symbol(cls, v: str) -> str:
        v = v.strip()
        if not v or any(ch in v for ch in "<>&\"'"):
            raise ValueError("Use a currency symbol or code, such as $, £, Rs or USD")
        return v

    @model_validator(mode="after")
    def _known_plans(self):
        unknown = set(self.plans) - set(PLANS)
        if unknown or set(self.plans) != set(PLANS):
            raise ValueError(f"Give a price for each plan: {', '.join(PLANS)}")
        if self.recommended is not None and self.recommended not in PLANS:
            raise ValueError("The recommended plan must be one of the plans")
        if self.plans["free"].price != 0:
            raise ValueError("The free plan costs nothing; change its limits, not its price")
        return self


class PublicPlan(BaseModel):
    id: str
    name: str
    price: float
    currency: str
    blurb: str
    max_bots: int
    monthly_message_quota: int
    recommended: bool


def load_pricing(db: Session) -> PricingSettings:
    row = db.query(PlatformSetting).filter(PlatformSetting.key == KEY).first()
    try:
        return PricingSettings(**row.value) if row else PricingSettings(**DEFAULTS)
    except Exception:
        return PricingSettings(**DEFAULTS)      # a stored value from an older shape never breaks the public page


def public_plans(db: Session) -> List[PublicPlan]:
    pricing = load_pricing(db)
    return [
        PublicPlan(
            id=plan, name=plan.capitalize(), price=pricing.plans[plan].price, currency=pricing.currency,
            blurb=pricing.plans[plan].blurb, max_bots=limits["max_bots"],
            monthly_message_quota=limits["monthly_message_quota"], recommended=pricing.recommended == plan,
        )
        for plan, limits in PLANS.items()
    ]


@public_router.get("/plans", response_model=List[PublicPlan])
def list_public_plans(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"    # read by the marketing site on every visit
    return public_plans(db)


@admin_router.get("/pricing", response_model=PricingSettings)
def get_pricing(db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    return load_pricing(db)


@admin_router.put("/pricing", response_model=PricingSettings)
def set_pricing(body: PricingSettings, db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    row = db.query(PlatformSetting).filter(PlatformSetting.key == KEY).first()
    if row:
        row.value = body.model_dump()
    else:
        db.add(PlatformSetting(key=KEY, value=body.model_dump()))
    db.commit()
    return body
