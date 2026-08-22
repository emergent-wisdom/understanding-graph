/**
 * EmbeddingService - Generate and manage semantic embeddings for nodes
 * Uses @huggingface/transformers for local embedding generation
 */

// Dynamic import for transformers.js (ESM)
// biome-ignore lint/suspicious/noExplicitAny: transformers.js types are dynamic
let pipeline: any = null;
// biome-ignore lint/suspicious/noExplicitAny: transformers.js types are dynamic
let embeddingPipeline: any = null;

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'; // 384 dimensions, fast, good quality
const EMBEDDING_DIM = 384;

/**
 * Initialize the embedding pipeline (lazy loading).
 *
 * `@huggingface/transformers` is a peerDependency so a fresh `npx -y understanding-graph`
 * install does NOT pay the ~160MB onnxruntime download cost up front. Embedding
 * features (semantic search, similar nodes, semantic gaps, backfill) are opt-in:
 * if you call them without installing the peer, you get a clear error pointing
 * at the install command instead of a cryptic "Cannot find module" stack.
 */
// biome-ignore lint/suspicious/noExplicitAny: transformers.js types are dynamic
async function getEmbeddingPipeline(): Promise<any> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  if (!pipeline) {
    try {
      // Keep the optional peer out of the default install and developer audit.
      // A variable specifier also lets this package compile when the peer is
      // intentionally absent; callers who opt in still load the real module.
      const packageName = '@huggingface/transformers';
      const transformers = await import(packageName);
      pipeline = transformers.pipeline;
    } catch (err) {
      // Lead with the real error, not with a guess about its cause. This
      // message used to assert the peer dependency "is not installed" for
      // every failure. It was installed; a broken native dependency of its
      // own (sharp, for the wrong platform) was the actual fault, and the
      // truth was appended at the tail where it went unread. A confident
      // wrong headline costs more than no diagnosis: it sends the reader to
      // reinstall a package that is already there.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        'Embedding features (graph_semantic_search, graph_similar, ' +
          'graph_semantic_gaps, graph_backfill_embeddings) could not load the ' +
          `optional @huggingface/transformers peer dependency. Load error: ${reason}. ` +
          'If the package is genuinely missing, install it in the same local project ' +
          'as understanding-graph so Node can resolve both from one dependency tree. ' +
          'A separate global install does not reliably satisfy an npx-launched package. ' +
          'If it is already installed, the ' +
          'fault is usually one of ITS native dependencies built for another ' +
          'platform — check the load error above before reinstalling anything. ' +
          'For keyword-only search meanwhile, use graph_search_metadata or ' +
          'graph_find_by_trigger.',
      );
    }
  }

  console.error(`[EmbeddingService] Loading model ${MODEL_NAME}...`);
  embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME, {
    dtype: 'q8', // Use an 8-bit model for speed and size
  });
  console.error(`[EmbeddingService] Model loaded successfully`);

  return embeddingPipeline;
}

/**
 * Generate embedding for a text string
 * @param text - The text to embed
 * @returns Float32Array of embedding values
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();

  // Truncate very long text to avoid memory issues
  const truncatedText = text.slice(0, 8000);

  const output = await pipe(truncatedText, {
    pooling: 'mean',
    normalize: true,
  });

  // Convert to Float32Array
  return new Float32Array(output.data);
}

/**
 * Generate embedding for a node (combines title, understanding, why)
 * @param node - Object with title, understanding, and why fields
 * @returns Float32Array of embedding values
 */
export async function generateNodeEmbedding(node: {
  title: string;
  understanding?: string | null;
  why?: string | null;
}): Promise<Float32Array> {
  // Combine fields for richer semantic representation
  const parts = [node.title];
  if (node.understanding) parts.push(node.understanding);
  if (node.why) parts.push(node.why);

  const combinedText = parts.join(' ');
  return generateEmbedding(combinedText);
}

/**
 * Convert Float32Array to Buffer for SQLite storage
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Convert Buffer from SQLite back to Float32Array
 */
export function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Find k nearest neighbors by cosine similarity
 */
export function findNearestNeighbors(
  queryEmbedding: Float32Array,
  candidates: Array<{ id: string; embedding: Float32Array }>,
  k: number = 10,
): Array<{ id: string; similarity: number }> {
  const scored = candidates.map((c) => ({
    id: c.id,
    similarity: cosineSimilarity(queryEmbedding, c.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, k);
}

/**
 * Get embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}

/**
 * Check if model is loaded
 */
export function isModelLoaded(): boolean {
  return embeddingPipeline !== null;
}

/**
 * Preload the model (call at startup to avoid first-query delay)
 */
export async function preloadModel(): Promise<void> {
  await getEmbeddingPipeline();
}
