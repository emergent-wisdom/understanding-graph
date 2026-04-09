import React, { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  type Commit,
  useCommits,
  useConversation,
  useDbStats,
  useDocumentRoots,
  useEdge,
  useGraph,
  useLoadProject,
  useNode,
} from '@/hooks/useApi'
import {
  agentColorsTailwind,
  edgeColorsTailwind,
  triggerColorsTailwind,
} from '@/lib/colors'
import { cn, resolveReferences } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'

// Clickable node link - clicking flies to that node in the graph
// Uses span instead of button to avoid nested button issues when rendered inside clickable content
// flyOnly: if true, only moves camera without changing selection (useful in modals)
function NodeLink({
  nodeId,
  flyOnly = false,
}: {
  nodeId: string
  flyOnly?: boolean
}) {
  const selectAndFlyToNode = useAppStore((s) => s.selectAndFlyToNode)
  const flyToNode = useAppStore((s) => s.flyToNode)

  const handleClick = flyOnly ? flyToNode : selectAndFlyToNode

  return (
    // biome-ignore lint/a11y/useSemanticElements: In-app navigation, not URL link
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        handleClick(nodeId)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          handleClick(nodeId)
        }
      }}
      className="text-accent hover:text-accent/80 hover:underline font-mono text-xs cursor-pointer"
      title={`Go to node ${nodeId}`}
    >
      {nodeId}
    </span>
  )
}

// Convert URLs and node IDs in text to clickable links
// flyOnly: if true, node links only move camera without changing selection
function Linkify({
  children,
  flyOnly = false,
}: {
  children: string | null | undefined
  flyOnly?: boolean
}) {
  if (!children) return null

  // Ensure we have a string (might receive number or other primitives)
  const text = typeof children === 'string' ? children : String(children)

  // Combined regex: URLs or node IDs (n_xxx or d_xxx)
  const combinedRegex = /(https?:\/\/[^\s<]+|\b[nd]_[a-zA-Z0-9]+\b)/g
  const urlRegex = /^https?:\/\//
  const nodeIdRegex = /^[nd]_[a-zA-Z0-9]+$/

  const parts = text.split(combinedRegex)

  return (
    <>
      {parts.map((part, i) => {
        // Use index as key - parts derived from static string split, order is stable
        const key = `${i}-${part.slice(0, 10).replace(/[^a-z0-9]/gi, '')}`

        if (urlRegex.test(part)) {
          return (
            <a
              key={key}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline break-all"
            >
              {part}
            </a>
          )
        }

        if (nodeIdRegex.test(part)) {
          return <NodeLink key={key} nodeId={part} flyOnly={flyOnly} />
        }

        return <Fragment key={key}>{part}</Fragment>
      })}
    </>
  )
}

// Cross-project reference component - clickable link to another project's node
function CrossProjectReference({
  project,
  nodeId,
  title,
}: {
  project: string
  nodeId: string
  title?: string
}) {
  const loadProject = useLoadProject()
  const { setCurrentProject, selectAndFlyToNode } = useAppStore()
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async () => {
    setIsLoading(true)
    try {
      // Load the target project
      const result = await loadProject.mutateAsync(project)
      setCurrentProject({
        id: project,
        name: result.meta?.name || project,
        goal: result.meta?.goal,
      })
      // After project loads, select and fly to the node
      // Small delay to let the graph render
      setTimeout(() => {
        selectAndFlyToNode(nodeId)
        setIsLoading(false)
      }, 300)
    } catch (error) {
      console.error('Failed to navigate to cross-project reference:', error)
      setIsLoading(false)
    }
  }

  const displayProject = project === 'default' ? 'Home' : project

  return (
    <div className="flex items-start gap-2">
      <span className="text-accent">📎</span>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className={cn(
          'text-left text-accent hover:underline',
          isLoading && 'opacity-50 cursor-wait',
        )}
      >
        {title || `${displayProject}/${nodeId}`}
        <span className="text-xs text-text-muted ml-1">→ {displayProject}</span>
      </button>
    </div>
  )
}

// Map fileType to language for syntax highlighter
const FILE_TYPE_TO_LANGUAGE: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  ml: 'ocaml',
  fs: 'fsharp',
  clj: 'clojure',
  lisp: 'lisp',
  vim: 'vim',
  dockerfile: 'docker',
  makefile: 'makefile',
  toml: 'toml',
  ini: 'ini',
  diff: 'diff',
  graphql: 'graphql',
  proto: 'protobuf',
}

// Code renderer with syntax highlighting
function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <SyntaxHighlighter
      language={language || 'text'}
      style={oneDark}
      customStyle={{
        margin: 0,
        borderRadius: '0.5rem',
        fontSize: '0.75rem',
        maxHeight: '400px',
      }}
      showLineNumbers
      lineNumberStyle={{
        minWidth: '2.5em',
        paddingRight: '1em',
        color: '#6b7280',
      }}
    >
      {code}
    </SyntaxHighlighter>
  )
}

// Check if fileType is a code file (not markdown, text, or thinking)
function isCodeFileType(fileType?: string): boolean {
  if (!fileType) return false
  const normalized = fileType.toLowerCase()
  // Exclude text-based types that should render as Markdown
  const textTypes = ['md', 'markdown', 'txt', 'text', 'thinking']
  return !textTypes.includes(normalized)
}

// Type for document parts (used in full document view)
type DocumentPart = {
  type: 'content' | 'thinking'
  content: string
  title: string
  id: string
  metadata?: Record<string, unknown> // For thought_fluid and other metadata
}

// Helper to render document parts with thinking blocks
// flyOnly: if true, node links only move camera without changing selection
function DocumentRenderer({
  parts,
  mode,
  flyOnly = false,
}: {
  parts: DocumentPart[]
  mode: 'graph' | 'fluid'
  flyOnly?: boolean
}) {
  return (
    <div className="prose prose-sm prose-invert max-w-none">
      {parts.map((part) =>
        part.type === 'thinking' ? (
          <div
            key={part.id}
            className="my-4 rounded-lg border border-purple-500/30 bg-purple-500/10 overflow-hidden"
          >
            <div className="px-3 py-1.5 bg-purple-500/20 border-b border-purple-500/30 flex items-center gap-2">
              <span className="text-purple-400 text-xs font-semibold uppercase tracking-wider">
                Thinking
              </span>
              {part.title && (
                <span className="text-purple-300/70 text-xs truncate flex-1">
                  {part.title}
                </span>
              )}
            </div>
            <div className="p-3 text-purple-200/90 text-sm leading-relaxed prose prose-sm prose-invert max-w-none prose-p:text-purple-200/90 prose-strong:text-purple-100 prose-em:text-purple-200/80">
              {mode === 'fluid' && part.metadata?.thought_fluid ? (
                <Markdown flyOnly={flyOnly}>
                  {part.metadata.thought_fluid as string}
                </Markdown>
              ) : (
                <Markdown flyOnly={flyOnly}>{part.content}</Markdown>
              )}
            </div>
          </div>
        ) : (
          <div key={part.id}>
            <Markdown flyOnly={flyOnly}>{part.content}</Markdown>
          </div>
        ),
      )}
    </div>
  )
}

