from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# ── DiaryEntry ──────────────────────────────────────────────────────────────

class DiaryEntryCreate(BaseModel):
    date: str
    content: str = ""
    tags: List[str] = []

class DiaryEntryUpdate(BaseModel):
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    created_at: Optional[str] = None   # ISO string for time editing

class DiaryEntryOut(BaseModel):
    id: str
    date: str
    content: str
    tags: List[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# ── KnowledgeObject ─────────────────────────────────────────────────────────

class ObjectCreate(BaseModel):
    type: str
    title: str
    description: str = ""
    notes: str = ""
    tags: List[str] = []
    properties: Dict[str, Any] = {}

class ObjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None

class ObjectOut(BaseModel):
    id: str
    type: str
    title: str
    description: str
    notes: str
    tags: List[str]
    properties: Dict[str, Any]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# ── Mention ─────────────────────────────────────────────────────────────────

class MentionOut(BaseModel):
    id: str
    object_id: str
    source_type: str
    source_id: str
    created_at: datetime

    class Config:
        from_attributes = True

# ── Search ──────────────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    id: str
    type: str              # "diary" or "object"
    title: str
    preview: str
    date: Optional[str] = None
    object_type: Optional[str] = None

# ── Tags ────────────────────────────────────────────────────────────────────

class TagInfo(BaseModel):
    name: str
    diary_count: int
    object_count: int
    total: int

class TagRename(BaseModel):
    old_name: str
    new_name: str

# ── Merge ───────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    source_id: str   # object to be deleted
    target_id: str   # object to survive
