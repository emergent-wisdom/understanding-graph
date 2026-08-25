import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { getToolDefinitions, handleToolCall } from '../tools/index.js';
import { docOp } from './support/doc-batch.js';

const PROJECT_ID = 'document-split-test';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-document-split-'));
  const projectDir = path.join(tmpDir, 'projects');

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createRoot(title: string, content: string, fileType: string) {
  return await docOp<{ id: string }>(contextManager, 'full', 'doc_create', {
    title,
    content,
    level: 'document',
    isDocRoot: true,
    fileType,
  });
}

async function split(params: Record<string, unknown>): Promise<{
  success: boolean;
  results?: Array<{
    parentContentCleared: boolean;
    childLevel?: string;
    sections: Array<{ id: string; title: string }>;
  }>;
  errors?: Array<{ error: string }>;
  commit?: { id: string; message: string };
  regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
}>;
async function split(
  params: Record<string, unknown>,
  mode: 'coding' | 'writing' | 'synthetic_reader',
): Promise<{
  success: boolean;
  results?: Array<{
    parentContentCleared: boolean;
    childLevel?: string;
    sections: Array<{ id: string; title: string }>;
  }>;
  errors?: Array<{ error: string }>;
  commit?: { id: string; message: string };
  regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
}>;
async function split(
  params: Record<string, unknown>,
  mode: 'coding' | 'writing' | 'synthetic_reader' = 'coding',
): Promise<{
  success: boolean;
  results?: Array<{
    parentContentCleared: boolean;
    childLevel?: string;
    sections: Array<{ id: string; title: string }>;
  }>;
  errors?: Array<{ error: string }>;
  commit?: { id: string; message: string };
  regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
}> {
  return handleToolCall(
    'graph_batch',
    {
      commit_message: 'Split one coherent document unit into ordered children',
      agent_name: 'document-split-test',
      ignoreWarnings: true,
      operations: [{ tool: 'doc_split', params }],
    },
    contextManager,
    mode,
  ) as Promise<{
    success: boolean;
    results?: Array<{
      parentContentCleared: boolean;
      childLevel?: string;
      sections: Array<{ id: string; title: string }>;
    }>;
    errors?: Array<{ error: string }>;
    commit?: { id: string; message: string };
    regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
  }>;
}

