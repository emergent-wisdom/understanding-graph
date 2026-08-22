# DO NOT EDIT DIRECTLY - Generated from graph node n_3ffa40dc
# To modify, use doc_revise on the source node in the graph

from __future__ import annotations

from dataclasses import dataclass

from errors import ValidationError


@dataclass(frozen=True, slots=True)
class Event:
    """A validated measurement at an integer timestamp."""

    event_id: str
    timestamp: int
    value: int
    tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.event_id.strip():
            raise ValidationError("event_id must not be blank")
        if self.timestamp < 0:
            raise ValidationError("timestamp must be non-negative")
        if len(set(self.tags)) != len(self.tags):
            raise ValidationError("tags must be unique")


@dataclass(frozen=True, slots=True)
class WindowSummary:
    """Aggregate for a half-open time window [start, end)."""

    start: int
    end: int
    count: int
    total: int
    tags: tuple[tuple[str, int], ...]
