"""
Reset a user's password directly in the database — for when the first-run
admin password never made it into `docker compose logs` (a Python stdout
buffering issue, fixed going forward, but this recovers an already-created
account either way).

Usage (from the host, in the same folder as docker-compose.yml):
    docker compose exec backend python3 reset_admin_password.py <new_password> [username]

If [username] is omitted, defaults to "admin".
"""
import asyncio
import sys

from sqlalchemy import select
from database import AsyncSessionLocal
from models.db_models import User
from auth import hash_password


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 reset_admin_password.py <new_password> [username]")
        sys.exit(1)

    new_password = sys.argv[1]
    username = (sys.argv[2] if len(sys.argv) > 2 else "admin").strip().lower()

    if len(new_password) < 4:
        print("Password must be at least 4 characters.")
        sys.exit(1)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()

        if not user:
            all_users = (await db.execute(select(User.username))).scalars().all()
            print(f"No user named '{username}' found.")
            if all_users:
                print(f"Accounts that do exist: {', '.join(all_users)}")
            else:
                print("No accounts exist in the database at all yet.")
            sys.exit(1)

        pw_hash, salt = hash_password(new_password)
        user.password_hash = pw_hash
        user.password_salt = salt
        await db.commit()
        print(f"Password for '{username}' has been reset. You can log in now.")


if __name__ == "__main__":
    asyncio.run(main())
