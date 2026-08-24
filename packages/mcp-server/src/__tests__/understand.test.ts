import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
  THINKING_IDENTITY_PREAMBLE,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { UNDERSTANDING_PROTOCOL_MOVES } from '../protocol.js';
import { getToolDefinitions, handleToolCall } from '../tools/index.js';
import { UNDERSTANDING_PROMPT_CONTRACT_VERSION } from '../tools/understand.js';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-understand-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'understand-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('understand-test')) {
    sqlite.initDatabase(path.join(projectDir, 'understand-test'));
  }
  sqlite.setCurrentProject('understand-test');
  await contextManager.switchProject('understand-test');
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function understand(
  query: string,
  workflow = 'general',
  focusNodeIds?: string[],
  stance?: string,
) {
  return (await handleToolCall(
    'graph_understand',
    {
      query,
      workflow,
      ...(focusNodeIds ? { focusNodeIds } : {}),
      ...(stance ? { stance } : {}),
    },
    contextManager,
  )) as Record<string, unknown>;
}

describe('graph_understand contract', () => {
  it('is exposed in every mode with distinct workflow choices', () => {
    for (const mode of [
      'reading',
      'research',
      'coding',
      'collaborative_coding',
      'writing',
      'full',
      'synthetic_reader',
    ] as const) {
      const tool = getToolDefinitions(mode).find(
        (candidate) => candidate.name === 'graph_understand',
      );
      expect(tool).toBeDefined();
      const workflow = tool?.inputSchema.properties?.workflow as {
        enum?: string[];
      };
      expect(workflow.enum).toEqual([
        'auto',
        'reading',
        'research',
        'coding',
        'collaborative_coding',
        'writing',
        'general',
      ]);
      const stance = tool?.inputSchema.properties?.stance as {
        enum?: string[];
      };
      expect(stance.enum).toEqual([
        'balanced',
        'deepen',
        'resist',
        'connect',
        'disrupt',
        'revisit',
        'test',
      ]);
    }
  });

  it('keeps work domain separate from epistemic stance and changes the packet', async () => {
    const store = getGraphStore();
    const availableAccount = store.createNode({
      title: 'Fixed retry collapse',
      trigger: 'model',
      why: 'Current account of the failure.',
      understanding:
        'Fixed retry timing synchronizes clients and creates a collapse under burst load.',
    });
    const counterPressure = store.createNode({
      title: 'Capacity saturation precedes synchronization',
      trigger: 'tension',
      why: 'A competing causal account must stay live.',
      understanding:
        'The service was already beyond sustainable capacity before client timing aligned.',
    });
    const distantProvocation = store.createNode({
      title: 'Forest firebreak mosaic',
      trigger: 'serendipity',
      why: 'A distant pattern may or may not transfer.',
      understanding:
        'Heterogeneous gaps can prevent a locally useful response from propagating globally.',
    });
    store.createEdge({
      fromId: counterPressure.id,
      toId: availableAccount.id,
      type: 'contradicts',
      why: 'The accounts disagree about which condition is causally prior.',
    });

    const resisted = await understand(
      'Diagnose the fixed retry collapse',
      'coding',
      undefined,
      'resist',
    );
    const disrupted = await understand(
      'Diagnose the fixed retry collapse',
      'coding',
      undefined,
      'disrupt',
    );
    const resistedFrame = resisted.frame as {
      stanceMaterial?: { nodes: Array<{ id: string }> };
    };
    const disruptedFrame = disrupted.frame as {
      stanceMaterial?: { nodes: Array<{ id: string }> };
    };

    expect(resisted.workflow).toMatchObject({ resolved: 'coding' });
    expect(resisted.stance).toBe('resist');
    expect(
      resistedFrame.stanceMaterial?.nodes.map((node) => node.id),
    ).toContain(counterPressure.id);
    expect(disrupted.workflow).toMatchObject({ resolved: 'coding' });
    expect(disrupted.stance).toBe('disrupt');
    expect(disrupted.stanceSource).toBe('explicit');
    expect(
      disruptedFrame.stanceMaterial?.nodes.map((node) => node.id),
    ).toContain(distantProvocation.id);
    expect(disrupted.prompt).toContain('STANCE: disrupt');
    expect(disrupted.prompt).toContain(
      'reject it if it does not survive scrutiny',
    );
    expect(disrupted.prompt).toContain('MEDIUM INTEGRITY');
    expect(disrupted.prompt).toContain('must not become the only copy');
  });

  it('leaves next-move judgment with the model in direct mode', async () => {
    const result = (await handleToolCall(
      'graph_understand',
      {
        query: 'Continue the work without ambient navigation',
        workflow: 'general',
      },
      contextManager,
      'full',
      false,
      'direct',
    )) as { prompt: string };

    expect(result.prompt).not.toContain('graph_suggest_next');
    expect(result.prompt).toContain('Choose the next graph move yourself');
    expect(result.prompt).toContain(
      'no graph capability depends on suggestion guidance',
    );
  });

  it('surfaces artifact/cognition imbalance during repeated graph re-entry', async () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'Research dossier',
      content: 'A rooted evidence artifact.',
      level: 'document',
      isDocRoot: true,
      fileType: 'markdown',
    });
    let afterId: string | undefined;
    for (let index = 1; index < 8; index++) {
      const passage = store.createDocumentNode({
        title: `Evidence unit ${index}`,
        content: `Observed material ${index}.`,
        level: 'paragraph',
        parentId: root.id,
        afterId,
      });
      afterId = passage.id;
    }

    const result = await understand(
      're-enter the research evidence',
      'general',
    );
    const frame = result.frame as {
      artifactCognitionBalance?: {
        metrics: { documentNodes: number; cognitiveNodes: number };
        advisories: Array<{ code: string; message: string }>;
      };
    };

    expect(frame.artifactCognitionBalance?.metrics).toMatchObject({
      documentNodes: 8,
      cognitiveNodes: 0,
    });
    expect(frame.artifactCognitionBalance?.advisories).toEqual([
      expect.objectContaining({
        code: 'artifact_structure_outpaces_cognition',
      }),
    ]);
    expect(result.prompt).toContain(
      'artifact production is outrunning the recursive understanding loop',
    );
    expect(result.prompt).toContain('It is not a score or quota');
  });

  it('re-enters source-linked understanding during research even when its wording differs from the query', async () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'Archive isotope dossier',
      content: 'Evidence dossier',
      level: 'document',
      isDocRoot: true,
      fileType: 'markdown',
    });
    const passage = store.createDocumentNode({
      title: 'Polar isotope measurement',
      content:
        'The polar archive isotope measurement was taken after the container seal failed.',
      level: 'paragraph',
      parentId: root.id,
    });
    const linkedUnderstanding = store.createNode({
      title: 'Custody may dominate the apparent signal',
      trigger: 'hypothesis',
      why: 'Handling history changes how the measurement should be weighted.',
      understanding:
        'The decisive uncertainty may lie in custody and contamination rather than the physical mechanism under comparison.',
    });
    store.createEdge({
      fromId: linkedUnderstanding.id,
      toId: passage.id,
      type: 'learned_from',
      why: 'The failed seal made custody uncertainty salient.',
    });

    const result = await understand(
      'Compare the polar archive isotope measurement evidence',
      'research',
    );
    const frame = result.frame as {
      baseline: Array<{ id: string }>;
      artifactEvidence?: { passages: Array<{ id: string }> };
    };

    expect(frame.artifactEvidence?.passages.map((item) => item.id)).toContain(
      passage.id,
    );
    expect(frame.baseline.map((item) => item.id)).toContain(
      linkedUnderstanding.id,
    );
  });

  it('hides reserved thinking from ordinary understanding and exposes it only in synthetic_reader', async () => {
    const reserved = withReservedThinkingVisibility(true, () =>
      getGraphStore().createNode({
        title: 'Constraint discovery',
        trigger: 'thinking',
        content: `${THINKING_IDENTITY_PREAMBLE}\n\nRuntime evidence changed the implementation toward explicit workflow routing.`,
        understanding: JSON.stringify({
          signatures: [{ agentId: 'private-signature-marker' }],
        }),
        level: 'paragraph',
        fileType: 'thinking',
      }),
    );

    const ordinary = await understand(
      'runtime implementation workflow',
      'coding',
    );
    const ordinarySerialized = JSON.stringify(ordinary);

    expect(ordinary.status).toBe('no_relevant_context');
    expect(ordinarySerialized).not.toContain(reserved.id);
    expect(ordinarySerialized).not.toContain('Constraint discovery');
    expect(ordinarySerialized).not.toContain(
      'Runtime evidence changed the implementation',
    );
    expect(ordinarySerialized).not.toContain('private-signature-marker');
    expect(ordinarySerialized).not.toContain(THINKING_IDENTITY_PREAMBLE);
    expect(ordinarySerialized).toContain(
      'Code lives in ordered document nodes',
    );
    expect(ordinarySerialized).toContain(
      'generated files are executable projections',
    );

    const synthetic = (await handleToolCall(
      'graph_understand',
      { query: 'runtime implementation workflow', workflow: 'general' },
      contextManager,
      'synthetic_reader',
    )) as Record<string, unknown>;
    const syntheticSerialized = JSON.stringify(synthetic);

    expect(synthetic.status).toBe('grounded');
    expect(syntheticSerialized).toContain(
      'Runtime evidence changed the implementation toward explicit workflow routing.',
    );
    expect(syntheticSerialized).not.toContain('private-signature-marker');
    expect(syntheticSerialized).not.toContain(THINKING_IDENTITY_PREAMBLE);
  });

  it('preserves typed resistance and evidence without forcing a shift', async () => {
    const store = getGraphStore();
    const baseline = store.createNode({
      title: 'Universal understanding workflow',
      trigger: 'foundation',
      why: 'It is the default product assumption.',
      understanding: 'Every task can use one universal understanding workflow.',
    });
    const resistance = store.createNode({
      title: 'Workflow-specific evidence metabolism',
      trigger: 'tension',
      why: 'Reading and coding expose different evidence.',
      understanding:
        'Reading advances sources chronologically while coding tests executable artifacts.',
    });
    const evidence = store.createNode({
      title: 'Executable test observation',
      trigger: 'reference',
      why: 'It records the relevant verification surface.',
      understanding: 'A failing test constrained the coding decision.',
    });
    const contradiction = store.createEdge({
      fromId: resistance.id,
      toId: baseline.id,
      type: 'contradicts',
      explanation: 'Rejects a universal work loop',
      why: 'The primary artifact and evidence differ by workflow.',
    });
    const learnedFrom = store.createEdge({
      fromId: resistance.id,
      toId: evidence.id,
      type: 'learned_from',
      explanation: 'Grounded in an executable check',
      why: 'The test result exposed the distinction.',
    });

    const first = await understand('workflow evidence reading coding');
    const second = await understand('workflow evidence reading coding');
    const frame = first.frame as {
      resistance: Array<{ id: string }>;
      evidence: Array<{ id?: string }>;
      relations: Array<{ id: string; type: string; why: string }>;
    };

    expect(second.frame).toEqual(first.frame);
    expect(first.promptContractVersion).toBe(
      UNDERSTANDING_PROMPT_CONTRACT_VERSION,
    );
    expect(frame.resistance.map((item) => item.id)).toContain(resistance.id);
    expect(frame.evidence.map((item) => item.id)).toContain(evidence.id);
    expect(frame.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: contradiction.id,
          type: 'contradicts',
          why: 'The primary artifact and evidence differ by workflow.',
        }),
        expect.objectContaining({
          id: learnedFrom.id,
          type: 'learned_from',
          why: 'The test result exposed the distinction.',
        }),
      ]),
    );
    expect(first.prompt).toContain('No shift and no new node are honest');
    expect(first.prompt).toContain('not a required phase');
    expect(first.prompt).toContain(
      'Preserve communicable, material understanding that could matter',
    );
    expect(first.prompt).toContain('Do not transcribe token-level steps');
    expect(first.prompt).toContain('never claim access to hidden');
    expect(first.prompt).toMatch(/never reserved\s+`thinking`/);
    expect(first.prompt).toContain('top-level `frame` field');
    expect(first.prompt).not.toContain('<graph_material>');
    expect(String(first.prompt).split(/\s+/).length).toBeLessThan(850);
  });

  it('reports machine-readable evidence for a focused re-entry', async () => {
    const store = getGraphStore();
    const changed = store.createNode({
      title: 'Changed retry model',
      trigger: 'hypothesis',
      why: 'A runtime result changed the model.',
      understanding: 'Retries can synchronize under common-mode stress.',
    });
    const prior = store.createNode({
      title: 'Prior resilience assumption',
      trigger: 'foundation',
      why: 'This was the earlier operating assumption.',
      understanding: 'Replica count alone determines resilience.',
    });
    const relation = store.createEdge({
      fromId: changed.id,
      toId: prior.id,
      type: 'contradicts',
      why: 'Common-mode behavior defeats identical replicas together.',
      explanation: 'Runtime evidence changed the resilience model.',
    });

    const result = await understand(
      'Continue after the retry experiment',
      'coding',
      [changed.id],
    );

    expect(result.understandingMode).toEqual({
      protocol: 'fluid-understanding-v1',
      mode: 'understanding',
      medium: 'graph',
      mediumIntegrity: {
        artifact: 'graph-canonical',
        understanding: 'graph-canonical',
        chat: 'mirror-status-or-question',
      },
      moment: 'entered',
      availableMoves: [...UNDERSTANDING_PROTOCOL_MOVES],
      process: 'agent-chosen',
      evidence: expect.objectContaining({
        workflow: 'coding',
        status: 'grounded',
        requestedFocusNodeIds: [changed.id],
        includedFocusNodeIds: [changed.id],
        includedFocusRelationIds: [relation.id],
      }),
    });
  });

  it('keeps contradictory concept nodes on opposite sides of the frame', async () => {
    const store = getGraphStore();
    const defaultFirst = store.createNode({
      title: 'Editorial pacing default',
      trigger: 'foundation',
      why: 'This was the initial manuscript strategy.',
      understanding:
        'The opening should explain the entire system before introducing a character.',
    });
    const draftResistance = store.createNode({
      title: 'Editorial pacing counterexample',
      trigger: 'foundation',
      why: 'A draft read exposed a competing structure.',
      understanding:
        'The opening should introduce a character before explaining the system.',
    });
    const contradiction = store.createEdge({
      fromId: draftResistance.id,
      toId: defaultFirst.id,
      type: 'contradicts',
      why: 'Only one event can lead the opening.',
      explanation: 'Competing opening structures',
    });

    const result = await understand(
      'editorial pacing opening character system',
      'writing',
    );
    const frame = result.frame as {
      baseline: Array<{ id: string }>;
      resistance: Array<{ id: string; viaEdgeIds: string[] }>;
    };
    const baselineIds = frame.baseline.map((item) => item.id);
    const resistanceIds = frame.resistance.map((item) => item.id);

    expect(baselineIds).toHaveLength(1);
    expect(resistanceIds).toHaveLength(1);
    expect(new Set([...baselineIds, ...resistanceIds])).toEqual(
      new Set([defaultFirst.id, draftResistance.id]),
    );
    expect(frame.resistance[0]?.viaEdgeIds).toContain(contradiction.id);
  });

  it('expands passage evidence from selected resistance, not only retrieval seeds', async () => {
    const store = getGraphStore();
    const baseline = store.createNode({
      title: 'Clockwork orchard passage interpretation',
      trigger: 'foundation',
      why: 'This is the expectation being tested.',
      understanding:
        'The clockwork orchard passage supports a mechanical interpretation.',
    });
    for (let index = 0; index < 5; index++) {
      store.createNode({
        title: `Clockwork orchard passage interpretation reference ${index}`,
        trigger: 'reference',
        why: 'Retrieval fixture with stronger lexical coverage.',
        understanding: 'Reference marker.',
      });
    }
    const resistance = store.createNode({
      title: 'Clockwork interpretation conflict',
      trigger: 'tension',
      why: 'The encountered image resists the mechanical reading.',
      understanding: 'Organic growth qualifies the clockwork interpretation.',
    });
    const passage = store.createNode({
      title: 'Encountered paragraph 2',
      content: 'Branches bend around the gears instead of obeying them.',
      level: 'paragraph',
      fileType: 'md',
    });
    store.createEdge({
      fromId: resistance.id,
      toId: baseline.id,
      type: 'contradicts',
      why: 'The organic image resists a purely mechanical reading.',
    });
    const learnedFrom = store.createEdge({
      fromId: resistance.id,
      toId: passage.id,
      type: 'learned_from',
      why: 'This exact encountered paragraph caused the qualification.',
    });

    const result = await understand(
      'clockwork orchard passage interpretation',
      'reading',
    );
    const frame = result.frame as {
      resistance: Array<{ id: string }>;
      evidence: Array<{ id?: string }>;
      relations: Array<{ id: string }>;
    };

    expect(frame.resistance.map((item) => item.id)).toContain(resistance.id);
    expect(frame.evidence.map((item) => item.id)).toContain(passage.id);
    expect(frame.relations.map((edge) => edge.id)).toContain(learnedFrom.id);
  });

  it('surfaces a relevant experiment and the passages it tested as evidence', async () => {
    const store = getGraphStore();
    store.createNode({
      title: 'Remembered-time transfer mechanism',
      trigger: 'hypothesis',
      why: 'This is the mechanism being tested.',
      understanding:
        'Remembered time is exchanged one-for-one for waking hours.',
    });
    const experiment = store.createNode({
      title: 'Transfer arithmetic for a quarter million sleepers',
      trigger: 'experiment',
      why: 'The story needs internally coherent arithmetic.',
      understanding:
        'Thirty-one remembered years contain enough hours to wake a quarter million sleepers for one hour each.',
    });
    const requirement = store.createNode({
      title: 'Emergency requirement passage',
      content:
        'The city needs thirty-one remembered years before sunlight clears the roofs.',
      level: 'paragraph',
      fileType: 'md',
    });
    const population = store.createNode({
      title: 'Affected population passage',
      content: 'A quarter million sleepers wait for the dawn grid.',
      level: 'paragraph',
      fileType: 'md',
    });
    const requirementEdge = store.createEdge({
      fromId: experiment.id,
      toId: requirement.id,
      type: 'learned_from',
      why: 'This passage states the duration used by the calculation.',
    });
    const populationEdge = store.createEdge({
      fromId: experiment.id,
      toId: population.id,
      type: 'learned_from',
      why: 'This passage states the population used by the calculation.',
    });

    const result = await understand(
      'check transfer arithmetic for thirty-one remembered years and a quarter million sleepers',
      'writing',
    );
    const frame = result.frame as {
      evidence: Array<{ id?: string }>;
      relations: Array<{ id: string; type: string }>;
    };
    const evidenceIds = frame.evidence.map((item) => item.id);

    expect(result.status).toBe('grounded');
    expect(evidenceIds).toContain(experiment.id);
    expect(evidenceIds).toContain(requirement.id);
    expect(evidenceIds).toContain(population.id);
    expect(frame.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: requirementEdge.id,
          type: 'learned_from',
        }),
        expect.objectContaining({
          id: populationEdge.id,
          type: 'learned_from',
        }),
      ]),
    );
  });

  it('uses concrete artifact implementations as evidence only for native artifact workflows', async () => {
    const store = getGraphStore();
    const decision = store.createNode({
      title: 'Reader promise for the opening',
      trigger: 'decision',
      why: 'This is the structural choice being tested.',
      understanding: 'The opening promises the reader an intimate mystery.',
    });
    const manuscript = store.createNode({
      title: 'Prologue',
      content: 'Mara found a key warm from a hand she had never touched.',
      summary: 'A generic summary that must not replace manuscript evidence.',
      level: 'section',
      fileType: 'md',
    });
    const implementation = store.createEdge({
      fromId: decision.id,
      toId: manuscript.id,
      type: 'implements',
      why: 'The prologue is the prose that realizes the reader promise.',
    });

    const writing = await understand('reader promise opening', 'writing');
    const coding = await understand('reader promise opening', 'coding');
    const general = await understand('reader promise opening', 'general');
    const writingFrame = writing.frame as {
      evidence: Array<{ id?: string; excerpt?: string }>;
      relations: Array<{ id: string }>;
    };
    const generalFrame = general.frame as {
      evidence: Array<{ id?: string }>;
    };
    const codingFrame = coding.frame as {
      evidence: Array<{ id?: string }>;
    };

    expect(writingFrame.evidence.map((item) => item.id)).toContain(
      manuscript.id,
    );
    expect(
      writingFrame.evidence.find((item) => item.id === manuscript.id)?.excerpt,
    ).toBe('Mara found a key warm from a hand she had never touched.');
    expect(writingFrame.relations.map((edge) => edge.id)).toContain(
      implementation.id,
    );
    expect(codingFrame.evidence.map((item) => item.id)).toContain(
      manuscript.id,
    );
    expect(generalFrame.evidence.map((item) => item.id)).not.toContain(
      manuscript.id,
    );
  });

  it('does not reinterpret creative provenance as epistemic evidence', async () => {
    const store = getGraphStore();
    const sourceMaterial = store.createNode({
      title: 'Lantern weather inheritance',
      trigger: 'foundation',
      why: 'A graph image that may shape prose.',
      understanding:
        'Lantern weather inheritance suggests a light carrying an obsolete climate.',
    });
    const manuscriptUnit = store.createNode({
      title: 'A finished paragraph',
      content: 'She opened the door and found summer waiting in the lamp.',
      level: 'paragraph',
      fileType: 'md',
    });
    store.createEdge({
      fromId: manuscriptUnit.id,
      toId: sourceMaterial.id,
      type: 'inspired_by',
      why: 'The obsolete-climate image caused the impossible summer in the lamp.',
    });

    const result = await understand('lantern weather inheritance', 'writing');
    const frame = result.frame as {
      baseline: Array<{ id: string }>;
      evidence: Array<{ id?: string }>;
    };

    expect(frame.baseline.map((item) => item.id)).toContain(sourceMaterial.id);
    expect(frame.evidence.map((item) => item.id)).not.toContain(
      manuscriptUnit.id,
    );
  });

  it('offers one deterministic query-relevant cognitive node as optional writing inspiration', async () => {
    const store = getGraphStore();
    for (let index = 0; index < 3; index++) {
      store.createNode({
        title: `Lunar archive voice inheritance premise ${index}`,
        trigger: 'foundation',
        why: 'Lunar archive voice inheritance shapes this premise.',
        understanding:
          'Lunar archive voice inheritance establishes the central story pressure.',
      });
    }
    const candidate = store.createNode({
      title: 'A borrowed tide enters the archive',
      trigger: 'serendipity',
      why: 'It might open an unexpected tonal route.',
      understanding:
        'The lunar archive mistakes an inherited voice for the sound of a tide.',
    });
    const neighboringPressure = store.createNode({
      title: 'The tide owes a debt to an absent moon',
      trigger: 'tension',
      why: 'This pressure gives the association a relational direction.',
      understanding:
        'The inherited tide is not only an image; it implies an absent cause that still exerts force.',
    });
    const candidateRelation = store.createEdge({
      fromId: candidate.id,
      toId: neighboringPressure.id,
      type: 'refines',
      why: 'The absent moon turns the borrowed tide into a causal pressure.',
    });
    const irrelevant = store.createNode({
      title: 'Glass insects at noon',
      trigger: 'serendipity',
      why: 'This belongs to a different work.',
      understanding: 'Glass insects shelter beneath a copper leaf.',
    });

    const first = await understand(
      'lunar archive voice inheritance',
      'writing',
    );
    const second = await understand(
      'lunar archive voice inheritance',
      'writing',
    );
    const writingFrame = first.frame as {
      baseline: Array<{ id: string }>;
      resistance: Array<{ id: string }>;
      evidence: Array<{ id?: string }>;
      inspirationCandidate: {
        id: string;
        title: string;
        trigger: string;
        excerpt: string;
        selectionReason: string;
        neighborhood: Array<{
          node: { id: string; title: string };
          relation: { id: string; type: string; direction: string };
        }>;
      } | null;
    };
    const selected = new Set([
      ...writingFrame.baseline.map((item) => item.id),
      ...writingFrame.resistance.map((item) => item.id),
      ...writingFrame.evidence.flatMap((item) => (item.id ? [item.id] : [])),
    ]);

    expect(second.frame).toEqual(first.frame);
    expect(writingFrame.inspirationCandidate).toEqual({
      id: candidate.id,
      title: 'A borrowed tide enters the archive',
      trigger: 'serendipity',
      excerpt:
        'The lunar archive mistakes an inherited voice for the sound of a tide.',
      selectionReason:
        'Highest-ranked query-relevant ordinary cognitive node not already used as baseline, resistance, or evidence; offered as optional creative pressure.',
      neighborhood: [
        {
          node: expect.objectContaining({
            id: neighboringPressure.id,
            title: 'The tide owes a debt to an absent moon',
          }),
          relation: expect.objectContaining({
            id: candidateRelation.id,
            type: 'refines',
            direction: 'outgoing',
          }),
        },
      ],
    });
    expect(selected).not.toContain(candidate.id);
    expect(writingFrame.inspirationCandidate?.id).not.toBe(irrelevant.id);
    expect(first.prompt).toContain(
      'offered for that purpose—not an instruction, requirement, or quota',
    );
    expect(first.prompt).toContain('reject it when it is merely noise');
    expect(first.prompt).toContain('preserve exact provenance');

    const general = await understand(
      'lunar archive voice inheritance',
      'general',
    );
    expect(general.frame).not.toHaveProperty('inspirationCandidate');
  });

  it('returns no writing inspiration when relevant ordinary nodes are selected or resolved', async () => {
    const store = getGraphStore();
    const selected = store.createNode({
      title: 'Lunar archive voice inheritance',
      trigger: 'foundation',
      why: 'This is the relevant established premise.',
      understanding:
        'A lunar archive preserves a voice through inherited memory.',
    });
    store.createNode({
      title: 'Resolved lunar archive association',
      trigger: 'serendipity',
      why: 'The possibility was considered and closed.',
      understanding:
        'The lunar archive voice inheritance once suggested a tidal metaphor.',
      metadata: {
        liveAttention: true,
        attentionStatus: 'resolved',
      },
    });

    const result = await understand(
      'lunar archive voice inheritance',
      'writing',
    );
    const frame = result.frame as {
      baseline: Array<{ id: string }>;
      inspirationCandidate: unknown;
    };

    expect(frame.baseline.map((item) => item.id)).toContain(selected.id);
    expect(frame.inspirationCandidate).toBeNull();
  });

  it('keeps artifact and cognitive search budgets separate for a small writing graph', async () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'Eleven Words for the Drowned',
      content: '# Eleven Words for the Drowned',
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    });
    const receipt = store.createDocumentNode({
      title: 'The Receipt',
      content:
        'The clerk removes dangerous nouns. Hidden nouns are marked [BLACK].',
      level: 'section',
      parentId: root.id,
      fileType: 'md',
    });
    const redaction = store.createDocumentNode({
      title: 'Redaction',
      content: 'Verbs educate while nouns aim, so the policy hides nouns.',
      level: 'section',
      parentId: root.id,
      afterId: receipt.id,
      fileType: 'md',
    });
    const lesson = store.createDocumentNode({
      title: 'The Lesson',
      content: 'Opening the sea changes from apparent crime to rescue.',
      level: 'section',
      parentId: root.id,
      afterId: redaction.id,
      fileType: 'md',
    });
    const valve = store.createDocumentNode({
      title: 'The Founding Valve',
      content: 'The climax preserves a real personal cost.',
      level: 'section',
      parentId: root.id,
      afterId: lesson.id,
      fileType: 'md',
    });
    const ending = store.createDocumentNode({
      title: 'What the Future Sends',
      content: 'Remorse carries gratitude backward without undoing the cost.',
      level: 'section',
      parentId: root.id,
      afterId: valve.id,
      fileType: 'md',
    });

    const createAttention = (
      title: string,
      trigger: Parameters<typeof store.createNode>[0]['trigger'],
      understanding: string,
      aboutId: string,
      status: 'open' | 'resolved' = 'open',
    ) => {
      const note = store.createNode({
        title,
        trigger,
        understanding,
        why: `The ${title.toLocaleLowerCase()} should shape later prose.`,
        metadata: {
          liveAttention: true,
          attentionStatus: status,
          aboutNodeId: aboutId,
        },
      });
      store.createEdge({
        fromId: note.id,
        toId: aboutId,
        type: 'learned_from',
        why: `The ${title.toLocaleLowerCase()} emerged from this manuscript unit.`,
      });
      return note;
    };

    const premise = createAttention(
      'Premise and governing constraint',
      'foundation',
      'The narrow apology mechanism must remain subordinate to the relationship.',
      receipt.id,
    );
    const tension = createAttention(
      'Ethical pressure, not puzzle mechanics',
      'tension',
      'The institution should remain credible while still demanding harmful silence.',
      redaction.id,
    );
    const surprise = createAttention(
      'Changed meaning of the warning',
      'surprise',
      'Opening the sea changes from a crime into a necessary rescue.',
      lesson.id,
    );
    const decision = createAttention(
      'Climax must preserve cost',
      'decision',
      'Clever engineering must not erase the protagonist’s personal cost.',
      valve.id,
    );
    const consequence = createAttention(
      'Ending image and emotional claim',
      'consequence',
      'The final receipt carries gratitude and remorse without undoing death.',
      ending.id,
    );
    const evaluation = createAttention(
      'Reread found a temporal arithmetic break',
      'evaluation',
      'The manuscript reread corrected the future interval from thirty-one years to twenty-two, preserving reader trust.',
      root.id,
      'resolved',
    );

    const broad = await understand(
      'Encounter the existing science-fiction manuscript as a fresh writer-editor; identify its governing reader promise, voice, structure, unresolved tensions, and inherited editorial attention.',
      'writing',
    );
    const broadFrame = broad.frame as {
      baseline: Array<{ id: string }>;
      resistance: Array<{ id: string }>;
    };
    const cognitiveIds = new Set([
      ...broadFrame.baseline.map((item) => item.id),
      ...broadFrame.resistance.map((item) => item.id),
    ]);

    expect(cognitiveIds).toEqual(
      new Set([
        premise.id,
        tension.id,
        surprise.id,
        decision.id,
        consequence.id,
        evaluation.id,
      ]),
    );
    expect(
      (
        broad.selection as {
          roleSeeds: { artifactScopeFallback: number };
        }
      ).roleSeeds.artifactScopeFallback,
    ).toBeGreaterThanOrEqual(5);

    const targeted = await understand(
      'Pressure-test redaction mechanics where verbs educate and nouns are hidden.',
      'writing',
    );
    const targetedFrame = targeted.frame as {
      evidence: Array<{ id?: string }>;
    };
    expect(targetedFrame.evidence.map((item) => item.id)).toContain(receipt.id);
    expect(targetedFrame.evidence.map((item) => item.id)).toContain(
      redaction.id,
    );
  });

  it('does not call an empty understanding packet grounded', async () => {
    getGraphStore().createNode({
      title: 'The Clockwork Orchard',
      content: '# The Clockwork Orchard',
      level: 'document',
      fileType: 'md',
      isDocRoot: true,
    });

    const result = await understand('Clockwork Orchard', 'writing');
    const frame = result.frame as {
      baseline: unknown[];
      resistance: unknown[];
      evidence: unknown[];
      relations: unknown[];
    };

    expect(frame).toEqual({
      baseline: [],
      resistance: [],
      evidence: [],
      inspirationCandidate: null,
      relations: [],
    });
    expect(result.status).toBe('no_relevant_context');
    expect(result.prompt).toContain(
      'do not invent continuity with a past state',
    );
  });

  it('uses current and prior code document revisions as coding baseline', async () => {
    const store = getGraphStore();
    const moduleRoot = store.createDocumentNode({
      title: 'EventLedger.py',
      content: [
        'class EventLedger:',
        '    """Initial inclusive interval implementation."""',
        '    def events_between(self, start, end):',
        '        return [event for event in self.events if start <= event.at <= end]',
      ].join('\n'),
      summary: 'EventLedger uses an inclusive interval.',
      level: 'document',
      isDocRoot: true,
      fileType: 'py',
    });
    store.updateNode(moduleRoot.id, {
      content: [
        'class EventLedger:',
        '    """EventLedger uses a half-open interval."""',
        '    def events_between(self, start, end):',
        '        return [event for event in self.events if start <= event.at < end]',
      ].join('\n'),
      summary: 'EventLedger uses a half-open interval.',
      revisionWhy:
        'Avoid double-counting events at adjacent interval boundaries.',
    });

    const coding = await understand('EventLedger half-open interval', 'coding');
    const general = await understand(
      'EventLedger half-open interval',
      'general',
    );
    const codingFrame = coding.frame as {
      baseline: Array<{ id: string; excerpt: string; priorState?: string }>;
    };
    const baseline = codingFrame.baseline.find(
      (item) => item.id === moduleRoot.id,
    );

    expect(coding.status).toBe('grounded');
    expect(baseline?.excerpt).toContain('half-open interval');
    expect(baseline?.priorState).toContain('inclusive interval');
    expect(general.status).toBe('no_relevant_context');
  });

  it('falls back to lexical retrieval and reports unrelated queries honestly', async () => {
    getGraphStore().createNode({
      title: 'Chronological source progression',
      trigger: 'foundation',
      why: 'Reading order carries interpretive evidence.',
      understanding:
        'Read passages in sequence and preserve expectation changes.',
    });

    const relevant = await understand(
      'chronological source progression',
      'reading',
    );
    expect(relevant.status).toBe('grounded');
    expect((relevant.selection as { method: string }).method).toBe('lexical');
    expect(relevant.prompt).toContain(
      'Keep the source progression chronological',
    );
    expect(relevant.prompt).toContain(
      'Re-enter the expectations, questions, attractions, and hesitations',
    );
    expect(relevant.prompt).toContain('unread-source claims');
    expect(relevant.prompt).toContain('quarantine possible spoilers');
    expect(relevant.prompt).toContain(
      'Do not turn this packet into a checklist',
    );

    const unrelated = await understand(
      'volcanic mineral spectroscopy',
      'general',
    );
    expect(unrelated.status).toBe('no_relevant_context');
    expect(unrelated.prompt).toContain(
      'do not invent continuity with a past state',
    );
  });

  it('assembles a bounded, provenance-preserving dossier packet across passages', async () => {
    const store = getGraphStore();
    const question = store.createDocumentNode({
      title: 'Question',
      content: 'Who ruled when the Orval eclipse occurred?',
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    });
    const dossier = store.createDocumentNode({
      title: 'Dossier of the North Archive',
      content: '# Dossier of the North Archive',
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    });
    const namingPassage = store.createDocumentNode({
      title: 'Astronomical naming',
      content:
        'At Orval Gate, the first silent eclipse was recorded as the Sable Transit.',
      level: 'paragraph',
      parentId: dossier.id,
      fileType: 'md',
    });
    const datingPassage = store.createDocumentNode({
      title: 'Regnal dating',
      content:
        'The Sable Transit fell within the Fen Regency, before the accession of House Marr.',
      level: 'paragraph',
      parentId: dossier.id,
      afterId: namingPassage.id,
      fileType: 'md',
    });
    const unrelatedSibling = store.createDocumentNode({
      title: 'Seal composition',
      content: 'The archive seal was made from wax, flax, and powdered amber.',
      level: 'paragraph',
      parentId: dossier.id,
      afterId: datingPassage.id,
      fileType: 'md',
    });
    const distractor = store.createDocumentNode({
      title: 'Botanical appendix',
      content: '# Botanical appendix',
      level: 'document',
      isDocRoot: true,
      fileType: 'md',
    });
    const distractorPassage = store.createDocumentNode({
      title: 'Gate moss',
      content:
        'Orval Gate also names a yellow moss cultivated by southern gardeners.',
      level: 'paragraph',
      parentId: distractor.id,
      fileType: 'md',
    });

    const distributed = await understand(
      'Orval eclipse Fen regency',
      'reading',
    );
    const distributedPacket = (
      distributed.frame as {
        artifactEvidence: {
          passages: Array<{
            id: string;
            rootId: string;
            path: Array<{ id: string; title: string }>;
            matchedQueryTerms: string[];
            bridgeTerms: string[];
            selectionReason: string;
          }>;
          coverage: {
            queryTerms: string[];
            coveredQueryTerms: string[];
            uncoveredQueryTerms: string[];
            selectedPassageIds: string[];
            selectedRootIds: string[];
            possibleInsufficiency: boolean;
            basis: string;
          };
        };
      }
    ).artifactEvidence;

    expect(distributed.status).toBe('grounded');
    expect(distributedPacket.passages.map((passage) => passage.id)).toEqual([
      namingPassage.id,
      datingPassage.id,
    ]);
    expect(distributedPacket.passages[0]?.path).toEqual([
      { id: dossier.id, title: 'Dossier of the North Archive' },
      { id: namingPassage.id, title: 'Astronomical naming' },
    ]);
    expect(distributedPacket.coverage).toEqual(
      expect.objectContaining({
        queryTerms: ['orval', 'eclipse', 'fen', 'regency'],
        coveredQueryTerms: ['orval', 'eclipse', 'fen', 'regency'],
        uncoveredQueryTerms: [],
        selectedPassageIds: [namingPassage.id, datingPassage.id],
        selectedRootIds: [dossier.id],
        possibleInsufficiency: false,
        basis:
          'Exact lexical query coverage is a retrieval diagnostic, not proof that the passages are sufficient to answer.',
      }),
    );
    const distributedPassageIds = distributedPacket.passages.map(
      (passage) => passage.id,
    );
    expect(distributedPassageIds).not.toContain(question.id);
    expect(distributedPassageIds).not.toContain(unrelatedSibling.id);
    expect(distributedPassageIds).not.toContain(distractorPassage.id);
    expect(distributed.prompt).toContain(
      'retrieve more context rather than guess',
    );

    const bridged = await understand(
      'Who ruled when the Orval eclipse occurred?',
      'general',
    );
    const bridgedPassages = (
      bridged.frame as {
        artifactEvidence: {
          passages: Array<{
            id: string;
            matchedQueryTerms: string[];
            bridgeTerms: string[];
            selectionReason: string;
          }>;
        };
      }
    ).artifactEvidence.passages;

    expect(bridgedPassages.map((passage) => passage.id)).toEqual([
      namingPassage.id,
      datingPassage.id,
    ]);
    expect(bridgedPassages[1]).toEqual(
      expect.objectContaining({
        id: datingPassage.id,
        matchedQueryTerms: [],
        bridgeTerms: ['sable', 'transit'],
        selectionReason: 'rare_term_bridge',
      }),
    );

    const insufficient = await understand(
      'Orval eclipse cobalt succession',
      'general',
    );
    const insufficientCoverage = (
      insufficient.frame as {
        artifactEvidence: {
          coverage: {
            uncoveredQueryTerms: string[];
            possibleInsufficiency: boolean;
          };
        };
      }
    ).artifactEvidence.coverage;
    expect(insufficientCoverage.uncoveredQueryTerms).toEqual([
      'cobalt',
      'succession',
    ]);
    expect(insufficientCoverage.possibleInsufficiency).toBe(true);

    const unrelated = await understand('obsidian moth acoustics', 'general');
    expect(unrelated.status).toBe('no_relevant_context');
    expect(unrelated.frame).not.toHaveProperty('artifactEvidence');

    const writing = await understand('Orval eclipse Fen regency', 'writing');
    expect(writing.frame).not.toHaveProperty('artifactEvidence');
    expect(writing.selection).not.toHaveProperty('artifactEvidence');
  });

  it('rejects packets grounded only by one generic shared token', async () => {
    getGraphStore().createNode({
      title: 'Universal workflow system',
      trigger: 'foundation',
      why: 'Describes task routing.',
      understanding: 'One system can route every workflow.',
    });

    const result = await understand(
      'How do astronomers measure a planetary system orbital inclination?',
      'general',
    );

    expect(result.status).toBe('no_relevant_context');
    expect(result.frame).toEqual({
      baseline: [],
      resistance: [],
      evidence: [],
      relations: [],
    });
    expect(result.prompt).toContain(
      'do not invent continuity with a past state',
    );
  });

  it('does not load the optional model merely because stored embeddings exist', async () => {
    const store = getGraphStore();
    const node = store.createNode({
      title: 'Repository evidence loop',
      trigger: 'foundation',
      why: 'Coding claims should be executable.',
      understanding: 'Use tests and runtime observations as coding evidence.',
    });
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(Buffer.alloc(384 * 4), node.id);
    const semanticSearch = vi.spyOn(store, 'semanticSearch');

    const result = await understand('repository evidence tests', 'coding');

    expect((result.selection as { method: string }).method).toBe('lexical');
    expect(
      (result.selection as { embeddingCoverage: { withEmbedding: number } })
        .embeddingCoverage.withEmbedding,
    ).toBe(1);
    expect(semanticSearch).not.toHaveBeenCalled();
  });

  it('keeps graph-shape guidance advisory and routes ordinary divergence through grounded discovery', async () => {
    const store = getGraphStore();
    const premise = store.createNode({
      title: 'Current premise',
      trigger: 'foundation',
      why: 'Fixture premise',
      understanding: 'The current model is internally coherent.',
    });
    const consequence = store.createNode({
      title: 'Current consequence',
      trigger: 'consequence',
      why: 'Fixture consequence',
      understanding: 'The model has one understood implication.',
    });
    store.createEdge({
      fromId: consequence.id,
      toId: premise.id,
      type: 'learned_from',
      why: 'The consequence follows from the premise.',
    });

    const pulse = (await handleToolCall(
      'graph_thermostat',
      {},
      contextManager,
      'coding',
    )) as {
      governance: {
        advisory: boolean;
        recommended_tool: string;
        directive: string;
      };
    };

    expect(pulse.governance).toMatchObject({
      advisory: true,
      recommended_tool: 'graph_discover_grounded',
    });
    expect(pulse.governance.directive).toContain(
      '"no defensible connection" is a valid result',
    );
  });

  it('infers workflow only when explicitly asked for auto', async () => {
    const coding = (await understand(
      'Debug the repository test suite',
      'auto',
    )) as { workflow: { requested: string; resolved: string } };
    const writing = (await understand(
      'Revise the voice of this book chapter',
      'auto',
    )) as { workflow: { requested: string; resolved: string } };
    const reading = (await understand(
      'Read this book chronologically',
      'auto',
    )) as { workflow: { requested: string; resolved: string } };
    const research = (await understand(
      'Write a research report comparing the evidence across studies',
      'auto',
    )) as { workflow: { requested: string; resolved: string } };

    expect(coding.workflow).toEqual({ requested: 'auto', resolved: 'coding' });
    expect(writing.workflow).toEqual({
      requested: 'auto',
      resolved: 'writing',
    });
    expect(reading.workflow).toEqual({
      requested: 'auto',
      resolved: 'reading',
    });
    expect(research.workflow).toEqual({
      requested: 'auto',
      resolved: 'research',
    });
    expect(
      (await understand('Compare the literature evidence', 'research')).prompt,
    ).toContain('This is a research task');
  });
});