describe('batch-only doc_split', () => {
  it('splits a Python root into named units that generate valid code without a repair revision', async () => {
    const source = [
      'from dataclasses import dataclass',
      '',
      '@dataclass',
      'class Event:',
      '    value: int',
      '',
      '@dataclass',
      'class WindowSummary:',
      '    total: int',
    ].join('\n');
    const root = await createRoot('models.py', source, 'py');
    const staleEmbedding = new Float32Array([0.25, 0.75]);
    sqlite
      .getDb()
      .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(Buffer.from(staleEmbedding.buffer), root.id);
    getGraphStore().invalidateCache();
    const commitsBefore = sqlite.getRecentCommits().length;

    const result = await split({
      nodeId: root.id,
      mode: 'lines',
      lineNumbers: [6],
    });
    const splitResult = result.results?.[0];

    expect(result.success).toBe(true);
    expect(result.commit).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^c_/),
        message: 'Split one coherent document unit into ordered children',
      }),
    );
    expect(splitResult?.parentContentCleared).toBe(true);
    expect(splitResult?.sections.map((section) => section.title)).toEqual([
      'Event',
      'WindowSummary',
    ]);

    const store = getGraphStore();
    const parent = store.getNode(root.id);
    expect(parent?.content).toBeNull();
    expect(parent?.embedding).toBeNull();
    expect(parent?.version).toBe(2);
    expect(parent?.revisions[0]?.content).toBe(source);
    expect(store.getChildren(root.id).map((child) => child.title)).toEqual([
      'Event',
      'WindowSummary',
    ]);

    expect(sqlite.getRecentCommits().length - commitsBefore).toBe(1);
    // The root carries its own creation commit now that creating it goes
    // through graph_batch, so the split's commit is read from a node the
    // split actually produced.
    const [firstUnit] = store.getChildren(root.id);
    expect(sqlite.getCommitForNode(firstUnit.id)?.message).toBe(
      'Split one coherent document unit into ordered children',
    );
    for (const section of splitResult?.sections ?? []) {
      expect(sqlite.getCommitForNode(section.id)?.message).toBe(
        'Split one coherent document unit into ordered children',
      );
    }
    expect(
      result.regeneratedDocuments?.some(
        (document) => document.rootId === root.id,
      ),
    ).toBe(true);

    const generated = (await handleToolCall(
      'doc_generate',
      { rootId: root.id },
      contextManager,
    )) as { success: boolean; outputPath: string };
    expect(generated.success).toBe(true);

    const output = fs.readFileSync(generated.outputPath, 'utf8');
    expect(output).not.toContain('% Split into');
    expect(output.match(/class Event:/g)).toHaveLength(1);
    expect(output.match(/class WindowSummary:/g)).toHaveLength(1);

    const compiled = spawnSync(
      'python3',
      ['-m', 'py_compile', generated.outputPath],
      { encoding: 'utf8' },
    );
    expect(compiled.status, compiled.stderr || compiled.stdout).toBe(0);
  });

  it('keeps metadata headings in children while clearing prose from the container', async () => {
    const root = await createRoot(
      'notes.md',
      '# Intro\nOpening.\n\n## Details\nMore.',
      'md',
    );

    const result = await split({ nodeId: root.id, mode: 'headers' });

    expect(result.success).toBe(true);
    expect(result.results?.[0]?.parentContentCleared).toBe(true);
    expect(getGraphStore().getNode(root.id)?.content).toBeNull();
    expect(
      getGraphStore()
        .getChildren(root.id)
        .map((child) => child.title),
    ).toEqual(['Intro', 'Details']);
    const generatedPath = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    )?.outputPath;
    const generated = fs.readFileSync(generatedPath || '', 'utf8');
    expect(generated.match(/Opening\./g)).toHaveLength(1);
    expect(generated.match(/More\./g)).toHaveLength(1);
    expect(generated).not.toContain('# notes.md');
    expect(generated).not.toContain('Container for');
    expect(generated).not.toContain('% Split');
  });

  it('preserves paragraph granularity without rendering metadata headings or old container prose', async () => {
    const root = await createRoot('story.md', '# Story', 'md');
    const paragraph = getGraphStore().createDocumentNode({
      title: 'Paragraph 7 — Refusal',
      content: 'The answer waited.\n“No,” she said.',
      level: 'paragraph',
      parentId: root.id,
    });

    const result = await split({
      nodeId: paragraph.id,
      mode: 'lines',
      lineNumbers: [1],
    });
    expect(result.success).toBe(true);
    expect(
      getGraphStore()
        .getChildren(paragraph.id)
        .map((child) => child.level),
    ).toEqual(['paragraph', 'paragraph']);

    const generatedPath = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    )?.outputPath;
    const generated = fs.readFileSync(generatedPath || '', 'utf8');
    expect(generated.match(/The answer waited\./g)).toHaveLength(1);
    expect(generated.match(/“No,” she said\./g)).toHaveLength(1);
    expect(generated).not.toContain('Paragraph 7');
    expect(generated).not.toContain('Section 1');
    expect(generated).not.toContain('Section 2');
  });

  it('can split a scene into paragraph children without inventing child headings', async () => {
    const root = await createRoot('story.md', '# Story', 'md');
    const scene = getGraphStore().createDocumentNode({
      title: 'The Threshold',
      content: 'The door remembered her.\n\nShe crossed anyway.',
      level: 'section',
      parentId: root.id,
    });

    const invalid = await split(
      {
        nodeId: scene.id,
        mode: 'lines',
        lineNumbers: [2],
        childLevel: 'beat',
      },
      'writing',
    );
    expect(invalid.success).toBe(false);
    expect(invalid.errors?.[0]?.error).toContain('INVALID_CHILD_LEVEL');
    expect(getGraphStore().getNode(scene.id)?.content).toContain(
      'She crossed anyway.',
    );
    expect(getGraphStore().getChildren(scene.id)).toEqual([]);

    const result = await split(
      {
        nodeId: scene.id,
        mode: 'lines',
        lineNumbers: [2],
        childLevel: 'paragraph',
      },
      'writing',
    );
    expect(result.success).toBe(true);
    expect(result.results?.[0]?.childLevel).toBe('paragraph');
    expect(
      getGraphStore()
        .getChildren(scene.id)
        .map((child) => child.level),
    ).toEqual(['paragraph', 'paragraph']);

    const generatedPath = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    )?.outputPath;
    const generated = fs.readFileSync(generatedPath || '', 'utf8');
    expect(generated).toContain('## The Threshold');
    expect(generated.match(/The door remembered her\./g)).toHaveLength(1);
    expect(generated.match(/She crossed anyway\./g)).toHaveLength(1);
    expect(generated).not.toContain('Section 1');
    expect(generated).not.toContain('Section 2');
  });

  it('renders sentence and plain-text split containers without stale understanding excerpts', async () => {
    const storyRoot = await createRoot('sentences.md', '# Sentences', 'md');
    const sentence = getGraphStore().createDocumentNode({
      title: 'Pivotal sentence',
      content: 'First clause.\nSecond clause.',
      level: 'sentence',
      parentId: storyRoot.id,
    });
    const sentenceResult = await split({
      nodeId: sentence.id,
      mode: 'lines',
      lineNumbers: [1],
    });
    expect(sentenceResult.success).toBe(true);
    const sentenceOutput = fs.readFileSync(
      sentenceResult.regeneratedDocuments?.find(
        (document) => document.rootId === storyRoot.id,
      )?.outputPath || '',
      'utf8',
    );
    expect(sentenceOutput.match(/First clause\./g)).toHaveLength(1);
    expect(sentenceOutput.match(/Second clause\./g)).toHaveLength(1);

    const textRoot = await createRoot('plain.txt', 'Document preface', 'txt');
    const textUnit = getGraphStore().createDocumentNode({
      title: 'Text unit',
      content: 'Alpha line.\nBeta line.',
      level: 'section',
      parentId: textRoot.id,
    });
    const textResult = await split({
      nodeId: textUnit.id,
      mode: 'lines',
      lineNumbers: [1],
    });
    expect(textResult.success).toBe(true);
    const textOutput = fs.readFileSync(
      textResult.regeneratedDocuments?.find(
        (document) => document.rootId === textRoot.id,
      )?.outputPath || '',
      'utf8',
    );
    expect(textOutput.match(/Alpha line\./g)).toHaveLength(1);
    expect(textOutput.match(/Beta line\./g)).toHaveLength(1);
  });

  it('allows splitting after an inactive historical child without reviving it', async () => {
    const root = await createRoot(
      'historical.py',
      'FIRST = 1\nSECOND = 2',
      'py',
    );
    const oldChild = getGraphStore().createDocumentNode({
      title: 'Archived prior unit',
      content: 'OLD = 0',
      level: 'section',
      parentId: root.id,
    });
    expect(getGraphStore().archiveNode(oldChild.id, 'Historical')).toBe(true);

    const result = await split({
      nodeId: root.id,
      mode: 'lines',
      lineNumbers: [1],
    });
    expect(result.success).toBe(true);
    expect(getGraphStore().getNode(oldChild.id)).toMatchObject({
      active: false,
    });
    expect(
      getGraphStore()
        .getChildren(root.id)
        .map((child) => child.title),
    ).not.toContain('Archived prior unit');
  });

  it('is hidden as a direct mutation in every advertised mode', async () => {
    for (const mode of [
      'reading',
      'research',
      'coding',
      'collaborative_coding',
      'writing',
      'full',
      'synthetic_reader',
    ] as const) {
      expect(
        getToolDefinitions(mode).some((tool) => tool.name === 'doc_split'),
      ).toBe(false);
    }

    const root = await createRoot('direct.py', 'VALUE = 1\nVALUE = 2', 'py');
    await expect(
      handleToolCall(
        'doc_split',
        { nodeId: root.id, mode: 'lines', lineNumbers: [1] },
        contextManager,
        'coding',
      ),
    ).rejects.toThrow('not available in TOOL_MODE');
  });

  it('rejects occupied nodes and obsolete split modes without changing topology', async () => {
    const root = await createRoot('occupied.py', 'ROOT = 1', 'py');
    const commitsBefore = sqlite.getRecentCommits().length;
    const child = getGraphStore().createDocumentNode({
      title: 'Existing unit',
      content: 'EXISTING = 1',
      level: 'section',
      parentId: root.id,
    });
    const nodesBefore = getGraphStore()
      .getAll()
      .nodes.map((node) => node.id)
      .sort();
    const edgesBefore = getGraphStore()
      .getAll()
      .edges.map((edge) => edge.id)
      .sort();

    const occupied = await split({
      nodeId: root.id,
      mode: 'lines',
      lineNumbers: [1],
    });
    expect(occupied.success).toBe(false);
    expect(occupied.errors?.[0]?.error).toContain(
      'DOCUMENT_SPLIT_REQUIRES_LEAF',
    );

    const obsolete = await split({
      nodeId: child.id,
      mode: 'lines',
      lineNumbers: [1],
      asFiles: true,
    });
    expect(obsolete.success).toBe(false);
    expect(obsolete.errors?.[0]?.error).toContain('UNSUPPORTED_SPLIT_MODE');
    expect(
      getGraphStore()
        .getAll()
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(nodesBefore);
    expect(
      getGraphStore()
        .getAll()
        .edges.map((edge) => edge.id)
        .sort(),
    ).toEqual(edgesBefore);
    expect(sqlite.getRecentCommits().length - commitsBefore).toBe(0);
  });

  it('rejects invalid modes, boundaries, one-section results, and reserved blocks without mutation', async () => {
    const root = await createRoot(
      'validation.py',
      'FIRST = 1\nSECOND = 2\nTHIRD = 3',
      'py',
    );
    const oneSectionRoot = await createRoot(
      'one-section.md',
      '# Only\nbody',
      'md',
    );
    const commitsBefore = sqlite.getRecentCommits().length;
    const nodesBefore = getGraphStore()
      .getAll()
      .nodes.map((node) => node.id)
      .sort();
    const edgesBefore = getGraphStore()
      .getAll()
      .edges.map((edge) => edge.id)
      .sort();

    for (const params of [
      { nodeId: root.id, mode: 'characters' },
      { nodeId: root.id, mode: 'lines', lineNumbers: [0] },
      { nodeId: root.id, mode: 'lines', lineNumbers: [1.5] },
      { nodeId: root.id, mode: 'lines', lineNumbers: [1, 1] },
      { nodeId: oneSectionRoot.id, mode: 'headers' },
    ]) {
      const result = await split(params);
      expect(result.success).toBe(false);
    }

    const reserved = withReservedThinkingVisibility(true, () =>
      getGraphStore().createDocumentNode({
        title: 'Reserved Reader block',
        content: 'private block line one\nprivate block line two',
        trigger: 'thinking',
        level: 'document',
        isDocRoot: true,
        fileType: 'thinking',
      }),
    );
    const reservedResult = await split(
      { nodeId: reserved.id, mode: 'lines', lineNumbers: [1] },
      'synthetic_reader',
    );
    expect(reservedResult.success).toBe(false);
    expect(reservedResult.errors?.[0]?.error).toContain(
      'RESERVED_DOCUMENT_SPLIT_NOT_ALLOWED',
    );

    expect(
      getGraphStore()
        .getAll()
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(nodesBefore);
    expect(
      getGraphStore()
        .getAll()
        .edges.map((edge) => edge.id)
        .sort(),
    ).toEqual(edgesBefore);
    expect(
      withReservedThinkingVisibility(true, () =>
        getGraphStore().getNode(reserved.id),
      ),
    ).toMatchObject({
      active: true,
      content: 'private block line one\nprivate block line two',
    });
    expect(sqlite.getRecentCommits().length - commitsBefore).toBe(0);
  });
});
