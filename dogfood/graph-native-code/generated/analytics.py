# DO NOT EDIT DIRECTLY - Generated from graph node n_c711c1b9
# To modify, use doc_revise on the source node in the graph

"""Windowed event aggregation."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable

from models import Event, WindowSummary


def _validate_width(width: int) -> None:
    if width <= 0:
        raise ValueError("width must be positive")


def _bucket_start(timestamp: int, width: int) -> int:
    return (timestamp // width) * width


def summarize(events: Iterable[Event], width: int) -> tuple[WindowSummary, ...]:
    """Aggregate events into sorted, fixed-width windows."""
    _validate_width(width)
    buckets: dict[int, list[Event]] = defaultdict(list)
    for event in events:
        buckets[_bucket_start(event.timestamp, width)].append(event)

    summaries: list[WindowSummary] = []
    for start in sorted(buckets):
        bucket = buckets[start]
        tag_counts = Counter(tag for event in bucket for tag in event.tags)
        summaries.append(
            WindowSummary(
                start=start,
                end=start + width,
                count=len(bucket),
                total=sum(event.value for event in bucket),
                tags=tuple(sorted(tag_counts.items())),
            )
        )
    return tuple(summaries)


def merge_summaries(summaries: Iterable[WindowSummary]) -> WindowSummary:
    """Merge adjacent or overlapping summaries into one envelope."""
    materialized = tuple(summaries)
    if not materialized:
        raise ValueError("at least one summary is required")
    tag_counts: Counter[str] = Counter()
    for summary in materialized:
        tag_counts.update(dict(summary.tags))
    return WindowSummary(
        start=min(summary.start for summary in materialized),
        end=max(summary.end for summary in materialized),
        count=sum(summary.count for summary in materialized),
        total=sum(summary.total for summary in materialized),
        tags=tuple(sorted(tag_counts.items())),
    )
