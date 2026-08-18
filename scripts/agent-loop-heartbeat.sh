#!/bin/bash
#
# Self-driven agent loop: a heartbeat an agent can arm to keep working without
# a human re-prompting it between iterations.
#
# WHY THIS EXISTS
# Some harnesses offer a native "wake me in N seconds" call. That call can fail
# silently — in the session this came from, two consecutive wakeups never fired
# and no error surfaced to the agent, so the loop simply stopped while
# appearing to be armed. A background process emitting a line on a fixed
# interval is more reliable, because the failure is visible: the ticks stop.
#
# HOW TO USE IT
# Arm it with whatever background-process facility the harness exposes, such
# that each stdout line is delivered back to the agent as an event. Every line
# is one wake-up. Kill the process to end the loop.
#
#   bash scripts/agent-loop-heartbeat.sh [interval_seconds] [message]
#
# CHOOSING THE INTERVAL
# Match it to how long one iteration actually takes, not to how eager you are.
# A tick faster than the work cannot make the work go faster; it only risks the
# harness rate-limiting or stopping a monitor that emits too many events.
# Iterations of real work usually run minutes, so 120s is a sane floor.
#
# WHAT TO PUT IN THE MESSAGE
# The tick is the only thing the next iteration is guaranteed to see, so it is
# a delivery surface: whatever it carries is what shapes the next iteration.
# An agent always arrives with something, and the tick decides the shape of it.
# A tick that says "continue" reliably produces more of whatever was already
# happening. If the loop should diverge rather than grind, say so here.
set -euo pipefail

INTERVAL="${1:-120}"
MESSAGE="${2:-LOOP TICK - resume work; begin by diverging, not by continuing}"

case "$INTERVAL" in
  ''|*[!0-9]*)
    echo "usage: agent-loop-heartbeat.sh [interval_seconds] [message]" >&2
    exit 64
    ;;
esac

if [ "$INTERVAL" -lt 30 ]; then
  echo "refusing an interval under 30s: ticks faster than the work only risk being rate-limited" >&2
  exit 64
fi

n=0
while true; do
  sleep "$INTERVAL"
  n=$((n + 1))
  echo "$MESSAGE (tick $n)"
done
