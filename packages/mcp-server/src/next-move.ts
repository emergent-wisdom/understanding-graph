import type { UnderstandingStance } from './protocol.js';

export type NextMoveStep = {
  description: string;
  call?: {
    tool: string;
    arguments: Record<string, unknown>;
  };
};

export type RolledNextMove = {
  action: string;
  label: string;
  stance: UnderstandingStance;
  weight: number;
  whyNow: string;
  subjects?: NextMoveNode[];
  steps: NextMoveStep[];
};

export type NextMoveNode = {
  id: string;
  title: string;
  trigger?: string | null;
  validated?: boolean;
  epistemicStatus?: 'validated' | 'speculative';
  excerpt?: string;
  isDocRoot?: boolean;
};

export type NextMoveRelation = {
  type: string;
  from: NextMoveNode;
  to: NextMoveNode;
  why?: string;
};

export type RollNextMovesInput = {
  task: string;
  workflow: string;
  focusNodeIds: string[];
  nodeCount: number;
  edgeCount: number;
  cognitiveNodeCount?: number;
  cognitiveEdgeCount?: number;
  isolatedCognitiveCount?: number;
  unresolvedCount: number;
  documentCount: number;
  isolatedCount?: number;
  contradictionCount?: number;
  cycleCount?: number;
  recentActions?: string[];
  taskRelevantNodes?: NextMoveNode[];
  focusNodes?: NextMoveNode[];
  openQuestions?: NextMoveNode[];
  isolatedNodes?: NextMoveNode[];
  documentNodes?: NextMoveNode[];
  centralNodes?: NextMoveNode[];
  randomNodes?: NextMoveNode[];
  contradictions?: NextMoveRelation[];
  creativityEnabled?: boolean;
  updatesSince?: string;
  count?: number;
  availableTools?: ReadonlySet<string>;
};

type MoveTemplate = Omit<RolledNextMove, 'weight' | 'stance'> & {
  available: boolean;
};

