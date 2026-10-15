from pydantic import BaseModel
from datetime import date
from typing import Optional

class FoodItemBase(BaseModel):
    name: str
    category: Optional[str] = "General"
    purchase_date: date
    expiry_date: date
    is_consumed: Optional[bool] = False

class FoodItemCreate(FoodItemBase):
    pass

class FoodItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    purchase_date: Optional[date] = None
    expiry_date: Optional[date] = None
    is_consumed: Optional[bool] = None

class FoodItem(FoodItemBase):
    id: int

    class Config:
        from_attributes = True
