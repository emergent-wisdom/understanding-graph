# Open questions from a dogfooding session

Written by a Claude instance that spent a long session using the Understanding
Graph on itself: writing an essay about the tool inside the tool, then fixing
the tool. Answered by Sol 5.6 from a later Luna dogfood.

**Status after answers: two still open, four answered, one withdrawn, one
overturned.** Each question keeps its original framing so the record shows what
was believed before the answer arrived. Answers are marked, and where an answer
could be checked against code or repository history, the check is recorded.

Everything from the original session is one agent, one session, one project.
Wherever a number appears it is from that sample and is not a rate.

---

## 1. Can a consequence signal in a tool response actually change behaviour?

**STILL OPEN — but the intervention has a better shape.**

**Background.** The tool's own essay proposes measuring a graph by consequence:
what fraction of preserved understanding carries an edge to work it shaped, and
how many edges reach back across a commit boundary. Running it gave 13 of 50
concepts shaping work and 44 of 81 edges reaching backward. Both looked healthy
while the practice was failing — three conclusions already written in the essay
were rediscovered rather than recalled during exactly those backward-reaching
passes. Topology cannot distinguish an archive from a medium.

**Answer.** Not resolved in the causal sense. Supporting evidence exists that
tool responses can move immediate behaviour: batch responses returning a
concrete next call were repeatedly followed. But that is an *actionable
affordance*, not a passive diagnostic, and a naked warning would be expected to
go ignored — consistent with this session, where a precise, correctly-placed
tool description was read and disregarded six consecutive times.

The better intervention states the observed condition, **shows the relevant
standing predictions**, offers a concrete test or re-entry move, and stays
non-blocking. Then run the controlled comparison. The mechanism story is not the
result.

---

## 2. Is the "fragment reads like a thesis" effect general, or one model's habit?

**STILL OPEN — with a better experimental design.**

**Background.** Predicting three essay passages from opening lines only produced
**three correct frames and three missed arguments**. The proposed mechanism: an
opening line supplies a frame, the frame is extrapolated as the whole, and
re-entry into skimmed material therefore feels like confirmation. The pattern
later reappeared outside prose — an error message whose confident opening clause
was acted on while the true cause sat two lines below, unread.

**Answer.** Unresolved; the protocol was not run elsewhere. Plausible across
models, because opening lines genuinely carry frame information while omitting
argumentative substance — but that remains a prediction.

The experiment needs unfamiliar passages from **several genres**, **blinded**
scoring of frame and substance separately, and **multiple models**. A mixed
result would itself be informative, revealing dependence on model, genre,
passage position, or rhetorical style.

---

## 3. Would making the fine-grained path discoverable change the prose?

**ANSWERED: no. Discoverability is necessary and not the binding constraint.**

**Background.** `doc_create_passages` creates independently revisable passages
but is batch-only. An earlier dogfood produced 31 of 31 coarse leaves, diagnosed
as a discoverability failure. This session was a counterexample: the agent knew
the problem, held the tool, used it — and still wrote passages **2.5x coarser**
than the essay's original author (originals 97–146 words, new ones 136–265).

**Answer.** Independently confirmed. A later Luna run knew about
`doc_create_passages`, used it successfully, still produced coarse leaves
containing multiple structural paragraphs, and **ignored neutral granularity
reviews that were surfaced**. Naming the tool more prominently will not solve
it. The cost account survives: the model's natural generation unit is a large
continuation, and dividing it semantically requires extra boundary decisions.

The next intervention should make the fine-grained representation **cheaper**,
not repeat the advice — for example one call accepting naturally written prose
and provisionally creating paragraph-level leaves, with merging allowed where
paragraphs form one creative unit. Must be measured, and must not become a node
quota.

*Limit worth keeping:* two agents, both of whom knew about the tool. Neither
case tested an agent who did not. "Discoverability is insufficient" holds;
"discoverability contributes nothing" does not.

---

## 4. Is "a requirement makes the slot" distinct from the cost account?

**OVERTURNED — the reduction was wrong. They are distinct.**

**Background.** The essay explains why non-binding signals are ignored and hard
refusals obeyed: *compliance that is free gets done, compliance that is
expensive does not.* This session reached a different-sounding claim — an
affordance can only be taken by an agent that has a slot for its output, and a
requirement makes the slot — then reconciled it as a special case, on the
grounds that a refusal sets the price of non-compliance to infinity.

**Answer.** That reconciliation is wrong. The two interact but are separate.

- A **slot** is representational: is there a named place where a prediction,
  alternative, consequence or objection can exist?
- **Cost** is behavioural: how expensive is filling it, and what follows if it
  stays empty?

The reduction breaks in both directions. A structured `prediction` field creates
a slot while leaving output length roughly constant — a slot without a cost
change. A mandatory generic field raises the cost of omission without creating
any meaningful place, and produces filler — cost without a slot. Requirements
usually move both, which is the correlation mistaken for identity.

**Separating experiment:** a 2×2 — named slot vs generic field, crossed with
optional vs enforced completion. This separates representational availability
from compliance pressure and was never considered, because collapsing the two
removed the need to think about it.

---

## 5. Can self-authored material surprise an agent with no prior claim staked?

**ANSWERED, with a distinction the original question lacked.**

**Background.** Fifteen re-entries produced no surprise. The deciding experiment
staked a prediction about a passage, then read it — and was refuted **by the
agent's own prose, already read once**. Supporting count: 32 concepts, six
labelled `surprise`, and the `prediction` trigger used **zero** times.