export function rollNextMoves(
  input: RollNextMovesInput,
  random: () => number = Math.random,
): RolledNextMove[] {
  const understandArguments = {
    query: input.task,
    workflow: input.workflow,
    ...(input.focusNodeIds.length > 0
      ? { focusNodeIds: input.focusNodeIds }
      : {}),
  };
  const understandWith = (
    stance: UnderstandingStance,
    focusNodeIds = input.focusNodeIds,
  ) => ({
    ...understandArguments,
    stance,
    ...(focusNodeIds.length > 0 ? { focusNodeIds } : {}),
  });
  const hasGraph = input.nodeCount > 0;
  const taskRelevant = pickMany(
    (input.taskRelevantNodes ?? []).slice(0, 6),
    3,
    random,
  );
  const focus = pickMany(input.focusNodes ?? [], 3, random);
  const question = pickOne((input.openQuestions ?? []).slice(0, 4), random);
  const artifact = pickOne((input.documentNodes ?? []).slice(0, 4), random);
  const wholeArtifact =
    pickOne(
      (input.documentNodes ?? []).filter((node) => node.isDocRoot).slice(0, 4),
      random,
    ) ?? artifact;
  const isolated = pickMany(input.isolatedNodes ?? [], 2, random);
  const randomSubjects = pickMany(input.randomNodes ?? [], 3, random);
  const central = pickOne((input.centralNodes ?? []).slice(0, 4), random);
  const contradiction = pickOne(input.contradictions ?? [], random);
  const creativityEnabled = input.creativityEnabled !== false;
  const reentrySubjects =
    focus.length > 0
      ? focus
      : taskRelevant.length > 0
        ? taskRelevant
        : central
          ? [central]
          : [];
  const connectionSubjects =
    isolated.length >= 2
      ? isolated
      : taskRelevant.length >= 2
        ? taskRelevant.slice(0, 2)
        : creativityEnabled &&
            taskRelevant.length > 0 &&
            randomSubjects.length > 0
          ? uniqueNodes([taskRelevant[0], ...randomSubjects]).slice(0, 2)
          : [];
  const templates: MoveTemplate[] = [
    {
      action: 're-enter',
      label: 'Re-enter relevant understanding',
      available: hasGraph,
      whyNow:
        reentrySubjects.length > 0
          ? `Bring ${reentrySubjects.map((node) => `“${node.title}”`).join(', ')} back into contact with their graph neighborhoods.`
          : central
            ? `“${central.title}” is structurally central and may change how the task is understood.`
            : 'Prior graph state may change how the task is understood.',
      subjects: reentrySubjects.length > 0 ? reentrySubjects : undefined,
      steps: [
        {
          description:
            'Retrieve task-relevant prior, resistance, evidence, and relations.',
          call: {
            tool: 'graph_understand',
            arguments: understandWith('balanced'),
          },
        },
        {
          description:
            'Let anything that genuinely catches alter the next question or action.',
        },
      ],
    },
    {
      action: 'continue',
      label: 'Advance the task in its native form',
      available: true,
      whyNow:
        'The user task itself may be the strongest source of direction; graph ceremony is not required.',
      steps: [
        {
          description:
            'Make the next locally coherent artifact, inquiry, decision, or experiment move in its canonical graph nodes.',
        },
        {
          description:
            'Preserve the communicable understanding produced while doing it, then mirror committed work in chat if useful.',
        },
      ],
    },
    {
      action: 'deepen',
      label: question
        ? `Deepen the live question “${question.title}”`
        : 'Deepen the most consequential live question',
      available: hasGraph,
      whyNow: question
        ? `This question remains open: ${question.excerpt || question.title}`
        : input.unresolvedCount > 0
          ? `${input.unresolvedCount} unresolved question or tension node(s) are visible.`
          : 'A local interpretation may deserve more evidence or precision before expansion.',
      subjects: question ? [question] : undefined,
      steps: [
        {
          description:
            'Re-enter with questions, tensions, and underdeveloped models weighted.',
          call: {
            tool: 'graph_understand',
            arguments: understandWith(
              'deepen',
              question ? [question.id] : input.focusNodeIds,
            ),
          },
        },
        {
          description:
            'Choose one that materially bears on the user task and investigate it.',
        },
      ],
    },
    {
      action: 'integrate',
      label: contradiction
        ? `Integrate “${contradiction.from.title}” with “${contradiction.to.title}”`
        : 'Integrate a contradiction or competing account',
      available:
        (input.contradictionCount ?? 0) > 0 || input.unresolvedCount > 0,
      whyNow: contradiction
        ? `The graph marks a ${contradiction.type} relation${contradiction.why ? `: ${contradiction.why}` : '.'}`
        : 'A contradiction, cycle, or live tension may need qualification rather than immediate resolution.',
      subjects: contradiction
        ? [contradiction.from, contradiction.to]
        : question
          ? [question]
          : undefined,
      steps: [
        {
          description:
            'Re-enter the competing claims with their evidence and relations in view.',
          call: {
            tool: 'graph_understand',
            arguments: understandWith(
              'resist',
              contradiction
                ? [contradiction.from.id, contradiction.to.id]
                : input.focusNodeIds,
            ),
          },
        },
        {
          description:
            'Seek the boundary conditions, hidden assumption, or model that explains the disagreement.',
        },
      ],
    },
    {
      action: 'connect',
      label:
        connectionSubjects.length >= 2
          ? `Ask whether “${connectionSubjects[0].title}” and “${connectionSubjects[1].title}” share a defensible bridge`
          : 'Look for a defensible distant connection',
      available:
        input.nodeCount >= 2 &&
        (creativityEnabled || connectionSubjects.length >= 2),
      whyNow:
        isolated.length >= 2
          ? 'These graph elements are structurally isolated; their separation may be meaningful or accidental.'
          : connectionSubjects.length >= 2
            ? 'One subject is close to the task and the other was sampled from elsewhere in the graph; the contrast may reveal a real mechanism or only noise.'
            : 'Two regions may share a mechanism, tension, or missing bridge that local retrieval will not surface.',
      subjects: connectionSubjects.length >= 2 ? connectionSubjects : undefined,
      steps:
        connectionSubjects.length >= 2
          ? [
              {
                description:
                  'Check whether the two concrete nodes already have a path.',
                call: {
                  tool: 'graph_path',
                  arguments: {
                    from: connectionSubjects[0].id,
                    to: connectionSubjects[1].id,
                  },
                },
              },
              {
                description:
                  'Compare their content and mechanisms. Preserve a bridge only if it survives scrutiny; no connection is valid.',
                call: {
                  tool: 'graph_understand',
                  arguments: understandWith(
                    'connect',
                    connectionSubjects.map((node) => node.id),
                  ),
                },
              },
            ]
          : [
              {
                description:
                  'Sample distant graph material and ask whether a genuine bridge exists.',
                call: {
                  tool: 'graph_discover_grounded',
                  arguments: {
                    nodes: 3,
                    edges: 0,
                    cold: false,
                    intensity: 0.2,
                  },
                },
              },
            ],
    },
    {
      action: 'bisociate',
      label:
        reentrySubjects.length > 0
          ? `Spread activation from ${reentrySubjects.map((node) => `“${node.title}”`).join(', ')}`
          : 'Surface a graph-wide bisociation',
      available: creativityEnabled && input.nodeCount >= 2,
      whyNow:
        'A spreading-activation pass can surface a concrete cross-context pair that ordinary task relevance would leave dormant.',
      subjects: reentrySubjects.length > 0 ? reentrySubjects : undefined,
      steps: [
        {
          description:
            'Use graph structure, node temperature, and information gain to surface candidate associations.',
          call: {
            tool: 'graph_bisociate',
            arguments:
              reentrySubjects.length > 0
                ? {
                    seed_nodes: reentrySubjects.map((node) => node.id),
                    limit: 8,
                  }
                : { strategy: 'mixed', limit: 8 },
          },
        },
        {
          description:
            'Judge whether a candidate changes the live work. Connect or preserve it only if the relation survives scrutiny; rejecting every candidate is valid.',
        },
      ],
    },
    {
      action: 'disrupt',
      label:
        randomSubjects.length >= 2
          ? `Let ${randomSubjects.map((node) => `“${node.title}”`).join(', ')} perturb the current path`
          : 'Introduce a grounded random perturbation',
      available: creativityEnabled && input.nodeCount >= 3,
      whyNow:
        'A high-weight roll can justify leaving the most familiar path long enough to test a colder association.',
      subjects: randomSubjects.length >= 2 ? randomSubjects : undefined,
      steps:
        randomSubjects.length >= 2
          ? [
              {
                description:
                  'Treat the sampled subjects as concrete provocations. Ask what each makes newly visible in the current task.',
                call: {
                  tool: 'graph_understand',
                  arguments: understandWith(
                    'disrupt',
                    randomSubjects.map((node) => node.id),
                  ),
                },
              },
              {
                description:
                  'Let a defensible surprise redirect the work, or reject the perturbation as noise.',
              },
            ]
          : [
              {
                description:
                  'Sample cold graph material; returned nodes are provocations, not premises.',
                call: {
                  tool: 'graph_random',
                  arguments: {
                    nodes: 3,
                    edges: 0,
                    cold: true,
                    force: false,
                  },
                },
              },
            ],
    },
    {
      action: 'force-bisociation',
      label:
        randomSubjects.length >= 2
          ? `Temporarily force “${randomSubjects[0].title}” and “${randomSubjects[1].title}” into contact`
          : 'Run a Physics What-If between distant concepts',
      available: creativityEnabled && input.nodeCount >= 2,
      whyNow:
        'A deliberately forced lens can generate a candidate relation that ordinary relevance retrieval would never propose. The candidate still has to survive later scrutiny.',
      subjects:
        randomSubjects.length >= 2 ? randomSubjects.slice(0, 2) : undefined,
      steps: [
        {
          description:
            'For one generative pass, assume the sampled concepts connect and articulate how.',
          call: {
            tool: 'graph_random',
            arguments: {
              nodes: 2,
              edges: 0,
              cold: true,
              force: true,
              ...(randomSubjects.length >= 2
                ? {
                    nodeIds: randomSubjects.slice(0, 2).map((node) => node.id),
                  }
                : {}),
            },
          },
        },
        {
          description:
            'Release the forced assumption. Test the candidate against evidence and preserve it only if a defensible relation remains; no connection is valid.',
        },
      ],
    },
    {
      action: 'axiomatic-noise',
      label: 'Inject blind axiomatic noise',
      available: creativityEnabled && input.nodeCount >= 2,
      whyNow:
        'When familiar associations dominate, a blind ANI pass can force a model to invent a different explanatory frame from machine-local random words.',
      steps: [
        {
          description:
            'Draw cold graph material, replace part of it with machine-local dictionary seeds, and return only the blind-agent prompt.',
          call: {
            tool: 'graph_discover',
            arguments: {
              nodes: 2,
              cold: true,
              intensity: 0.25,
              blind: true,
            },
          },
        },
        {
          description:
            'Give only that prompt to a separate blind model context. Release the axioms afterward, scrutinize the synthesis, and preserve only what remains useful.',
        },
      ],
    },
    {
      action: 'survey-topology',
      label: 'Survey the graph as a landscape',
      available: hasGraph,
      whyNow:
        'A bounded task packet can omit a region whose topology or recent momentum would change the work.',
      steps: [
        {
          description:
            'Read the compact structural digest of regions, hubs, and recent activity.',
          call: { tool: 'graph_skeleton', arguments: {} },
        },
        {
          description:
            'Choose a region that could materially bear on the task, page it with graph_context_region, and stop after orientation if no region matters.',
        },
      ],
    },
    {
      action: 'catch-up',
      label: 'Catch up on graph changes since the last cursor',
      available: Boolean(input.updatesSince),
      whyNow:
        'A caller-supplied timestamp makes temporal re-entry possible without treating the present packet as the whole graph.',
      steps: [
        {
          description:
            'Load every visible node, edge, and commit change since the supplied timestamp.',
          call: {
            tool: 'graph_updates',
            arguments: { since: input.updatesSince },
          },
        },
        {
          description:
            'Re-enter only changes that can alter the live task; delta size depends on intervening work.',
        },
      ],
    },
    {
      action: 'inspect-structure',
      label: 'Inspect gaps, bridges, and open questions',
      available: hasGraph,
      whyNow: `${input.nodeCount} node(s) and ${input.edgeCount} edge(s) may expose structural absences or overused paths.`,
      steps: [
        {
          description:
            'Inspect graph shape without treating diagnostics as targets.',
          call: {
            tool: 'graph_analyze',
            arguments: { include: ['gaps', 'bridges', 'questions'] },
          },
        },
        {
          description: 'Act only on a finding that matters to the task.',
        },
      ],
    },
    {
      action: 'reread-artifact',
      label: artifact
        ? `Reread or test “${artifact.title}” as a fresh encounter`
        : 'Reread or test the current artifact',
      available: input.documentCount > 0,
      whyNow: `${input.documentCount} document node(s) can act as fresh encounters rather than passive output.`,
      subjects: artifact ? [artifact] : undefined,
      steps: [
        {
          description:
            'Read the exact local unit as a bounded fresh encounter.',
          call: artifact
            ? {
                tool: 'doc_read',
                arguments: { nodeId: artifact.id, offset: 0, limit: 8 },
              }
            : { tool: 'doc_list_roots', arguments: {} },
        },
        {
          description:
            'Reread, run, compare, or test it; preserve what this encounter changes.',
        },
      ],
    },
    {
      action: 'check-practice',
      label: 'Check how this graph has been worked, not how it is shaped',
      available: input.nodeCount >= 10,
      // Structural measures cannot distinguish a well-formed graph nobody
      // re-enters from a well-formed graph that changed someone's mind. On a
      // real project they reported 0.0% fragmentation, 100% connectivity and
      // 75/100 while five of six artifact units had no cognitive link at all
      // — so the diagnostics that would have caught it have to arrive
      // without being asked for. An agent that has to think of calling this
      // is an agent that already suspects the answer.
      whyNow: `${input.nodeCount} nodes exist; an occasional conduct check may show whether the graph is being re-entered and whether artifact units retain links to the understanding that shaped them. It is a mirror, not a missing-work checklist.`,
      steps: [
        {
          description:
            'Read only the diagnostics that bear on the current work. None is a target, and an absent node type is not work to manufacture.',
          call: { tool: 'graph_practice', arguments: {} },
        },
        {
          description:
            'Change practice only when a finding matters to the user task; otherwise ignore the report and continue or pause.',
        },
      ],
    },
    {
      action: 'read-artifact-whole',
      label: wholeArtifact
        ? `Read “${wholeArtifact.title}” end to end, in order`
        : 'Read the current artifact end to end, in order',
      available: input.documentCount >= 3,
      // Faults that belong to the SEQUENCE are invisible to every node-level
      // check. Measured: a five-passage story passed two rolled
      // reread-artifact suggestions and a last-sentence sweep, and reading it
      // whole found that nobody in it wanted anything — every passage
      // individually fine, the absence a property of the order.
      //
      // The natural trigger, time since the agent last read it whole, is
      // unobservable: the graph records writes, never reads. So this uses the
      // writing-streak proxy — prose has accumulated, and has outpaced live
      // thinking.
      whyNow: `${input.documentCount} document node(s) exist and nothing has read along their order. A fault that belongs to the sequence rather than to any single passage is invisible to node-level rereads.`,
      subjects: wholeArtifact ? [wholeArtifact] : undefined,
      steps: [
        {
          description:
            'Read the first bounded page of exact document units in order.',
          call: wholeArtifact
            ? {
                tool: 'doc_read',
                arguments: { nodeId: wholeArtifact.id, offset: 0, limit: 8 },
              }
            : { tool: 'doc_list_roots', arguments: {} },
        },
        {
          description:
            'Follow pagination.nextOffset until the root is complete; preserve only what the sequence changes that no individual unit did.',
        },
      ],
    },
    {
      action: 'read-source',
      label: 'Return to source material',
      available: input.workflow === 'reading' || input.workflow === 'research',
      whyNow:
        'Another bounded source encounter may revise the live inquiry more than further synthesis would.',
      steps: [
        {
          description: 'Inspect available sources and their progress.',
          call: { tool: 'source_list', arguments: {} },
        },
        {
          description:
            'Read the next relevant bounded passage and preserve the understanding it actually produces.',
        },
      ],
    },
    {
      action: 'search',
      label: 'Search from the local uncertainty',
      available: hasGraph,
      whyNow:
        'A narrower question may retrieve useful material that the broad task wording misses.',
      steps: [
        {
          description:
            'Restate the current uncertainty concretely, then retrieve against that wording.',
          call: {
            tool: 'graph_understand',
            arguments: understandWith('deepen'),
          },
        },
      ],
    },
    {
      action: 'revisit-history',
      label: 'Inspect how the current state arose',
      available: hasGraph,
      whyNow:
        'Revision history may reveal an abandoned alternative, unresolved correction, or reason for the present shape.',
      steps: [
        {
          description: 'Inspect recent graph changes and their stated intent.',
          call: { tool: 'graph_history', arguments: { limit: 12 } },
        },
        {
          description: 'Recover only history that changes the present task.',
        },
      ],
    },
    {
      action: 'preserve',
      label: 'Preserve the live understanding before moving on',
      available: true,
      whyNow:
        'A useful interpretation, alternative, reason, or uncertainty may already exist but remain transient.',
      steps: [
        {
          description:
            'Identify what a future instance would lose if the current context disappeared.',
        },
        {
          description:
            'Commit that understanding with its exact source or artifact provenance using graph_batch.',
        },
      ],
    },
    {
      action: 'pause',
      label: 'Pause or finish without inventing more work',
      available: true,
      whyNow:
        'The honest next move may be to stop when further activity would add ceremony rather than understanding.',
      steps: [
        {
          description:
            'Verify that the graph preserves the live state needed for continuation, then report or pause.',
        },
      ],
    },
  ];

  const count = Math.max(1, Math.min(6, Math.floor(input.count ?? 4)));
  const candidates = templates
    .filter(
      (template) =>
        template.available &&
        template.steps.every(
          (step) =>
            !step.call ||
            input.availableTools == null ||
            input.availableTools.has(step.call.tool),
        ),
    )
    .map((template) => ({
      template,
      pressure:
        actionPressure(template.action, input) *
        taskRelevanceMultiplier(template.subjects, input.taskRelevantNodes),
    }));
  const selected: typeof candidates = [];

  while (candidates.length > 0 && selected.length < count) {
    const total = candidates.reduce(
      (sum, candidate) => sum + candidate.pressure,
      0,
    );
    let threshold = random() * total;
    let selectedIndex = candidates.length - 1;
    for (let index = 0; index < candidates.length; index += 1) {
      threshold -= candidates[index].pressure;
      if (threshold <= 0) {
        selectedIndex = index;
        break;
      }
    }

    selected.push(...candidates.splice(selectedIndex, 1));
  }

  const maximumSelectedPressure =
    selected.length > 0
      ? Math.max(...selected.map((candidate) => candidate.pressure))
      : 1;
  return selected.map(({ template, pressure }) => {
    const { available: _available, ...move } = template;
    return {
      ...move,
      stance: stanceForAction(move.action),
      weight: Math.max(
        1,
        Math.round((pressure / maximumSelectedPressure) * 100),
      ),
      whyNow: `${move.whyNow} State pressure ${pressure.toFixed(2)}; only rolled options are shown.`,
    };
  });
}

