import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EmbeddingService,
  getGraphStore,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dictionary cache for chaos injection
let dictionaryCache: string[] | null = null;

function loadDictionary(): string[] {
  if (dictionaryCache) return dictionaryCache;

  // Try multiple locations for the dictionary
  // __dirname is packages/mcp-server/dist/tools/ so go up to packages/ then into core/data/
  const locations = [
    path.join(__dirname, '../../../core/data/words_alpha.txt'),
    path.join(process.cwd(), 'packages/core/data/words_alpha.txt'),
    path.join(process.cwd(), 'words_alpha.txt'),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        const content = fs.readFileSync(loc, 'utf-8');
        dictionaryCache = content
          .split('\n')
          .filter((w) => w.trim().length > 3);
        console.error(
          `Dictionary loaded: ${dictionaryCache.length} words from ${loc}`,
        );
        return dictionaryCache;
      } catch (e) {
        console.warn(`Failed to load dictionary from ${loc}:`, e);
      }
    }
  }

  // Fallback - small list of interesting words
  console.warn('Dictionary not found, using fallback list');
  dictionaryCache = [
    'entropy',
    'mycelium',
    'phosphene',
    'palingenesis',
    'exuviae',
    'syzygy',
    'apophenia',
    'pareidolia',
    'tulostoma',
    'dehisce',
    'tessellate',
    'liminal',
    'palimpsest',
    'petrichor',
    'sonder',
  ];
  return dictionaryCache;
}

