# Understanding Graph Prompts

Modular prompt components for building agents. **This is the authoritative reference.**

## The Golden Rule

**Each folder has ONE purpose. Put information in ONE place only.**

| Folder | Purpose | Who sees it |
|--------|---------|-------------|
| `core/` | Philosophical foundations, identity | Synthesizer, Workers |
| `tools/` | How to use tools, parameter reference | Everyone using those tools |
| `modes/` | Phase-specific behavior (think, read) | Agents in that phase |
| `roles/` | Agent-specific identity and protocols | Only that agent |
| `workflows/` | Optional specialized workflows | Include as needed |

## Where To Put New Information

**"All agents should know X"** → `tools/api_reference.md` (if tool-related) or `core/orientation.md` (if conceptual)

**"Workers in think phase should know X"** → `modes/think_phase.md`

**"Only the Synthesizer should know X"** → `roles/synthesizer.md`

**"Only the Reader should know X"** → `roles/reader.md`

**"This is about commit messages"** → `tools/api_reference.md` (all graph_batch users see this)

---

## Actual Agent Composition (from run_reader.py)

### Reader
```
orientation.md
roles/reader.md
core/emergent_wisdom.md   ← EMERGENT_WISDOM
```
Note: Reader does NOT get api_reference.md - commit guidance is in roles/reader.md directly.

### Workers (connector, skeptic, speculator, etc.)
```
orientation.md
philosophy.md
tools/graph_vision.md
modes/think_phase.md      ← WORKERS GET THIS
tools/api_reference.md    ← WORKERS GET THIS
roles/{worker}.md
```

### Synthesizer
```
orientation.md
philosophy.md
core/identity.md          ← IDENTITY_MANTRA
core/emergent_wisdom.md   ← EMERGENT_WISDOM
tools/graph_vision.md
tools/api_reference.md
roles/synthesizer.md
```

### Translator
```
orientation.md
core/identity.md          ← IDENTITY_MANTRA
philosophy.md
core/emergent_wisdom.md   ← EMERGENT_WISDOM
tools/graph_vision.md
roles/translator.md
```
Note: Translator does NOT get api_reference.md - commit guidance is in roles/translator.md directly.

### Curator
```
orientation.md
tools/graph_vision.md
tools/api_reference.md
(inline prompt)
```

### All Agents (optional)
```
modes/fresh_reading.md    ← Added when --fresh-reading flag is used
```

---

## Folder Reference

### `core/` - Philosophical Foundations
Files included for agents that need deep understanding.

| File | Purpose | Included By |
|------|---------|-------------|
| `orientation.md` | Project context, current state | ALL agents |
| `philosophy.md` | What is an Understanding Graph | Workers, Synthesizer, Translator |
| `identity.md` | The identity mantra (IDENTITY_MANTRA) | Synthesizer, Translator |
| `emergent_wisdom.md` | Wisdom protocol (EMERGENT_WISDOM) | Reader, Synthesizer, Translator |
| `five_laws.md` | The 5 fundamental laws | (legacy, check usage) |
| `node_types.md` | Trigger types reference | (legacy, check usage) |
| `edge_types.md` | Edge types reference | (legacy, check usage) |

### `tools/` - Tool Usage
Reference for how to use MCP tools correctly.

| File | Purpose | Included By |
|------|---------|-------------|
| `api_reference.md` | Parameter reference, commit messages | Workers, Synthesizer, Curator |
| `graph_vision.md` | graph_context, graph_search, etc. | Workers, Synthesizer, Translator, Curator |
| `graph.md` | Full graph mutation reference | (legacy, check usage) |
| `document.md` | Document tools reference | (legacy, check usage) |

### `modes/` - Phase-Specific Behavior
Behavior for specific execution phases.

| File | Purpose | Included By |
|------|---------|-------------|
| `think_phase.md` | How to think, debate, create nodes | Workers ONLY |
| `fresh_reading.md` | Pretend no prior knowledge | All (when --fresh-reading) |
| `reading.md` | CMP reading mode | (legacy, check usage) |
| `reading_thinker.md` | Sequential iterator | (legacy, check usage) |

### `roles/` - Agent Identity
Each agent's unique identity and protocols. **Only that agent sees their role file.**

| File | Agent |
|------|-------|
| `reader.md` | Reader |
| `synthesizer.md` | Synthesizer |
| `translator.md` | Translator |
| `connector.md` | Connector worker |
| `skeptic.md` | Skeptic worker |
| `speculator.md` | Speculator worker |
| `belief_tracker.md` | Belief Tracker worker |
| `axiologist.md` | Axiologist worker |
| `psychologist.md` | Psychologist worker |
| `critic.md` | Critic worker |

### `workflows/` - Optional Workflows
Include as needed for specific tasks.

| File | Purpose |
|------|---------|
| `checkpoints.md` | Analysis nodes and CHECKPOINT messages |
| `coherence.md` | Graph maintenance |
| `cross_project.md` | Multi-project operations |
| `references.md` | Citations and bibliography |
| `serendipity.md` | Inverse hallucination |
| `worker.md` | Spawning sub-agents |

---

## Decision Tree: Where Does This Go?

```
Is it about HOW TO USE A TOOL?
  └─ YES → tools/api_reference.md (or specific tool file)
  └─ NO ↓

Is it PHASE-SPECIFIC (think phase vs read phase)?
  └─ YES → modes/{phase}.md
  └─ NO ↓

Is it for ONE SPECIFIC AGENT only?
  └─ YES → roles/{agent}.md
  └─ NO ↓

Is it PHILOSOPHICAL (what is understanding, identity)?
  └─ YES → core/{topic}.md
  └─ NO ↓

Is it a SPECIALIZED WORKFLOW?
  └─ YES → workflows/{workflow}.md
  └─ NO → Ask yourself why it doesn't fit anywhere
```

---

## Anti-Patterns

**DON'T duplicate information across files.** If you're copying text, you're doing it wrong.

**DON'T put worker-specific info in core/.** Core is for universal concepts.

**DON'T put universal info in roles/.** Roles are for agent-specific identity.

**DON'T add commit message guidance to every role file.** It goes in `tools/api_reference.md` once.

---

## Current Commit Message Guidance

| Agent | Where they get commit guidance |
|-------|-------------------------------|
| Workers | `tools/api_reference.md` (The Metacognitive Stream) |
| Synthesizer | `tools/api_reference.md` + `roles/synthesizer.md` |
| Reader | `roles/reader.md` only (doesn't get api_reference.md) |
| Translator | `roles/translator.md` only (doesn't get api_reference.md) |

**Rule:** Don't duplicate across files. Each agent should get guidance from ONE source.
