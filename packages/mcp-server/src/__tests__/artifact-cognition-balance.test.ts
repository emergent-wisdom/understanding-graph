import type {
  GraphEdgeData,
  GraphNodeData,
} from '@emergent-wisdom/understanding-graph-core';
import { describe, expect, it } from 'vitest';
import { assessArtifactCognitionBalance } from '../artifact-cognition-balance.js';

function node(
  id: string,
  kind: 'document' | 'cognitive' | 'reserved',
  content: string | null = null,
): GraphNodeData {
  return {
    id,
    title: id,
    trigger:
      kind === 'reserved'
        ? 'thinking'
        : kind === 'cognitive'
          ? 'analysis'
          : 'foundation',
    why: null,
    understanding: kind === 'cognitive' ? `Understanding ${id}` : null,
    sourceElements: null,
    validated: null,
    active: true,
    version: 1,
    revisions: [],
    conversationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    archivedAt: null,
    archiveReason: null,
    embedding: null,
    references: null,
    content,
    summary: null,
    level: kind === 'cognitive' ? null : 'paragraph',
    isDocRoot: false,
    fileType: kind === 'reserved' ? 'thinking' : null,
    metadata: {},
  };
}

function edge(
  id: string,
  fromId: string,
  toId: string,
  type: string,
): GraphEdgeData {
  return {
    id,
    fromId,
    toId,
    from: fromId,
    to: toId,
    type,
    explanation: null,
    why: 'Fixture relationship',
    active: true,
    version: 1,
    revisions: [],
    conversationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
  };
}

describe('artifact/cognition balance advisory', () => {
  it('does not turn a small document scaffold into a quota', () => {
    const nodes = Array.from({ length: 7 }, (_, index) =>
      node(`doc-${index}`, 'document', `Artifact ${index}`),
    );

    const result = assessArtifactCognitionBalance(nodes, []);

    expect(result.metrics).toMatchObject({
      documentNodes: 7,
      cognitiveNodes: 0,
      contentBearingLeaves: 7,
    });
    expect(result.advisories).toEqual([]);
  });

  it('notices a pronounced artifact-heavy shape while respecting strong local links', () => {
    const documents = Array.from({ length: 15 }, (_, index) =>
      node(`doc-${index}`, 'document', index < 4 ? null : `Passage ${index}`),
    );
    const cognition = Array.from({ length: 5 }, (_, index) =>
      node(`cog-${index}`, 'cognitive'),
    );
    const structuralEdges = [
      edge('contains-1', 'doc-0', 'doc-1', 'contains'),
      edge('contains-2', 'doc-0', 'doc-2', 'contains'),
      edge('contains-3', 'doc-0', 'doc-3', 'contains'),
    ];
    const provenanceEdges = documents
      .slice(4)
      .map((document, index) =>
        edge(
          `provenance-${index}`,
          document.id,
          cognition[index % cognition.length].id,
          'inspired_by',
        ),
      );

    const result = assessArtifactCognitionBalance(
      [...documents, ...cognition],
      [...structuralEdges, ...provenanceEdges],
    );

    expect(result.metrics).toMatchObject({
      documentNodes: 15,
      cognitiveNodes: 5,
      documentToCognitiveRatio: 3,
      contentBearingLeaves: 11,
      directlyLinkedContentLeaves: 11,
      directLinkRate: 1,
    });
    expect(result.advisories.map((item) => item.code)).toEqual([
      'artifact_structure_outpaces_cognition',
    ]);
    expect(result.advisories[0]?.message).toMatch(/not a target or quota/i);
    expect(result.advisories[0]?.message).toMatch(/add nothing/i);
  });

  it('notices sparse direct links independently of the document/node ratio', () => {
    const documents = Array.from({ length: 6 }, (_, index) =>
      node(`doc-${index}`, 'document', `Evidence ${index}`),
    );
    const cognition = Array.from({ length: 3 }, (_, index) =>
      node(`cog-${index}`, 'cognitive'),
    );

    const result = assessArtifactCognitionBalance(
      [...documents, ...cognition],
      [
        edge('linked', 'cog-0', 'doc-0', 'learned_from'),
        edge('structural-does-not-count', 'doc-1', 'cog-1', 'next'),
      ],
    );

    expect(result.metrics).toMatchObject({
      contentBearingLeaves: 6,
      directlyLinkedContentLeaves: 1,
      directLinkRate: 1 / 6,
    });
    expect(result.advisories.map((item) => item.code)).toEqual([
      'sparse_artifact_cognition_links',
    ]);
    expect(result.advisories[0]?.message).toMatch(
      /do not create notes or edges to improve this percentage/i,
    );
  });

  it('treats the 25% link boundary as descriptive sufficiency, not a target to exceed', () => {
    const documents = Array.from({ length: 8 }, (_, index) =>
      node(`doc-${index}`, 'document', `Artifact ${index}`),
    );
    const cognition = Array.from({ length: 3 }, (_, index) =>
      node(`cog-${index}`, 'cognitive'),
    );

    const result = assessArtifactCognitionBalance(
      [...documents, ...cognition],
      [
        edge('linked-1', 'doc-0', 'cog-0', 'expresses'),
        edge('linked-2', 'cog-1', 'doc-1', 'learned_from'),
      ],
    );

    expect(result.metrics.directLinkRate).toBe(0.25);
    expect(result.advisories).toEqual([]);
  });

  it('excludes reserved synthetic blocks and inactive graph state', () => {
    const reserved = Array.from({ length: 10 }, (_, index) =>
      node(`reserved-${index}`, 'reserved', `Synthetic ${index}`),
    );
    const inactive = node('inactive-document', 'document', 'Archived');
    inactive.active = false;

    const result = assessArtifactCognitionBalance(
      [node('ordinary-document', 'document', 'Current'), inactive, ...reserved],
      [edge('hidden-edge', 'reserved-0', 'ordinary-document', 'relates')],
    );

    expect(result.metrics).toMatchObject({
      documentNodes: 1,
      cognitiveNodes: 0,
      contentBearingLeaves: 1,
      directlyLinkedContentLeaves: 0,
    });
    expect(result.advisories).toEqual([]);
  });

  it('does not let references, libraries, or random inputs satisfy the understanding side', () => {
    const documents = Array.from({ length: 8 }, (_, index) =>
      node(`doc-${index}`, 'document', `Evidence ${index}`),
    );
    const reference = node('reference', 'cognitive');
    reference.trigger = 'reference';
    const library = node('library', 'cognitive');
    library.trigger = 'library';
    const randomness = node('randomness', 'cognitive');
    randomness.trigger = 'randomness';

    const result = assessArtifactCognitionBalance(
      [...documents, reference, library, randomness],
      [edge('reference-link', 'doc-0', reference.id, 'relates')],
    );

    expect(result.metrics).toMatchObject({
      documentNodes: 8,
      cognitiveNodes: 0,
      directlyLinkedContentLeaves: 0,
    });
    expect(result.advisories.map((item) => item.code)).toEqual([
      'artifact_structure_outpaces_cognition',
    ]);
  });
});
