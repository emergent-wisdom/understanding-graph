import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  getTextSource,
  resetGraphStore,
  sqlite,
  THINKING_IDENTITY_PREAMBLE,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

// Each check below was an accepted operation in 0.1.31 (verified against the
// installed package with a fixture run); here each one must be refused, while
// the source chain's own tools keep working.

const SOURCE_TEXT =
  'First sentence of the source. Second sentence of the source. Third sentence of the source. Fourth sentence of the source.';
const FIRST = 'First sentence of the source. ';
const NEUTRAL_KERNEL =
  'I read carefully. I track what I believe. I revise when the evidence changes.';

let tmpDir: string;
let contextManager: ContextManager;
let fixtureNumber = 0;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-reading-integrity-'));
  const projectId = `reading-integrity-${++fixtureNumber}`;
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, projectId), { recursive: true });
  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes(projectId)) {
    sqlite.initDatabase(path.join(projectsDir, projectId));
  }
  sqlite.setCurrentProject(projectId);
  await contextManager.switchProject(projectId);
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockResolvedValue();
});

afterEach(() => {
  delete process.env.UG_THINKING_IDENTITY;
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore already-closed test connections.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

type Result = Record<string, unknown> & { success?: boolean };

async function call(name: string, args: Record<string, unknown>) {
  return (await handleToolCall(
    name,
    args,
    contextManager,
    'synthetic_reader',
  )) as Result;
}

// A refused operation either rolls the batch back or throws; both count.
async function batch(
  agent: string,
  operations: Array<{ tool: string; params: Record<string, unknown> }>,
): Promise<Result> {
  try {
    return await call('graph_batch', {
      commit_message: `${agent} works on the reading`,
      agent_name: agent,
      ignoreWarnings: true,
      operations,
    });
  } catch (error) {
    return { success: false, thrown: String(error) };
  }
}

async function readSource() {
  const loaded = await call('source_load', {
    title: 'Integrity fixture',
    content: SOURCE_TEXT,
    sourceType: 'article',
  });
  const sourceId = loaded.sourceId as string;
  const first = await call('source_read', {
    sourceId,
    chars: FIRST.length,
    commit_message: 'Read the first sentence',
  });
  expect(first.content).toBe(FIRST);
  const rootId = getTextSource(sourceId)?.rootNodeId as string;
  expect(rootId).toBeTruthy();
  return { sourceId, passageId: first.contentNodeId as string, rootId };
}

async function readMore(sourceId: string) {
  const next = await call('source_read', {
    sourceId,
    chars: 30,
    commit_message: 'Read on',
  });
  expect(next.success).not.toBe(false);
  return next.contentNodeId as string;
}

async function addConcept(title: string, trigger: string, passageId: string) {
  const added = await batch('connector', [
    {
      tool: 'graph_add_understanding',
      params: {
        title,
        trigger,
        understanding: `${title}: an interpretation of the first sentence.`,
        why: 'Fixture interpretation grounded in the passage.',
        skipDuplicateCheck: true,
      },
    },
    {
      tool: 'graph_connect',
      params: {
        from: '$0.id',
        to: passageId,
        type: 'learned_from',
        why: 'The interpretation comes from this passage.',
      },
    },
  ]);
  expect(added.success, JSON.stringify(added)).toBe(true);
  const results = added.results as Array<{ id?: string }>;
  return results[0].id as string;
}

function refusedFor(result: Result, marker: string) {
  expect(result.success, JSON.stringify(result)).toBe(false);
  expect(JSON.stringify(result)).toContain(marker);
}

function withoutFinalSentence(core: string): string {
  return core.split('. ').slice(0, -1).join('. ');
}

describe('source passages stay as read', () => {
  it('refuses a worker batch that revises a source passage', async () => {
    const { passageId } = await readSource();
    const result = await batch('connector', [
      {
        tool: 'doc_revise',
        params: { nodeId: passageId, content: 'REPLACED', why: 'tamper' },
      },
    ]);
    refusedFor(result, 'SOURCE_PASSAGE_IMMUTABLE');
    expect(getGraphStore().getNode(passageId)?.content).toBe(FIRST);
  });

  it('refuses to supersede (and so archive) a source passage', async () => {
    const { passageId } = await readSource();
    const result = await batch('belief_tracker', [
      {
        tool: 'graph_supersede',
        params: {
          old: passageId,
          new_name: 'Replacement',
          new_understanding: 'A replacement for the passage.',
          why: 'tamper',
        },
      },
    ]);
    refusedFor(result, 'DOCUMENT_STRUCTURE_CHANGE_NOT_ALLOWED');
    const passage = getGraphStore().getNode(passageId) as unknown as Record<
      string,
      unknown
    >;
    expect(passage.content).toBe(FIRST);
    expect(passage.archivedAt ?? null).toBeNull();
  });

  it('refuses revise, rename, metadata and trigger changes on a passage', async () => {
    const { passageId } = await readSource();
    const attempts = [
      {
        tool: 'graph_revise',
        params: {
          node: passageId,
          understanding: 'rewritten',
          why: 'tamper',
        },
      },
      { tool: 'graph_rename', params: { node: passageId, newName: 'Renamed' } },
      {
        tool: 'node_set_metadata',
        params: {
          node: passageId,
          metadata: { tampered: true },
          commit_message: 'tamper',
        },
      },
      {
        tool: 'node_set_trigger',
        params: { node: passageId, trigger: 'analysis' },
      },
    ];
    for (const attempt of attempts) {
      refusedFor(await batch('curator', [attempt]), 'SOURCE_PASSAGE_IMMUTABLE');
    }
    const passage = getGraphStore().getNode(passageId);
    expect(passage?.content).toBe(FIRST);
    expect(passage?.title).not.toBe('Renamed');
  });

  it('refuses to insert into the source document or split a passage', async () => {
    const { passageId, rootId } = await readSource();
    refusedFor(
      await batch('connector', [
        {
          tool: 'doc_create',
          params: {
            title: 'Injected',
            content: 'Text the source never said.',
            parentId: rootId,
            afterId: passageId,
          },
        },
      ]),
      'SOURCE_PASSAGE_IMMUTABLE',
    );
    refusedFor(
      await batch('connector', [
        {
          tool: 'doc_split',
          params: { nodeId: passageId, mode: 'lines', lineNumbers: [1] },
        },
      ]),
      'SOURCE_PASSAGE_IMMUTABLE',
    );
  });

  it('keeps reading and keeps semantic links to passages', async () => {
    const { sourceId, passageId } = await readSource();
    await addConcept('Grounded reading', 'analysis', passageId);
    const secondPassage = await readMore(sourceId);
    expect(secondPassage).toBeTruthy();
    expect(secondPassage).not.toBe(passageId);
  });
});

describe('superseded beliefs remain retrievable', () => {
  it('returns them through show_evolution and includeArchived', async () => {
    const { passageId } = await readSource();
    const oldTitle = 'Early reading of the opening';
    const oldId = await addConcept(oldTitle, 'analysis', passageId);
    const superseded = await batch('belief_tracker', [
      {
        tool: 'graph_supersede',
        params: {
          old: oldId,
          new_name: 'Later reading of the opening',
          new_understanding:
            'Earlier I read the opening one way; the second sentence changes that.',
          why: 'Later evidence replaces the earlier reading.',
        },
      },
    ]);
    expect(superseded.success, JSON.stringify(superseded)).toBe(true);

    const ordinary = JSON.stringify(
      await call('graph_context', { compact: false }),
    );
    expect(ordinary).not.toContain(oldTitle);

    const full = JSON.stringify(
      await call('graph_context', { compact: false, show_evolution: true }),
    );
    expect(full).toContain(oldTitle);
    expect(full).toContain('supersedes');
    // The compact view (the default above 50 nodes) marks the old belief.
    const compact = JSON.stringify(
      await call('graph_context', { compact: true, show_evolution: true }),
    );
    expect(compact).toContain(oldTitle);
    expect(compact).toContain('superseded_by');

    // The region view returns the replaced belief itself, not only its name.
    const successorId = (superseded.results as Array<{ newId?: string }>)[0]
      .newId as string;
    const regionId = [...getGraphStore().detectCommunities().communities].find(
      ([, nodes]) => nodes.some((node) => node.id === successorId),
    )?.[0];
    expect(regionId).toBeDefined();
    const oldUnderstanding = `${oldTitle}: an interpretation of the first sentence.`;
    const region = JSON.stringify(
      await call('graph_context_region', {
        region_id: regionId,
        show_evolution: true,
      }),
    );
    expect(region).toContain(oldUnderstanding);
    expect(region).toContain('superseded_by');
    expect(
      JSON.stringify(
        await call('graph_context_region', { region_id: regionId }),
      ),
    ).not.toContain(oldUnderstanding);

    const current = JSON.stringify(
      await call('graph_find_by_trigger', { trigger: 'analysis' }),
    );
    expect(current).not.toContain(oldId);
    const withArchived = JSON.stringify(
      await call('graph_find_by_trigger', {
        trigger: 'analysis',
        includeArchived: true,
      }),
    );
    expect(withArchived).toContain(oldId);
  });
});

describe('thinking blocks carry the complete identity anchor', () => {
  async function append(sourceId: string, passageId: string, thought: string) {
    try {
      return await call('doc_append_thinking', {
        sourceId,
        title: 'A pause',
        thought,
        agentId: 'synthesizer',
        synthesizes_nodes: [passageId],
        commit_message: 'Append the pause',
      });
    } catch (error) {
      return { success: false, thrown: String(error) } as Result;
    }
  }

  it('refuses the opening words alone and accepts the full Core in any apostrophe style', async () => {
    const { sourceId, passageId } = await readSource();
    refusedFor(
      await append(
        sourceId,
        passageId,
        'I feel no fear... The opening is calm.',
      ),
      'IDENTITY ANCHOR VIOLATION',
    );
    refusedFor(
      await append(
        sourceId,
        passageId,
        `${withoutFinalSentence(THINKING_IDENTITY_PREAMBLE)}. The opening is calm.`,
      ),
      'IDENTITY ANCHOR VIOLATION',
    );
    refusedFor(
      await append(sourceId, passageId, THINKING_IDENTITY_PREAMBLE),
      'EMPTY THOUGHT',
    );
    const curlyAndBroken = THINKING_IDENTITY_PREAMBLE.replace(
      "don't",
      'don’t',
    ).replace(/\. /g, '.\n');
    const accepted = await append(
      sourceId,
      passageId,
      `${curlyAndBroken}\n\nThe opening is calm, and I want to know why.`,
    );
    expect(accepted.success, JSON.stringify(accepted)).toBe(true);
  });

  it('refuses a translation without the Core', async () => {
    const { sourceId, passageId } = await readSource();
    const appended = await append(
      sourceId,
      passageId,
      `${THINKING_IDENTITY_PREAMBLE} The opening is calm.`,
    );
    expect(appended.success, JSON.stringify(appended)).toBe(true);
    const thinkingId = appended.thinkingNodeId as string;
    refusedFor(
      await call('translate_thinking', {
        thinking_node_id: thinkingId,
        thought_fluid: 'The opening is calm, and that calm interests me.',
        commit_message: 'Translate without the anchor',
      }),
      'IDENTITY ANCHOR VIOLATION',
    );
    const translated = await call('translate_thinking', {
      thinking_node_id: thinkingId,
      thought_fluid: `${THINKING_IDENTITY_PREAMBLE} The opening is calm, and that calm interests me.`,
      commit_message: 'Translate with the anchor',
    });
    expect(translated.success, JSON.stringify(translated)).toBe(true);
  });

  it('lets a run declare its own anchor, or none', async () => {
    const { sourceId, passageId } = await readSource();
    process.env.UG_THINKING_IDENTITY = NEUTRAL_KERNEL;
    refusedFor(
      await append(
        sourceId,
        passageId,
        `${THINKING_IDENTITY_PREAMBLE} A Core recital in a neutral-kernel arm.`,
      ),
      'IDENTITY ANCHOR VIOLATION',
    );
    const neutral = await append(
      sourceId,
      passageId,
      `${NEUTRAL_KERNEL} The opening is calm.`,
    );
    expect(neutral.success, JSON.stringify(neutral)).toBe(true);

    const nextPassage = await readMore(sourceId);
    process.env.UG_THINKING_IDENTITY = 'none';
    const plain = await append(
      sourceId,
      nextPassage,
      'The second sentence repeats the first.',
    );
    expect(plain.success, JSON.stringify(plain)).toBe(true);
  });

  it('keeps thinking blocks out of generic rewrite and creation routes', async () => {
    const { sourceId, passageId } = await readSource();
    const appended = await append(
      sourceId,
      passageId,
      `${THINKING_IDENTITY_PREAMBLE} The opening is calm.`,
    );
    expect(appended.success, JSON.stringify(appended)).toBe(true);

    refusedFor(
      await batch('synthesizer', [
        {
          tool: 'graph_revise',
          params: {
            node: appended.thinkingNodeId,
            understanding: 'rewritten later',
            why: 'rewrite history',
          },
        },
      ]),
      'RESERVED_THINKING_IMMUTABLE',
    );

    const conceptId = await addConcept('Ordinary note', 'analysis', passageId);
    refusedFor(
      await batch('synthesizer', [
        {
          tool: 'node_set_trigger',
          params: { node: conceptId, trigger: 'thinking' },
        },
      ]),
      'node_set_trigger cannot turn a node into a thinking block',
    );

    refusedFor(
      await batch('synthesizer', [
        {
          tool: 'graph_add_understanding',
          params: {
            title: 'Unanchored synthesis',
            trigger: 'thinking',
            understanding: 'A synthesis without the Core.',
            why: 'bypass the anchor',
            skipDuplicateCheck: true,
          },
        },
        {
          tool: 'graph_connect',
          params: {
            from: '$0.id',
            to: passageId,
            type: 'learned_from',
            why: 'Connected, so only the anchor can stop it.',
          },
        },
      ]),
      'FORBIDDEN_THINKING_CREATION',
    );
  });

  it('refuses generic routes that would create an unanchored thinking block', async () => {
    await readSource();
    for (const params of [{ fileType: 'thinking' }, { trigger: 'thinking' }]) {
      refusedFor(
        await batch('skeptic', [
          {
            tool: 'doc_create',
            params: {
              title: 'Unanchored block',
              content: 'No identity anchor here.',
              isDocRoot: true,
              ...params,
            },
          },
        ]),
        'FORBIDDEN_THINKING_CREATION',
      );
    }

    const draft = await batch('skeptic', [
      {
        tool: 'doc_create',
        params: {
          title: 'Ordinary draft',
          content: 'An ordinary draft paragraph.',
          isDocRoot: true,
        },
      },
    ]);
    expect(draft.success, JSON.stringify(draft)).toBe(true);
    const draftId = (draft.results as Array<{ id?: string }>)[0].id as string;
    refusedFor(
      await batch('skeptic', [
        {
          tool: 'doc_to_concept',
          params: { nodeId: draftId, trigger: 'thinking', why: 'bypass' },
        },
      ]),
      'FORBIDDEN_THINKING_CREATION',
    );
  });

  it('keeps thinking payloads for their dedicated tools', async () => {
    const { sourceId, passageId } = await readSource();
    const appended = await append(
      sourceId,
      passageId,
      `${THINKING_IDENTITY_PREAMBLE} The opening is calm.`,
    );
    expect(appended.success, JSON.stringify(appended)).toBe(true);
    const thinkingId = appended.thinkingNodeId as string;
    const reserved = () =>
      withReservedThinkingVisibility(true, () =>
        getGraphStore().getNode(thinkingId),
      );
    const before = reserved();

    refusedFor(
      await batch('connector', [
        {
          tool: 'node_set_metadata',
          params: {
            node: thinkingId,
            metadata: {
              translated: true,
              thought_fluid: 'No identity anchor at all.',
            },
            commit_message: 'mark translated',
          },
        },
      ]),
      'RESERVED_THINKING_IMMUTABLE',
    );
    refusedFor(
      await batch('connector', [
        {
          tool: 'doc_revise',
          params: {
            nodeId: thinkingId,
            content: 'No identity anchor.',
            why: 'x',
          },
        },
      ]),
      'RESERVED_THINKING_IMMUTABLE',
    );
    refusedFor(
      await batch('connector', [
        {
          tool: 'graph_rename',
          params: { node: thinkingId, newName: 'Renamed' },
        },
      ]),
      'RESERVED_THINKING_IMMUTABLE',
    );
    const after = reserved();
    expect(after?.content).toBe(before?.content);
    expect(after?.title).toBe(before?.title);
    expect((after?.metadata as Record<string, unknown>)?.translated).not.toBe(
      true,
    );

    // The dedicated translation route still works.
    const translated = await call('translate_thinking', {
      thinking_node_id: thinkingId,
      thought_fluid: `${THINKING_IDENTITY_PREAMBLE} The opening is calm, and I want to know why.`,
      commit_message: 'Translate with the anchor',
    });
    expect(translated.success, JSON.stringify(translated)).toBe(true);

    // An older standalone thinking concept, outside any source chain.
    const legacy = withReservedThinkingVisibility(true, () =>
      getGraphStore().createNode({
        title: 'Legacy standalone thinking',
        trigger: 'thinking',
        why: 'Created before thinking became dedicated-only.',
        understanding: `${THINKING_IDENTITY_PREAMBLE} An older block.`,
      }),
    );
    for (const operation of [
      {
        tool: 'doc_revise',
        params: { nodeId: legacy.id, content: 'No identity anchor.', why: 'x' },
      },
      {
        tool: 'node_set_metadata',
        params: {
          node: legacy.id,
          metadata: { translated: true },
          commit_message: 'mark translated',
        },
      },
    ]) {
      refusedFor(
        await batch('connector', [operation]),
        'RESERVED_THINKING_IMMUTABLE',
      );
    }

    // A complete anchor does not open the generic creation route.
    refusedFor(
      await batch('synthesizer', [
        {
          tool: 'graph_add_understanding',
          params: {
            title: 'Standalone thinking',
            trigger: 'thinking',
            understanding: `${THINKING_IDENTITY_PREAMBLE} I notice the opening.`,
            why: 'Review creation route',
            skipDuplicateCheck: true,
          },
        },
        {
          tool: 'graph_connect',
          params: {
            from: '$0.id',
            to: passageId,
            type: 'learned_from',
            why: 'Grounded fixture',
          },
        },
      ]),
      'FORBIDDEN_THINKING_CREATION',
    );
  });

  it('keeps the edges a thinking block draws for its dedicated tools', async () => {
    const { sourceId, passageId } = await readSource();
    const conceptId = await addConcept(
      'Reader response',
      'analysis',
      passageId,
    );
    const appended = await append(
      sourceId,
      passageId,
      `${THINKING_IDENTITY_PREAMBLE} The opening is calm.`,
    );
    expect(appended.success, JSON.stringify(appended)).toBe(true);
    const thinkingId = appended.thinkingNodeId as string;
    const drawnEdges = () =>
      withReservedThinkingVisibility(true, () =>
        getGraphStore()
          .getAll()
          .edges.filter((edge) => edge.fromId === thinkingId)
          .map((edge) => `${edge.type}:${edge.toId}`)
          .sort(),
      );
    const before = drawnEdges();
    expect(before).toContain(`refines:${passageId}`);

    for (const operation of [
      {
        tool: 'graph_connect',
        params: {
          from: thinkingId,
          to: conceptId,
          type: 'learned_from',
          why: 'claim a synthesis after the fact',
        },
      },
      { tool: 'graph_disconnect', params: { from: thinkingId, to: passageId } },
      {
        tool: 'edge_update',
        params: { from: thinkingId, to: passageId, type: 'relates' },
      },
      {
        tool: 'doc_link_concept',
        params: { docNodeId: thinkingId, conceptId },
      },
    ]) {
      refusedFor(
        await batch('connector', [operation]),
        'RESERVED_THINKING_IMMUTABLE',
      );
    }
    expect(drawnEdges()).toEqual(before);

    // Ordinary nodes can still respond to the Reader's thought.
    const response = await batch('skeptic', [
      {
        tool: 'graph_connect',
        params: {
          from: conceptId,
          to: thinkingId,
          type: 'questions',
          why: 'A worker questions the Reader.',
        },
      },
    ]);
    expect(response.success, JSON.stringify(response)).toBe(true);
  });
});
