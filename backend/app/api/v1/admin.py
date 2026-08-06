import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.users import require_current_user
from app.database import get_db
from app.models import Avatar, Message, Session, User

logger = logging.getLogger(__name__)
router = APIRouter()


async def require_superuser(current_user: User = Depends(require_current_user)) -> User:
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return current_user


@router.get("/stats")
async def get_admin_stats(
    _: User = Depends(require_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Platform-wide counts for the admin dashboard overview."""

    async def _count(model, *where) -> int:
        query = select(func.count()).select_from(model)
        for condition in where:
            query = query.where(condition)
        result = await db.execute(query)
        return int(result.scalar() or 0)

    return {
        "users_total": await _count(User),
        "users_active": await _count(User, User.is_active.is_(True)),
        "avatars_total": await _count(Avatar),
        "sessions_total": await _count(Session),
        "sessions_active": await _count(Session, Session.status == "active"),
        "messages_total": await _count(Message),
    }
