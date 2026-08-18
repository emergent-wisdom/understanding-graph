# DO NOT EDIT DIRECTLY - Generated from graph node n_e1559999
# To modify, use doc_revise on the source node in the graph

"""External payload parsing boundary."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from errors import ValidationError
from models import Event


def _coerce_tags(raw: object) -> tuple[str, ...]:
    if raw is None:
        return ()
    if isinstance(raw, str) or not isinstance(raw, Iterable):
        raise ValidationError("tags must be an iterable of strings")
    tags = tuple(str(tag) for tag in raw)
    if any(not tag for tag in tags):
        raise ValidationError("tags must not contain blanks")
    return tags


def parse_event(row: Mapping[str, object]) -> Event:
    """Translate one external mapping into a validated Event."""
    try:
        return Event(
            event_id=str(row["id"]),
            timestamp=int(row["timestamp"]),
            value=int(row["value"]),
            tags=_coerce_tags(row.get("tags")),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidationError(f"invalid event payload: {row!r}") from exc
