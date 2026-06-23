from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from database import init_db
from routers import diary, objects, search, export, tags, time


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from routers.time import init_time_tables
    await init_time_tables()
    yield


app = FastAPI(title="Headspace API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(diary.router)
app.include_router(objects.router)
app.include_router(search.router)
app.include_router(export.router)
app.include_router(tags.router)
app.include_router(time.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "headspace"}
