import asyncio
import logging
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.api.v1.users import get_current_user
from app.database import get_db
from app.models import Message, Session, User
from app.schemas import MessageCreate, MessageResponse
from app.services.storage import storage_service

logger = logging.getLogger(__name__)
router = APIRouter()


def _user_id(current_user: Optional[User]) -> str:
    return current_user.id if current_user else "demo-user"


async def _get_owned_session(
    session_id: str, uid: str, db: AsyncSession, current_user: Optional[User] = None
) -> Session:
    """Fetch session and verify ownership (superusers may access any session)."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    is_admin = current_user is not None and current_user.is_superuser
    if session.user_id != uid and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to access this session"
        )
    return session


@router.post("/send", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    message_data: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Send a message in a session (REST fallback; prefer WebSocket for real-time)."""
    try:
        session = await _get_owned_session(message_data.session_id, _user_id(current_user), db, current_user)

        if session.status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not active"
            )

        message = Message(
            session_id=message_data.session_id,
            role="user",
            content=message_data.content,
            content_type=message_data.content_type,
        )
        db.add(message)
        await db.commit()
        await db.refresh(message)

        logger.info(f"Message created: {message.id}")
        return message

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to send message"
        )


@router.get("/session/{session_id}", response_model=List[MessageResponse])
async def list_session_messages(
    session_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """List messages in a session (must own the session)."""
    try:
        await _get_owned_session(session_id, _user_id(current_user), db, current_user)

        result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .offset(skip)
            .limit(limit)
            .order_by(Message.created_at)
        )
        return result.scalars().all()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list messages: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list messages"
        )


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get a message by ID (must own the parent session)."""
    try:
        result = await db.execute(select(Message).where(Message.id == message_id))
        message = result.scalar_one_or_none()
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

        # Verify ownership via parent session
        await _get_owned_session(message.session_id, _user_id(current_user), db, current_user)
        return message

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get message"
        )


@router.get("/{message_id}/video")
async def download_message_video(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Download the generated video for an assistant message as a single mp4.

    The pipeline generates one clip per sentence (see websocket.py's
    `_animate_from_queue`); their storage keys are recorded on the message's
    `message_metadata.video_chunks`. Chunks are concatenated with a stream
    copy (no re-encode, since they share codec/resolution) when there's more
    than one.
    """
    result = await db.execute(select(Message).where(Message.id == message_id))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    await _get_owned_session(message.session_id, _user_id(current_user), db, current_user)

    chunks = sorted(
        (message.message_metadata or {}).get("video_chunks") or [],
        key=lambda c: c.get("index", 0),
    )
    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No video available for this message"
        )

    tmp_dir = Path(tempfile.mkdtemp(prefix="msg-video-"))
    try:
        chunk_paths = []
        for i, chunk in enumerate(chunks):
            try:
                data = await storage_service.download_file(chunk["key"])
            except FileNotFoundError:
                continue
            path = tmp_dir / f"chunk_{i}.mp4"
            path.write_bytes(data)
            chunk_paths.append(path)

        if not chunk_paths:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Video chunks are no longer available",
            )

        if len(chunk_paths) == 1:
            output_path = chunk_paths[0]
        else:
            filelist = tmp_dir / "concat.txt"
            filelist.write_text("\n".join(f"file '{p.name}'" for p in chunk_paths))
            output_path = tmp_dir / "combined.mp4"
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(filelist),
                "-c",
                "copy",
                str(output_path),
                cwd=str(tmp_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0 or not output_path.exists():
                logger.error(
                    f"ffmpeg concat failed for message {message_id}: "
                    f"{stderr.decode(errors='replace')}"
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to assemble video",
                )

        return FileResponse(
            path=str(output_path),
            media_type="video/mp4",
            filename=f"message-{message.id[:8]}.mp4",
            background=BackgroundTask(shutil.rmtree, str(tmp_dir), True),
        )
    except HTTPException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.error(f"Failed to build video download for message {message_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to build video download",
        )


class MessageEditPayload(BaseModel):
    content: str = Field(..., min_length=1, max_length=8000)


@router.patch("/{message_id}", response_model=MessageResponse)
async def edit_message(
    message_id: str,
    payload: MessageEditPayload,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Edit a message's content (must own the parent session)."""
    try:
        result = await db.execute(select(Message).where(Message.id == message_id))
        message = result.scalar_one_or_none()
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

        await _get_owned_session(message.session_id, _user_id(current_user), db, current_user)
        message.content = payload.content.strip()
        await db.commit()
        await db.refresh(message)
        return message
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to edit message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to edit message"
        )


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Delete a message (must own the parent session)."""
    try:
        result = await db.execute(select(Message).where(Message.id == message_id))
        message = result.scalar_one_or_none()
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

        await _get_owned_session(message.session_id, _user_id(current_user), db, current_user)
        await db.delete(message)
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to delete message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete message"
        )
