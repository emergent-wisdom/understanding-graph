# DO NOT EDIT DIRECTLY - Generated from graph node n_eabe8b49
# To modify, use doc_revise on the source node in the graph

"""Application service for ingestion and snapshots."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from analytics import summarize
from ledger import EventLedger
from models import WindowSummary
from parsing import parse_event


class PulseService:
    """Coordinates ingestion and deterministic snapshots."""

    def __init__(self, ledger: EventLedger | None = None) -> None:
        self.ledger = ledger or EventLedger()

    def ingest(self, rows: Iterable[Mapping[str, object]]) -> tuple[int, int]:
        accepted = 0
        duplicates = 0
        for row in rows:
            if self.ledger.append(parse_event(row)):
                accepted += 1
            else:
                duplicates += 1
        return accepted, duplicates

    def snapshot(
        self, start: int, end: int, width: int
    ) -> tuple[WindowSummary, ...]:
        return summarize(self.ledger.between(start, end), width)
