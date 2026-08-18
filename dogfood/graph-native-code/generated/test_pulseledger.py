# DO NOT EDIT DIRECTLY - Generated from graph node n_22d290f3
# To modify, use doc_revise on the source node in the graph

"""Executable behavior contract for Pulse Ledger."""

import unittest

from analytics import merge_summaries, summarize
from errors import ValidationError
from ledger import EventLedger
from models import Event
from service import PulseService


class PulseLedgerTests(unittest.TestCase):
    def test_event_validation(self) -> None:
        with self.assertRaises(ValidationError):
            Event("", 0, 1)

    def test_ledger_deduplicates_and_orders(self) -> None:
        ledger = EventLedger()
        self.assertTrue(ledger.append(Event("b", 3, 2)))
        self.assertTrue(ledger.append(Event("a", 3, 1)))
        self.assertFalse(ledger.append(Event("a", 9, 99)))
        self.assertEqual(
            [event.event_id for event in ledger.between(0, 4)], ["a", "b"]
        )

    def test_ledger_range_is_end_exclusive(self) -> None:
        ledger = EventLedger()
        ledger.append(Event("inside", 9, 1))
        ledger.append(Event("boundary", 10, 1))
        self.assertEqual(
            [event.event_id for event in ledger.between(0, 10)], ["inside"]
        )

    def test_summarize_builds_deterministic_windows(self) -> None:
        summaries = summarize(
            [
                Event("a", 2, 3, ("blue",)),
                Event("b", 8, 5, ("blue", "fast")),
                Event("c", 12, 7, ("fast",)),
            ],
            width=10,
        )
        self.assertEqual(
            [(item.start, item.count, item.total) for item in summaries],
            [(0, 2, 8), (10, 1, 7)],
        )
        self.assertEqual(summaries[0].tags, (("blue", 2), ("fast", 1)))

    def test_invalid_width_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            summarize([], 0)

    def test_merge_summaries_preserves_totals_and_tags(self) -> None:
        summaries = summarize(
            [Event("a", 1, 2, ("x",)), Event("b", 11, 4, ("x", "y"))],
            10,
        )
        merged = merge_summaries(summaries)
        self.assertEqual(
            (merged.start, merged.end, merged.count, merged.total),
            (0, 20, 2, 6),
        )
        self.assertEqual(merged.tags, (("x", 2), ("y", 1)))

    def test_service_ingestion_and_snapshot(self) -> None:
        service = PulseService()
        rows = [
            {"id": "a", "timestamp": 1, "value": 2, "tags": ["x"]},
            {"id": "a", "timestamp": 99, "value": 100},
            {"id": "b", "timestamp": 11, "value": 4, "tags": ["y"]},
        ]
        self.assertEqual(service.ingest(rows), (2, 1))
        self.assertEqual(
            [item.total for item in service.snapshot(0, 20, 10)], [2, 4]
        )

    def test_service_rejects_malformed_payload(self) -> None:
        service = PulseService()
        with self.assertRaises(ValidationError):
            service.ingest([{"id": "a", "timestamp": "later", "value": 1}])


if __name__ == "__main__":
    unittest.main()
