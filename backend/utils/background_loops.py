import asyncio
from datetime import datetime, timedelta

from sqlalchemy import select

from database import AsyncSessionLocal
from models.db_models import User, DiaryEntry, KnowledgeObject
from utils.mentions import auto_tag_content
from utils.telegram_client import get_updates, send_message

AUTO_TAG_LOOP_INTERVAL = 60          # check every minute
AUTO_TAG_DELAY_MINUTES = 5           # only tag content that's been untouched for this long

TELEGRAM_LOOP_INTERVAL = 15          # poll every 15 seconds


async def run_auto_tag_pass():
    """One pass of the auto-tag automation — finds diary entries and object
    notes edited more than 5 minutes ago that haven't been auto-tagged
    since, and links any plain-text mentions of existing objects. Split out
    from the loop below so it can be tested/run standalone."""
    from routers.diary import _sync_mentions as _sync_diary_mentions
    from routers.objects import _sync_mentions as _sync_object_mentions

    async with AsyncSessionLocal() as db:
        users_result = await db.execute(select(User).where(User.auto_tag_enabled == True))
        users = users_result.scalars().all()
        cutoff = datetime.utcnow() - timedelta(minutes=AUTO_TAG_DELAY_MINUTES)

        for user in users:
            objs_result = await db.execute(select(KnowledgeObject).where(KnowledgeObject.user_id == user.id))
            all_objects = objs_result.scalars().all()

            entries_result = await db.execute(select(DiaryEntry).where(DiaryEntry.user_id == user.id))
            for entry in entries_result.scalars().all():
                if entry.updated_at > cutoff:
                    continue
                if entry.auto_tagged_at and entry.auto_tagged_at >= entry.updated_at:
                    continue
                new_content, count = auto_tag_content(entry.content, all_objects)
                if count > 0:
                    entry.content = new_content
                    await db.commit()
                    await _sync_diary_mentions(db, entry, user.id)
                entry.auto_tagged_at = datetime.utcnow()
                await db.commit()

            for obj in all_objects:
                if obj.updated_at > cutoff:
                    continue
                if obj.auto_tagged_at and obj.auto_tagged_at >= obj.updated_at:
                    continue
                others = [o for o in all_objects if o.id != obj.id]
                new_notes, count = auto_tag_content(obj.notes or "", others)
                if count > 0:
                    obj.notes = new_notes
                    await db.commit()
                    await _sync_object_mentions(db, obj, user.id)
                obj.auto_tagged_at = datetime.utcnow()
                await db.commit()


async def auto_tag_background_loop():
    """Runs run_auto_tag_pass() every minute for the lifetime of the app."""
    while True:
        try:
            await run_auto_tag_pass()
        except Exception:
            pass   # never let one bad record kill the loop
        await asyncio.sleep(AUTO_TAG_LOOP_INTERVAL)


async def telegram_poll_loop():
    """Long-polls Telegram for every user who has connected a bot. The
    first message a user sends to their bot links that chat to their
    account (no diary entry created for a bare '/start'); every message
    after that becomes a timestamped diary entry."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                users_result = await db.execute(select(User).where(User.telegram_bot_token != None))
                users = users_result.scalars().all()

                for user in users:
                    token = user.telegram_bot_token
                    offset = (user.telegram_last_update_id or 0) + 1 if user.telegram_last_update_id else 0
                    updates = await get_updates(token, offset)
                    if not updates:
                        continue

                    max_update_id = user.telegram_last_update_id or 0
                    for update in updates:
                        max_update_id = max(max_update_id, update.get("update_id", 0))
                        message = update.get("message")
                        if not message:
                            continue

                        chat_id = str(message.get("chat", {}).get("id", ""))
                        text = (message.get("text") or "").strip()
                        msg_ts = message.get("date")

                        if user.telegram_chat_id and chat_id != user.telegram_chat_id:
                            continue   # only the chat that first linked this bot may add entries

                        if not user.telegram_chat_id:
                            user.telegram_chat_id = chat_id
                            await db.commit()
                            await send_message(token, chat_id, "✅ Connected! Messages you send here will be added to your Headspace diary.")
                            if text == "/start" or not text:
                                continue   # linking-only message, nothing to save

                        if not text or text == "/start":
                            continue

                        entry_time = datetime.utcfromtimestamp(msg_ts) if msg_ts else datetime.utcnow()
                        entry_date = entry_time.strftime("%Y-%m-%d")

                        import uuid as _uuid
                        db.add(DiaryEntry(
                            id=str(_uuid.uuid4()), user_id=user.id, date=entry_date,
                            content=text, tags=[], created_at=entry_time, updated_at=entry_time,
                        ))
                        await db.commit()
                        await send_message(token, chat_id, f"✅ Added to your diary ({entry_date}).")

                    user.telegram_last_update_id = max_update_id
                    await db.commit()
        except Exception:
            pass   # never let one bad token / network hiccup kill the loop
        await asyncio.sleep(TELEGRAM_LOOP_INTERVAL)
