import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import {
  THINKING_IDENTITY_PREAMBLE,
  TRIGGER_TYPES,
  type TriggerType,
} from '../types/index.js';
import { withReservedThinkingVisibility } from '../visibility.js';
import {
  generateHistoryContext,
  generateRegionContext,
  generateXmlContext,
  getUpdatesSince,
} from './ContextService.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

const PROJECT_ID = 'context-service-test';
const SINCE_BEFORE_FIXTURES = '1970-01-01 00:00:00';

const EXPECTED_TRIGGER_TYPES = [
  'foundation',
  'surprise',
  'repetition',
  'consequence',
  'tension',
  'question',
  'serendipity',
  'decision',
  'experiment',
  'analysis',
  'randomness',
  'reference',
  'library',
  'thinking',
  'prediction',
  'hypothesis',
  'model',
  'evaluation',
] as const satisfies readonly TriggerType[];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-context-service-'));
  sqlite.initDatabase(path.join(tmpDir, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
});

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createConcept(title: string, trigger: TriggerType = 'foundation') {
  return getGraphStore().createNode({
    title,
    trigger,
    why: `Why ${title} belongs in the graph.`,
    understanding: `Understanding recorded for ${title}.`,
  });
}

function createThinkingNode(
  title: string,
  content: string,
  signatureMarker: string,
) {
  return withReservedThinkingVisibility(true, () =>
    getGraphStore().createNode({
      title,
      trigger: 'thinking',
      content,
      understanding: JSON.stringify({
        signatures: [{ agentId: signatureMarker }],
      }),
      level: 'paragraph',
      fileType: 'thinking',
    }),
  );
}

function regionIdContaining(nodeId: string): number {
  for (const [regionId, nodes] of getGraphStore().detectCommunities()
    .communities) {
    if (nodes.some((node) => node.id === nodeId)) return regionId;
  }
  throw new Error(`No region contains node ${nodeId}`);
}

