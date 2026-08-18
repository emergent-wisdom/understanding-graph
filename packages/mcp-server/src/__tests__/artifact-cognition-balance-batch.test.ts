import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactCognitionBalanceAssessment } from '../artifact-cognition-balance.js';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';
import { docOp } from './support/doc-batch.js';

let temporaryDirectory: string;
let contextManager: ContextManager;

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ug-artifact-cognition-balance-'),
  );
  const projectDirectory = path.join(temporaryDirectory, 'projects');
  fs.mkdirSync(path.join(projectDirectory, 'balance-test'), {
    recursive: true,
  });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDirectory);
  sqlite.initAllDatabases(projectDirectory);
  if (!sqlite.getLoadedProjectIds().includes('balance-test')) {
    sqlite.initDatabase(path.join(projectDirectory, 'balance-test'));
  }
  sqlite.setCurrentProject('balance-test');
  await contextManager.switchProject('balance-test');
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockResolvedValue();
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('graph_batch artifact/cognition advisory', () => {
  it('surfaces the neutral diagnostic for graph-native code, not only prose', async () => {
    const operations: Array<{
      tool: string;
      params: Record<string, unknown>;
    }> = [
      {
        tool: 'doc_create',
        params: {
          title: 'service.ts',
          content: 'export type Input = string',
          fileType: 'ts',
          isDocRoot: true,
          level: 'document',
        },
      },
    ];
    for (let index = 1; index < 8; index++) {
      operations.push({
        tool: 'doc_create',
        params: {
          title: `function-${index}`,
          content: `export function function${index}() { return ${index} }`,
          parentId: '$0.id',
          afterId: index === 1 ? undefined : `$${index - 1}.id`,
          level: 'section',
        },
      });
    }

    const result = (await handleToolCall(
      'graph_batch',
      {
        operations,
        agent_name: 'test-agent',
        commit_message: 'Create addressable code responsibilities',
        ignoreWarnings: true,
      },
      contextManager,
      'coding',
    )) as {
      success: boolean;
      artifactCognitionBalance?: ArtifactCognitionBalanceAssessment;
      navigation?: {
        focusNodeIds: string[];
        suggestedCall: {
          tool: string;
          arguments: { workflow: string; focusNodeIds: string[] };
        };
      };
    };

    expect(result.success).toBe(true);
    expect(result.artifactCognitionBalance?.metrics).toMatchObject({
      documentNodes: 8,
      cognitiveNodes: 0,
    });
    expect(
      result.artifactCognitionBalance?.advisories.map((item) => item.code),
    ).toEqual(['artifact_structure_outpaces_cognition']);
    expect(JSON.stringify(result.artifactCognitionBalance)).not.toMatch(
      /scene|manuscript|prose/i,
    );
    expect(result.artifactCognitionBalance?.advisories[0]?.message).toMatch(
      /not a target or quota/i,
    );
    expect(result.navigation?.focusNodeIds).toHaveLength(8);
    expect(result.navigation?.suggestedCall).toMatchObject({
      tool: 'graph_suggest_next',
      arguments: {
        workflow: 'coding',
        focusNodeIds: result.navigation?.focusNodeIds,
      },
    });
  });

  it('also surfaces when a document grows one unit at a time', async () => {
    const root = await docOp<{ id: string }>(
      contextManager,
      'writing',
      'doc_create',
      {
        title: 'Incrementally built report',
        content: 'Report root',
        fileType: 'md',
        isDocRoot: true,
        level: 'document',
      },
      'Create the report root',
    );
    let afterId: string | undefined;
    let finalResult:
      | {
          artifactCognitionBalance?: ArtifactCognitionBalanceAssessment;
        }
      | undefined;
    for (let index = 1; index < 8; index++) {
      finalResult = await docOp<{
        id: string;
        artifactCognitionBalance?: ArtifactCognitionBalanceAssessment;
      }>(
        contextManager,
        'writing',
        'doc_create',
        {
          title: `Evidence passage ${index}`,
          content: `Evidence ${index}`,
          parentId: root.id,
          afterId,
          level: 'paragraph',
        },
        `Add evidence passage ${index}`,
      );
      afterId = (finalResult as { id: string }).id;
    }

    expect(finalResult?.artifactCognitionBalance?.metrics).toMatchObject({
      documentNodes: 8,
      cognitiveNodes: 0,
    });
    expect(
      finalResult?.artifactCognitionBalance?.advisories.map(
        (item) => item.code,
      ),
    ).toContain('artifact_structure_outpaces_cognition');
  });
});
