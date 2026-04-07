/**
 * EmbeddingService - Generate and manage semantic embeddings for nodes
 * Uses @xenova/transformers for local embedding generation
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
 * Initialize the embedding pipeline (lazy loading)
 */
// biome-ignore lint/suspicious/noExplicitAny: transformers.js types are dynamic
async function getEmbeddingPipeline(): Promise<any> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  if (!pipeline) {
    const transformers = await import('@xenova/transformers');
    pipeline = transformers.pipeline;
  }

  console.error(`[EmbeddingService] Loading model ${MODEL_NAME}...`);
  embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME, {
    quantized: true, // Use quantized model for speed
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
