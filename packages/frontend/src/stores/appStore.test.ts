import { describe, expect, it, vi } from 'vitest'
import { reconcileHydratedProject } from './appStore'

function response(ok: boolean, body: unknown = {}) {
  return { ok, json: async () => body }
}

describe('reconcileHydratedProject', () => {
  it('keeps a persisted project when the backend loads it', async () => {
    const fetchProject = vi.fn().mockResolvedValue(
      response(true, {
        id: 'existing',
        name: 'Existing project',
        goal: 'Continue the work',
      }),
    )

    await expect(
      reconcileHydratedProject(
        { id: 'existing', name: 'Old display name' },
        fetchProject,
      ),
    ).resolves.toEqual({
      id: 'existing',
      name: 'Existing project',
      goal: 'Continue the work',
    })
    expect(fetchProject).toHaveBeenCalledTimes(1)
  })

  it('replaces a missing persisted project with the backend current project', async () => {
    const fetchProject = vi
      .fn()
      .mockResolvedValueOnce(response(false))
      .mockResolvedValueOnce(
        response(true, { id: 'available', name: 'Available project' }),
      )

    await expect(
      reconcileHydratedProject(
        { id: 'deleted', name: 'Deleted project' },
        fetchProject,
      ),
    ).resolves.toEqual({ id: 'available', name: 'Available project' })
    expect(fetchProject).toHaveBeenNthCalledWith(2, '/api/projects/current')
  })

  it('clears stale state when neither persisted nor current project exists', async () => {
    const fetchProject = vi
      .fn()
      .mockResolvedValueOnce(response(false))
      .mockResolvedValueOnce(response(false))

    await expect(
      reconcileHydratedProject(
        { id: 'deleted', name: 'Deleted project' },
        fetchProject,
      ),
    ).resolves.toBeNull()
  })
})
