import re
from typing import List, Tuple

MENTION_PATTERN = re.compile(r'@\[([^\]]+)\]\(([^)]+)\)')

def extract_mentions(content: str) -> List[Tuple[str, str]]:
    """Returns list of (display_name, object_id) tuples found in content."""
    return [(m.group(1), m.group(2)) for m in MENTION_PATTERN.finditer(content)]

def strip_mentions(content: str) -> str:
    """Replace @[Name](id) with plain @Name for preview text."""
    return MENTION_PATTERN.sub(lambda m: f"@{m.group(1)}", content)


def auto_tag_content(content: str, objects: list) -> tuple[str, int]:
    """
    Scan plain text (skipping text already inside @[Name](id) mentions) for
    occurrences of existing object titles, and wrap the first occurrence of
    each with @[Title](id). Never creates new objects — only links to ones
    already given in `objects` (each an object with .id and .title).

    Longest titles are matched first so e.g. "Farabi Tamal" wins over a
    plain "Tamal" if both exist. Matches are whole-word / case-insensitive.
    Returns (new_content, count_tagged).
    """
    if not content or not objects:
        return content, 0

    # Longest title first, so multi-word names are preferred over substrings
    candidates = sorted(
        [(o.id, o.title) for o in objects if o.title and o.title.strip()],
        key=lambda x: -len(x[1])
    )

    # Figure out which spans are already inside an existing @[Name](id) mention —
    # never touch those, and never re-tag inside them.
    protected = [(m.start(), m.end()) for m in MENTION_PATTERN.finditer(content)]

    def is_protected(start: int, end: int) -> bool:
        return any(not (end <= p_start or start >= p_end) for p_start, p_end in protected)

    already_tagged_ids = {oid for _name, oid in extract_mentions(content)}

    tagged_count = 0
    result = content
    for oid, title in candidates:
        if oid in already_tagged_ids:
            continue
        pattern = re.compile(r'(?<!\w)' + re.escape(title) + r'(?!\w)', re.IGNORECASE)
        m = pattern.search(result)
        if not m:
            continue
        start, end = m.start(), m.end()
        if is_protected(start, end):
            continue
        matched_text = result[start:end]
        replacement = f'@[{matched_text}]({oid})'
        result = result[:start] + replacement + result[end:]
        tagged_count += 1
        # Recompute protected spans since the string shifted
        protected = [(mm.start(), mm.end()) for mm in MENTION_PATTERN.finditer(result)]
        already_tagged_ids.add(oid)

    return result, tagged_count