function stanceForAction(action: string): UnderstandingStance {
  switch (action) {
    case 'deepen':
    case 'search':
      return 'deepen';
    case 'integrate':
      return 'resist';
    case 'connect':
    case 'inspect-structure':
    case 'bisociate':
    case 'survey-topology':
      return 'connect';
    case 'disrupt':
    case 'force-bisociation':
    case 'axiomatic-noise':
      return 'disrupt';
    case 'revisit-history':
    case 'check-practice':
    case 'catch-up':
      return 'revisit';
    case 'reread-artifact':
    case 'read-artifact-whole':
    case 'read-source':
      return 'test';
    default:
      return 'balanced';
  }
}

function actionPressure(action: string, input: RollNextMovesInput): number {
  const nodeCount = Math.max(1, input.cognitiveNodeCount ?? input.nodeCount);
  const fragmentation =
    (input.isolatedCognitiveCount ?? input.isolatedCount ?? 0) / nodeCount;
  const tightness = (input.cognitiveEdgeCount ?? input.edgeCount) / nodeCount;
  const unresolved = input.unresolvedCount / nodeCount;
  const contradictions = (input.contradictionCount ?? 0) / nodeCount;
  const cycles = (input.cycleCount ?? 0) / nodeCount;
  let pressure = 1;

  switch (action) {
    case 're-enter':
      pressure += input.focusNodeIds.length > 0 ? 1.1 : 0.35;
      break;
    case 'continue':
      pressure += 0.7;
      break;
    case 'deepen':
      pressure += unresolved * 5 + contradictions * 3;
      break;
    case 'integrate':
      pressure += contradictions * 7 + cycles * 3 + unresolved * 2;
      break;
    case 'connect':
      pressure += fragmentation * 6 + (tightness < 1 ? 0.5 : 0);
      break;
    case 'bisociate':
      pressure += Math.max(0, tightness - 1) * 0.6;
      pressure += input.focusNodeIds.length > 0 ? 0.45 : 0.2;
      break;
    case 'disrupt':
      pressure += Math.max(0, tightness - 1.5) * 1.5;
      pressure += unresolved < 0.08 ? 0.6 : 0;
      break;
    case 'force-bisociation':
      pressure += Math.max(0, tightness - 1.2) * 0.7;
      pressure += 0.35;
      break;
    case 'axiomatic-noise':
      pressure += Math.max(0, tightness - 1.5) * 0.45;
      pressure += unresolved < 0.05 ? 0.2 : 0;
      break;
    case 'inspect-structure':
      pressure += fragmentation * 3 + cycles * 2;
      break;
    case 'survey-topology':
      pressure += Math.min(1.2, input.nodeCount / 40);
      pressure += input.focusNodeIds.length === 0 ? 0.35 : 0;
      break;
    case 'catch-up':
      pressure += 0.8;
      break;
    case 'reread-artifact':
      pressure += Math.min(1.5, input.documentCount / 8);
      break;
    case 'read-artifact-whole':
      // Rises with accumulated prose, and again when prose has outpaced live
      // thinking — the observable stand-in for adding without stepping back.
      pressure += Math.min(1.2, input.documentCount / 6);
      pressure +=
        input.documentCount > Math.max(2, input.unresolvedCount * 2) ? 0.6 : 0;
      break;
    case 'read-source':
      pressure += 0.9;
      break;
    case 'search':
      pressure += unresolved * 2 + 0.35;
      break;
    case 'revisit-history':
      pressure += Math.min(0.8, input.nodeCount / 30);
      break;
    case 'preserve':
      pressure += input.documentCount > input.unresolvedCount * 3 ? 0.7 : 0.2;
      break;
    case 'pause':
      pressure = unresolved === 0 && contradictions === 0 ? 0.75 : 0.2;
      break;
  }

  if (input.workflow === 'writing') {
    if (
      action === 'disrupt' ||
      action === 'force-bisociation' ||
      action === 'bisociate' ||
      action === 'axiomatic-noise' ||
      action === 'connect'
    )
      pressure *= 1.35;
    if (action === 'reread-artifact') pressure *= 1.25;
  } else if (input.workflow === 'coding') {
    if (action === 'reread-artifact' || action === 'deepen') pressure *= 1.35;
    if (
      action === 'disrupt' ||
      action === 'force-bisociation' ||
      action === 'bisociate' ||
      action === 'axiomatic-noise'
    )
      pressure *= 0.65;
  } else if (input.workflow === 'research' || input.workflow === 'reading') {
    if (action === 'read-source' || action === 'search') pressure *= 1.4;
    if (action === 'integrate') pressure *= 1.25;
    if (action === 'read-artifact-whole') pressure *= 0.65;
  }

  const recentIndex = (input.recentActions ?? []).indexOf(action);
  if (recentIndex === 0) pressure *= 0.2;
  else if (recentIndex === 1) pressure *= 0.4;
  else if (recentIndex === 2) pressure *= 0.65;

  return Math.max(0.05, pressure);
}

function taskRelevanceMultiplier(
  subjects: NextMoveNode[] | undefined,
  taskRelevantNodes: NextMoveNode[] | undefined,
): number {
  if (!subjects?.length || !taskRelevantNodes?.length) return 1;
  const relevantIds = new Set(taskRelevantNodes.map((node) => node.id));
  return subjects.some((subject) => relevantIds.has(subject.id)) ? 1.25 : 1;
}

function uniqueNodes(nodes: NextMoveNode[]): NextMoveNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function pickOne<Value>(
  values: Value[],
  random: () => number,
): Value | undefined {
  if (values.length === 0) return undefined;
  return values[
    Math.min(values.length - 1, Math.floor(random() * values.length))
  ];
}

function pickMany<Value>(
  values: Value[],
  count: number,
  random: () => number,
): Value[] {
  const remaining = [...values];
  const selected: Value[] = [];
  while (remaining.length > 0 && selected.length < count) {
    const index = Math.min(
      remaining.length - 1,
      Math.floor(random() * remaining.length),
    );
    selected.push(...remaining.splice(index, 1));
  }
  return selected;
}
