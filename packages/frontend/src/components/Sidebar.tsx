import { FileText, Monitor, Moon, Sun } from 'lucide-react'
import { useDocumentRoots, useLoadProject, useProjects } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { data: projects = [], isLoading } = useProjects()
  const loadProject = useLoadProject()
  const {
    currentProject,
    setCurrentProject,
    theme,
    setTheme,
    openDocumentView,
  } = useAppStore()
  const { data: documentRoots = [] } = useDocumentRoots(!!currentProject)

  const sortedProjects = [...projects].sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  const handleSelectProject = async (id: string) => {
    const result = await loadProject.mutateAsync(id)
    setCurrentProject({
      id,
      name: result.meta?.name || id,
      goal: result.meta?.goal,
    })
    onNavigate?.()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border-subtle">
        <h1 className="text-sm font-semibold text-text-primary tracking-tight">
          Understanding Graph
        </h1>
        <p className="text-xs text-text-muted mt-0.5">
          Trace how understanding develops
        </p>
        <details className="mt-3 rounded-md border border-border-subtle bg-bg-muted/40">
          <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            How to read this graph
          </summary>
          <dl className="space-y-2 border-t border-border-subtle px-2.5 py-2.5 text-xs leading-relaxed text-text-secondary">
            <div>
              <dt className="inline font-medium text-text-primary">Nodes</dt>
              <dd className="inline">
                {' '}
                capture parts of the work and the understanding around them.
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-text-primary">Arrows</dt>
              <dd className="inline">
                {' '}
                show what answers, refines, or informs what.
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-text-primary">History</dt>
              <dd className="inline">
                {' '}
                shows how the graph changed over time.
              </dd>
            </div>
          </dl>
        </details>
      </div>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
          Projects
        </h2>

        <div className="flex flex-col gap-2">
          {isLoading ? (
            <div className="text-text-muted text-sm text-center py-8">
              Loading...
            </div>
          ) : sortedProjects.length === 0 ? (
            <div className="text-text-muted text-sm text-center py-8 px-4 bg-bg-muted/50 rounded-lg border border-dashed border-border-default">
              No projects yet.
              <br />
              <span className="text-text-muted/70">
                Ask your MCP agent to create a descriptive project for the task.
              </span>
            </div>
          ) : (
            sortedProjects.map((project) => (
              <button
                type="button"
                key={project.id}
                onClick={() => handleSelectProject(project.id)}
                disabled={loadProject.isPending}
                className={cn(
                  'group relative p-3 rounded-lg text-left border transition-all duration-150',
                  'noise-subtle',
                  currentProject?.id === project.id
                    ? 'bg-accent-muted border-accent shadow-sm'
                    : 'bg-bg-surface border-border-subtle hover:border-border-default hover:shadow-sm',
                  loadProject.isPending && 'opacity-50 cursor-wait',
                )}
              >
                <h3
                  className={cn(
                    'text-sm font-medium',
                    currentProject?.id === project.id
                      ? 'text-accent'
                      : 'text-text-primary',
                  )}
                >
                  {project.name}
                </h3>
                <p className="text-xs text-text-muted mt-1 line-clamp-2">
                  {project.goal || 'No goal set'}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Documents list */}
        {currentProject && documentRoots.length > 0 && (
          <>
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 mt-6">
              Documents
            </h2>
            <div className="flex flex-col gap-2">
              {documentRoots.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    openDocumentView(doc.id)
                    onNavigate?.()
                  }}
                  className={cn(
                    'group relative p-3 rounded-lg text-left border transition-all duration-150',
                    'noise-subtle',
                    'bg-bg-surface border-border-subtle hover:border-border-default hover:shadow-sm',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-text-muted shrink-0" />
                    <h3 className="text-sm font-medium text-text-primary truncate">
                      {doc.title}
                    </h3>
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
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer with theme toggle */}
      <div className="p-4 border-t border-border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Theme</span>
          <div className="flex gap-1 p-1 bg-bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                theme === 'light'
                  ? 'bg-bg-surface text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary',
              )}
              title="Light mode"
            >
              <Sun size={14} />
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                theme === 'dark'
                  ? 'bg-bg-surface text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary',
              )}
              title="Dark mode"
            >
              <Moon size={14} />
            </button>
            <button
              type="button"
              onClick={() => setTheme('system')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                theme === 'system'
                  ? 'bg-bg-surface text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary',
              )}
              title="System"
            >
              <Monitor size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
