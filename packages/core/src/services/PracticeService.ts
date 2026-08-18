import * as sqlite from '../database/sqlite.js';
import * as EmbeddingService from './EmbeddingService.js';
import { analyzeGraph } from './AnalysisService.js';
import { getGraphStore } from './GraphStore.js';

/**
 * How the graph has been WORKED, as distinct from how it is SHAPED.
 *
 * graph_analyze and graph_score answer whether a graph is well formed. They
 * are not able to answer whether it is doing anything, and on a real project
 * they reported 0.0% fragmentation, 100% connectivity and 75/100 at the same
 * moment that five of six prose passages were connected to no thinking at all.
 * A well-formed graph nobody re-enters scores exactly like a well-formed graph
 * that changes someone's mind.
 *
 * So these diagnostics measure conduct rather than structure: whether the
 * graph is re-entered or only written to, whether prose carries the thinking
 * that produced it, whether practices adopted early survived, whether
 * predictions were ever scored, whether anything was ever overturned.
 *
 * Three rules hold throughout.
 *
 * Every diagnostic is a PROXY and says so. None of them can see whether the
 * thinking was any good; they see whether the machinery was used as designed,
 * and those come apart.
 *
 * A diagnostic with no data reports that it has no data. It never reports
 * zero. Silence and absence look identical in a number, and treating an
 * unrecorded quantity as a measured zero is the specific failure that let a
 * graph of unconsidered prose report a clean bill.
 *
 * There is deliberately no total. A single score becomes a target, and the
 * contract already says structural scores are diagnostics and never targets.
 * Six readings that disagree with each other are more use than one number that
 * can be driven up.
 */
export interface PracticeDiagnostic {
  /** Short stable key, for an agent that wants to compare across sessions. */
  key: string;
  /** The measurement, formatted, or 'not recorded' when there is no data. */
  value: string;
  /** What it is computed from, so the proxy can be judged rather than trusted. */
  basis: string;
  /** What it might mean. Deliberately hedged: these are indications, not verdicts. */
  reading: string;
}

export interface PracticeReport {
  worked: PracticeDiagnostic[];
  shaped: {
    nodeCount: number;
    edgeCount: number;
    isolatedCount: number;
    ungroundedProseCount: number;
  };
  note: string;
}

/**
 * Directories the operating system empties without notice.
 *
 * Anchored at the root and tolerant of a missing trailing slash. Both matter:
 * matching the substring anywhere would fire on ordinary paths like
 * ~/tmp-notes and train the reader to ignore the warning, and the failure this
 * comes from was configured as a bare path with no trailing slash.
 */
const EPHEMERAL_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/'];

