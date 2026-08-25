import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EmbeddingService,
  type GraphNodeData,
  type GraphStore,
  getGraphStore,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';
import { epistemicStatusForNode } from '../protocol.js';

const DICTIONARY_PATH_ENV = 'UG_ANI_DICTIONARY_PATH';
const SYSTEM_DICTIONARY_PATHS = [
  '/usr/share/dict/words',
  '/usr/share/dict/web2',
  '/usr/share/dict/american-english',
  '/usr/share/dict/british-english',
  '/usr/local/share/dict/words',
  '/opt/homebrew/share/dict/words',
];

// ANI uses a dictionary installed on the host machine. Cache the parsed words,
// but retain the path so tests and long-running servers can change an explicit
// override without accidentally reusing another machine-local dictionary.
let dictionaryCache: { source: string; words: string[] } | null = null;

function loadDictionary(): string[] {
  const configuredPath = process.env[DICTIONARY_PATH_ENV]?.trim();
  const locations = configuredPath
    ? [path.resolve(configuredPath)]
    : SYSTEM_DICTIONARY_PATHS;
  const failures: string[] = [];

  for (const loc of locations) {
    if (dictionaryCache?.source === loc) return dictionaryCache.words;

    if (fs.existsSync(loc)) {
      try {
        const content = fs.readFileSync(loc, 'utf-8');
        const words = content
          .split(/\r?\n/)
          .map((word) => word.trim())
          .filter((word) => /^\p{L}{4,}$/u.test(word));
        if (words.length === 0) {
          failures.push(`${loc} contained no eligible words`);
          continue;
        }
        dictionaryCache = { source: loc, words };
        console.error(
          `ANI dictionary loaded: ${words.length} words from ${loc}`,
        );
        return words;
      } catch (e) {
        failures.push(`${loc}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  throw new Error(
    `ANI requires a machine-local newline-delimited dictionary. Set ${DICTIONARY_PATH_ENV} to an installed word-list file or install one at a standard system path. Searched: ${locations.join(', ')}.${
      failures.length > 0 ? ` Problems: ${failures.join('; ')}` : ''
    } No bundled or reduced fallback is used.`,
  );
}

function readIntensity(value: unknown, fallback: number): number {
  const intensity = value === undefined ? fallback : value;
  if (
    typeof intensity !== 'number' ||
    !Number.isFinite(intensity) ||
    intensity < 0 ||
    intensity > 1
  ) {
    throw new Error('intensity must be a finite number from 0 to 1');
  }
  return intensity;
}

function readInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return number;
}

function readNumber(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new Error(
      `${label} must be a finite number from ${minimum} to ${maximum}`,
    );
  }
  return number;
}

function nodeSemanticText(node: GraphNodeData): string {
  return (
    node.understanding?.trim() ||
    node.summary?.trim() ||
    node.content?.trim() ||
    node.title
  );
}

function describeNode(node: GraphNodeData, excerptLimit = 800) {
  const semanticText = nodeSemanticText(node);
  return {
    id: node.id,
    name: node.title,
    trigger: node.trigger,
    ...epistemicStatusForNode(node),
    understanding:
      semanticText.slice(0, excerptLimit) +
      (semanticText.length > excerptLimit ? '...' : ''),
  };
}

function recordNodeExposure(store: GraphStore, nodeIds: Iterable<string>) {
  const uniqueIds = [...new Set(nodeIds)];
  if (uniqueIds.length > 0) store.recordAccessBatch(uniqueIds);
}

function injectChaos(
  text: string,
  intensity: number,
  seedSource: 'dictionary' | 'graph',
): {
  corrupted: string;
  seeds: string[];
} {
  const words = text.split(/(\s+)/);
  const seeds: string[] = [];
  const eligibleWords = words
    .map((word, index) => {
      const match = /\p{L}{4,}/u.exec(word);
      return match
        ? { index, start: match.index, length: match[0].length }
        : null;
    })
    .filter(
      (
        candidate,
      ): candidate is { index: number; start: number; length: number } =>
        candidate != null,
    );
  if (intensity > 0 && eligibleWords.length === 0) {
    throw new Error(
      'ANI could not perturb the text because it contains no words of at least four Unicode letters',
    );
  }
  const selectedWords = new Map(
    eligibleWords
      .filter(() => Math.random() < intensity)
      .map((candidate) => [candidate.index, candidate]),
  );

  // A positive ANI request must actually perturb the input. Without this
  // guard, short inputs sometimes received zero seeds by chance.
  if (intensity > 0 && eligibleWords.length > 0 && selectedWords.size === 0) {
    const selected =
      eligibleWords[Math.floor(Math.random() * eligibleWords.length)];
    selectedWords.set(selected.index, selected);
  }

  const needsSeeds = selectedWords.size > 0;
  const dictionary =
    seedSource === 'dictionary' && needsSeeds ? loadDictionary() : [];
  const store = seedSource === 'graph' && needsSeeds ? getGraphStore() : null;
  const graphNodes = store ? store.getRandomNodes(50) : [];
  if (seedSource === 'graph' && needsSeeds && graphNodes.length === 0) {
    throw new Error(
      'Graph-sourced ANI requires at least one visible graph node',
    );
  }

  const corrupted = words
    .map((word, index) => {
      const selected = selectedWords.get(index);
      if (selected) {
        let seed: string;
        if (seedSource === 'dictionary') {
          seed =
            dictionary[
              Math.floor(Math.random() * dictionary.length)
            ].toUpperCase();
        } else {
          const node =
            graphNodes[Math.floor(Math.random() * graphNodes.length)];
          // Extract first word from node name
          seed = node.title.split(/\s+/)[0].toUpperCase();
        }
        seeds.push(seed);
        return `${word.slice(0, selected.start)}[${seed}]${word.slice(selected.start + selected.length)}`;
      }
      return word;
    })
    .join('');

  return { corrupted, seeds };
}

export const synthesisTools: Tool[] = [
  {
    name: 'graph_discover',
    description: `HIGH-DIVERGENCE, UNGROUNDED ANI (Axiomatic Noise Injection).

Use when the live work genuinely benefits from high-divergence exploration,
whether chosen directly or offered by a creativity-enabled suggestion roll.
For ordinary connection-finding, prefer graph_discover_grounded: it first asks
for a defensible bridge and allows "no connection" as an answer.

WHAT IT DOES:
1. Selects random nodes from graph
2. Corrupts their synthesis with chaos seeds (dictionary words)
3. Returns a prompt for sense-making

WORKFLOW:
1. Call graph_discover({ nodes: 2, cold: true })
2. Read the returned "prompt" field
3. IMPORTANT: Start a SEPARATE agent or isolated model context with ONLY the prompt
   - The blind agent must NOT know the original node context
   - This tests the Inverse Hallucination method: inventing logic to fit facts
4. Record synthesis with graph_batch containing a graph_serendipity operation

WHY BLIND AGENTS: If the same context sees the original material, it can map seeds back to known meanings. An isolated context has to invent another logic. Use the portable "blindAgentRecommendation.blindPrompt". ANI requires a host-installed word list; set UG_ANI_DICTIONARY_PATH when no standard system dictionary is available.`,
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Number of random nodes to select (1-8; default: 3)',
        },
        intensity: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Experimental replacement probability from 0.0 to 1.0 (default: 0.25). Higher values perturb more of the material but carry no quality guarantee.',
        },
        cold: {
          type: 'boolean',
          description:
            'Prioritize rarely-accessed nodes for maximum semantic distance. Use true for more surprising connections.',
        },
        blind: {
          type: 'boolean',
          description:
            'When true, omits original graph material and seed details and supplies a prompt suitable for a fresh isolated context. The host must enforce isolation; the MCP tool cannot do so itself.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_discover_grounded',
    description:
      'DEFAULT serendipity workflow: 1) Pick random nodes and optional edges whose endpoints are among them, 2) Find a defensible connection or explicitly report none, 3) optionally perturb the grounded bridge, 4) integrate only what survives scrutiny. Prefer this over ungrounded graph_discover for understanding work.',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'integer',
          minimum: 2,
          maximum: 8,
          description: 'Number of random nodes to select (2-8; default: 3)',
        },
        edges: {
          type: 'integer',
          minimum: 0,
          maximum: 8,
          description:
            'Maximum random edges among the selected nodes to include (0-8; default: 0)',
        },
        intensity: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Chaos injection intensity for phase 3 (0.0-1.0). Applied AFTER sense-making. Default: 0.20',
        },
        cold: {
          type: 'boolean',
          description:
            'Prioritize rarely-accessed nodes for maximum semantic distance.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_discover_grounded_chaos',
    description:
      'Phase 3 of grounded serendipity: Takes the genuine bridge you found and injects chaos to push it into unexplored territory. Call this AFTER graph_discover_grounded once you have articulated the real connection. Requires a host-installed newline-delimited dictionary; set UG_ANI_DICTIONARY_PATH when no standard system word list exists.',
    inputSchema: {
      type: 'object',
      properties: {
        bridge: {
          type: 'string',
          description:
            'The genuine connection you found between the concepts (from Phase 2)',
        },
        explanation: {
          type: 'string',
          description: 'Your explanation of why this connection is real',
        },
        source_nodes: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 8,
          description:
            'Node IDs from the original graph_discover_grounded call',
        },
        intensity: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Chaos injection intensity (0.0-1.0). Default: 0.20',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['bridge', 'source_nodes'],
    },
  },
  {
    name: 'graph_bisociate',
    description:
      'Optional Bisociation Engine: use spreading activation and information-gain signals to surface concrete concept pairs that may support an unexpected connection. Supply seed_nodes to spread from the current focus, or omit them for graph-wide mixed sampling. The candidates are provocations for model judgment, not claims that a connection exists.',
    inputSchema: {
      type: 'object',
      properties: {
        seed_nodes: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 6,
          description:
            'Optional node IDs or titles representing the current focus. Activation spreads through their graph neighborhoods.',
        },
        strategy: {
          type: 'string',
          enum: ['mixed', 'hot', 'cold', 'random', 'bridge'],
          description:
            'Graph-wide seed strategy when seed_nodes is omitted (default: mixed).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum candidates to return (default: 8).',
        },
        steps: {
          type: 'integer',
          minimum: 1,
          maximum: 6,
          description:
            'Maximum spreading-activation hops for explicit seeds (default: 3).',
        },
        decay: {
          type: 'number',
          minimum: 0.05,
          maximum: 0.95,
          description:
            'Activation retained per hop for explicit seeds (default: 0.6).',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_random',
    description:
      'Sample concrete graph elements for divergent exploration. Use the returned nodes as provocations: judge how, or whether, they matter to the live task. No defensible connection is valid. force:true enables the stronger local Physics What-If experiment; ordinary work should normally keep force:false.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 12,
          description:
            'Deprecated alias for nodes. Edges remain controlled independently by edges.',
        },
        nodes: {
          type: 'integer',
          minimum: 1,
          maximum: 12,
          description:
            'Number of random nodes to get (default: 2 when force:true, 3 otherwise)',
        },
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 6,
          description:
            'Optional exact node IDs or titles supplied by graph_suggest_next. When present, inspect these nodes instead of drawing another random sample.',
        },
        edges: {
          type: 'integer',
          minimum: 0,
          maximum: 12,
          description: 'Number of random edges to get',
        },
        force: {
          type: 'boolean',
          description:
            'Optional Physics What-If experiment that temporarily assumes sampled concepts connect and asks how. Default false; reject the result unless later scrutiny grounds it.',
        },
        cold: {
          type: 'boolean',
          description:
            'Prioritize cold (rarely accessed) nodes for maximum semantic distance. Best combined with force:true.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_serendipity',
    description: `BATCH-ONLY: Record a serendipitous synthesis, anchor it to every source element with typed learned_from edges, and get a Novelty Score verdict. Use as a graph_batch operation so the node, edges, and commit land atomically.

WHEN TO USE: After graph_discover or graph_chaos produces an insight worth keeping.

WHAT IT DOES:
1. Creates a serendipity node with your synthesis
2. Calculates Novelty Score (S_N) = Harmonic Mean of Divergence × Coherence
3. Returns an advisory label: ACCEPT (S_N ≥ 0.35) | RETRY (regenerate) | UNSCORED (no embeddings)

The score does not validate the synthesis and never blocks persistence. New serendipity remains validated=false until later scrutiny or testing supports an explicit graph_validate operation.

TYPICAL BATCH OPERATION:
{ tool: "graph_serendipity", params: {
  name: "The Parasitic Optimization Pattern",
  synthesis: "Systems that optimize for engagement become parasitic...",
  source_elements: ["n_abc123", "n_def456"],
  why: "Connects evolutionary biology to tech ethics"
} }

The source_elements are the node IDs from your graph_discover() call - include them for proper attribution.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Evocative name for your synthesis (e.g., "The Parasitic Optimization Pattern")',
        },
        synthesis: {
          type: 'string',
          description:
            'Your creative synthesis - the insight that emerged from chaos',
        },
        source_elements: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 12,
          description:
            'Node IDs that inspired this (from graph_discover response)',
        },
        why: {
          type: 'string',
          description:
            'Why this synthesis matters or is worth exploring further',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['name', 'synthesis', 'source_elements'],
    },
  },
  {
    name: 'graph_validate',
    description:
      'BATCH-ONLY: Record an authored validation judgment after a serendipity has survived scrutiny or testing. This stores status and rationale; it does not independently prove the claim. Use as a graph_batch operation so the revision and commit land atomically.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Serendipity node name or ID to validate',
        },
        insight: {
          type: 'string',
          description: 'Brief description of the real insight extracted',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['node', 'insight'],
    },
  },
  {
    name: 'graph_chaos',
    description: `ANI (Axiomatic Noise Injection): Corrupt text with chaos seeds to force a divergent reinterpretation.

WHAT IT DOES:
1. Takes your text (or random node content)
2. Replaces words independently at a configurable probability (25% by default)
3. Returns corrupted text + "Physics What-If" prompt

WORKFLOW:
1. graph_chaos({ text: "Your concept description" })
2. Read the "prompt" field from result
3. CRITICAL: Start a BLIND agent or isolated model context using ONLY the prompt
   - Agent must NOT see original text
   - This tests the Inverse Hallucination method by asking the model to invent logic that fits the seeds
4. Record the synthesis with graph_batch containing a graph_serendipity operation

The response includes a portable "blindAgentRecommendation.blindPrompt". ANI requires a host-installed word list; set UG_ANI_DICTIONARY_PATH when no standard system dictionary is available.

MECHANISM: Seeds are temporarily treated as axioms. For example, an isolated context that sees [CAPITALISM] in place of "system" must construct a frame in which capitalism functions as a system-governing force. The result is a speculative candidate that still requires scrutiny.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          maxLength: 12000,
          description:
            'Text to corrupt with chaos seeds. If not provided, uses a random node understanding from the graph.',
        },
        source_node: {
          type: 'string',
          description:
            'Optional graph node ID or title anchoring caller-supplied text. Supply it when a retained candidate should be attributable to existing graph material.',
        },
        intensity: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Experimental replacement probability from 0.0 to 1.0 (default: 0.25). Higher values perturb more of the material but carry no quality guarantee.',
        },
        source: {
          type: 'string',
          enum: ['dictionary', 'graph'],
          description:
            'Entropy source. "dictionary" (default): use the machine-local word list detected by the server. "graph": use existing node names for self-referential chaos.',
        },
        blind: {
          type: 'boolean',
          description:
            'When true, omits original text and seed details and supplies a prompt suitable for a fresh isolated context. The host must enforce isolation; the MCP tool cannot do so itself.',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
    },
  },
  {
    name: 'graph_evaluate_variations',
    description:
      'Experimentally rank candidate texts by a Novelty Score: the harmonic mean of semantic divergence from the supplied original context and caller-assessed coherence. Returns candidates best-to-worst with per-candidate scores; it does not measure truth or validate the winner. Originally designed as the selection phase of the ANI serendipity pipeline (see graph_chaos / graph_discover).',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'The original context/text before chaos injection',
        },
        variations: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 12,
          description: 'Array of generated narrative variations to compare',
        },
        coherence_scores: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 10 },
          minItems: 1,
          maxItems: 12,
          description:
            'Optional 0-10 coherence scores for each variation (default: 8.0)',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['context', 'variations'],
    },
  },
  {
    name: 'graph_decide',
    description:
      'BATCH-ONLY: Create a durable decision node that captures a choice, connects to every option with valid typed edges, and records what was chosen and why. Use as a graph_batch operation so the node, option edges, and commit land atomically.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'The decision question (e.g., "Which caching strategy?")',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node IDs or names of the alternatives being considered',
        },
        chosen: {
          type: 'string',
          description: 'Node ID or name of the chosen option',
        },
        reasoning: {
          type: 'string',
          description: 'Why this option was chosen over the alternatives',
        },
        project: {
          type: 'string',
          description: 'Project ID (optional)',
        },
      },
      required: ['question', 'options', 'chosen', 'reasoning'],
    },
  },
];

export async function handleSynthesisTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  const conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const toolCallId = contextManager.getCurrentToolCall();

  switch (name) {
    case 'graph_discover': {
      const store = getGraphStore();
      const coldMode = args.cold === true;
      const nodeCount = readInteger(args.nodes, 3, 'nodes', 1, 8);
      const intensity = readIntensity(args.intensity, 0.25);

      // 1. Get random nodes
      const nodes = coldMode
        ? store.getColdNodes(nodeCount).map((c) => c.node)
        : store.getRandomNodes(nodeCount);

      if (nodes.length === 0) {
        return {
          success: false,
          error: 'No nodes in graph to select from',
        };
      }

      // 2. Combine understandings
      const combinedText = nodes
        .map((node) => nodeSemanticText(node).slice(0, 1200))
        .join(' | ');

      // 3. Chaos injection
      const { corrupted, seeds } = injectChaos(
        combinedText,
        intensity,
        'dictionary',
      );

      // Build ANI prompt for blind agent
      const prompt = `ANI (AXIOMATIC NOISE INJECTION) — SERENDIPITY EXPLORATION

**Chaos-Corrupted Synthesis Material:**
"${corrupted}"

**Seeds Injected:** ${seeds.join(', ')}

---

**PHYSICS WHAT-IF PROTOCOL**

The bracketed [SEEDS] are AXIOMS — fundamental truths about this domain. Your job is to RATIONALIZE how they could be true.

For each seed:
1. **LITERAL OR MORPHOLOGICAL READING**: State a meaning only if you know it; otherwise mark it unknown and work from the word's form or sound without inventing a dictionary definition
2. **PHYSICS**: What law would govern this domain if this seed were true?
3. **REVELATION**: What does this reveal that standard analysis misses?

Synthesize a coherent conceptual framework integrating all seeds. Name it something evocative.`;

      const persistenceRecommendation = {
        operation: 'graph_serendipity',
        sourceElements: nodes.map((node) => node.id),
        instruction:
          'Return the candidate to the orchestrating context. After scrutiny, that context may preserve it source-linked and unvalidated with graph_batch; the blind context should not access the graph.',
      };

      // Portable prompt for a fresh agent/conversation. The tool cannot know
      // whether its host provides subagents, a new task, or a separate chat.
      const blindAgentPrompt = `You are a blind sense-making agent. You have NO context about the original source.

${prompt}

CRITICAL:
- Do NOT guess what the original text was about
- Treat EVERY seed as TRUE
- Invent LOGIC to fit these FACTS (Inverse Hallucination)
- Create a NOVEL framework, not a reconstruction`;

      recordNodeExposure(
        store,
        nodes.map((node) => node.id),
      );

      // Blind mode omits the original material and seeds. Host-level context
      // isolation remains the caller's responsibility.
      if (args.blind === true) {
        return {
          success: true,
          mode: 'blind',
          prompt,
          sourceNodeIds: nodes.map((n) => n.id), // IDs only for graph_serendipity attribution
          blindAgentRecommendation: {
            message:
              'Blind mode active. Start a fresh agent or isolated conversation with only blindPrompt.',
            blindPrompt: blindAgentPrompt,
          },
          persistenceRecommendation,
          warning:
            'Do not give the isolated sense-making context the original graph material; that separation is what makes this an Inverse Hallucination experiment.',
        };
      }

      // Full response (for debugging or when orchestrator needs context)
      return {
        success: true,
        mode: 'full',
        sourceNodes: nodes.map((node) => describeNode(node)),
        combinedText,
        corrupted,
        seeds,
        intensity,
        prompt,
        blindAgentRecommendation: {
          message:
            'For the blind ANI variant, start a fresh agent or isolated conversation without the original context. Consider using blind=true.',
          blindPrompt: blindAgentPrompt,
        },
        persistenceRecommendation,
      };
    }

    case 'graph_discover_grounded': {
      // Grounded serendipity: find real connection first, THEN inject chaos
      const store = getGraphStore();
      const coldMode = args.cold === true;
      const nodeCount = readInteger(args.nodes, 3, 'nodes', 2, 8);
      const edgeCount = readInteger(args.edges, 0, 'edges', 0, 8);
      const intensity = readIntensity(args.intensity, 0.2); // Lower default - chaos comes after sense-making

      // Phase 1: Random element picking
      const nodes = coldMode
        ? store.getColdNodes(nodeCount).map((c) => c.node)
        : store.getRandomNodes(nodeCount);

      if (nodes.length < 2) {
        return {
          success: false,
          error: 'INSUFFICIENT_GRAPH',
          message:
            'Grounded serendipity requires at least two visible graph nodes.',
        };
      }
      const selectedNodeIds = new Set(nodes.map((node) => node.id));
      const eligibleEdges = store
        .getAll()
        .edges.filter(
          (edge) =>
            selectedNodeIds.has(edge.fromId) && selectedNodeIds.has(edge.toId),
        );
      for (let index = eligibleEdges.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [eligibleEdges[index], eligibleEdges[swapIndex]] = [
          eligibleEdges[swapIndex],
          eligibleEdges[index],
        ];
      }
      const edges = eligibleEdges.slice(0, edgeCount);

      // Format elements for the prompt
      const nodeDescriptions = nodes
        .map(
          (n, i) =>
            `${i + 1}. **${n.title}** (${n.id})\n   ${nodeSemanticText(n).slice(0, 200)}`,
        )
        .join('\n\n');

      const edgeDescriptions =
        edges.length > 0
          ? edges
              .map(
                (e) =>
                  `- ${e.fromId} → ${e.toId}: "${e.explanation || e.type}"`,
              )
              .join('\n')
          : null;

      // Phase 2 prompt: Find the REAL connection first
      const senseMakingPrompt = `GROUNDED SERENDIPITY — Phase 2: Sense-Making

**Random Elements Selected:**

${nodeDescriptions}
${edgeDescriptions ? `\n**Edges:**\n${edgeDescriptions}` : ''}

---

**YOUR TASK: Find the genuine bridge.**

These concepts were selected randomly, but randomness often surfaces hidden structure. Before any creative leap, ground yourself:

1. **SHARED SUBSTRATE**: What domain, principle, or phenomenon do these concepts genuinely share? (Not forced — actually share.)

2. **FUNCTIONAL ANALOGY**: If one concept's mechanism was transplanted to another's domain, what would it explain?

3. **TENSION OR COMPLEMENT**: Do these concepts pull in opposite directions, or fill each other's gaps?

Articulate the **real connection** — the one that would hold up under scrutiny. Be specific. If there isn't one, say so.

---

Once you've found it, reply with:

**BRIDGE FOUND:** [one sentence describing the genuine connection]

**EXPLANATION:** [2-3 sentences on why this connection is real, not forced]

Then I'll inject chaos to push this connection into unexplored territory.`;

      // Prepare chaos injection materials for phase 3
      const combinedText = nodes
        .map((node) => nodeSemanticText(node).slice(0, 1200))
        .join(' | ');

      recordNodeExposure(
        store,
        nodes.map((node) => node.id),
      );

      return {
        success: true,
        phase: 'sense-making',
        sourceNodes: nodes.map((node) => describeNode(node)),
        sourceEdges: edges.map((e) => ({
          id: e.id,
          from: e.fromId,
          to: e.toId,
          explanation: e.explanation,
        })),
        prompt: senseMakingPrompt,
        // Materials for phase 3 (chaos injection) - model should call graph_discover_grounded_chaos after sense-making
        chaosReady: {
          combinedText,
          intensity,
          nodeIds: nodes.map((n) => n.id),
          hint: 'After articulating the bridge, call graph_discover_grounded_chaos with your bridge statement to inject chaos and complete the serendipity.',
        },
      };
    }

    case 'graph_discover_grounded_chaos': {
      // Phase 3: Inject chaos into the genuine bridge
      const store = getGraphStore();
      const bridge = typeof args.bridge === 'string' ? args.bridge.trim() : '';
      const explanation = (args.explanation as string) || '';
      const rawSourceNodes = args.source_nodes;
      if (
        !Array.isArray(rawSourceNodes) ||
        rawSourceNodes.length < 1 ||
        rawSourceNodes.length > 8 ||
        rawSourceNodes.some(
          (node) => typeof node !== 'string' || node.trim().length === 0,
        )
      ) {
        return {
          success: false,
          error: 'source_nodes must contain 1 to 8 non-empty node references',
        };
      }
      const sourceNodes = [
        ...new Set(
          rawSourceNodes.map(
            (node) =>
              contextManager.resolveNodeWithSuggestions(
                node as string,
                projectId,
              ).id,
          ),
        ),
      ];
      const intensity = readIntensity(args.intensity, 0.2);

      if (!bridge) {
        return {
          success: false,
          error:
            'No bridge statement provided. First call graph_discover_grounded and articulate the real connection.',
        };
      }

      // Combine bridge and explanation for chaos injection
      const textToCorrupt = explanation ? `${bridge} — ${explanation}` : bridge;

      // Inject chaos into the grounded connection
      const { corrupted, seeds } = injectChaos(
        textToCorrupt,
        intensity,
        'dictionary',
      );
      recordNodeExposure(store, sourceNodes);

      // Build the phase 4 integration prompt
      const integrationPrompt = `GROUNDED SERENDIPITY — Phase 3: Chaos Perturbation

**Your Genuine Bridge:**
"${bridge}"

${explanation ? `**Your Explanation:**\n"${explanation}"\n` : ''}
---

**Chaos-Corrupted Bridge:**
"${corrupted}"

**Seeds Injected:** ${seeds.join(', ')}

---

**INTEGRATION TASK:**

The seeds are perturbations to your real insight. For each seed, ask:

1. **LITERAL TWIST**: What if this word was literally true of your bridge?
2. **DOMAIN SHIFT**: What if this seed pulled your connection into a completely different field?
3. **INVERSION**: What if the seed represents the opposite of your bridge — what would that teach you?

Find where the chaos reveals something your original bridge missed. The goal is not to abandon your insight, but to **extend it into territory you wouldn't have explored otherwise**.

---

If a genuine extension emerges, record it atomically with graph_batch using a graph_serendipity operation:
- name: A concise name for the extended insight
- synthesis: The chaos-extended version of your bridge
- source_elements: [${sourceNodes.map((id) => `"${id}"`).join(', ')}]
- why: How does this extend beyond your original bridge?

If the chaos didn't reveal anything useful, that's fine — the original bridge was already the insight.`;

      return {
        success: true,
        phase: 'chaos-injection',
        originalBridge: bridge,
        explanation,
        corrupted,
        seeds,
        intensity,
        sourceNodes,
        prompt: integrationPrompt,
      };
    }

    case 'graph_bisociate': {
      const store = getGraphStore();
      const limit = readInteger(args.limit, 8, 'limit', 1, 20);
      const stochasticSparsePairs = () => {
        const allNodes = store.getAll().nodes;
        const poolSize = Math.min(
          allNodes.length,
          Math.max(2, Math.min(12, limit * 2)),
        );
        const coldPool = store.getColdNodes(poolSize).map((item) => item.node);
        const pool = [...(coldPool.length >= 2 ? coldPool : allNodes)];
        for (let index = pool.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
        }
        const pairs: Array<Record<string, unknown>> = [];
        for (
          let left = 0;
          left < pool.length && pairs.length < limit;
          left += 1
        ) {
          for (
            let right = left + 1;
            right < pool.length && pairs.length < limit;
            right += 1
          ) {
            pairs.push({
              node1: describeNode(pool[left]),
              node2: describeNode(pool[right]),
              score: null,
              reason: 'Sparse-graph stochastic fallback',
              signals: { stochastic: true },
            });
          }
        }
        recordNodeExposure(
          store,
          pairs.flatMap((pair) => [
            (pair.node1 as { id: string }).id,
            (pair.node2 as { id: string }).id,
          ]),
        );
        return pairs;
      };
      if (
        args.seed_nodes !== undefined &&
        (!Array.isArray(args.seed_nodes) ||
          args.seed_nodes.length < 1 ||
          args.seed_nodes.length > 6 ||
          args.seed_nodes.some(
            (ref) => typeof ref !== 'string' || ref.trim().length === 0,
          ))
      ) {
        throw new Error(
          'seed_nodes must contain 1 to 6 non-empty node references',
        );
      }
      const seedRefs = Array.isArray(args.seed_nodes)
        ? [...new Set(args.seed_nodes.map((ref) => (ref as string).trim()))]
        : [];

      if (seedRefs.length > 0) {
        const seeds = seedRefs.map((ref) => {
          const resolved = contextManager.resolveNodeWithSuggestions(
            ref,
            projectId,
          );
          const node = store.getNode(resolved.id);
          if (!node) throw new Error(`Node not found: ${ref}`);
          return node;
        });
        const steps = readInteger(args.steps, 3, 'steps', 1, 6);
        const decay = readNumber(args.decay, 0.6, 'decay', 0.05, 0.95);
        const activated = store.spreadingActivation(
          seeds.map((node) => node.id),
          {
            decayFactor: decay,
            maxSteps: steps,
            temperatureWeighted: true,
          },
        );

        if (activated.length === 0 && store.getAll().nodes.length >= 2) {
          const fallback = await store.unifiedSerendipity({
            limit,
            seedStrategy: 'mixed',
            numSeeds: 3,
          });
          const fallbackCandidates =
            fallback.length > 0
              ? fallback.map((candidate) => ({
                  node1: describeNode(candidate.node1),
                  node2: describeNode(candidate.node2),
                  score: candidate.score,
                  reason: candidate.reason,
                  signals: candidate.sources,
                }))
              : stochasticSparsePairs();
          recordNodeExposure(store, [
            ...seeds.map((node) => node.id),
            ...fallback.flatMap((candidate) => [
              candidate.node1.id,
              candidate.node2.id,
            ]),
          ]);
          return {
            success: true,
            mode: 'graph-wide-fallback',
            requestedSeeds: seeds.map((node) => describeNode(node)),
            fallbackReason:
              'The explicit seeds activated no non-seed candidates, so the engine returned graph-wide candidates instead.',
            fallbackKind:
              fallback.length > 0 ? 'multi-signal' : 'stochastic-sparse-graph',
            candidates: fallbackCandidates,
            choice:
              'Treat fallback candidates as provocations, not evidence. Reject every candidate if none helps the live task.',
          };
        }

        const communityByNode = new Map<string, number>();
        for (const [communityId, communityNodes] of store.detectCommunities()
          .communities) {
          for (const communityNode of communityNodes) {
            communityByNode.set(communityNode.id, communityId);
          }
        }

        const visibleActivated = activated.slice(0, limit);
        recordNodeExposure(store, [
          ...seeds.map((node) => node.id),
          ...visibleActivated.map((candidate) => candidate.node.id),
        ]);
        return {
          success: true,
          mode: 'seeded-spreading-activation',
          seeds: seeds.map((node) => describeNode(node)),
          candidates: visibleActivated.map((candidate) => {
            const source = store.getNode(candidate.source);
            return {
              source: source ? describeNode(source) : { id: candidate.source },
              target: describeNode(candidate.node),
              activation: candidate.activation,
              pathLength: candidate.pathLength,
              informationGain: store.informationGain(
                candidate.source,
                candidate.node.id,
                communityByNode,
              ),
            };
          }),
          parameters: { decay, steps },
          choice:
            'Judge whether any candidate helps the live task. You may connect, scrutinize, perturb, combine, or reject every candidate; activation is attention pressure, not evidence.',
        };
      }

      const strategy = args.strategy ?? 'mixed';
      if (
        typeof strategy !== 'string' ||
        !['mixed', 'hot', 'cold', 'random', 'bridge'].includes(strategy)
      ) {
        throw new Error(
          'strategy must be one of: mixed, hot, cold, random, bridge',
        );
      }
      const candidates = await store.unifiedSerendipity({
        limit,
        seedStrategy: strategy as
          | 'mixed'
          | 'hot'
          | 'cold'
          | 'random'
          | 'bridge',
        numSeeds: 3,
      });

      if (candidates.length === 0 && store.getAll().nodes.length >= 2) {
        return {
          success: true,
          mode: 'graph-wide-stochastic-fallback',
          strategy,
          fallbackReason:
            'The sparse graph produced no activation, link-prediction, or embedding candidates, so the engine sampled cold node pairs without assigning a score.',
          candidates: stochasticSparsePairs(),
          choice:
            'These pairs are stochastic provocations only. Reject every candidate if no defensible connection helps the live task.',
        };
      }

      recordNodeExposure(
        store,
        candidates.flatMap((candidate) => [
          candidate.node1.id,
          candidate.node2.id,
        ]),
      );

      return {
        success: true,
        mode: 'graph-wide-bisociation',
        strategy,
        candidates: candidates.map((candidate) => ({
          node1: describeNode(candidate.node1),
          node2: describeNode(candidate.node2),
          score: candidate.score,
          reason: candidate.reason,
          signals: candidate.sources,
        })),
        choice:
          'Treat these as concrete propositions to evaluate, not ranked truths. Explore one that could change the work, combine them, or reject all of them.',
      };
    }

    case 'graph_random': {
      const store = getGraphStore();
      const forceMode = args.force === true;
      const coldMode = args.cold === true;
      if (
        args.nodeIds !== undefined &&
        (!Array.isArray(args.nodeIds) ||
          args.nodeIds.length < 2 ||
          args.nodeIds.length > 6 ||
          args.nodeIds.some(
            (ref) => typeof ref !== 'string' || ref.trim().length === 0,
          ))
      ) {
        throw new Error(
          'nodeIds must contain 2 to 6 non-empty node references',
        );
      }
      const requestedNodeRefs = Array.isArray(args.nodeIds)
        ? [...new Set(args.nodeIds.map((ref) => (ref as string).trim()))]
        : [];

      // Default to 2 nodes for forcing (pairs work best), 3 otherwise
      const countValue = args.nodes ?? args.count;
      const nodeCount = readInteger(
        countValue,
        forceMode ? 2 : 3,
        args.nodes === undefined && args.count !== undefined
          ? 'count'
          : 'nodes',
        1,
        12,
      );
      const edgeCount = readInteger(args.edges, 0, 'edges', 0, 12);

      // Get nodes - cold mode prioritizes rarely accessed nodes for max semantic distance
      const sampledNodes =
        requestedNodeRefs.length > 0
          ? requestedNodeRefs.map((ref) => {
              const resolved = contextManager.resolveNodeWithSuggestions(
                ref,
                projectId,
              );
              const node = store.getNode(resolved.id);
              if (!node) throw new Error(`Node not found: ${ref}`);
              return node;
            })
          : coldMode
            ? store.getColdNodes(nodeCount).map((c) => c.node)
            : store.getRandomNodes(nodeCount);
      const nodes = [
        ...new Map(sampledNodes.map((node) => [node.id, node])).values(),
      ];
      if (forceMode && nodes.length < 2) {
        throw new Error(
          'Axiomatic forcing requires at least two distinct visible graph nodes',
        );
      }
      const edges = store.getRandomEdges(edgeCount);

      const baseResult = {
        nodes: nodes.map((node) => describeNode(node)),
        edges: edges.map((e) => ({
          id: e.id,
          from: e.fromId,
          to: e.toId,
          explanation: e.explanation,
        })),
      };
      recordNodeExposure(
        store,
        nodes.map((node) => node.id),
      );

      if (forceMode && nodes.length >= 2) {
        // Axiomatic forcing mode - Physics What-If prompt
        const conceptA = nodes[0];
        const conceptB = nodes[1];
        const additionalConcepts = nodes.slice(2);

        let forcingPrompt = `PHYSICS WHAT-IF — FORCED GENERATIVE PASS

You are given concepts from an understanding graph:

**Concept A: ${conceptA.title}**
${nodeSemanticText(conceptA).slice(0, 1600)}

**Concept B: ${conceptB.title}**
${nodeSemanticText(conceptB).slice(0, 1600)}`;

        if (additionalConcepts.length > 0) {
          forcingPrompt += '\n\n**Additional Concepts:**';
          additionalConcepts.forEach((c, i) => {
            forcingPrompt += `\n${i + 1}. **${c.title}**: ${nodeSemanticText(c).slice(0, 200)}`;
          });
        }

        forcingPrompt += `

---

For this generative pass only, assume these concepts are axiomatically connected.
Do not evaluate the connection yet; articulate the strongest version of how it could work.

**Physics What-If:** If Concept A was a fundamental law governing Concept B, how would the relationship function? If B was a law governing A, how would it differ?

Describe the connection under that temporary axiom. Explain HOW rather than deciding whether it is true.

Then release the axiom and scrutinize the candidate against the task, evidence,
and source concepts. Preserve it only if a defensible relation remains; "no
connection" is a valid result. A forced candidate is not itself graph evidence.`;

        return {
          ...baseResult,
          mode: 'forcing',
          prompt: forcingPrompt,
        };
      }

      // Permission mode (default) - original behavior
      return {
        ...baseResult,
        mode: 'permission',
        hint: 'Treat these concrete elements as a divergent provocation. Ask what they make newly visible, then preserve only a connection that survives scrutiny; no connection is valid.',
      };
    }

    case 'graph_serendipity': {
      const store = getGraphStore();
      const title = typeof args.name === 'string' ? args.name.trim() : '';
      const synthesis =
        typeof args.synthesis === 'string' ? args.synthesis.trim() : '';
      const sourceRefs = args.source_elements;

      if (!title || !synthesis) {
        return {
          success: false,
          error: 'MISSING_PARAMETER',
          message: 'graph_serendipity requires non-empty name and synthesis.',
        };
      }
      if (
        !Array.isArray(sourceRefs) ||
        sourceRefs.length === 0 ||
        sourceRefs.length > 12 ||
        sourceRefs.some(
          (source) => typeof source !== 'string' || source.trim() === '',
        )
      ) {
        return {
          success: false,
          error: 'MISSING_SOURCE_ELEMENTS',
          message:
            'graph_serendipity requires at least one valid source_elements node reference.',
        };
      }

      // Resolve and validate every source before mutating. This keeps the
      // handler safe even when it is called internally by graph_batch.
      const resolvedSourceMap = new Map<string, { id: string; name: string }>();
      for (const sourceRef of sourceRefs) {
        const resolved = contextManager.resolveNodeWithSuggestions(
          sourceRef as string,
          projectId,
        );
        resolvedSourceMap.set(resolved.id, {
          id: resolved.id,
          name: resolved.title,
        });
      }
      const resolvedSources = [...resolvedSourceMap.values()];
      const sourceIds = resolvedSources.map((source) => source.id);

      const node = store.createNode({
        title,
        trigger: 'serendipity',
        why:
          (typeof args.why === 'string' && args.why.trim()) ||
          'Source-linked candidate retained for scrutiny',
        understanding: synthesis,
        conversationId,
        toolCallId,
        sourceElements: sourceIds,
      });

      const createdEdges = resolvedSources.map((source) => {
        const why =
          'Preserves the supplied source attribution for this serendipitous synthesis.';
        const edge = store.createEdge({
          fromId: node.id,
          toId: source.id,
          type: 'learned_from',
          explanation: `Synthesized from "${source.name}"`,
          why,
          conversationId,
          toolCallId,
        });
        return {
          id: edge.id,
          from: node.id,
          to: source.id,
          type: edge.type,
          why,
        };
      });

      // Phase 3: Selection - Calculate Novelty Score (S_N)
      // S_N = Harmonic Mean(Divergence, Coherence)
      // Divergence = how different from source concepts (want novelty)
      // Coherence = how well it connects to existing knowledge (want relevance)
      let noveltyScore = 0;
      let divergence = 0;
      let coherence = 0;
      let potentialConnections: Array<
        ReturnType<typeof describeNode> & { similarity: number }
      > = [];
      let scoringUnavailableReason: string | null = null;

      const NOVELTY_THRESHOLD = 0.35;

      try {
        if (!EmbeddingService.isModelLoaded()) {
          throw new Error('Optional embedding model is not loaded');
        }
        // Generate embedding for the new synthesis
        await store.generateAndStoreEmbedding(node.id);
        const embeddedSynthesis = store.getNode(node.id);
        if (!embeddedSynthesis?.embedding) {
          throw new Error('Could not store the synthesis node embedding');
        }
        // Novelty uses one representation consistently: every cosine below
        // compares the complete node embedding (title + semantic body + why),
        // including the newly created synthesis itself.
        const synthesisEmbedding = embeddedSynthesis.embedding;
        const sourceSimilarities: number[] = [];
        for (const sourceId of sourceIds) {
          const sourceNode = store.getNode(sourceId);
          if (!sourceNode) continue;
          // Score the exact current source text. Stored embeddings can lag a
          // revision in older databases, so source divergence does not reuse
          // them here.
          const sourceEmbedding =
            await EmbeddingService.generateNodeEmbedding(sourceNode);
          sourceSimilarities.push(
            Math.max(
              0,
              Math.min(
                1,
                EmbeddingService.cosineSimilarity(
                  synthesisEmbedding,
                  sourceEmbedding,
                ),
              ),
            ),
          );
        }
        if (sourceSimilarities.length !== sourceIds.length) {
          throw new Error('Could not score every supplied source element');
        }

        const avgSourceSimilarity =
          sourceSimilarities.reduce((sum, value) => sum + value, 0) /
          sourceSimilarities.length;
        divergence = 1 - avgSourceSimilarity;

        const sourceIdSet = new Set(sourceIds);
        sourceIdSet.add(node.id);

        const nonSourceMatches = store
          .getAll()
          .nodes.filter(
            (candidate) =>
              !sourceIdSet.has(candidate.id) && candidate.embedding != null,
          )
          .map((candidate) => ({
            node: candidate,
            similarity: Math.max(
              0,
              Math.min(
                1,
                EmbeddingService.cosineSimilarity(
                  synthesisEmbedding,
                  candidate.embedding as Float32Array,
                ),
              ),
            ),
          }))
          .sort(
            (left, right) =>
              right.similarity - left.similarity ||
              left.node.id.localeCompare(right.node.id),
          );

        // Calculate Coherence: max_similarity_to_non_source
        // High coherence = synthesis connects to existing knowledge
        if (nonSourceMatches.length > 0) {
          coherence = nonSourceMatches[0].similarity;
          potentialConnections = nonSourceMatches.slice(0, 5).map((match) => ({
            ...describeNode(match.node, 100),
            similarity: Math.round(match.similarity * 100) / 100,
          }));
        }

        // Harmonic Mean: balances both metrics
        // Returns 0 if either is 0 (need both novelty AND coherence)
        if (divergence > 0 && coherence > 0) {
          noveltyScore =
            (2 * divergence * coherence) / (divergence + coherence);
        }
      } catch (error) {
        // Embeddings not available - can't calculate score
        noveltyScore = -1; // Indicates scoring failed
        scoringUnavailableReason =
          error instanceof Error ? error.message : String(error);
      }

      const scored = noveltyScore >= 0;
      const verdict = !scored
        ? 'UNSCORED'
        : noveltyScore >= NOVELTY_THRESHOLD
          ? 'ACCEPT'
          : 'RETRY';

      return {
        success: true,
        id: node.id,
        name: node.title,
        validated: false,
        epistemicStatus: 'speculative',
        source_elements: sourceIds,
        edges: createdEdges,
        affectedNodeIds: [node.id],
        affectedEdgeIds: createdEdges.map((edge) => edge.id),
        message: `Created serendipity node "${node.title}"`,
        // Phase 3 Selection Results
        scoring: {
          novelty_score: scored ? Math.round(noveltyScore * 100) / 100 : null,
          divergence: scored ? Math.round(divergence * 100) / 100 : null,
          coherence: scored ? Math.round(coherence * 100) / 100 : null,
          threshold: NOVELTY_THRESHOLD,
          verdict,
        },
        potentialConnections,
        hint:
          verdict === 'RETRY'
            ? `Experimental novelty score ${noveltyScore.toFixed(2)} is below threshold ${NOVELTY_THRESHOLD}; this is neither rejection nor a quality judgment.`
            : verdict === 'ACCEPT'
              ? `Experimental novelty score S_N=${noveltyScore.toFixed(2)} is above threshold ${NOVELTY_THRESHOLD}; this is not validation. ${potentialConnections.length} potential connection(s) found.`
              : `Experimental scoring unavailable${scoringUnavailableReason ? `: ${scoringUnavailableReason}` : ''}. The node remains unvalidated.`,
      };
    }

    case 'graph_validate': {
      const nodeRef = typeof args.node === 'string' ? args.node.trim() : '';
      const insight =
        typeof args.insight === 'string' ? args.insight.trim() : '';
      if (!nodeRef || !insight) {
        return {
          success: false,
          error: 'MISSING_PARAMETER',
          message: 'graph_validate requires non-empty node and insight.',
        };
      }

      const resolved = contextManager.resolveNodeWithSuggestions(
        nodeRef,
        projectId,
      );

      const store = getGraphStore();
      const current = store.getNode(resolved.id);
      if (current?.trigger !== 'serendipity') {
        return {
          success: false,
          error: 'WRONG_NODE_TYPE',
          message:
            'graph_validate only records validation judgments for serendipity nodes.',
        };
      }
      const node = store.updateNode(resolved.id, {
        validated: true,
        revisionWhy: `Validated: ${insight}`,
        conversationId,
      });

      return {
        success: true,
        id: node.id,
        name: node.title,
        validated: true,
        message: `Validated serendipity node "${node.title}"`,
        insight,
        affectedNodeIds: [node.id],
      };
    }

    case 'graph_chaos': {
      const store = getGraphStore();
      const intensity = readIntensity(args.intensity, 0.25);
      const source = args.source ?? 'dictionary';
      if (source !== 'dictionary' && source !== 'graph') {
        throw new Error('source must be either dictionary or graph');
      }

      // Get text to corrupt
      let text: string | undefined;
      if (args.text !== undefined) {
        if (typeof args.text !== 'string' || args.text.trim().length === 0) {
          throw new Error('text must be a non-empty string when supplied');
        }
        text = args.text.trim();
        if (text.length > 12000) {
          throw new Error('text must not exceed 12000 characters');
        }
      }
      let sourceNode: GraphNodeData | null = null;

      const sourceNodeRef =
        typeof args.source_node === 'string' ? args.source_node.trim() : '';
      if (sourceNodeRef) {
        const resolved = contextManager.resolveNodeWithSuggestions(
          sourceNodeRef,
          projectId,
        );
        sourceNode = store.getNode(resolved.id);
        if (!sourceNode) throw new Error(`Node not found: ${sourceNodeRef}`);
      }

      if (text === undefined) {
        // Use a random node's semantic material as the source text.
        const nodes = store.getRandomNodes(1);
        if (nodes.length > 0) {
          text = nodeSemanticText(nodes[0]);
          sourceNode = nodes[0];
        } else {
          return {
            success: false,
            error: 'No text provided and no suitable graph nodes found',
          };
        }
      }

      // Inject chaos
      const { corrupted, seeds } = injectChaos(text, intensity, source);

      // Build the Physics What-If prompt for a BLIND agent
      const forcingPrompt = `ANI (AXIOMATIC NOISE INJECTION) — BLIND AGENT PROTOCOL

**Corrupted Text:**
"${corrupted}"

**Chaos Seeds Injected:** ${seeds.join(', ')}

---

**PHYSICS WHAT-IF PROTOCOL**

You are a physicist discovering alien documents. The bracketed words are NOT errors — they are AXIOMS. Each [SEED] represents a fundamental law governing this domain.

For each seed, answer:
1. **LITERAL OR MORPHOLOGICAL READING**: State a meaning only if you know it; otherwise mark it unknown and work from the word's form or sound without inventing a dictionary definition
2. **PHYSICS**: If this word was a physical law governing this scenario, how would reality function?
3. **REVELATION**: What does this reveal that standard analysis would miss?

**CRITICAL**: You must treat these seeds as TRUE. Do not dismiss them as random noise. Your job is to RATIONALIZE how they could be true — this is Inverse Hallucination.

After interrogation, synthesize a coherent conceptual framework that integrates ALL the seed-derived insights. Name your framework something evocative.`;

      const persistenceRecommendation = {
        available: sourceNode != null,
        ...(sourceNode
          ? {
              operation: 'graph_serendipity',
              sourceElements: [sourceNode.id],
              instruction:
                'Return the candidate to the orchestrating context. After scrutiny, that context may preserve it source-linked and unvalidated with graph_batch; the blind context should not access the graph.',
            }
          : {
              instruction:
                'This caller-supplied text has no graph source anchor. If a candidate is worth retaining, first preserve or identify the actual source material in the graph; do not invent provenance.',
            }),
      };

      const blindAgentPrompt = `You are a blind sense-making agent. You have NO context about the original text.

${forcingPrompt}

IMPORTANT:
- Do NOT try to guess what the original text was about
- Treat EVERY seed as an axiom that MUST be true
- Your job is to invent LOGIC to fit these FACTS (Inverse Hallucination)
- Create a novel conceptual framework, not a reconstruction

Return the framework to the orchestrating context for scrutiny and source-linked persistence.`;

      if (sourceNode) recordNodeExposure(store, [sourceNode.id]);

      // Blind mode omits the original material and seeds. Host-level context
      // isolation remains the caller's responsibility.
      if (args.blind === true) {
        return {
          success: true,
          mode: 'blind',
          prompt: forcingPrompt,
          sourceNodeId: sourceNode?.id || null, // ID only for attribution
          blindAgentRecommendation: {
            message:
              'Blind mode active. Start a fresh agent or isolated conversation with only blindPrompt.',
            blindPrompt: blindAgentPrompt,
          },
          persistenceRecommendation,
          warning:
            'Do not give the isolated sense-making context the original text; that separation is what makes this an Inverse Hallucination experiment.',
        };
      }

      // Full response (for debugging or when orchestrator needs context)
      return {
        success: true,
        mode: 'full',
        original: text,
        corrupted,
        seeds,
        seedCount: seeds.length,
        intensity,
        source,
        sourceNode: sourceNode ? describeNode(sourceNode) : null,
        prompt: forcingPrompt,
        blindAgentRecommendation: {
          message:
            'For the blind ANI variant, start a fresh agent or isolated conversation without the original context. Consider using blind=true.',
          why: 'If the sense-making agent knows the original text, it will map seeds back to known meanings instead of inventing new logic (Inverse Hallucination).',
          blindPrompt: blindAgentPrompt,
        },
        persistenceRecommendation,
      };
    }

    case 'graph_evaluate_variations': {
      const context =
        typeof args.context === 'string' ? args.context.trim() : '';
      const rawVariations = args.variations;
      const variations = Array.isArray(rawVariations)
        ? rawVariations.map((variation) =>
            typeof variation === 'string' ? variation.trim() : variation,
          )
        : [];
      const rawCoherence = args.coherence_scores;
      const providedCoherence = Array.isArray(rawCoherence)
        ? rawCoherence
        : undefined;

      if (!context) {
        return {
          success: false,
          error: 'A non-empty original context is required',
        };
      }
      if (
        variations.length < 1 ||
        variations.length > 12 ||
        variations.some(
          (variation) =>
            typeof variation !== 'string' || variation.length === 0,
        )
      ) {
        return {
          success: false,
          error:
            'variations must contain 1 to 12 non-empty strings; malformed entries are not silently removed',
        };
      }
      if (
        rawCoherence !== undefined &&
        (!Array.isArray(rawCoherence) ||
          rawCoherence.length !== variations.length)
      ) {
        return {
          success: false,
          error:
            'coherence_scores must be an array with exactly one score per variation',
        };
      }
      if (
        providedCoherence?.some(
          (score) =>
            typeof score !== 'number' ||
            !Number.isFinite(score) ||
            score < 0 ||
            score > 10,
        )
      ) {
        return {
          success: false,
          error: 'coherence_scores must contain only numbers from 0 to 10',
        };
      }

      try {
        // Generate embedding for the original context
        const contextEmbedding =
          await EmbeddingService.generateEmbedding(context);
        if (!contextEmbedding) {
          return {
            success: false,
            error: 'Failed to generate embedding for context',
          };
        }

        // Score each variation
        const scored: Array<{
          index: number;
          variation: string;
          divergence: number;
          coherence: number;
          novelty_score: number;
          rawNoveltyScore: number;
        }> = [];

        for (let i = 0; i < variations.length; i++) {
          const variation = variations[i] as string;

          // Generate embedding for variation
          const varEmbedding =
            await EmbeddingService.generateEmbedding(variation);
          if (!varEmbedding) {
            // Skip variations we can't embed
            continue;
          }

          // Calculate Divergence: 1 - similarity to original context
          const similarity = Math.max(
            0,
            Math.min(
              1,
              EmbeddingService.cosineSimilarity(contextEmbedding, varEmbedding),
            ),
          );
          const divergence = 1 - similarity;

          // Coherence: use provided score (normalized 0-1) or default 0.8
          const coherence =
            providedCoherence?.[i] !== undefined
              ? providedCoherence[i] / 10 // Normalize 0-10 to 0-1
              : 0.8;

          // Novelty Score: Harmonic Mean of Divergence and Coherence
          let noveltyScore = 0;
          if (divergence > 0 && coherence > 0) {
            noveltyScore =
              (2 * divergence * coherence) / (divergence + coherence);
          }

          scored.push({
            index: i,
            variation:
              variation.slice(0, 200) + (variation.length > 200 ? '...' : ''),
            divergence: Math.round(divergence * 1000) / 1000,
            coherence: Math.round(coherence * 1000) / 1000,
            novelty_score: Math.round(noveltyScore * 1000) / 1000,
            rawNoveltyScore: noveltyScore,
          });
        }

        if (scored.length === 0) {
          return {
            success: false,
            error: 'Could not generate embeddings for any variations',
          };
        }

        // Sort by novelty score descending
        scored.sort((a, b) => b.rawNoveltyScore - a.rawNoveltyScore);

        const winner = scored[0];
        const NOVELTY_THRESHOLD = 0.35;

        return {
          success: true,
          winner: {
            index: winner.index,
            full_text: variations[winner.index],
            novelty_score: winner.novelty_score,
            divergence: winner.divergence,
            coherence: winner.coherence,
          },
          ranking: scored.map(({ rawNoveltyScore: _raw, ...score }) => score),
          threshold: NOVELTY_THRESHOLD,
          verdict:
            winner.rawNoveltyScore >= NOVELTY_THRESHOLD ? 'ACCEPT' : 'RETRY',
          message:
            winner.rawNoveltyScore >= NOVELTY_THRESHOLD
              ? `Variation ${winner.index} has the highest experimental score (S_N=${winner.novelty_score}), above threshold ${NOVELTY_THRESHOLD}; this is not validation or a quality judgment.`
              : `Variation ${winner.index} has the highest experimental score (S_N=${winner.novelty_score}), below threshold ${NOVELTY_THRESHOLD}; this is not a quality judgment.`,
        };
      } catch (err) {
        return {
          success: false,
          error: `Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    case 'graph_decide': {
      const store = getGraphStore();
      const question =
        typeof args.question === 'string' ? args.question.trim() : '';
      const optionRefs = args.options;
      const chosenRef =
        typeof args.chosen === 'string' ? args.chosen.trim() : '';
      const reasoning =
        typeof args.reasoning === 'string' ? args.reasoning.trim() : '';

      if (!question || !chosenRef || !reasoning) {
        return {
          success: false,
          error: 'MISSING_PARAMETER',
          message:
            'graph_decide requires non-empty question, chosen, and reasoning.',
        };
      }
      if (
        !Array.isArray(optionRefs) ||
        optionRefs.length === 0 ||
        optionRefs.some(
          (option) => typeof option !== 'string' || option.trim() === '',
        )
      ) {
        return {
          success: false,
          error: 'MISSING_OPTIONS',
          message: 'graph_decide requires at least one valid option reference.',
        };
      }

      // Resolve every option and the chosen node before creating anything.
      // This prevents a malformed internal call from leaving a decision orphan.
      const resolvedOptionMap = new Map<string, { id: string; name: string }>();
      for (const ref of optionRefs) {
        const resolved = contextManager.resolveNodeWithSuggestions(
          ref as string,
          projectId,
        );
        resolvedOptionMap.set(resolved.id, {
          id: resolved.id,
          name: resolved.title,
        });
      }
      const resolvedOptions = [...resolvedOptionMap.values()];

      // Resolve chosen option
      const resolvedChosen = contextManager.resolveNodeWithSuggestions(
        chosenRef,
        projectId,
      );

      // Verify chosen is in options
      if (!resolvedOptions.some((o) => o.id === resolvedChosen.id)) {
        return {
          success: false,
          error: `Chosen option "${resolvedChosen.title}" is not in the options list`,
          options: resolvedOptions,
        };
      }

      // Create the decision node
      const decisionNode = store.createNode({
        title: question,
        trigger: 'decision',
        why: `Records why "${resolvedChosen.title}" was selected from ${resolvedOptions.length} option(s).`,
        understanding: reasoning,
        conversationId,
        toolCallId,
        metadata: {
          chosenOptionId: resolvedChosen.id,
          chosenOptionName: resolvedChosen.title,
          options: resolvedOptions,
        },
      });

      // A decision is the durable synthesis result. It points to every input:
      // `implements` identifies the chosen realization, while `contextualizes`
      // preserves rejected alternatives without inventing bespoke edge types.
      const createdEdges: Array<{
        id: string;
        from: string;
        to: string;
        type: string;
        why: string;
      }> = [];
      for (const option of resolvedOptions) {
        const isChosen = option.id === resolvedChosen.id;
        const type = isChosen ? 'implements' : 'contextualizes';
        const why = isChosen
          ? 'The chosen option is the concrete realization of this decision.'
          : 'Preserves this unchosen option as part of the decision context.';
        const edge = store.createEdge({
          fromId: decisionNode.id,
          toId: option.id,
          type,
          explanation: isChosen
            ? `Selected option for: ${question}`
            : `Alternative considered but not selected for: ${question}`,
          why,
          conversationId,
          toolCallId,
        });
        createdEdges.push({
          id: edge.id,
          from: decisionNode.id,
          to: option.id,
          type: edge.type,
          why,
        });
      }

      return {
        success: true,
        id: decisionNode.id,
        question,
        chosen: {
          id: resolvedChosen.id,
          name: resolvedChosen.title,
        },
        options: resolvedOptions,
        reasoning,
        edges: createdEdges,
        affectedNodeIds: [decisionNode.id],
        affectedEdgeIds: createdEdges.map((edge) => edge.id),
        message: `Created decision node "${question}" with ${resolvedOptions.length} options. Chose: "${resolvedChosen.title}"`,
      };
    }

    default:
      throw new Error(`Unknown synthesis tool: ${name}`);
  }
}