describe('ContextService model context', () => {
  it('keeps recent tool-action provenance exclusive to synthetic visibility', () => {
    sqlite.saveConversation(
      'synthetic-action-visibility-fixture',
      'Synthetic Reader action fixture',
      'Synthetic Reader action response',
    );
    withReservedThinkingVisibility(true, () =>
      sqlite.logToolCall({
        sessionId: 'synthetic-action-visibility-fixture',
        toolName: 'doc_get_unsigned_thinking',
        arguments: {
          title: 'RESERVED_TOOL_ARGUMENT_MARKER',
          nodeId: 'n_reserved_tool_marker',
        },
        error: 'RESERVED_TOOL_ERROR_MARKER',
      }),
    );

    const ordinary = withReservedThinkingVisibility(false, () =>
      getUpdatesSince(PROJECT_ID, SINCE_BEFORE_FIXTURES),
    );
    expect(ordinary).not.toContain('recent_actions');
    expect(ordinary).not.toContain('doc_get_unsigned_thinking');
    expect(ordinary).not.toContain('RESERVED_TOOL_ARGUMENT_MARKER');
    expect(ordinary).not.toContain('n_reserved_tool_marker');
    expect(ordinary).not.toContain('RESERVED_TOOL_ERROR_MARKER');

    const synthetic = withReservedThinkingVisibility(true, () =>
      getUpdatesSince(PROJECT_ID, SINCE_BEFORE_FIXTURES),
    );
    expect(synthetic).toContain('recent_actions');
    expect(synthetic).toContain('doc_get_unsigned_thinking');
    expect(synthetic).toContain('RESERVED_TOOL_ARGUMENT_MARKER');
    expect(synthetic).toContain('n_reserved_tool_marker');
    expect(synthetic).toContain('RESERVED_TOOL_ERROR_MARKER');
  });

  it('joins free-form conversation text only in synthetic visibility', () => {
    sqlite.saveConversation(
      'conversation-visibility-fixture',
      'RESERVED_CONVERSATION_QUERY_MARKER',
      'RESERVED_CONVERSATION_RESPONSE_MARKER',
    );
    getGraphStore().createNode({
      title: 'Visible event with a mixed conversation',
      trigger: 'analysis',
      why: 'Exercises conversation joining independently of node visibility',
      understanding:
        'The event is ordinary but its conversation is unclassified',
      conversationId: 'conversation-visibility-fixture',
    });

    const ordinary = generateHistoryContext();
    expect(ordinary).not.toContain('RESERVED_CONVERSATION_QUERY_MARKER');
    expect(ordinary).not.toContain('RESERVED_CONVERSATION_RESPONSE_MARKER');

    const synthetic = withReservedThinkingVisibility(true, () =>
      generateHistoryContext(),
    );
    expect(synthetic).toContain('RESERVED_CONVERSATION_QUERY_MARKER');
    expect(synthetic).toContain('RESERVED_CONVERSATION_RESPONSE_MARKER');
  });

  it('renders every supported trigger type in synthetic visibility', () => {
    expect(TRIGGER_TYPES).toEqual(EXPECTED_TRIGGER_TYPES);

    const nodes = withReservedThinkingVisibility(true, () => {
      const nodes = EXPECTED_TRIGGER_TYPES.map((trigger) =>
        trigger === 'thinking'
          ? createThinkingNode(
              `Trigger ${trigger}`,
              'A substantive thinking trace.',
              'trigger-fixture-signer',
            )
          : createConcept(`Trigger ${trigger}`, trigger),
      );

      const store = getGraphStore();
      const anchor = nodes[0];
      for (const node of nodes.slice(1)) {
        store.createEdge({
          fromId: anchor.id,
          toId: node.id,
          type: 'relates',
          explanation: 'Groups trigger rendering fixtures',
          why: 'Keeps every trigger fixture in one test region.',
        });
      }
      return nodes;
    });

    const anchor = nodes[0];

    const [full, region] = withReservedThinkingVisibility(
      true,
      () =>
        [
          generateXmlContext(PROJECT_ID, { compact: false }),
          generateRegionContext(PROJECT_ID, regionIdContaining(anchor.id)),
        ] as const,
    );

    for (const trigger of EXPECTED_TRIGGER_TYPES) {
      const renderedConcept = `<name>Trigger ${trigger}</name>`;
      expect(full).toContain(renderedConcept);
      expect(full).toContain(`type="${trigger}"`);
      expect(region).toContain(renderedConcept);
      expect(region).toContain(`type="${trigger}"`);
    }
  });

  it('uses thinking content instead of signature metadata in every context mode', () => {
    const thought =
      'A counterexample shifted the working belief toward constraints.';
    const signatureMarker = 'private-signature-agent';
    const thinking = createThinkingNode(
      'Belief shift after the counterexample',
      `${THINKING_IDENTITY_PREAMBLE}\n\n${thought}`,
      signatureMarker,
    );
    const concept = createConcept('Constraint-aware account');

    withReservedThinkingVisibility(true, () =>
      getGraphStore().createEdge({
        fromId: thinking.id,
        toId: concept.id,
        type: 'refines',
        explanation: 'Narrows the original claim',
        why: 'The counterexample identifies the missing constraint.',
      }),
    );

    const contexts = withReservedThinkingVisibility(true, () => [
      generateXmlContext(PROJECT_ID, { compact: false }),
      generateXmlContext(PROJECT_ID, { nodeId: thinking.id }),
      generateXmlContext(PROJECT_ID, { compact: true }),
      generateRegionContext(PROJECT_ID, regionIdContaining(thinking.id)),
      getUpdatesSince(PROJECT_ID, SINCE_BEFORE_FIXTURES),
    ]);

    for (const context of contexts) {
      expect(context).toContain(`<understanding>${thought}</understanding>`);
      expect(context).not.toContain(signatureMarker);
      expect(context).not.toContain('&quot;signatures&quot;');
      expect(context).not.toContain(THINKING_IDENTITY_PREAMBLE);
    }

    const focused = contexts[1];
    expect(focused.match(new RegExp(thought, 'g'))).toHaveLength(1);
    expect(focused).not.toContain(`<content>${thought}</content>`);
  });

  it('excludes reserved nodes and incident edges from every ordinary context mode', () => {
    const visible = createConcept('Visible context anchor');
    const reservedTitle = 'RESERVED_CONTEXT_MARKER';
    const reserved = createThinkingNode(
      reservedTitle,
      `${THINKING_IDENTITY_PREAMBLE}\n\nReserved context body.`,
      'reserved-context-signer',
    );
    const incident = withReservedThinkingVisibility(true, () =>
      getGraphStore().createEdge({
        fromId: reserved.id,
        toId: visible.id,
        type: 'refines',
        explanation: 'RESERVED_EDGE_MARKER',
        why: 'Makes accidental edge projection observable.',
      }),
    );
    const regionId = regionIdContaining(visible.id);

    const contexts = withReservedThinkingVisibility(false, () => [
      generateXmlContext(PROJECT_ID, { compact: false }),
      generateXmlContext(PROJECT_ID, { nodeId: visible.id }),
      generateXmlContext(PROJECT_ID, { compact: true }),
      generateRegionContext(PROJECT_ID, regionId),
      getUpdatesSince(PROJECT_ID, SINCE_BEFORE_FIXTURES),
    ]);

    for (const context of contexts) {
      expect(context).toContain(visible.title);
      expect(context).not.toContain(reservedTitle);
      expect(context).not.toContain(reserved.id);
      expect(context).not.toContain(incident.id);
      expect(context).not.toContain('RESERVED_EDGE_MARKER');
    }

    const hiddenFocus = withReservedThinkingVisibility(false, () =>
      generateXmlContext(PROJECT_ID, { nodeId: reserved.id }),
    );
    expect(hiddenFocus).toContain('not found');
    expect(hiddenFocus).not.toContain(reservedTitle);
  });

  it('preserves edge type, explanation, and why across context modes', () => {
    const broad = createConcept('Broad account');
    const precise = createConcept('Precise account');
    const relation = 'Narrows <scope> & removes ambiguity';
    const why = 'The broad claim overfits & needs <constraints>.';

    getGraphStore().createEdge({
      fromId: precise.id,
      toId: broad.id,
      type: 'refines',
      explanation: relation,
      why,
    });

    const escapedRelation =
      '<relation>Narrows &lt;scope&gt; &amp; removes ambiguity</relation>';
    const escapedWhy =
      '<why>The broad claim overfits &amp; needs &lt;constraints&gt;.</why>';
    const contexts = [
      generateXmlContext(PROJECT_ID, { compact: false }),
      generateXmlContext(PROJECT_ID, { nodeId: precise.id }),
      generateXmlContext(PROJECT_ID, { compact: true }),
      generateRegionContext(PROJECT_ID, regionIdContaining(precise.id)),
    ];

    for (const context of contexts) {
      expect(context).toContain('edge_type="refines"');
      expect(context).toContain(escapedRelation);
      expect(context).toContain(escapedWhy);
    }

    const updates = getUpdatesSince(PROJECT_ID, SINCE_BEFORE_FIXTURES);
    expect(updates).toContain('type="refines"');
    expect(updates).toContain(escapedRelation);
    expect(updates).toContain(escapedWhy);
  });
});