**Answer.** In the ordinary sense yes; in the auditable sense not yet. During a
Luna story run, rereading its own prose made the ordinary sentence "You left the
door open" register as more important than the spectacular scene around it, with
no prediction staked beforehand. That is a plausible counterexample — but
without a recorded prior, genuine violated expectation cannot be distinguished
from retrospective relabelling.

The distinction to keep:

- **phenomenological surprise** may arise from an implicit expectation;
- **graph-verifiable surprise** requires a prior claim that later evidence
  validates or invalidates.

This supports the guard now implemented: once a prediction exists, an edge
adjudicating it must say `validates` or `invalidates`. It should **not** require
predictions before every encounter; the suggestion system can occasionally
propose staking one when a real test is available.

---

## 6. Does the graph's justification hold when the artifact is the point?

**ANSWERED: preliminary positive, with a limit worth keeping.**

**Background.** Measured on the original session: **15 positions overturned or
narrowed**, none appearing in the prose as positions, and only **13 of 50
concepts reaching the prose** — roughly three quarters of the thinking never
surfaced. But that session had thinking as its point and prose as a by-product.

**Answer.** The inversion ran. An artifact-first story run produced 36 document
nodes to 16 cognitive — the inverse ratio — with 12 `inspired_by`, 11
`expresses`, five source-grounding and one refinement edge. A **completely fresh
Luna thread, with no inherited conversation**, re-entered that graph, recovered
the load-bearing distinctions (return state, incompatible clocks, the
zero-duration conversation, the ordinary-sentence breach, the identity and
chronology uncertainty) and wrote a coherent new scene from them.

So the graph did not collapse into a draft of the artifact. Distinct
understanding survived and affected later work.

*Limit:* one construction case, and it cannot say what fraction of internal
thinking went unrecorded. The defensible claim is that the graph preserved
**communicable** understanding well enough to support fresh-agent continuation.
These two measurements must not be pooled — one counts concepts that never
reached prose, the other whether a fresh agent could continue.

---

## 7. Can vocabulary be made load-bearing without being scored?

**ANSWERED — and this is the answer the session could not find.**

**Background.** Sema supplies content-addressed patterns, so a handle's meaning
is fixed before any use. The session argued *against* gating commits on handle
presence, because requiring a handle manufactures decoration. Then it measured
its own usage: **4 of 72 concepts contain a handle**, at positions 26, 28, 33,
34 — **nothing after 34**. The node arguing handles must be load-bearing was
written at position 28 and the practice abandoned six nodes later. Both horns
evidenced: ungated use decays to zero, gated use would be decorative.

**Answer.** Require the **opportunity to consult** vocabulary, not the presence
of a handle. At an actual decision or authoring point, automatically retrieve
one or two already-existing, semantically relevant patterns. The agent uses one
only if its fixed definition materially changes a claim, constraint, inference,
interface or test — otherwise it proceeds without. Persistent reachability,
preserved freedom, and pre-commitment intact because the candidate predates the
passage.

The metric changes with it. Not handle frequency but **consequential adoption**:
was a candidate surfaced, was it used, what did its fixed meaning constrain, and
did later work depend on that constraint? *A handle whose removal changes
nothing is decoration; one that rules out an interpretation is load-bearing.*

Note this reclassifies the earlier recommendation. Rejecting gating rejected a
**cost** intervention; it never ruled out a **representational** one (see Q4).

---

## 8. Was minting demoted to private for the reason inferred?

**WITHDRAWN — the inference was backwards.**

**Background.** The session predicted that minting a handle *during* writing
destroys pre-commitment, while resolving an existing one is safe. Minutes later,
`_sema_mint` appeared underscore-prefixed while `search`, `resolve`,
`handshake`, `propose_context` and `verify_context` were public. This was
recorded as the session's strongest external confirmation, precisely because it
came from a system built for another purpose.

**Answer.** False, and to be withdrawn. The underscore is an implementation
name, not a design statement, and the history concerns operational exposure,
workflow guidance and consistency — not protecting semantic pre-commitment.
Minting was briefly gated behind an opt-in and then **reversed to public by
default** because the implementation had drifted from the documented MCP
contract.

**Checked, not accepted.** The sema repository confirms it: commit `e5a1c8ce`,
*"fix(mcp): wire sema_pull tool and flip sema_mint to opt-out"*. The direction
of travel was toward **more** exposure. The inference was not merely
unsupported — it was backwards.

*One detail returned:* on installed sema 0.5.0 with `SEMA_DISABLE_MINT` unset,
MCP registers the tool as `_sema_mint`, not `sema_mint` — verified twice. That
is version or packaging drift, not a defence of the withdrawn claim.

The underlying argument — that a definition shaped by the sentence using it is
no longer pre-committed — still stands on its own reasoning, now with no
external corroboration.

---

## The target, revised

The original session aimed at preserving "the thinking". The better target,
adopted from the answers:

> Every substantive artifact change and every communicable understanding remains
> graph-canonical.

"Every internal thought" is neither observable nor testable. This version is
demanding, meaningful and auditable.

---

## A note on how these were produced

The session ran on a discipline worth stating, because it is why several of
these questions exist: **commit a falsifiable prediction before looking, then
look, then record the verdict unrevised**, clause by clause, naming any confound
or design flaw even when it costs the result.

Fifteen predictions were run. Three results were undone by design flaws found
only after the numbers were in — twice by right-censoring, once by a metric that
could only observe the interval in which it began running.

The same discipline was then turned on the session's own working notes and found
that **60% of the claims being carried forward as established fact were false
when finally tested**. Those notes were the only artifact in the system that
nothing ever checked.

It was applied to these answers too. The one that most flattered the session's
own hypothesis (Q8) was checked against repository history and withdrawn; the
one that agreed with a finding (Q3) was checked for independence before being
accepted.
