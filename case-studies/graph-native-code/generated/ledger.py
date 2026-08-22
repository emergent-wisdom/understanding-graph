# DO NOT EDIT DIRECTLY - Generated from graph node n_6c56a481
# To modify, use doc_revise on the source node in the graph

"""Idempotent in-memory event ledger."""

from __future__ import annotations

from models import Event


class EventLedger:
    """Stores the first event seen for each event_id."""

    def __init__(self) -> None:
        self._events: dict[str, Event] = {}

    def append(self, event: Event) -> bool:
        if event.event_id in self._events:
            return False
        self._events[event.event_id] = event
        return True

    def between(self, start: int, end: int) -> tuple[Event, ...]:
        if end < start:
            raise ValueError("end must be greater than or equal to start")
        return tuple(
            sorted(
                (
                    event
                    for event in self._events.values()
                    if start <= event.timestamp < end
                ),
                key=lambda event: (event.timestamp, event.event_id),
            )
        )

    def __len__(self) -> int:
        return len(self._events)
