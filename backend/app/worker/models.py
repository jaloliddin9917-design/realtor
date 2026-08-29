from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeat"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_tick_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
