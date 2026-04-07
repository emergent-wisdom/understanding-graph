import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { type GraphNodeData, getGraphStore } from './GraphStore.js';

export interface DocumentWriterOptions {
  outputDir: string;
  includeMetadata?: boolean;
  watchInterval?: number; // ms between checks for changes
  compileLatex?: boolean; // auto-compile .tex files to PDF
}

export interface WriteResult {
  rootId: string;
  outputPath: string;
  nodeCount: number;
  updatedAt: string;
  fileType: string;
  pdfPath?: string; // set if LaTeX was compiled to PDF
  compileError?: string; // set if LaTeX compilation failed
}

// Supported file types and their extensions
const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  md: '.md',
  markdown: '.md',
  py: '.py',
  python: '.py',
  js: '.js',
  javascript: '.js',
  ts: '.ts',
  typescript: '.ts',
  txt: '.txt',
  text: '.txt',
  json: '.json',
  yaml: '.yaml',
  yml: '.yml',
  html: '.html',
  css: '.css',
  sql: '.sql',
  sh: '.sh',
  bash: '.sh',
  tex: '.tex',
  latex: '.tex',
};

/**
 * DocumentWriter - Generates files from document nodes
 *
 * Supports multiple file types:
 * - Markdown (.md) - default, with headings based on depth
 * - Code files (.py, .js, .ts, etc.) - content directly
 * - Plain text (.txt) - simple text output
 *
 * Can run in watch mode to automatically update on changes.
 */
export class DocumentWriter {
  private outputDir: string;
  private includeMetadata: boolean;
  private watchInterval: number;
  private compileLatex: boolean;
  private watchers: Map<string, NodeJS.Timeout> = new Map();
  private lastHashes: Map<string, string> = new Map();

  constructor(options: DocumentWriterOptions) {
    this.outputDir = options.outputDir;
    this.includeMetadata = options.includeMetadata ?? false;
    this.watchInterval = options.watchInterval ?? 1000;
    this.compileLatex = options.compileLatex ?? true; // default ON

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Write companion .bib files referenced in LaTeX content
   * Looks for \bibliography{name} and finds matching nodes by exact name
   */
  private writeBibFiles(texPath: string, texContent: string): string[] {
    const dir = path.dirname(texPath);
    const writtenFiles: string[] = [];

    // Find \bibliography{...} references
    const bibMatch = texContent.match(/\\bibliography\{([^}]+)\}/);
    if (!bibMatch) return writtenFiles;

    const bibNames = bibMatch[1].split(',').map((n) => n.trim());
    const store = getGraphStore();

    for (const bibName of bibNames) {
      // Look for a node with this exact name (with or without .bib extension)
      // Use findNodeByName for exact case-insensitive match
      const bibNode =
        store.findNodeByName(`${bibName}.bib`) || store.findNodeByName(bibName);

      if (bibNode?.content) {
        const bibPath = path.join(dir, `${bibName}.bib`);
        fs.writeFileSync(bibPath, bibNode.content, 'utf-8');
        writtenFiles.push(bibPath);
        console.error(`Wrote bibliography: ${bibPath}`);
      } else {
        console.warn(
          `Bibliography file not found in graph: ${bibName}.bib or ${bibName}`,
        );
      }
    }

    return writtenFiles;
  }

