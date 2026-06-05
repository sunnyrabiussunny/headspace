from sqlalchemy import Column, String, Text, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import uuid

Base = declarative_base()

def new_id():
    return str(uuid.uuid4())

class DiaryEntry(Base):
    __tablename__ = "diary_entries"

    id          = Column(String, primary_key=True, default=new_id)
    date        = Column(String, nullable=False, index=True)   # YYYY-MM-DD
    content     = Column(Text, default="")
    tags        = Column(JSON, default=list)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class KnowledgeObject(Base):
    __tablename__ = "knowledge_objects"

    id          = Column(String, primary_key=True, default=new_id)
    type        = Column(String, nullable=False)   # PERSON, PLACE, IDEA, ORGANIZATION
    title       = Column(String, nullable=False)
    description = Column(Text, default="")
    notes       = Column(Text, default="")
    tags        = Column(JSON, default=list)
    properties  = Column(JSON, default=dict)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Mention(Base):
    __tablename__ = "mentions"

    id          = Column(String, primary_key=True, default=new_id)
    object_id   = Column(String, nullable=False, index=True)
    source_type = Column(String, nullable=False)  # "diary" or "object"
    source_id   = Column(String, nullable=False, index=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