export function isEphemeralPath(dir: string): boolean {
  const normalized = dir.endsWith('/') ? dir : `${dir}/`;
  return EPHEMERAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

const OVERTURNING = new Set(['supersedes', 'contradicts', 'invalidates']);
const VERDICT = new Set(['validates', 'invalidates', 'contradicts']);

/** Commits, oldest first. The default accessor caps at 50 and orders newest first. */
function allCommits() {
  return [...sqlite.getRecentCommits(5000)].reverse();
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return 'not recorded';
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

export function assessPractice(): PracticeReport {
  const store = getGraphStore();
  const { nodes, edges } = store.getAll();
  const analysis = analyzeGraph(sqlite.getCurrentProjectId() ?? '', {
    showEvolution: false,
  });
  const commits = allCommits();
  const callCounts = sqlite.getToolCallCounts();
  // What this same diagnostic reported last time it was called. A number that
  // is fresh every reading cannot show that nothing changed, so ignoring it
  // leaves no trace — the silent-guard shape, aimed by the agent at itself.
  const previousCounts =
    sqlite.getToolCallCountsAtPreviousCall('graph_practice');
  const totalCalls = Object.values(callCounts).reduce((a, c) => a + c.calls, 0);
  const totalRefused = Object.values(callCounts).reduce(
    (a, c) => a + c.refused,
    0,
  );

  const worked: PracticeDiagnostic[] = [];

  // 1. Re-entry. The tool's whole claim is that returning to prior state
  //    changes later work, so a graph that is only ever written to is a store
  //    wearing a medium's interface. Measured once at 122 writes to 6
  //    re-entries, which nothing in the graph could report at the time.
  // A refused batch is not a write. Counting it as one inflates the ratio and
  // credits the agent for work the tool rolled back.
  const batches = callCounts.graph_batch ?? { calls: 0, refused: 0 };
  const writes = batches.calls - batches.refused;
  const reEntries = callCounts.graph_understand?.calls ?? 0;

  const writesPerReEntry = (w: number, r: number) =>
    r === 0 ? null : w / r;
  const current = writesPerReEntry(writes, reEntries);
  let movement = '';
  if (previousCounts) {
    const pb = previousCounts.graph_batch ?? { calls: 0, refused: 0 };
    const before = writesPerReEntry(
      pb.calls - pb.refused,
      previousCounts.graph_understand?.calls ?? 0,
    );
    if (before !== null && current !== null) {
      const delta = current - before;
      movement =
        Math.abs(delta) < 0.05
          ? ` — unchanged since you last read this (${before.toFixed(1)})`
          : delta < 0
            ? ` — down from ${before.toFixed(1)} since you last read this`
            : ` — UP from ${before.toFixed(1)} since you last read this`;
    }
  }
  worked.push({
    key: 're_entry',
    value:
      totalCalls === 0
        ? 'not recorded'
        : reEntries === 0
          ? `${writes} writes, no re-entry`
          : `${(writes / reEntries).toFixed(1)} writes per re-entry${movement}`,
    basis: 'tool_calls, this project',
    reading:
      totalCalls === 0
        ? 'No tool calls recorded here, so this cannot be assessed. It is not zero.'
        : 'Roughly one re-entry per handful of writes suggests the graph is being consulted. Ten or more writes per re-entry suggests it is being filled rather than used, which looks identical in every structural measure.',
  });

  // 2. Where the graph lives. The startup warning for this goes to stderr,
  //    which an MCP client does not surface to the model — so it protects a
  //    human reading logs and not the agent whose work is at risk. The agent
  //    reads tool responses, so the fact belongs in one.
  const storeDir = sqlite.getProjectsDir();
  worked.push({
    key: 'store_durability',
    value:
      storeDir === null
        ? 'not recorded'
        : isEphemeralPath(storeDir)
          ? `EPHEMERAL: ${storeDir}`
          : `durable: ${storeDir}`,
    basis: 'the directory the project databases are loaded from',
    reading:
      storeDir === null
        ? 'The store location is unknown from here, so durability cannot be assessed. It is not safe by default.'
        : isEphemeralPath(storeDir)
          ? 'The operating system deletes this without notice, and the next run will silently recreate an empty database at the same path — so the directory will look intact and hold nothing. Two hundred nodes were lost this way. Move it before doing work you intend to keep.'
          : 'Outside the directories the OS clears on its own. That is not a backup; it only means the store is not scheduled for deletion.',
  });

  // 3. Whether duplicate detection is actually running.
  //
  // graph_batch is described — by its own documentation, and repeatedly in
  // this project's commit messages — as enforcing orphan prevention,
  // duplicate detection, atomic rollback and commit provenance. Three of
  // those always run. The fourth is guarded by
  // `!skipCheck && EmbeddingService.isModelLoaded()`, so it runs only when the
  // embedding model happens to be loaded in-process, and says nothing at all
  // when it is not. A near-duplicate concept was written to a real project
  // without a murmur while that guarantee was being asserted in writing.
  //
  // Silence is the problem, not the condition. Embeddings are an optional peer
  // dependency and it is reasonable for the check to be unavailable; it is not
  // reasonable for an agent to be unable to find out.
  const duplicateDetection = EmbeddingService.isModelLoaded();
  worked.push({
    key: 'duplicate_detection',
    value: duplicateDetection ? 'active' : 'NOT RUNNING',
    basis: 'whether the embedding model is loaded in this process',
    reading: duplicateDetection
      ? 'Near-duplicate concepts are refused before they are written, and the refusal names which existing node they duplicate.'
      : 'The embedding model is not loaded, so duplicate detection is skipped silently on every write. Nothing will stop the same understanding being recorded twice under different titles, and no refusal will say so. Three of graph_batch\'s four guarantees still hold; this is the one that does not.',
  });

  // 4. What the understanding says that the artifact does not.
  //
  // Everything above measures CONDUCT — whether the graph is re-entered,
  // whether commits are attributed, whether predictions get scored. None of it
  // says anything about the thing being built. An agent building an artifact
  // in here gets no feedback on the artifact, which is the half that matters
  // to it, and the graph is the only place that could give it: nothing else
  // knows which unit expresses which decision.
  //
  // Two directions, and they mean opposite things. A decision nothing
  // expresses is understanding that outran the artifact — the interesting
  // case, because it is usually the newest thinking and the thing most worth
  // building next. A unit expressing a decision that has since been overturned
  // is the artifact outrunning the understanding, which is staler and more
  // dangerous: code that still says what its author no longer believes.
  const artifactCount = analysis.stats.artifactNodeCount ?? 0;
  if (artifactCount > 0) {
    const expressed = new Set(
      edges
        .filter((e) => e.type === 'expresses' || e.type === 'inspired_by')
        .map((e) => e.toId),
    );
    const overturnedIds = new Set(
      edges
        .filter((e) => e.type === 'invalidates' || e.type === 'supersedes')
        .map((e) => e.toId),
    );
    const DECIDED = new Set([
      'decision',
      'model',
      'foundation',
      'hypothesis',
      'tension',
      'evaluation',
    ]);
    const isArtifact = (n: (typeof nodes)[number]) =>
      Boolean(n.isDocRoot || n.level);

    const unbuilt = nodes.filter(
      (n) =>
        !isArtifact(n) &&
        n.trigger &&
        DECIDED.has(n.trigger) &&
        !expressed.has(n.id) &&
        !overturnedIds.has(n.id),
    );
    const stale = edges
      .filter((e) => e.type === 'expresses' || e.type === 'inspired_by')
      .filter((e) => overturnedIds.has(e.toId));

    worked.push({
      key: 'understanding_ahead_of_artifact',
      value:
        unbuilt.length === 0
          ? 'nothing decided is unexpressed'
          : `${unbuilt.length} decision(s) nothing in the artifact expresses: ${unbuilt
              .slice(0, 3)
              .map((n) => `"${n.title}"`)
              .join(', ')}`,
      basis:
        'live decision-shaped concepts with no inbound expresses or inspired_by edge',
      reading:
        unbuilt.length === 0
          ? 'Every standing decision has something in the artifact answering to it.'
          : 'These are usually the newest thinking, and the most likely candidates for what to build next. Some will be about the work rather than in it, and belong here unexpressed — but a central finding sitting in this list means the artifact has not caught up with what you know.',
    });

    worked.push({
      key: 'artifact_ahead_of_understanding',
      value:
        stale.length === 0
          ? 'nothing expresses a retired decision'
          : `${stale.length} unit(s) still express a decision that was overturned`,
      basis: 'expresses edges pointing at invalidated or superseded concepts',
      reading:
        stale.length === 0
          ? 'No part of the artifact is still answering to a position that has since been retired.'
          : 'This is code that says what its author no longer believes. Nothing else can detect it: the compiler cannot know a decision was overturned, and the decision cannot know which code expressed it. Revise the unit or record why it survives the change.',
    });
  }

  // 5. Prose grounding. Passages arrive holding `contains` and `next`, so they
  //    can never register as orphans however little thought is attached.
  const documentCount = analysis.stats.artifactNodeCount ?? 0;
  const ungrounded = analysis.stats.ungroundedProseCount ?? 0;
  worked.push({
    key: 'prose_grounding',
    value:
      documentCount === 0
        ? 'no prose yet'
        : `${documentCount - ungrounded} of ${documentCount} passages carry thinking`,
    basis: 'document nodes with at least one edge to a cognitive node',
    reading:
      documentCount === 0
        ? 'No artifact units exist, so there is nothing to ground.'
        : 'Ungrounded passages are prose that some thinking probably produced, where the link was never recorded. That state is indistinguishable from genuine thoughtlessness, and orphan prevention cannot see it.',
  });

  // 6. Practice drift. Measured across two real projects: practices adopted at
  //    the start held at 100 per cent, and every practice retrofitted mid-way
  //    decayed. So the first few commits predict the rest, and the comparison
  //    is worth more than either figure alone.
  const early = commits.slice(0, 5);
  const recent = commits.slice(-5);
  const named = (list: typeof commits) =>
    list.filter((c) => (c.agentName ?? '').trim()).length;
  worked.push({
    key: 'practice_drift',
    value:
      commits.length < 6
        ? `${named(commits)} of ${commits.length} commits attributed, too early to compare`
        : `attribution ${ratio(named(early), early.length)} early against ${ratio(named(recent), recent.length)} lately`,
    basis: 'agent_name on the first five and last five commits',
    reading:
      'A practice that was present early and is absent now has decayed, and re-adopting it mid-project historically does not take. A practice absent from the start rarely arrives later.',
  });

  // 7. Scored predictions. Staking a claim before looking is only worth
  //    anything if the verdict is recorded afterwards, and an unscored
  //    prediction is indistinguishable from one that was quietly abandoned.
  const predictions = nodes.filter((n) => n.trigger === 'prediction');
  const scored = predictions.filter((p) =>
    edges.some((e) => e.toId === p.id && VERDICT.has(e.type)),
  );
  worked.push({
    key: 'scored_predictions',
    value:
      predictions.length === 0
        ? 'no predictions made'
        : `${scored.length} of ${predictions.length} predictions carry a verdict`,
    basis: 'prediction nodes with an inbound validates, invalidates or contradicts edge',
    reading:
      predictions.length === 0
        ? 'Nothing has been staked before looking, so nothing can have been wrong in a way the graph records.'
        : 'Unscored predictions accumulate as debt. A prediction whose verdict is never written cannot correct anything, and the graph keeps the confident half while losing the outcome.',
  });

  // 8. Refusals. The most informative thing an agent does is the thing the
  //    tool refuses, and none of it was recorded until refusals stopped being
  //    reported as completed calls. A guard that never fires is dead weight; a
  //    guard that fires constantly means the tool is fighting its users, and
  //    the difference is only visible from here.
  worked.push({
    key: 'refusals',
    value:
      totalCalls === 0
        ? 'not recorded'
        : `${totalRefused} of ${totalCalls} calls were refused (${ratio(totalRefused, totalCalls)})`,
    basis: 'tool_calls rows carrying an error or a returned refusal',
    reading:
      totalCalls === 0
        ? 'No tool calls recorded here, so this cannot be assessed. It is not zero.'
        : 'A steady trickle is the tool working. A long run with none may mean the guards are not reaching what you do; a high share means you are repeatedly asking for something the design forbids, which is worth reading as a question about the design.',
  });

  // 9. Self-correction. A graph in which nothing was ever overturned is either
  //    a record of unusual luck or a record that stopped arguing with itself.
  const overturning = edges.filter((e) => OVERTURNING.has(e.type)).length;
  worked.push({
    key: 'self_correction',
    value:
      edges.length === 0
        ? 'no edges yet'
        : `${overturning} of ${edges.length} edges overturn something (${ratio(overturning, edges.length)})`,
    basis: 'supersedes, contradicts and invalidates edges',
    reading:
      'Near zero means nothing here has been revised against anything else. That is worth checking rather than celebrating: the corrections a graph holds are the part re-entry can actually use.',
  });

  // 10. Edge vocabulary. `relates` records that two things are connected and
  //    nothing about how, so a graph leaning on it has recorded adjacency
  //    rather than relation.
  const generic = edges.filter((e) => e.type === 'relates').length;
  worked.push({
    key: 'edge_vocabulary',
    value:
      edges.length === 0
        ? 'no edges yet'
        : `${ratio(generic, edges.length)} generic`,
    basis: 'edges typed `relates` against all edges',
    reading:
      'A generic edge says two nodes are connected without saying how, so following it later buys nothing that a search would not. A high share means the typing is decorative.',
  });

  return {
    worked,
    shaped: {
      nodeCount: analysis.stats.nodeCount,
      edgeCount: analysis.stats.edgeCount,
      isolatedCount: analysis.stats.isolatedCount,
      ungroundedProseCount: ungrounded,
    },
    note: 'Every figure here is a proxy for conduct, not a measure of quality. They indicate whether the machinery was used as designed, which comes apart from whether the thinking was any good. There is no total on purpose: a single score becomes a target.',
  };
}