  /**
   * Compile a LaTeX file to PDF using pdflatex + bibtex
   * Full sequence: pdflatex → bibtex → pdflatex → pdflatex
   */
  private compileLatexToPdf(
    texPath: string,
  ): { pdfPath: string } | { error: string } {
    const dir = path.dirname(texPath);
    const basename = path.basename(texPath, '.tex');
    const pdfPath = path.join(dir, `${basename}.pdf`);

    try {
      // Read tex content to check for bibliography
      const texContent = fs.readFileSync(texPath, 'utf-8');
      const hasBibliography = /\\bibliography\{/.test(texContent);

      // Write companion .bib files if needed
      if (hasBibliography) {
        this.writeBibFiles(texPath, texContent);
      }

      const options = { cwd: dir, stdio: 'pipe' as const, timeout: 60000 };

      // First pdflatex pass - creates .aux file with citation references
      execSync(`pdflatex -interaction=nonstopmode "${basename}.tex"`, options);

      // Run bibtex if bibliography is present
      if (hasBibliography) {
        try {
          execSync(`bibtex "${basename}"`, options);
        } catch (bibErr) {
          // bibtex warnings are common, only fail on real errors
          console.warn(`bibtex warning: ${bibErr}`);
        }
      }

      // Second and third pdflatex passes - resolves references
      execSync(`pdflatex -interaction=nonstopmode "${basename}.tex"`, options);
      execSync(`pdflatex -interaction=nonstopmode "${basename}.tex"`, options);

      if (fs.existsSync(pdfPath)) {
        // Clean up auxiliary files (including bibtex files)
        const auxFiles = [
          '.aux',
          '.log',
          '.out',
          '.toc',
          '.lof',
          '.lot',
          '.bbl',
          '.blg',
        ];
        for (const ext of auxFiles) {
          const auxPath = path.join(dir, `${basename}${ext}`);
          if (fs.existsSync(auxPath)) {
            fs.unlinkSync(auxPath);
          }
        }
        return { pdfPath };
      }
      return { error: 'PDF not generated' };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Try to extract useful error from log file
      const logPath = path.join(dir, `${basename}.log`);
      if (fs.existsSync(logPath)) {
        const log = fs.readFileSync(logPath, 'utf-8');
        const errorMatch = log.match(/^!.*$/m);
        if (errorMatch) {
          return { error: `LaTeX error: ${errorMatch[0]}` };
        }
      }
      return { error: `pdflatex failed: ${error.slice(0, 200)}` };
    }
  }

  /**
   * Get file extension for a file type
   */
  private getExtension(fileType: string | null): string {
    if (!fileType) return '.md';
    const normalized = fileType.toLowerCase().replace(/^\./, '');
    return FILE_TYPE_EXTENSIONS[normalized] || `.${normalized}`;
  }

  /**
   * Check if file type is markdown
   */
  private isMarkdown(fileType: string | null): boolean {
    const normalized = fileType?.toLowerCase().replace(/^\./, '') || 'md';
    return normalized === 'md' || normalized === 'markdown';
  }

  /**
   * Check if file type is code (needs raw content output)
   */
  private isCode(fileType: string | null): boolean {
    const codeTypes = [
      'py',
      'python',
      'js',
      'javascript',
      'ts',
      'typescript',
      'sh',
      'bash',
      'sql',
      'css',
      'html',
      'json',
      'yaml',
      'yml',
      'tex',
      'latex',
    ];
    const normalized = fileType?.toLowerCase().replace(/^\./, '') || '';
    return codeTypes.includes(normalized);
  }

  /**
   * Generate markdown content from a flattened document
   */
  private generateMarkdown(
    nodes: Array<{ node: GraphNodeData; depth: number }>,
    rootNode: GraphNodeData,
  ): string {
    const lines: string[] = [];

    // Title from root node
    lines.push(`# ${rootNode.title}`);
    lines.push('');

    if (this.includeMetadata) {
      lines.push(`> Generated: ${new Date().toISOString()}`);
      lines.push(`> Nodes: ${nodes.length}`);
      lines.push('');
    }

    // Root summary/content
    if (rootNode.summary) {
      lines.push(`*${rootNode.summary}*`);
      lines.push('');
    }
    if (rootNode.content) {
      lines.push(rootNode.content);
      lines.push('');
    }

    // Process children (skip root which is depth 0)
    for (const { node, depth } of nodes) {
      if (depth === 0) continue; // Skip root, already handled

      // Heading level based on depth (depth 1 = ##, depth 2 = ###, etc.)
      const headingLevel = Math.min(depth + 1, 6); // Max h6
      const heading = '#'.repeat(headingLevel);

      // Node title
      if (node.title && node.title !== node.content?.slice(0, 50)) {
        lines.push(`${heading} ${node.title}`);
        lines.push('');
      }

      // Node content - prefer content, fall back to understanding
      if (node.content) {
        lines.push(node.content);
        lines.push('');
      } else if (node.understanding) {
        lines.push(node.understanding);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate code/raw content from a flattened document
   * For code files, we concatenate content directly
   */
  private generateCode(
    nodes: Array<{ node: GraphNodeData; depth: number }>,
    rootNode: GraphNodeData,
    fileType: string,
  ): string {
    const lines: string[] = [];
    const ext = this.getExtension(fileType);

    // Add file header comment based on file type
    const commentStyle = this.getCommentStyle(ext);

    // Always add DO NOT EDIT header with source node ID
    if (commentStyle) {
      lines.push(
        `${commentStyle.start} DO NOT EDIT DIRECTLY - Generated from graph node ${rootNode.id}`,
      );
      lines.push(
        `${commentStyle.start} To modify, use doc_revise on the source node in the graph`,
      );
      if (this.includeMetadata) {
        lines.push(
          `${commentStyle.start} Generated: ${new Date().toISOString()}`,
        );
      }
      if (commentStyle.end) {
        lines.push(commentStyle.end);
      }
      lines.push('');
    }

    // Root content first
    if (rootNode.content) {
      lines.push(rootNode.content);
    }

    // Process children - just concatenate content
    for (const { node, depth } of nodes) {
      if (depth === 0) continue; // Skip root, already handled

      if (node.content) {
        // Add a newline separator if there's content before
        if (lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push('');
        }
        lines.push(node.content);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate plain text from a flattened document
   */
  private generateText(
    nodes: Array<{ node: GraphNodeData; depth: number }>,
    rootNode: GraphNodeData,
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(rootNode.title.toUpperCase());
    lines.push('='.repeat(rootNode.title.length));
    lines.push('');

    if (rootNode.summary) {
      lines.push(rootNode.summary);
      lines.push('');
    }
    if (rootNode.content) {
      lines.push(rootNode.content);
      lines.push('');
    }

    // Process children
    for (const { node, depth } of nodes) {
      if (depth === 0) continue;

      // Indent based on depth
      const indent = '  '.repeat(depth - 1);

      if (node.title) {
        lines.push(`${indent}${node.title}`);
      }

      if (node.content) {
        const contentLines = node.content.split('\n');
        for (const line of contentLines) {
          lines.push(`${indent}${line}`);
        }
        lines.push('');
      } else if (node.understanding) {
        lines.push(`${indent}${node.understanding}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get comment style for a file extension
   */
  private getCommentStyle(ext: string): { start: string; end?: string } | null {
    switch (ext) {
      case '.py':
      case '.sh':
      case '.yaml':
      case '.yml':
        return { start: '#' };
      case '.js':
      case '.ts':
      case '.css':
        return { start: '//' };
      case '.html':
        return { start: '<!--', end: '-->' };
      case '.sql':
        return { start: '--' };
      case '.tex':
        return { start: '%' };
      default:
        return null;
    }
  }

  /**
   * Resolve soft references in node content/text fields
   * Creates copies to avoid mutating the original nodes
   */
  private resolveNodeReferences(
    nodes: Array<{ node: GraphNodeData; depth: number }>,
    rootNode: GraphNodeData,
    store: ReturnType<typeof getGraphStore>,
  ): {
    resolvedNodes: Array<{ node: GraphNodeData; depth: number }>;
    resolvedRoot: GraphNodeData;
  } {
    const resolveNode = (node: GraphNodeData): GraphNodeData => ({
      ...node,
      title: store.resolveReferences(node.title),
      content: node.content ? store.resolveReferences(node.content) : null,
      understanding: node.understanding
        ? store.resolveReferences(node.understanding)
        : null,
      summary: node.summary ? store.resolveReferences(node.summary) : null,
    });

    return {
      resolvedNodes: nodes.map(({ node, depth }) => ({
        node: resolveNode(node),
        depth,
      })),
      resolvedRoot: resolveNode(rootNode),
    };
  }

  /**
   * Generate content based on file type
   */
  private generateContent(
    nodes: Array<{ node: GraphNodeData; depth: number }>,
    rootNode: GraphNodeData,
  ): string {
    const store = getGraphStore();
    const fileType = rootNode.fileType;

    // Resolve soft references before generating
    const { resolvedNodes, resolvedRoot } = this.resolveNodeReferences(
      nodes,
      rootNode,
      store,
    );

    if (this.isMarkdown(fileType)) {
      return this.generateMarkdown(resolvedNodes, resolvedRoot);
    } else if (this.isCode(fileType)) {
      return this.generateCode(resolvedNodes, resolvedRoot, fileType || 'txt');
    } else {
      return this.generateText(resolvedNodes, resolvedRoot);
    }
  }

  /**
   * Compute a simple hash of document content to detect changes
   */
  private computeHash(
    nodes: Array<{ node: GraphNodeData; depth: number }>,
  ): string {
    const content = nodes
      .map(
        (n) =>
          `${n.node.id}:${n.node.version}:${n.node.updatedAt || n.node.createdAt}`,
      )
      .join('|');
    // Simple hash - just use length + first/last chars for quick comparison
    return `${content.length}-${content.slice(0, 50)}-${content.slice(-50)}`;
  }

  /**
   * Generate a safe filename from document title and file type
   */
  private generateFilename(title: string, fileType: string | null): string {
    const ext = this.getExtension(fileType);
    // Strip existing extension from title if it matches the fileType
    // e.g., "myfile.tex" with fileType="tex" should become "myfile.tex" not "myfile-tex.tex"
    let cleanTitle = title;
    if (ext) {
      const extPattern = new RegExp(`\\.${fileType}$`, 'i');
      cleanTitle = title.replace(extPattern, '');
    }
    const baseName = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    return `${baseName}${ext}`;
  }

  /**
   * Read a document's assembled content without writing to file
   */
  readDocument(
    rootId: string,
  ): { content: string; nodeCount: number; fileType: string } | null {
    const store = getGraphStore();
    const rootNode = store.getNode(rootId);

    if (!rootNode) {
      return null;
    }

    if (!rootNode.isDocRoot && !rootNode.content) {
      return null;
    }

    const flattened = store.flattenDocument(rootId);
    const content = this.generateContent(flattened, rootNode);

    return {
      content,
      nodeCount: flattened.length,
      fileType: rootNode.fileType || 'md',
    };
  }

  /**
   * Write a single document to file
   */
  writeDocument(rootId: string): WriteResult | null {
    const store = getGraphStore();
    const rootNode = store.getNode(rootId);

    if (!rootNode) {
      console.error(`Document root not found: ${rootId}`);
      return null;
    }

    if (!rootNode.isDocRoot && !rootNode.content) {
      console.error(`Node ${rootId} is not a document root`);
      return null;
    }

    const flattened = store.flattenDocument(rootId);
    const content = this.generateContent(flattened, rootNode);
    const filename = this.generateFilename(rootNode.title, rootNode.fileType);
    const outputPath = path.join(this.outputDir, filename);

    fs.writeFileSync(outputPath, content, 'utf-8');

    const result: WriteResult = {
      rootId,
      outputPath,
      nodeCount: flattened.length,
      updatedAt: new Date().toISOString(),
      fileType: rootNode.fileType || 'md',
    };

    // Auto-compile LaTeX to PDF if enabled
    const ext = this.getExtension(rootNode.fileType);
    if (this.compileLatex && ext === '.tex') {
      console.error(`Compiling LaTeX: ${outputPath}`);
      const compileResult = this.compileLatexToPdf(outputPath);
      if ('pdfPath' in compileResult) {
        result.pdfPath = compileResult.pdfPath;
        console.error(`PDF generated: ${compileResult.pdfPath}`);
      } else {
        result.compileError = compileResult.error;
        console.error(`LaTeX compilation failed: ${compileResult.error}`);
      }
    }

    return result;
  }

  /**
   * Write all documents (all document roots) to files
   */
  writeAllDocuments(): WriteResult[] {
    const store = getGraphStore();
    const roots = store.getDocumentRoots();
    const results: WriteResult[] = [];

    for (const root of roots) {
      const result = this.writeDocument(root.id);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Check if a document has changed and needs regeneration
   */
  private hasChanged(rootId: string): boolean {
    const store = getGraphStore();
    const flattened = store.flattenDocument(rootId);
    const currentHash = this.computeHash(flattened);
    const lastHash = this.lastHashes.get(rootId);

    if (currentHash !== lastHash) {
      this.lastHashes.set(rootId, currentHash);
      return true;
    }
    return false;
  }

  /**
   * Start watching a document for changes
   */
  watchDocument(
    rootId: string,
    onChange?: (result: WriteResult) => void,
  ): void {
    if (this.watchers.has(rootId)) {
      console.error(`Already watching document: ${rootId}`);
      return;
    }

    // Initial write
    const initialResult = this.writeDocument(rootId);
    if (initialResult) {
      this.lastHashes.set(
        rootId,
        this.computeHash(getGraphStore().flattenDocument(rootId)),
      );
      onChange?.(initialResult);
    }

    // Set up polling
    const interval = setInterval(() => {
      if (this.hasChanged(rootId)) {
        const result = this.writeDocument(rootId);
        if (result) {
          console.error(`Document updated: ${result.outputPath}`);
          onChange?.(result);
        }
      }
    }, this.watchInterval);

    this.watchers.set(rootId, interval);
    console.error(
      `Watching document: ${rootId} (interval: ${this.watchInterval}ms)`,
    );
  }

  /**
   * Start watching all documents
   */
  watchAllDocuments(onChange?: (result: WriteResult) => void): void {
    const store = getGraphStore();
    const roots = store.getDocumentRoots();

    for (const root of roots) {
      this.watchDocument(root.id, onChange);
    }

    // Also check for new document roots periodically
    setInterval(() => {
      const currentRoots = store.getDocumentRoots();
      for (const root of currentRoots) {
        if (!this.watchers.has(root.id)) {
          console.error(`New document detected: ${root.title}`);
          this.watchDocument(root.id, onChange);
        }
      }
    }, this.watchInterval * 5); // Check less frequently for new docs
  }

  /**
   * Stop watching a document
   */
  stopWatching(rootId: string): void {
    const interval = this.watchers.get(rootId);
    if (interval) {
      clearInterval(interval);
      this.watchers.delete(rootId);
      this.lastHashes.delete(rootId);
      console.error(`Stopped watching document: ${rootId}`);
    }
  }

  /**
   * Stop watching all documents
   */
  stopAll(): void {
    for (const [rootId] of this.watchers) {
      this.stopWatching(rootId);
    }
  }

  /**
   * Get list of supported file types
   */
  static getSupportedTypes(): string[] {
    return Object.keys(FILE_TYPE_EXTENSIONS);
  }
}

// Factory function for easy instantiation
export function createDocumentWriter(
  outputDir: string,
  options?: Partial<DocumentWriterOptions>,
): DocumentWriter {
  return new DocumentWriter({
    outputDir,
    ...options,
  });
}
