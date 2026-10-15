from sqlalchemy import Boolean, Column, Integer, String, Date
from database import Base

class FoodItem(Base):
    __tablename__ = "food_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, index=True)
    purchase_date = Column(Date)
    expiry_date = Column(Date)
    is_consumed = Column(Boolean, default=False)
