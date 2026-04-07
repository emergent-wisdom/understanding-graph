import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeAllDatabases, getDb } from '../packages/core/src/database/sqlite.js';
import { GraphStore } from '../packages/core/src/services/GraphStore.js';
import { generateEmbedding, findNearestNeighbors } from '../packages/core/src/services/EmbeddingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const projectPath = path.resolve(__dirname, '../projects/metamorphosis');
  
  console.log(`[Verification] Initializing database for project: ${projectPath}`);
  try {
    initDatabase(projectPath);
  } catch (error) {
    console.error(`[Error] Failed to initialize database: ${error}`);
    process.exit(1);
  }

  const graphStore = new GraphStore();
  console.log('[Verification] Loading graph...');
  const graph = graphStore.loadGraph();
  
  console.log(`[Verification] Graph loaded. Nodes: ${graph.order}, Edges: ${graph.size}`);

  // --- Phase 1: Verify "Ghost Node" (Graph Collision) ---
  console.log('\n--- Phase 1: Verify "Ghost Node" (Graph Collision) ---');
  
  const query = "I feel no fear";
  console.log(`[Search] semantic search for: "${query}"`);
  
  const queryEmbedding = await generateEmbedding(query);
  
  const candidates: Array<{ id: string; embedding: Float32Array }> = [];
  graph.forEachNode((nodeId, attributes) => {
    if (attributes.embedding) {
      candidates.push({ id: nodeId, embedding: attributes.embedding });
    }
  });

  const searchResults = findNearestNeighbors(queryEmbedding, candidates, 10);
  
  // Count unique names among top results
  const uniqueNames = new Set<string>();
  const topNodes: any[] = [];
  
  for (const result of searchResults) {
    const node = graph.getNodeAttributes(result.id);
    topNodes.push(node);
    if (result.similarity > 0.7) { // Threshold for relevance
        uniqueNames.add(node.title);
    }
  }

  console.log(`[Result] Found ${uniqueNames.size} unique titles in top ${searchResults.length} results.`);
  console.log(`[Result] Top matches:`);
  topNodes.slice(0, 3).forEach(n => console.log(` - [${n.id}] ${n.title.substring(0, 50)}...`));

  // Check for the "Hub" node
  let suspectNodeId: string | null = null;
  
  // Look for a node with the exact mantra text or very similar
  for (const node of topNodes) {
    if (node.title.includes("I feel no fear")) {
        suspectNodeId = node.id;
        break; // Take the top one
    }
  }

  if (suspectNodeId) {
    const degree = graph.degree(suspectNodeId);
    console.log(`[Hub Check] Suspect Node ID: ${suspectNodeId}`);
    console.log(`[Hub Check] Degree: ${degree}`);
    
    // Check connectivity (Page 1 vs Page 50 approximation - using creation time or neighbors)
    const neighbors = graph.neighbors(suspectNodeId);
    console.log(`[Hub Check] Neighbor count: ${neighbors.length}`);
    if (neighbors.length > 0) {
        const n1 = graph.getNodeAttributes(neighbors[0]);
        const nLast = graph.getNodeAttributes(neighbors[neighbors.length - 1]);
        console.log(` - Neighbor 1 created: ${n1.createdAt}`);
        console.log(` - Neighbor Last created: ${nLast.createdAt}`);
    }
    
    if (degree > 10) {
        console.log(`[Confirmed] Node ${suspectNodeId} has high degree (>10), likely a collision hub.`);
    }
  } else {
    console.log("[Hub Check] No direct match for mantra found in top results.");
  }

  // Check Node Count for "thinking"
  let thinkingCount = 0;
  graph.forEachNode((nodeId, attributes) => {
    if (attributes.trigger === 'thinking') {
        thinkingCount++;
    }
  });
  console.log(`[Count] Total 'thinking' nodes: ${thinkingCount}`);
  if (thinkingCount < 10) { // Arbitrary low number for 50 pages
    console.log(`[Confirmed] Low thinking node count (${thinkingCount}). Collision likely.`);
  }


  // --- Phase 2: Verify "Stifling" (Repetitive Content) ---
  console.log('\n--- Phase 2: Verify "Stifling" (Repetitive Content) ---');
  
  const footerQuery = "This matters for people because";
  console.log(`[Search] Checking for footer: "${footerQuery}"`);
  
  let footerCount = 0;
  const nodesWithFooter: string[] = [];
  
  graph.forEachNode((nodeId, attributes) => {
    if (attributes.trigger === 'thinking' && attributes.understanding && attributes.understanding.includes(footerQuery)) {
        footerCount++;
        nodesWithFooter.push(nodeId);
    }
  });

  console.log(`[Repetition] Nodes containing footer: ${footerCount} / ${thinkingCount}`);
  
  if (thinkingCount > 0 && footerCount / thinkingCount > 0.8) {
     console.log(`[Confirmed] High repetition factor (${(footerCount/thinkingCount*100).toFixed(1)}%).`);
  }

  // Compare 2 random thinking nodes
  if (nodesWithFooter.length >= 2) {
      const n1 = graph.getNodeAttributes(nodesWithFooter[0]);
      const n2 = graph.getNodeAttributes(nodesWithFooter[1]);
      console.log(`[Comparison] Node 1: ...${n1.understanding.slice(-50)}`);
      console.log(`[Comparison] Node 2: ...${n2.understanding.slice(-50)}`);
      
      if (n1.understanding.includes(footerQuery) && n2.understanding.includes(footerQuery)) {
          console.log(`[Confirmed] Identical footers detected.`);
      }
  }


  // --- Phase 3: Verify Metadata Health ---
  console.log('\n--- Phase 3: Verify Metadata Health ---');
  
  if (suspectNodeId) {
      const suspectNode = graph.getNodeAttributes(suspectNodeId);
      console.log(`[Metadata] Suspect Node Title Length: ${suspectNode.title.length}`);
      console.log(`[Metadata] Suspect Node Title: "${suspectNode.title}"`);

      if (suspectNode.title.length > 50) { // Heuristic
          console.log(`[Confirmed] Title is likely the entire mantra (too long).`);
      }
  }


  // --- Report ---
  console.log('\n--- Final Report ---');
  console.log(`* Unique Thinking Nodes Found: ${thinkingCount}`);
  console.log(`* Max Degree of Thinking Node: ${suspectNodeId ? graph.degree(suspectNodeId) : 'N/A'}`);
  console.log(`* Repetition Factor: ${thinkingCount > 0 ? (footerCount/thinkingCount > 0.8 ? 'High' : 'Low') : 'N/A'}`);
  console.log(`* Title Health: ${suspectNodeId && graph.getNodeAttributes(suspectNodeId).title.length > 50 ? 'Fail' : 'Pass'}`);

  closeAllDatabases();
}

main().catch(console.error);
