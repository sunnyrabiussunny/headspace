import re
from typing import List, Tuple

MENTION_PATTERN = re.compile(r'@\[([^\]]+)\]\(([^)]+)\)')

def extract_mentions(content: str) -> List[Tuple[str, str]]:
    """Returns list of (display_name, object_id) tuples found in content."""
    return [(m.group(1), m.group(2)) for m in MENTION_PATTERN.finditer(content)]

def strip_mentions(content: str) -> str:
    """Replace @[Name](id) with plain @Name for preview text."""
    return MENTION_PATTERN.sub(lambda m: f"@{m.group(1)}", content)
