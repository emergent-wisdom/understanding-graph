import {
  type GraphEdgeData,
  type GraphNodeData,
  isReservedThinkingNode,
} from '@emergent-wisdom/understanding-graph-core';

const STRUCTURAL_EDGE_TYPES = new Set(['contains', 'next']);
const NON_UNDERSTANDING_TRIGGER_TYPES = new Set([
  'reference',
  'library',
  'randomness',
]);

export const ARTIFACT_COGNITION_BALANCE_THRESHOLDS = {
  minimumDocumentNodes: 8,
  documentToCognitiveRatio: 3,
  minimumContentLeaves: 6,
  sparseDirectLinkRate: 0.25,
} as const;

export type ArtifactCognitionAdvisoryCode =
  | 'artifact_structure_outpaces_cognition'
  | 'sparse_artifact_cognition_links';

export interface ArtifactCognitionAdvisory {
  code: ArtifactCognitionAdvisoryCode;
  message: string;
}

export interface ArtifactCognitionBalanceMetrics {
  documentNodes: number;
  cognitiveNodes: number;
  documentToCognitiveRatio: number | null;
  contentBearingLeaves: number;
  directlyLinkedContentLeaves: number;
  directLinkRate: number | null;
}

export interface ArtifactCognitionBalanceAssessment {
  metrics: ArtifactCognitionBalanceMetrics;
  advisories: ArtifactCognitionAdvisory[];
}

function isDocumentNode(node: GraphNodeData): boolean {
  return node.isDocRoot === true || Boolean(node.level);
}

/**
 * Describe a pronounced artifact/cognition imbalance without treating graph
 * shape as a quality score. Reserved synthetic Reader/CMP blocks are excluded
 * even when a caller happens to have synthetic visibility.
 */
export function assessArtifactCognitionBalance(
  nodes: readonly GraphNodeData[],
  edges: readonly GraphEdgeData[],
): ArtifactCognitionBalanceAssessment {
  const ordinaryNodes = nodes.filter(
    (node) => node.active !== false && !isReservedThinkingNode(node),
  );
  const ordinaryNodeIds = new Set(ordinaryNodes.map((node) => node.id));
  const ordinaryEdges = edges.filter(
    (edge) =>
      edge.active !== false &&
      ordinaryNodeIds.has(edge.fromId) &&
      ordinaryNodeIds.has(edge.toId),
  );

  const documentNodes = ordinaryNodes.filter(isDocumentNode);
  const cognitiveNodes = ordinaryNodes.filter(
    (node) =>
      !isDocumentNode(node) &&
      !NON_UNDERSTANDING_TRIGGER_TYPES.has(node.trigger || ''),
  );
  const documentIds = new Set(documentNodes.map((node) => node.id));
  const cognitiveIds = new Set(cognitiveNodes.map((node) => node.id));
  const documentParentIds = new Set(
    ordinaryEdges
      .filter(
        (edge) =>
          edge.type === 'contains' &&
          documentIds.has(edge.fromId) &&
          documentIds.has(edge.toId),
      )
      .map((edge) => edge.fromId),
  );
  const contentBearingLeaves = documentNodes.filter(
    (node) => Boolean(node.content?.trim()) && !documentParentIds.has(node.id),
  );
  const linkedContentLeafIds = new Set<string>();

  for (const edge of ordinaryEdges) {
    if (STRUCTURAL_EDGE_TYPES.has(edge.type)) continue;
    if (documentIds.has(edge.fromId) && cognitiveIds.has(edge.toId)) {
      linkedContentLeafIds.add(edge.fromId);
    }
    if (cognitiveIds.has(edge.fromId) && documentIds.has(edge.toId)) {
      linkedContentLeafIds.add(edge.toId);
    }
  }

  const directlyLinkedContentLeaves = contentBearingLeaves.filter((node) =>
    linkedContentLeafIds.has(node.id),
  ).length;
  const documentToCognitiveRatio =
    cognitiveNodes.length > 0
      ? documentNodes.length / cognitiveNodes.length
      : null;
  const directLinkRate =
    contentBearingLeaves.length > 0
      ? directlyLinkedContentLeaves / contentBearingLeaves.length
      : null;
  const metrics: ArtifactCognitionBalanceMetrics = {
    documentNodes: documentNodes.length,
    cognitiveNodes: cognitiveNodes.length,
    documentToCognitiveRatio,
    contentBearingLeaves: contentBearingLeaves.length,
    directlyLinkedContentLeaves,
    directLinkRate,
  };
  const advisories: ArtifactCognitionAdvisory[] = [];

  const artifactStructureOutpacesCognition =
    documentNodes.length >=
      ARTIFACT_COGNITION_BALANCE_THRESHOLDS.minimumDocumentNodes &&
    (cognitiveNodes.length === 0 ||
      documentNodes.length >=
        ARTIFACT_COGNITION_BALANCE_THRESHOLDS.documentToCognitiveRatio *
          cognitiveNodes.length);
  if (artifactStructureOutpacesCognition) {
    advisories.push({
      code: 'artifact_structure_outpaces_cognition',
      message:
        `The graph currently contains ${documentNodes.length} document/artifact nodes and ${cognitiveNodes.length} cognitive nodes. ` +
        'This may mean the artifact or evidence structure is developing faster than the understanding that could help future work resume it. ' +
        'Consider whether any genuine question, surprise, alternative, decision, evaluation, or correction has become important enough to preserve and connect to the exact artifact or evidence that prompted it. ' +
        'This is a descriptive notice, not a target or quota; if nothing genuinely became salient, add nothing.',
    });
  }

  const sparseArtifactCognitionLinks =
    cognitiveNodes.length > 0 &&
    contentBearingLeaves.length >=
      ARTIFACT_COGNITION_BALANCE_THRESHOLDS.minimumContentLeaves &&
    directLinkRate !== null &&
    directLinkRate < ARTIFACT_COGNITION_BALANCE_THRESHOLDS.sparseDirectLinkRate;
  if (sparseArtifactCognitionLinks) {
    const noun = contentBearingLeaves.length === 1 ? 'leaf' : 'leaves';
    const verb = directlyLinkedContentLeaves === 1 ? 'has' : 'have';
    advisories.push({
      code: 'sparse_artifact_cognition_links',
      message:
        `Only ${directlyLinkedContentLeaves} of ${contentBearingLeaves.length} content-bearing document ${noun} ${verb} a direct non-structural relationship with a cognitive node. ` +
        'Consider whether important local relationships between artifact or evidence and understanding are missing. ' +
        'Add only specific relationships you can explain; do not create notes or edges to improve this percentage.',
    });
  }

  return { metrics, advisories };
}