// Split view renderer - renders parts row by row with graph and fluid side by side
// This ensures each thinking block starts at the same height on both sides
function SplitDocumentRenderer({
  parts,
  flyOnly = false,
}: {
  parts: DocumentPart[]
  flyOnly?: boolean
}) {
  return (
    <div className="prose prose-sm prose-invert max-w-none">
      {parts.map((part) =>
        part.type === 'thinking' ? (
          <div
            key={part.id}
            className="my-4 rounded-lg border border-purple-500/30 bg-purple-500/10 overflow-hidden"
          >
            {/* Header spans full width */}
            <div className="px-3 py-1.5 bg-purple-500/20 border-b border-purple-500/30 flex items-center gap-2">
              <span className="text-purple-400 text-xs font-semibold uppercase tracking-wider">
                Thinking
              </span>
              {part.title && (
                <span className="text-purple-300/70 text-xs truncate flex-1">
                  {part.title}
                </span>
              )}
            </div>
            {/* Two columns for graph and fluid */}
            <div className="flex">
              {/* Graph mode (left) */}
              <div className="flex-1 p-3 border-r border-purple-500/20 text-purple-200/90 text-sm leading-relaxed prose prose-sm prose-invert max-w-none prose-p:text-purple-200/90 prose-strong:text-purple-100 prose-em:text-purple-200/80">
                <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2 font-semibold">
                  Graph
                </div>
                <Markdown flyOnly={flyOnly}>{part.content}</Markdown>
              </div>
              {/* Fluid mode (right) */}
              <div className="flex-1 p-3 text-purple-200/90 text-sm leading-relaxed prose prose-sm prose-invert max-w-none prose-p:text-purple-200/90 prose-strong:text-purple-100 prose-em:text-purple-200/80 bg-purple-500/5">
                <div className="text-[10px] uppercase tracking-wider text-purple-400 mb-2 font-semibold">
                  Fluid
                </div>
                {part.metadata?.thought_fluid ? (
                  <Markdown flyOnly={flyOnly}>
                    {part.metadata.thought_fluid as string}
                  </Markdown>
                ) : (
                  <span className="text-text-muted italic text-xs">
                    No fluid translation
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div key={part.id}>
            <Markdown flyOnly={flyOnly}>{part.content}</Markdown>
          </div>
        ),
      )}
    </div>
  )
}

// Modal for viewing content fullscreen
function ContentModal({
  isOpen,
  onClose,
  title,
  content,
  fileType,
  parts,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  content: string
  fileType?: string
  parts?: DocumentPart[]
}) {
  const [copied, setCopied] = useState(false)
  const [copyMode, setCopyMode] = useState<'graph' | 'fluid'>('graph')
  const [viewMode, setViewMode] = useState<'split' | 'graph' | 'fluid'>('split')

  // Check if this is an annotation project (has thinking nodes with translations)
  const hasThinkingNodes = parts?.some((p) => p.type === 'thinking')
  const hasFluidTranslations = parts?.some(
    (p) => p.type === 'thinking' && p.metadata?.thought_fluid,
  )
  const isAnnotationProject = hasThinkingNodes && hasFluidTranslations

  if (!isOpen) return null

  // Handle escape key to close
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  const handleCopy = async (mode: 'graph' | 'fluid') => {
    try {
      // Build content with <thinking> tags
      let copyContent = ''
      if (parts && parts.length > 0) {
        for (const part of parts) {
          if (part.type === 'thinking') {
            const thinkingContent =
              mode === 'fluid' && part.metadata?.thought_fluid
                ? (part.metadata.thought_fluid as string)
                : part.content
            copyContent += `\n<thinking>\n${thinkingContent}\n</thinking>\n`
          } else {
            copyContent += `\n${part.content}\n`
          }
        }
      } else {
        copyContent = content
      }
      await navigator.clipboard.writeText(copyContent.trim())
      setCopied(true)
      setCopyMode(mode)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Portal to body to escape any container positioning
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal content - wider for split view */}
      <div
        role="document"
        className={cn(
          'relative z-10 max-h-[85vh] bg-bg-surface rounded-xl border border-border-subtle shadow-2xl flex flex-col',
          isAnnotationProject ? 'w-[95vw] max-w-7xl' : 'w-[90vw] max-w-5xl',
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <h3
              id="modal-title"
              className="text-lg font-semibold text-text-primary"
            >
              {title}
            </h3>
            {fileType && (
              <span className="px-2 py-0.5 text-xs rounded-md font-medium font-mono bg-accent/20 text-accent border border-accent/30">
                .{fileType}
              </span>
            )}
            {isAnnotationProject && (
              <span className="px-2 py-0.5 text-xs rounded-md font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Annotation
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle for annotation projects */}
            {isAnnotationProject && (
              <div className="flex items-center gap-0.5 px-1 py-0.5 bg-bg-muted rounded-lg border border-border-subtle">
                <button
                  type="button"
                  onClick={() => setViewMode('split')}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    viewMode === 'split'
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-muted hover:text-text-primary',
                  )}
                >
                  Split
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('graph')}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    viewMode === 'graph'
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-muted hover:text-text-primary',
                  )}
                >
                  Graph
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('fluid')}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    viewMode === 'fluid'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'text-text-muted hover:text-text-primary',
                  )}
                >
                  Fluid
                </button>
              </div>
            )}
            {/* Copy buttons - show both for annotation projects */}
            {isAnnotationProject ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleCopy('graph')}
                  className={cn(
                    'px-2 py-1 text-xs rounded-l-lg border transition-all',
                    copied && copyMode === 'graph'
                      ? 'bg-green-500/20 text-green-400 border-green-500/30'
                      : 'bg-bg-muted text-text-muted hover:text-accent border-border-subtle hover:border-accent/30',
                  )}
                >
                  {copied && copyMode === 'graph' ? '✓ Copied' : 'Copy Graph'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy('fluid')}
                  className={cn(
                    'px-2 py-1 text-xs rounded-r-lg border-y border-r transition-all',
                    copied && copyMode === 'fluid'
                      ? 'bg-green-500/20 text-green-400 border-green-500/30'
                      : 'bg-bg-muted text-text-muted hover:text-accent border-border-subtle hover:border-accent/30',
                  )}
                >
                  {copied && copyMode === 'fluid' ? '✓ Copied' : 'Copy Fluid'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleCopy('graph')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
                  copied
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-bg-muted hover:bg-accent/20 text-text-muted hover:text-accent border border-border-subtle hover:border-accent/30',
                )}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-muted transition-colors text-text-muted hover:text-text-primary"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Close"
                role="img"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isCodeFileType(fileType) ? (
            <div className="p-6">
              <SyntaxHighlighter
                language={
                  FILE_TYPE_TO_LANGUAGE[fileType?.toLowerCase() || ''] ||
                  fileType
                }
                style={oneDark}
                customStyle={{
                  margin: 0,
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
                showLineNumbers
                lineNumberStyle={{
                  minWidth: '3em',
                  paddingRight: '1em',
                  color: '#6b7280',
                }}
              >
                {content}
              </SyntaxHighlighter>
            </div>
          ) : isAnnotationProject && parts ? (
            // Annotation project: Split or Single view based on viewMode
            viewMode === 'split' ? (
              <div className="p-6 overflow-auto h-full">
                <SplitDocumentRenderer parts={parts} />
              </div>
            ) : (
              // Single view (graph or fluid)
              <div className="p-6">
                <div className="text-xs font-semibold uppercase tracking-wider mb-4">
                  <span
                    className={
                      viewMode === 'fluid'
                        ? 'text-purple-400'
                        : 'text-text-muted'
                    }
                  >
                    {viewMode === 'fluid' ? 'Fluid Mode' : 'Graph Mode'}
                  </span>
                </div>
                <DocumentRenderer
                  parts={parts}
                  mode={viewMode === 'fluid' ? 'fluid' : 'graph'}
                />
              </div>
            )
          ) : parts && parts.length > 0 ? (
            // Single view for documents with thinking but no translations
            <div className="p-6">
              <DocumentRenderer parts={parts} mode="graph" />
            </div>
          ) : (
            // Simple content without parts
            <div className="p-6">
              <div className="prose prose-sm prose-invert max-w-none">
                <Markdown>{content}</Markdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Modal for viewing PDF in an iframe
function PdfModal({
  isOpen,
  onClose,
  title,
  pdfUrl,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  pdfUrl: string
}) {
  if (!isOpen) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-modal-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal content */}
      <div
        role="document"
        className="relative z-10 w-[90vw] max-w-5xl max-h-[85vh] bg-bg-surface rounded-xl border border-border-subtle shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2
            id="pdf-modal-title"
            className="text-lg font-semibold text-text-primary truncate"
          >
            {title}
          </h2>
          <div className="flex items-center gap-2">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
            >
              Open in New Tab
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-muted transition-colors text-text-muted hover:text-text-primary"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Close"
                role="img"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* PDF iframe */}
        <div className="flex-1 overflow-hidden p-2">
          <iframe
            src={pdfUrl}
            title={title}
            className="w-full h-full rounded-lg border border-border-subtle"
            style={{ minHeight: '70vh' }}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Helper to process React children and linkify string content
// Only wraps direct string children - React elements are handled by their own components
// flyOnly: if true, node links only move camera without changing selection
function linkifyChildren(
  children: React.ReactNode,
  flyOnly = false,
): React.ReactNode {
  return React.Children.map(children, (child, index) => {
    // String content - wrap with Linkify
    if (typeof child === 'string') {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable order from React.Children.map
        <Linkify key={index} flyOnly={flyOnly}>
          {child}
        </Linkify>
      )
    }
    // Numbers and other primitives - return as-is
    return child
  })
}

// Markdown renderer with styled output
// flyOnly: if true, node links only move camera without changing selection
function Markdown({
  children,
  flyOnly = false,
}: {
  children: string
  flyOnly?: boolean
}) {
  return (
    <ReactMarkdown
      components={{
        // Links - keep as-is (already linked)
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline break-all"
          >
            {children}
          </a>
        ),
        // Headings - linkify node IDs
        h1: ({ children }) => (
          <h1 className="text-lg font-semibold text-text-primary mt-4 mb-2 first:mt-0">
            {linkifyChildren(children, flyOnly)}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-semibold text-text-primary mt-3 mb-2 first:mt-0">
            {linkifyChildren(children, flyOnly)}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-text-primary mt-2 mb-1 first:mt-0">
            {linkifyChildren(children, flyOnly)}
          </h3>
        ),
        // Paragraphs - linkify node IDs
        p: ({ children }) => (
          <p className="mb-2 last:mb-0">{linkifyChildren(children, flyOnly)}</p>
        ),
        // Lists
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-text-secondary pl-1">
            {linkifyChildren(children, flyOnly)}
          </li>
        ),
        // Code - keep as-is (don't linkify code)
        code: ({ className, children }) => {
          const isBlock = className?.includes('language-')
          if (isBlock) {
            return (
              <code className="block bg-bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto my-2">
                {children}
              </code>
            )
          }
          // Inline code: if the content is exactly a sema handle
          // (e.g. `Parsimony#2578`), render it as a clickable link to
          // semahash.org. Sema handles are PascalCase + '#' + 4 hex.
          // The backticked convention means agents write sema handles
          // inside `` `` `` pairs by default, so they arrive here as
          // inline <code>.
          const inlineText =
            typeof children === 'string'
              ? children
              : Array.isArray(children) &&
                  children.length === 1 &&
                  typeof children[0] === 'string'
                ? children[0]
                : null
          if (inlineText) {
            const semaMatch = inlineText.match(
              /^([A-Z][A-Za-z]{2,})#[0-9a-f]{4}$/,
            )
            if (semaMatch) {
              const name = semaMatch[1]
              return (
                <a
                  href={`https://semahash.org/graph?node=${encodeURIComponent(name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${inlineText} on semahash.org`}
                  className="no-underline"
                >
                  <code className="bg-bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-accent hover:underline">
                    {children}
                  </code>
                </a>
              )
            }
          }
          return (
            <code className="bg-bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className="my-2">{children}</pre>,
        // Blockquote - linkify node IDs
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-muted italic">
            {linkifyChildren(children, flyOnly)}
          </blockquote>
        ),
        // Strong/Em - linkify node IDs
        strong: ({ children }) => (
          <strong className="font-semibold text-text-primary">
            {linkifyChildren(children, flyOnly)}
          </strong>
        ),
        em: ({ children }) => (
          <em className="italic">{linkifyChildren(children, flyOnly)}</em>
        ),
        // Horizontal rule
        hr: () => <hr className="border-border-subtle my-4" />,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

export function DetailsPanel() {
  const { activeTab, setActiveTab, currentProject } = useAppStore()

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'chat', label: 'Commits' },
    { id: 'node', label: 'Details' },
    { id: 'files', label: 'Files' },
    { id: 'db', label: 'Stats' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border-subtle flex justify-between items-center">
        <h2 className="text-sm font-semibold text-text-primary">History</h2>
        <div className="flex gap-1 p-1 bg-bg-muted rounded-lg">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'tab',
                activeTab === tab.id ? 'tab-active' : 'tab-inactive',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'chat' && <CommitsTab enabled={!!currentProject} />}
        {activeTab === 'node' && <NodeTab />}
        {activeTab === 'files' && <FilesTab enabled={!!currentProject} />}
        {activeTab === 'db' && <DbTab enabled={!!currentProject} />}
      </div>
    </div>
  )
}

function CommitCard({
  commit,
  nodeMap,
  edgeMap,
}: {
  commit: Commit
  nodeMap: Map<string, string>
  edgeMap: Map<string, { type: string; fromName: string; toName: string }>
}) {
  const [expanded, setExpanded] = useState(false)
  const {
    setHighlightedIds,
    clearHighlightedIds,
    selectAndFlyToNode,
    selectEdge,
  } = useAppStore()

  const totalChanges =
    (commit.nodeIds?.length || 0) + (commit.edgeIds?.length || 0)

  return (
    <div className="card p-4 hover:shadow-md transition-all">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="text-[11px] text-text-muted font-mono">
          {commit.id.slice(0, 12)}
        </div>
        {commit.agentName && (
          <span className="px-2 py-0.5 text-[10px] rounded-md bg-accent/20 text-accent border border-accent/30">
            {commit.agentName}
          </span>
        )}
      </div>

      {/* Message - hover to highlight all affected nodes/edges */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-only highlighting, not actionable */}
      <div
        className="text-sm text-text-primary mb-2 font-medium cursor-pointer hover:text-accent transition-colors"
        onMouseEnter={() =>
          setHighlightedIds(commit.nodeIds || [], commit.edgeIds || [])
        }
        onMouseLeave={() => clearHighlightedIds()}
      >
        {commit.message}
      </div>

      {/* Timestamp + expand toggle */}
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>{new Date(commit.createdAt).toLocaleString()}</span>
        {totalChanges > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 hover:text-accent transition-colors"
          >
            <span>
              {commit.nodeIds?.length || 0} nodes, {commit.edgeIds?.length || 0}{' '}
              edges
            </span>
            <span className="text-[10px]">{expanded ? '▲' : '▼'}</span>
          </button>
        )}
      </div>

      {/* Expandable details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          {/* Nodes list */}
          {commit.nodeIds && commit.nodeIds.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">
                Nodes
              </div>
              <div className="space-y-1">
                {commit.nodeIds.map((nodeId) => (
                  <button
                    key={nodeId}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectAndFlyToNode(nodeId)
                    }}
                    onMouseEnter={() => setHighlightedIds([nodeId], [])}
                    onMouseLeave={() => clearHighlightedIds()}
                    className="w-full text-left px-2 py-1 text-xs rounded bg-bg-muted/50 hover:bg-accent/20 transition-colors flex items-center gap-2"
                  >
                    <span className="text-accent">●</span>
                    <span className="text-text-primary truncate">
                      {nodeMap.get(nodeId) || nodeId}
                    </span>
                    <span className="text-text-muted font-mono text-[10px] ml-auto">
                      {nodeId.slice(0, 8)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Edges list */}
          {commit.edgeIds && commit.edgeIds.length > 0 && (
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">
                Edges
              </div>
              <div className="space-y-1">
                {commit.edgeIds.map((edgeId) => {
                  const edgeInfo = edgeMap.get(edgeId)
                  return (
                    <button
                      key={edgeId}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectEdge(edgeId)
                      }}
                      onMouseEnter={() => setHighlightedIds([], [edgeId])}
                      onMouseLeave={() => clearHighlightedIds()}
                      className="w-full text-left px-2 py-1 text-xs rounded bg-bg-muted/50 hover:bg-accent/20 transition-colors"
                    >
                      <div className="flex items-center gap-1 text-text-primary">
                        <span className="truncate max-w-[80px]">
                          {edgeInfo?.fromName || '?'}
                        </span>
                        <span className="text-accent text-[10px] px-1">
                          →{edgeInfo?.type}→
                        </span>
                        <span className="truncate max-w-[80px]">
                          {edgeInfo?.toName || '?'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CommitsTab({ enabled }: { enabled: boolean }) {
  const { data: commits = [], isLoading } = useCommits()
  const { data: graphData } = useGraph(enabled)

  // Build lookup maps for node/edge names
  const nodeMap = React.useMemo(() => {
    const map = new Map<string, string>()
    graphData?.nodes?.forEach((n) => {
      map.set(n.id, n.title)
    })
    return map
  }, [graphData?.nodes])

  const edgeMap = React.useMemo(() => {
    const map = new Map<
      string,
      { type: string; fromName: string; toName: string }
    >()
    graphData?.edges?.forEach((e) => {
      map.set(e.id, {
        type: e.type,
        fromName: nodeMap.get(e.from) || e.from,
        toName: nodeMap.get(e.to) || e.to,
      })
    })
    return map
  }, [graphData?.edges, nodeMap])

  if (isLoading) {
    return (
      <div className="text-text-muted text-sm text-center py-8">Loading...</div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="text-text-muted text-sm text-center py-8 bg-bg-muted/50 rounded-lg border border-dashed border-border-default">
        <p>No commits yet</p>
        <p className="text-xs mt-2 text-text-muted/70">
          Use graph_batch with a commit_message to create commits
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {commits.map((commit: Commit) => (
        <CommitCard
          key={commit.id}
          commit={commit}
          nodeMap={nodeMap}
          edgeMap={edgeMap}
        />
      ))}
    </div>
  )
}

function NodeTab() {
  const {
    selectedNodeId,
    selectedEdgeId,
    selectAndFlyToNode,
    timelineRange,
    pendingDocumentViewId,
    clearPendingDocumentView,
    closeDocumentModalSignal,
  } = useAppStore()
  const { data: node, isLoading: nodeLoading } = useNode(selectedNodeId)
  const { data: edge, isLoading: edgeLoading } = useEdge(selectedEdgeId)
  const { data: graphData } = useGraph()

  // Compute visible node IDs based on timeline filter
  const visibleNodeIds = useMemo(() => {
    if (!graphData?.nodes || !timelineRange) return null // null means show all
    const sortedIds = [...graphData.nodes]
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return timeA - timeB
      })
      .map((n) => n.id)
    const [start, end] = timelineRange
    return new Set(sortedIds.slice(start, end + 1))
  }, [graphData?.nodes, timelineRange])
  const { data: conversation } = useConversation(
    node?.conversationId || edge?.conversationId || null,
  )
  const [isContentModalOpen, setIsContentModalOpen] = useState(false)
  const [isFullDocModalOpen, setIsFullDocModalOpen] = useState(false)
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)

  // Open document modal when triggered from sidebar
  useEffect(() => {
    if (
      pendingDocumentViewId &&
      pendingDocumentViewId === selectedNodeId &&
      node?.isDocRoot
    ) {
      setIsFullDocModalOpen(true)
      clearPendingDocumentView()
    }
  }, [
    pendingDocumentViewId,
    selectedNodeId,
    node?.isDocRoot,
    clearPendingDocumentView,
  ])

  // Close document modal when navigating to a node (via node link click)
  useEffect(() => {
    if (closeDocumentModalSignal > 0) {
      setIsFullDocModalOpen(false)
      setIsContentModalOpen(false)
    }
  }, [closeDocumentModalSignal])

  if (!selectedNodeId && !selectedEdgeId) {
    return (
      <div className="text-text-muted text-sm text-center py-8 bg-bg-muted/50 rounded-lg border border-dashed border-border-default">
        Click a node or edge to see details
      </div>
    )
  }

  if (nodeLoading || edgeLoading) {
    return (
      <div className="text-text-muted text-sm text-center py-8">Loading...</div>
    )
  }

  if (selectedEdgeId && edge) {
    // Find from/to node text
    const fromNode = graphData?.nodes.find((n) => n.id === edge.from)
    const toNode = graphData?.nodes.find((n) => n.id === edge.to)

    // Format edge type for display (e.g., "diverse_from" -> "Diverse From")
    const formatEdgeType = (type: string) => {
      return type
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    return (
      <div className="card p-4 border-l-2 border-l-accent">
        <h3 className="text-base font-semibold text-text-primary mb-4">
          {edge.type ? formatEdgeType(edge.type) : 'Connection'}
        </h3>

        <div className="space-y-4">
          <DetailSection label="From">
            {fromNode?.title || edge.from}
          </DetailSection>

          <DetailSection label="To">{toNode?.title || edge.to}</DetailSection>

          <DetailSection label="Why this connection">
            <Linkify>{edge.why || 'Not specified'}</Linkify>
          </DetailSection>

          {conversation && <ConversationLink conversation={conversation} />}
        </div>
      </div>
    )
  }

  if (selectedNodeId && node) {
    // Check if this is a document node
    const isDocumentNode = node.content || node.isDocRoot || node.level

    // Find outgoing and incoming connections
    const outgoing =
      graphData?.edges
        .filter((e) => e.from === selectedNodeId)
        .map((e) => ({
          edge: e,
          targetNode: graphData?.nodes.find((n) => n.id === e.to),
        })) || []

    const incoming =
      graphData?.edges
        .filter((e) => e.to === selectedNodeId)
        .map((e) => ({
          edge: e,
          sourceNode: graphData?.nodes.find((n) => n.id === e.from),
        })) || []

    // Find next/prev nodes via "next" edges for document navigation
    const nextEdge = isDocumentNode
      ? graphData?.edges.find(
          (e) => e.from === selectedNodeId && e.type === 'next',
        )
      : null
    const nextNode = nextEdge
      ? graphData?.nodes.find((n) => n.id === nextEdge.to)
      : null

    const prevEdge = isDocumentNode
      ? graphData?.edges.find(
          (e) => e.to === selectedNodeId && e.type === 'next',
        )
      : null
    const prevNode = prevEdge
      ? graphData?.nodes.find((n) => n.id === prevEdge.from)
      : null

    // Find children via "contains" edges (this node contains children)
    const childEdges = isDocumentNode
      ? graphData?.edges.filter(
          (e) => e.from === selectedNodeId && e.type === 'contains',
        ) || []
      : []
    const childNodes = childEdges
      .map((e) => graphData?.nodes.find((n) => n.id === e.to))
      .filter(Boolean)

    // Find root node by traversing "contains" edges upward
    const findRoot = (): typeof node | null => {
      if (node.isDocRoot) return null // Already at root
      let currentId = selectedNodeId
      let iterations = 0
      while (iterations < 20) {
        const parentEdge = graphData?.edges.find(
          (e) => e.to === currentId && e.type === 'contains',
        )
        if (!parentEdge) break
        const parentNode = graphData?.nodes.find(
          (n) => n.id === parentEdge.from,
        )
        if (!parentNode) break
        if (parentNode.isDocRoot) return parentNode
        currentId = parentNode.id
        iterations++
      }
      return null
    }
    const rootNode = isDocumentNode ? findRoot() : null
    // Inherit fileType from root if this node doesn't have one
    const effectiveFileType = node.fileType || rootNode?.fileType

    // Assemble full document content from root and all children
    // Returns structured parts to enable special rendering of thinking blocks
    const assembleFullDocumentParts = (): DocumentPart[] => {
      if (!node.isDocRoot) {
        return node.content
          ? [
              {
                type: 'content',
                content: node.content,
                title: node.title,
                id: node.id,
                metadata: node.metadata,
              },
            ]
          : []
      }

      const parts: DocumentPart[] = []
      const visited = new Set<string>()
      const MAX_ITERATIONS = 200

      // Follow the sequential chain via 'next' edges to get all nodes in order
      // This captures both content nodes and thinking nodes interspersed between them
      // Starts from the NEXT node after startId (assumes startId is already processed)
      const followSequentialChain = (startId: string) => {
        // Find the first 'next' edge from the start node
        let nextEdge = graphData?.edges.find(
          (e) => e.from === startId && e.type === 'next',
        )
        let currentId: string | null = nextEdge?.to || null
        let iterations = 0

        while (currentId && iterations < MAX_ITERATIONS) {
          if (visited.has(currentId)) break
          visited.add(currentId)
          iterations++

          const currentNode = graphData?.nodes.find((n) => n.id === currentId)
          if (currentNode?.content) {
            const isThinking = currentNode.trigger === 'thinking'
            parts.push({
              type: isThinking ? 'thinking' : 'content',
              content: currentNode.content,
              title: currentNode.title,
              id: currentNode.id,
              metadata: currentNode.metadata,
            })
          }

          // Find next node in sequence
          nextEdge = graphData?.edges.find(
            (e) => e.from === currentId && e.type === 'next',
          )
          currentId = nextEdge?.to || null
        }
      }

      // Also collect children via 'contains' edges (for hierarchical documents)
      const collectContainedChildren = (parentId: string, depth = 0) => {
        if (depth > 50) return

        const childEdges =
          graphData?.edges.filter(
            (e) => e.from === parentId && e.type === 'contains',
          ) || []

        for (const edge of childEdges) {
          if (visited.has(edge.to)) continue

          const childNode = graphData?.nodes.find((n) => n.id === edge.to)
          if (childNode?.content) {
            visited.add(edge.to)
            const isThinking = childNode.trigger === 'thinking'
            parts.push({
              type: isThinking ? 'thinking' : 'content',
              content: childNode.content,
              title: childNode.title,
              id: childNode.id,
              metadata: childNode.metadata,
            })
          }

          // Follow any sequential chain from this child
          followSequentialChain(edge.to)

          // Recursively get nested children
          collectContainedChildren(edge.to, depth + 1)
        }
      }

      // Start with root's content if it has any
      if (node.content) {
        parts.push({
          type: 'content',
          content: node.content,
          title: node.title,
          id: node.id,
          metadata: node.metadata,
        })
        visited.add(node.id)
      }

      // Follow sequential chain from root (for source reading documents)
      followSequentialChain(selectedNodeId!)

      // Also collect hierarchical children (for manually structured documents)
      collectContainedChildren(selectedNodeId!)

      // Filter to only include visible nodes if timeline filter is active
      if (visibleNodeIds) {
        return parts.filter((p) => visibleNodeIds.has(p.id))
      }
      return parts
    }

    const fullDocumentParts = node.isDocRoot ? assembleFullDocumentParts() : []
    const fullDocumentContent = fullDocumentParts
      .map((p) => p.content)
      .join('\n\n')

    return (
      <div className="card p-4">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">
            {node.title}
          </h3>
          {isDocumentNode && (
            <div className="flex gap-1.5">
              {effectiveFileType && (
                <span className="px-2 py-0.5 text-xs rounded-md font-medium font-mono bg-accent/20 text-accent border border-accent/30">
                  .{effectiveFileType}
                </span>
              )}
              <span className="px-2 py-0.5 text-xs rounded-md font-medium bg-zinc-200/20 text-zinc-300 border border-zinc-400/30">
                {node.level || 'document'}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Document navigation - at top */}
          {isDocumentNode && (
            <div className="space-y-3">
              {/* Navigation row: back to root + prev/next */}
              <div className="flex gap-2">
                {rootNode && (
                  <button
                    type="button"
                    onClick={() => selectAndFlyToNode(rootNode.id)}
                    className="py-2 px-3 text-sm rounded-lg border border-border-subtle hover:border-accent hover:text-accent transition-colors"
                  >
                    ↑ Root
                  </button>
                )}
                <div className="flex-1" />
                {prevNode && (
                  <button
                    type="button"
                    onClick={() => selectAndFlyToNode(prevNode.id)}
                    className="py-2 px-3 text-sm rounded-lg border border-border-subtle hover:border-accent hover:text-accent transition-colors"
                  >
                    ← Prev
                  </button>
                )}
                {nextNode && (
                  <button
                    type="button"
                    onClick={() => selectAndFlyToNode(nextNode.id)}
                    className="py-2 px-3 text-sm rounded-lg border border-border-subtle hover:border-accent hover:text-accent transition-colors"
                  >
                    Next →
                  </button>
                )}
              </div>

              {/* Children sections */}
              {childNodes.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-text-muted font-medium uppercase tracking-wider">
                    Sections
                  </div>
                  <div className="space-y-1">
                    {childNodes.map((child) => (
                      <button
                        key={child!.id}
                        type="button"
                        onClick={() => selectAndFlyToNode(child!.id)}
                        className="w-full py-1.5 px-3 text-sm rounded-lg border border-border-subtle hover:border-accent hover:text-accent transition-colors text-left"
                      >
                        {child!.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* View PDF button for LaTeX documents */}
              {node.isDocRoot &&
                (effectiveFileType === 'tex' ||
                  effectiveFileType === 'latex') && (
                  <button
                    type="button"
                    onClick={() => setIsPdfModalOpen(true)}
                    className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <path d="M9 15l2 2 4-4" />
                    </svg>
                    View PDF
                  </button>
                )}

              {/* View Full Document button for root nodes */}
              {node.isDocRoot && childNodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsFullDocModalOpen(true)}
                  className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors flex items-center justify-center gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  View Document
                </button>
              )}
            </div>
          )}

          {node.content && (
            <>
              <DetailSection
                label={
                  node.trigger === 'thinking' && !!node.metadata?.thought_fluid
                    ? 'Graph Mode'
                    : effectiveFileType
                      ? `Content (${effectiveFileType})`
                      : 'Content'
                }
              >
                <button
                  type="button"
                  onClick={() => setIsContentModalOpen(true)}
                  className="w-full text-left cursor-pointer group relative"
                >
                  {/* Expand hint */}
                  <div className="absolute top-2 right-2 z-10 px-2 py-1 rounded bg-bg-surface/90 text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                    Expand
                  </div>
                  {isCodeFileType(effectiveFileType) ? (
                    <div className="group-hover:ring-2 group-hover:ring-accent/50 rounded-lg transition-all">
                      <CodeBlock
                        code={resolveReferences(
                          node.content || '',
                          graphData?.nodes || [],
                        )}
                        language={
                          FILE_TYPE_TO_LANGUAGE[
                            effectiveFileType?.toLowerCase() || ''
                          ] || effectiveFileType
                        }
                      />
                    </div>
                  ) : (
                    <div className="bg-bg-muted p-4 rounded-lg border border-border-subtle max-h-[400px] overflow-y-auto group-hover:ring-2 group-hover:ring-accent/50 transition-all">
                      <div className="prose prose-sm prose-invert max-w-none">
                        <Markdown>
                          {resolveReferences(
                            node.content || '',
                            graphData?.nodes || [],
                          )}
                        </Markdown>
                      </div>
                    </div>
                  )}
                </button>
              </DetailSection>

              <ContentModal
                isOpen={isContentModalOpen}
                onClose={() => setIsContentModalOpen(false)}
                title={node.title}
                content={resolveReferences(
                  node.content || '',
                  graphData?.nodes || [],
                )}
                fileType={effectiveFileType}
              />
            </>
          )}

          {/* Fluid Mode for thinking nodes with translations */}
          {node.trigger === 'thinking' && !!node.metadata?.thought_fluid && (
            <DetailSection label="Fluid Mode">
              <div className="bg-purple-500/10 p-4 rounded-lg border border-purple-500/30 max-h-[400px] overflow-y-auto">
                <div className="prose prose-sm prose-invert max-w-none prose-p:text-purple-200/90">
                  <Markdown>
                    {resolveReferences(
                      node.metadata.thought_fluid as string,
                      graphData?.nodes || [],
                    )}
                  </Markdown>
                </div>
              </div>
            </DetailSection>
          )}

          {/* Summary for document nodes */}
          {node.summary && (
            <DetailSection label="Summary">
              <Markdown>
                {resolveReferences(node.summary, graphData?.nodes || [])}
              </Markdown>
            </DetailSection>
          )}

          {/* Show trigger only for non-document nodes */}
          {!isDocumentNode && (
            <DetailSection label="Trigger">
              <span
                className={cn(
                  'inline-block px-2 py-0.5 text-xs rounded-md font-medium',
                  'bg-bg-muted text-text-secondary',
                )}
              >
                {node.trigger || 'Not specified'}
              </span>
            </DetailSection>
          )}

          {/* Why - show for non-document nodes */}
          {!isDocumentNode && (
            <DetailSection label="Why this was added">
              <Markdown>
                {resolveReferences(
                  node.why || 'Not specified',
                  graphData?.nodes || [],
                )}
              </Markdown>
            </DetailSection>
          )}

          {/* Understanding - show for non-document nodes, or if no content */}
          {(!isDocumentNode || !node.content) && node.understanding && (
            <DetailSection label="Understanding">
              <Markdown>
                {resolveReferences(node.understanding, graphData?.nodes || [])}
              </Markdown>
            </DetailSection>
          )}

          {/* References - clickable source links and cross-project refs */}
          {node.references && node.references.length > 0 && (
            <DetailSection label="References">
              <div className="space-y-1">
                {node.references.map((ref, i) => {
                  const isCrossProject = ref.project && ref.nodeId
                  const key = isCrossProject
                    ? `ref-${i}-${ref.project}-${ref.nodeId}`
                    : `ref-${i}-${(ref.url || '').slice(0, 20)}`

                  if (isCrossProject) {
                    return (
                      <CrossProjectReference
                        key={key}
                        project={ref.project!}
                        nodeId={ref.nodeId!}
                        title={ref.title}
                      />
                    )
                  }

                  return (
                    <div key={key} className="flex items-start gap-2">
                      <span className="text-accent">🔗</span>
                      <div>
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline break-all"
                        >
                          {ref.title || ref.url}
                        </a>
                        {ref.accessed && (
                          <span className="text-xs text-text-muted ml-2">
                            (accessed{' '}
                            {new Date(ref.accessed).toLocaleDateString()})
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </DetailSection>
          )}

          {conversation && <ConversationLink conversation={conversation} />}

          {outgoing.length > 0 && (
            <DetailSection label="Connects to">
              <div className="space-y-1">
                {outgoing.map(({ edge: e, targetNode }) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() =>
                      targetNode && selectAndFlyToNode(targetNode.id)
                    }
                    className="w-full text-left text-sm text-text-muted hover:text-accent transition-colors"
                  >
                    →{' '}
                    <span className="hover:underline">
                      {targetNode?.title || e.to}
                    </span>
                    {e.explanation && (
                      <span className="text-text-muted/70">
                        : <Linkify>{e.explanation}</Linkify>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </DetailSection>
          )}

          {incoming.length > 0 && (
            <DetailSection label="Connected from">
              <div className="space-y-1">
                {incoming.map(({ edge: e, sourceNode }) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() =>
                      sourceNode && selectAndFlyToNode(sourceNode.id)
                    }
                    className="w-full text-left text-sm text-text-muted hover:text-accent transition-colors"
                  >
                    ←{' '}
                    <span className="hover:underline">
                      {sourceNode?.title || e.from}
                    </span>
                    {e.explanation && (
                      <span className="text-text-muted/70">
                        : <Linkify>{e.explanation}</Linkify>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </DetailSection>
          )}
        </div>

        {/* Full Document Modal for root nodes */}
        {node.isDocRoot && fullDocumentContent && (
          <ContentModal
            isOpen={isFullDocModalOpen}
            onClose={() => setIsFullDocModalOpen(false)}
            title={`${node.title} (Full Document)`}
            content={resolveReferences(
              fullDocumentContent,
              graphData?.nodes || [],
            )}
            fileType={effectiveFileType}
            parts={fullDocumentParts.map((p) => ({
              ...p,
              content: resolveReferences(p.content, graphData?.nodes || []),
            }))}
          />
        )}

        {/* PDF Modal for LaTeX documents */}
        {node.isDocRoot &&
          (effectiveFileType === 'tex' || effectiveFileType === 'latex') && (
            <PdfModal
              isOpen={isPdfModalOpen}
              onClose={() => setIsPdfModalOpen(false)}
              title={`${node.title} (PDF)`}
              pdfUrl={`/api/graph/documents/${node.id}/pdf`}
            />
          )}
      </div>
    )
  }

  return null
}

function ConversationLink({
  conversation,
}: {
  conversation: {
    id: string
    query: string
    response?: string
    createdAt: string
  }
}) {
  const { setActiveTab } = useAppStore()

  const handleClick = () => {
    setActiveTab('chat')
    // Scroll to the conversation after tab switch
    setTimeout(() => {
      const element = document.getElementById(`conv-${conversation.id}`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Flash highlight
      element?.classList.add('ring-2', 'ring-accent')
      setTimeout(() => element?.classList.remove('ring-2', 'ring-accent'), 2000)
    }, 100)
  }

  return (
    <DetailSection label="Created in Session">
      <button
        type="button"
        onClick={handleClick}
        className="w-full text-left bg-bg-muted p-3 rounded-lg border border-border-subtle hover:border-accent transition-colors cursor-pointer"
      >
        <div className="text-[10px] text-accent mb-1.5 font-mono">
          Session: {conversation.id} -{' '}
          {new Date(conversation.createdAt).toLocaleString()}
        </div>
        <div className="text-sm text-text-primary mb-1.5">
          <strong>Q:</strong> {conversation.query}
        </div>
        {conversation.response ? (
          <div className="text-xs text-text-muted">
            <strong>Summary:</strong> {conversation.response.slice(0, 200)}
            {conversation.response.length > 200 ? '...' : ''}
          </div>
        ) : (
          <div className="text-xs text-text-muted italic">
            Session in progress
          </div>
        )}
      </button>
    </DetailSection>
  )
}

function FilesTab({ enabled }: { enabled: boolean }) {
  const { data: documentRoots = [], isLoading } = useDocumentRoots(enabled)
  const { selectAndFlyToNode } = useAppStore()

  if (isLoading) {
    return (
      <div className="text-text-muted text-sm text-center py-8">Loading...</div>
    )
  }

  if (documentRoots.length === 0) {
    return (
      <div className="text-text-muted text-sm text-center py-8 bg-bg-muted/50 rounded-lg border border-dashed border-border-default">
        <p>No document files yet</p>
        <p className="text-xs mt-2 text-text-muted/70">
          Create documents with{' '}
          <code className="bg-bg-muted px-1 rounded font-mono">doc_create</code>{' '}
          and{' '}
          <code className="bg-bg-muted px-1 rounded font-mono">
            isDocRoot: true
          </code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {documentRoots.map((doc) => (
        <button
          key={doc.id}
          type="button"
          onClick={() => selectAndFlyToNode(doc.id)}
          className="w-full text-left card p-3 hover:shadow-md hover:border-accent transition-all group"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary truncate">
                  {doc.title}
                </span>
                {doc.fileType && (
                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded font-medium font-mono bg-accent/20 text-accent border border-accent/30">
                    .{doc.fileType}
                  </span>
                )}
              </div>
              {doc.summary && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2">
                  {doc.summary}
                </p>
              )}
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-text-muted group-hover:text-accent transition-colors"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          {doc.createdAt && (
            <div className="text-[10px] text-text-muted mt-2 font-mono">
              {new Date(doc.createdAt).toLocaleDateString()}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

// Stats section component for DbTab
function StatsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
        {title}
      </div>
      {children}
    </div>
  )
}

// Distribution bar for stats
function DistributionBar({
  items,
  labelField,
  getColor,
}: {
  items: Array<{ count: number; percent: number; [key: string]: unknown }>
  labelField: string
  getColor?: (label: string) => string
}) {
  const defaultColor = (label: string) => {
    return (
      triggerColorsTailwind[label] ||
      edgeColorsTailwind[label] ||
      agentColorsTailwind[label] ||
      'bg-accent'
    )
  }

  const colorFn = getColor || defaultColor

  return (
    <div className="space-y-1.5">
      {items.slice(0, 8).map((item) => {
        const label = (item[labelField] as string) || 'null'
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className="w-16 text-xs text-text-secondary truncate"
              title={label}
            >
              {label}
            </div>
            <div className="flex-1 h-4 bg-bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  colorFn(label),
                )}
                style={{ width: `${Math.max(item.percent, 2)}%` }}
              />
            </div>
            <div className="w-12 text-xs text-text-muted text-right">
              {item.count}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DbTab({ enabled }: { enabled: boolean }) {
  const { data: stats, isLoading } = useDbStats(enabled)
  const { selectAndFlyToNode } = useAppStore()

  if (isLoading) {
    return (
      <div className="text-text-muted text-sm text-center py-8">Loading...</div>
    )
  }

  if (!stats) {
    return (
      <div className="text-text-muted text-sm text-center py-8 bg-bg-muted/50 rounded-lg border border-dashed border-border-default">
        No statistics available
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Overview cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3 text-center">
          <div className="text-2xl font-bold text-accent">
            {stats.nodes.active}
          </div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider">
            Nodes
          </div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-2xl font-bold text-accent">
            {stats.edges.total}
          </div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider">
            Edges
          </div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-2xl font-bold text-accent">
            {stats.commits.total}
          </div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider">
            Commits
          </div>
        </div>
      </div>

      {/* Node types */}
      <StatsSection title="Nodes by Type">
        <DistributionBar items={stats.nodes.byTrigger} labelField="trigger" />
      </StatsSection>

      {/* Edge types */}
      <StatsSection title="Edges by Type">
        <DistributionBar items={stats.edges.byType} labelField="type" />
      </StatsSection>

      {/* Commits by agent */}
      {stats.commits.byAgent.length > 0 && (
        <StatsSection title="Commits by Agent">
          <DistributionBar items={stats.commits.byAgent} labelField="agent" />
        </StatsSection>
      )}

      {/* Most connected nodes */}
      {stats.connectivity.mostConnected.length > 0 && (
        <StatsSection title="Most Connected">
          <div className="space-y-1">
            {stats.connectivity.mostConnected.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => selectAndFlyToNode(node.id)}
                className="w-full flex items-center justify-between text-left text-sm hover:text-accent transition-colors py-1"
              >
                <span
                  className="truncate text-text-secondary"
                  title={node.title}
                >
                  {node.title.length > 30
                    ? `${node.title.slice(0, 30)}...`
                    : node.title}
                </span>
                <span className="text-xs text-text-muted ml-2 shrink-0">
                  {node.edgeCount} edges
                </span>
              </button>
            ))}
          </div>
        </StatsSection>
      )}

      {/* Additional stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatsSection title="Thinking">
          <div className="text-sm">
            <span className="text-text-primary">{stats.thinking.total}</span>
            <span className="text-text-muted"> thoughts, </span>
            <span className="text-text-primary">
              {stats.thinking.translated}
            </span>
            <span className="text-text-muted"> translated</span>
          </div>
        </StatsSection>
        <StatsSection title="Health">
          <div className="text-sm">
            {stats.connectivity.orphanCount > 0 ? (
              <span className="text-orange-400">
                {stats.connectivity.orphanCount} orphans
              </span>
            ) : (
              <span className="text-emerald-400">No orphans</span>
            )}
          </div>
        </StatsSection>
      </div>
    </div>
  )
}

function DetailSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs text-text-muted font-medium uppercase tracking-wider mb-1.5">
        {label}
      </div>
      <div className="text-sm text-text-secondary leading-relaxed">
        {children}
      </div>
    </div>
  )
}