function injectChaos(
  text: string,
  intensity: number,
  seedSource: 'dictionary' | 'graph',
): {
  corrupted: string;
  seeds: string[];
} {
  const dictionary = seedSource === 'dictionary' ? loadDictionary() : [];
  const store = seedSource === 'graph' ? getGraphStore() : null;
  const graphNodes = store ? store.getRandomNodes(50) : [];

  const words = text.split(/(\s+)/);
  const seeds: string[] = [];

  const corrupted = words
    .map((word) => {
      // Only replace content words (letters only, > 3 chars)
      if (!/^[a-zA-Z]{4,}$/.test(word)) return word;

      if (Math.random() < intensity) {
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
        return `[${seed}]`;
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

Use only when the user explicitly wants speculative divergence. For normal
understanding work, prefer graph_discover_grounded: it finds a defensible
connection before perturbing it and allows "no connection" as an answer.

WHAT IT DOES:
1. Selects random nodes from graph
2. Corrupts their synthesis with chaos seeds (dictionary words)
3. Returns a prompt for sense-making

WORKFLOW:
1. Call graph_discover({ nodes: 2, cold: true })
2. Read the returned "prompt" field
3. IMPORTANT: Spawn a SEPARATE agent (Task tool) with ONLY the prompt
   - The blind agent must NOT know the original node context
   - This triggers "Inverse Hallucination" - inventing logic to fit facts
4. Record synthesis with graph_batch containing a graph_serendipity operation

WHY BLIND AGENTS: If you process the prompt yourself, you'll map seeds back to known meanings. A blind agent MUST invent new logic. Use the provided "blindAgentRecommendation.template".`,
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'number',
          description: 'Number of random nodes to select (default: 3)',
        },
        intensity: {
          type: 'number',
          description:
            'Chaos injection intensity 0.0-1.0. Optimal: 0.20-0.35. Below 0.20 = insufficient chaos. Above 0.35 = coherence collapses. Default: 0.25',
        },
        cold: {
          type: 'boolean',
          description:
            'Prioritize rarely-accessed nodes for maximum semantic distance. Use true for more surprising connections.',
        },
        blind: {
          type: 'boolean',
          description:
            'RECOMMENDED: When true, returns ONLY the prompt - omits sourceNodes, corrupted text, and seeds. This ENFORCES the Blind Axiom Requirement: the sense-making agent never sees the original context, triggering true Inverse Hallucination instead of metaphor mode.',
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
      'DEFAULT serendipity workflow: 1) Pick random nodes/edges, 2) Find a defensible connection or explicitly report none, 3) optionally perturb the grounded bridge, 4) integrate only what survives scrutiny. Prefer this over ungrounded graph_discover for understanding work.',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'number',
          description: 'Number of random nodes to select (default: 3)',
        },
        edges: {
          type: 'number',
          description: 'Number of random edges to include (default: 0)',
        },
        intensity: {
          type: 'number',
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
      'Phase 3 of grounded serendipity: Takes the genuine bridge you found and injects chaos to push it into unexplored territory. Call this AFTER graph_discover_grounded once you have articulated the real connection.',
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
          description:
            'Node IDs from the original graph_discover_grounded call',
        },
        intensity: {
          type: 'number',
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
    name: 'graph_random',
    description:
      'Sample concrete graph elements for divergent exploration. Use the returned nodes as provocations: judge how, or whether, they matter to the live task. No defensible connection is valid. force:true enables the stronger local Physics What-If experiment; ordinary work should normally keep force:false.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description:
            'Number of random elements to get (mixed nodes and edges)',
        },
        nodes: {
          type: 'number',
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
          type: 'number',
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
3. Returns verdict: ACCEPT (S_N ≥ 0.35) | RETRY (regenerate) | UNSCORED (no embeddings)

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
      'BATCH-ONLY: Mark a serendipity node as validated after extracting real insight from it. Use as a graph_batch operation so the revision and commit land atomically.',
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
    description: `ANI (Axiomatic Noise Injection): Corrupt text with chaos seeds to force creative breakthroughs.

WHAT IT DOES:
1. Takes your text (or random node content)
2. Replaces ~25% of words with random dictionary words as [SEEDS]
3. Returns corrupted text + "Physics What-If" prompt

WORKFLOW:
1. graph_chaos({ text: "Your concept description" })
2. Read the "prompt" field from result
3. CRITICAL: Spawn a BLIND agent with Task tool using ONLY the prompt
   - Agent must NOT see original text
   - This forces "Inverse Hallucination" - inventing logic to fit seeds
4. Record the synthesis with graph_batch containing a graph_serendipity operation

The response includes "blindAgentRecommendation.template" - a ready-to-use Task() call.

WHY THIS WORKS: Seeds become axioms. A blind agent treats [CAPITALISM] in place of "system" as TRUE and invents physics to explain why capitalism IS a system-governing force.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Text to corrupt with chaos seeds. If not provided, uses a random node understanding from the graph.',
        },
        intensity: {
          type: 'number',
          description:
            'Replacement probability 0.0-1.0. Optimal: 0.20-0.35. Below 0.20 = too predictable. Above 0.35 = incoherent. Default: 0.25',
        },
        source: {
          type: 'string',
          enum: ['dictionary', 'graph'],
          description:
            'Entropy source. "dictionary" (default): 370k words for maximum surprise. "graph": use existing node names for self-referential chaos.',
        },
        blind: {
          type: 'boolean',
          description:
            'RECOMMENDED: When true, returns ONLY the prompt - omits original text and seeds. Enforces the Blind Axiom Requirement for true Inverse Hallucination.',
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
      'Rank a list of candidate texts (alternative phrasings, alternative designs, alternative reasoning paths) by a Novelty Score that combines (a) semantic divergence from existing graph content, measured via embedding distance, and (b) internal coherence. Returns the candidates ranked best-to-worst with the chosen winner and per-candidate scores. Use this when you want to pick between several variations and want a reason rooted in the current graph rather than picking arbitrarily. Originally designed as the selection phase of a chaos-injection serendipity pipeline (see graph_chaos / graph_discover).',
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
          description: 'Array of generated narrative variations to compare',
        },
        coherence_scores: {
          type: 'array',
          items: { type: 'number' },
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
      const nodeCount = (args.nodes as number) || 3;
      const intensity = (args.intensity as number) ?? 0.25;

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
        .map((n) => n.understanding || n.title)
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
1. **LITERAL**: Dictionary meaning
2. **PHYSICS**: What law would govern this domain if this seed were true?
3. **REVELATION**: What does this reveal that standard analysis misses?

Synthesize a coherent conceptual framework integrating all seeds. Name it something evocative.

Record atomically with graph_batch using a graph_serendipity operation: (name, synthesis, source_elements: [${nodes.map((n) => `"${n.id}"`).join(', ')}], why)`;

      // Agent spawn template for blind agent
      const blindAgentTemplate = `Task({
  subagent_type: "general-purpose",
  model: "haiku", // ANI democratizes - lightweight models succeed
  prompt: \`You are a blind sense-making agent. You have NO context about the original source.

${prompt}

CRITICAL:
- Do NOT guess what the original text was about
- Treat EVERY seed as TRUE
- Invent LOGIC to fit these FACTS (Inverse Hallucination)
- Create a NOVEL framework, not a reconstruction\`
})`;

      // If blind=true, return ONLY what a blind agent needs (enforces ANI protocol)
      if (args.blind === true) {
        return {
          success: true,
          mode: 'blind',
          prompt,
          sourceNodeIds: nodes.map((n) => n.id), // IDs only for graph_serendipity attribution
          blindAgentRecommendation: {
            message:
              'Blind mode active. Spawn agent with ONLY the prompt field.',
            template: blindAgentTemplate,
          },
          warning:
            'You are seeing this response but should NOT process the prompt yourself. Spawn a separate Task agent with the prompt to trigger true Inverse Hallucination.',
        };
      }

      // Full response (for debugging or when orchestrator needs context)
      return {
        success: true,
        mode: 'full',
        sourceNodes: nodes.map((n) => ({
          id: n.id,
          name: n.title,
          understanding: n.understanding,
        })),
        combinedText,
        corrupted,
        seeds,
        intensity,
        prompt,
        blindAgentRecommendation: {
          message:
            'For true ANI effect, spawn a SEPARATE agent without original context. Consider using blind=true to enforce this.',
          template: blindAgentTemplate,
        },
      };
    }

    case 'graph_discover_grounded': {
      // Grounded serendipity: find real connection first, THEN inject chaos
      const store = getGraphStore();
      const coldMode = args.cold === true;
      const nodeCount = (args.nodes as number) || 3;
      const edgeCount = (args.edges as number) || 0;
      const intensity = (args.intensity as number) ?? 0.2; // Lower default - chaos comes after sense-making

      // Phase 1: Random element picking
      const nodes = coldMode
        ? store.getColdNodes(nodeCount).map((c) => c.node)
        : store.getRandomNodes(nodeCount);
      const edges = store.getRandomEdges(edgeCount);

      if (nodes.length === 0) {
        return {
          success: false,
          error: 'No nodes in graph to select from',
        };
      }

      // Format elements for the prompt
      const nodeDescriptions = nodes
        .map(
          (n, i) =>
            `${i + 1}. **${n.title}** (${n.id})\n   ${n.understanding?.slice(0, 200) || '(no understanding recorded)'}`,
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
        .map((n) => n.understanding || n.title)
        .join(' | ');

      return {
        success: true,
        phase: 'sense-making',
        sourceNodes: nodes.map((n) => ({
          id: n.id,
          name: n.title,
          understanding: n.understanding,
        })),
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
      const bridge = args.bridge as string;
      const explanation = (args.explanation as string) || '';
      const sourceNodes = args.source_nodes as string[];
      const intensity = (args.intensity as number) ?? 0.2;

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

    case 'graph_random': {
      const store = getGraphStore();
      const forceMode = args.force === true;
      const coldMode = args.cold === true;
      const requestedNodeRefs = Array.isArray(args.nodeIds)
        ? [
            ...new Set(
              args.nodeIds.filter(
                (ref): ref is string =>
                  typeof ref === 'string' && ref.trim().length > 0,
              ),
            ),
          ].slice(0, 6)
        : [];
      if (Array.isArray(args.nodeIds) && requestedNodeRefs.length < 2) {
        throw new Error(
          'nodeIds must contain at least two distinct node references',
        );
      }

      // Default to 2 nodes for forcing (pairs work best), 3 otherwise
      const nodeCount =
        (args.nodes as number) || (args.count as number) || (forceMode ? 2 : 3);
      const edgeCount = (args.edges as number) || 0;

      // Get nodes - cold mode prioritizes rarely accessed nodes for max semantic distance
      const nodes =
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
      const edges = store.getRandomEdges(edgeCount);

      const baseResult = {
        nodes: nodes.map((n) => ({
          id: n.id,
          name: n.title,
          understanding: n.understanding,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          from: e.fromId,
          to: e.toId,
          explanation: e.explanation,
        })),
      };

      if (forceMode && nodes.length >= 2) {
        // Axiomatic forcing mode - Physics What-If prompt
        const conceptA = nodes[0];
        const conceptB = nodes[1];
        const additionalConcepts = nodes.slice(2);

        let forcingPrompt = `PHYSICS WHAT-IF — FORCED GENERATIVE PASS

You are given concepts from an understanding graph:

**Concept A: ${conceptA.title}**
${conceptA.understanding || '(No understanding recorded)'}

**Concept B: ${conceptB.title}**
${conceptB.understanding || '(No understanding recorded)'}`;

        if (additionalConcepts.length > 0) {
          forcingPrompt += '\n\n**Additional Concepts:**';
          additionalConcepts.forEach((c, i) => {
            forcingPrompt += `\n${i + 1}. **${c.title}**: ${c.understanding?.slice(0, 200) || '(No understanding)'}`;
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
          (args.why as string) || 'Random synthesis for creative exploration',
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
      let potentialConnections: Array<{
        id: string;
        name: string;
        similarity: number;
        understanding?: string;
      }> = [];

      const NOVELTY_THRESHOLD = 0.35; // Below this, synthesis is weak

      try {
        if (!EmbeddingService.isModelLoaded()) {
          throw new Error('Optional embedding model is not loaded');
        }
        // Generate embedding for the new synthesis
        await store.generateAndStoreEmbedding(node.id);

        // Get all similar nodes
        const searchResults = await store.semanticSearch(synthesis, 10);
        const sourceIdSet = new Set(sourceIds);
        sourceIdSet.add(node.id);

        // Separate source matches from potential connections
        const sourceMatches = searchResults.filter((r) =>
          sourceIds.includes(r.node.id),
        );
        const nonSourceMatches = searchResults.filter(
          (r) => !sourceIdSet.has(r.node.id),
        );

        // Calculate Divergence: 1 - avg_similarity_to_sources
        // High divergence = synthesis is different from its inputs
        if (sourceMatches.length > 0) {
          const avgSourceSimilarity =
            sourceMatches.reduce((sum, r) => sum + r.similarity, 0) /
            sourceMatches.length;
          divergence = 1 - avgSourceSimilarity;
        } else {
          // No source embeddings found, assume moderate divergence
          divergence = 0.5;
        }

        // Calculate Coherence: max_similarity_to_non_source
        // High coherence = synthesis connects to existing knowledge
        if (nonSourceMatches.length > 0) {
          coherence = nonSourceMatches[0].similarity; // Already sorted desc
          potentialConnections = nonSourceMatches.slice(0, 5).map((r) => ({
            id: r.node.id,
            name: r.node.title,
            similarity: Math.round(r.similarity * 100) / 100,
            understanding: r.node.understanding?.slice(0, 100),
          }));
        }

        // Harmonic Mean: balances both metrics
        // Returns 0 if either is 0 (need both novelty AND coherence)
        if (divergence > 0 && coherence > 0) {
          noveltyScore =
            (2 * divergence * coherence) / (divergence + coherence);
        }
      } catch {
        // Embeddings not available - can't calculate score
        noveltyScore = -1; // Indicates scoring failed
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
            ? `Novelty score ${noveltyScore.toFixed(2)} below threshold ${NOVELTY_THRESHOLD}. Consider regenerating with different interpretation.`
            : verdict === 'ACCEPT'
              ? `Strong synthesis (S_N=${noveltyScore.toFixed(2)}). ${potentialConnections.length} potential connections found.`
              : 'Scoring unavailable (no embeddings). Node created without quality check.',
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
      const intensity = (args.intensity as number) ?? 0.25;
      const source = (args.source as 'dictionary' | 'graph') ?? 'dictionary';

      // Get text to corrupt
      let text = args.text as string;
      let sourceNode: { id: string; title: string } | null = null;

      if (!text) {
        // Use a random node's understanding as the source text
        const nodes = store.getRandomNodes(1);
        if (nodes.length > 0 && nodes[0].understanding) {
          text = nodes[0].understanding;
          sourceNode = { id: nodes[0].id, title: nodes[0].title };
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
1. **LITERAL**: What is the dictionary meaning of this word?
2. **PHYSICS**: If this word was a physical law governing this scenario, how would reality function?
3. **REVELATION**: What does this reveal that standard analysis would miss?

**CRITICAL**: You must treat these seeds as TRUE. Do not dismiss them as random noise. Your job is to RATIONALIZE how they could be true — this is Inverse Hallucination.

After interrogation, synthesize a coherent conceptual framework that integrates ALL the seed-derived insights. Name your framework something evocative.

Record the synthesis atomically with graph_batch using a graph_serendipity operation (name, synthesis, source_elements, why).`;

      // Agent spawn template for the blind agent
      const agentTemplate = `Task({
  subagent_type: "general-purpose",
  model: "haiku", // ANI democratizes - even lightweight models succeed
  prompt: \`You are a blind sense-making agent. You have NO context about the original text.

${forcingPrompt}

IMPORTANT:
- Do NOT try to guess what the original text was about
- Treat EVERY seed as an axiom that MUST be true
- Your job is to invent LOGIC to fit these FACTS (Inverse Hallucination)
- Create a novel conceptual framework, not a reconstruction

After synthesis, call graph_batch with a graph_serendipity operation to record your framework.\`
})`;

      // If blind=true, return ONLY what a blind agent needs
      if (args.blind === true) {
        return {
          success: true,
          mode: 'blind',
          prompt: forcingPrompt,
          sourceNodeId: sourceNode?.id || null, // ID only for attribution
          blindAgentRecommendation: {
            message:
              'Blind mode active. Spawn agent with ONLY the prompt field.',
            template: agentTemplate,
          },
          warning:
            'You are seeing this response but should NOT process the prompt yourself. Spawn a separate Task agent with the prompt to trigger true Inverse Hallucination.',
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
        sourceNode,
        prompt: forcingPrompt,
        blindAgentRecommendation: {
          message:
            'IMPORTANT: For true ANI effect, spawn a SEPARATE agent without the original context. Consider using blind=true to enforce this.',
          why: 'If the sense-making agent knows the original text, it will map seeds back to known meanings instead of inventing new logic (Inverse Hallucination).',
          template: agentTemplate,
        },
      };
    }

    case 'graph_evaluate_variations': {
      const context = args.context as string;
      const variations = args.variations as string[];
      const providedCoherence = args.coherence_scores as number[] | undefined;

      if (!variations || variations.length === 0) {
        return {
          success: false,
          error: 'No variations provided to evaluate',
        };
      }

      // Helper: cosine similarity between two vectors (Float32Array)
      const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
        if (a.length !== b.length) return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      };

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
        }> = [];

        for (let i = 0; i < variations.length; i++) {
          const variation = variations[i];

          // Generate embedding for variation
          const varEmbedding =
            await EmbeddingService.generateEmbedding(variation);
          if (!varEmbedding) {
            // Skip variations we can't embed
            continue;
          }

          // Calculate Divergence: 1 - similarity to original context
          const similarity = cosineSimilarity(contextEmbedding, varEmbedding);
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
          });
        }

        if (scored.length === 0) {
          return {
            success: false,
            error: 'Could not generate embeddings for any variations',
          };
        }

        // Sort by novelty score descending
        scored.sort((a, b) => b.novelty_score - a.novelty_score);

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
          ranking: scored,
          threshold: NOVELTY_THRESHOLD,
          verdict:
            winner.novelty_score >= NOVELTY_THRESHOLD ? 'ACCEPT' : 'RETRY',
          message:
            winner.novelty_score >= NOVELTY_THRESHOLD
              ? `Variation ${winner.index} wins with S_N=${winner.novelty_score}. Strong balance of novelty and coherence.`
              : `Best variation (${winner.index}) has S_N=${winner.novelty_score} below threshold ${NOVELTY_THRESHOLD}. Consider regenerating.`,
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
