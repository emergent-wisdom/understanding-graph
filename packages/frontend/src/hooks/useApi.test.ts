import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  invalidateProjectQueries,
  PROJECT_SCOPED_QUERY_KEYS,
  projectRequestHeaders,
  queryKeys,
  scopedQueryKey,
  shouldFetchSemanticSearch,
} from './useApi'

describe('invalidateProjectQueries', () => {
  it('invalidates every project-scoped query family without invalidating the project list', async () => {
    const queryClient = new QueryClient()

    for (const queryKey of PROJECT_SCOPED_QUERY_KEYS) {
      queryClient.setQueryData([...queryKey, 'cached-value'], { cached: true })
    }
    queryClient.setQueryData(queryKeys.projects, [{ id: 'project-a' }])

    await invalidateProjectQueries(queryClient)

    for (const queryKey of PROJECT_SCOPED_QUERY_KEYS) {
      expect(
        queryClient.getQueryState([...queryKey, 'cached-value'])?.isInvalidated,
      ).toBe(true)
    }
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(
      false,
    )
  })
})

describe('projectRequestHeaders', () => {
  it('sends explicit project identity for project-scoped API reads', () => {
    expect(projectRequestHeaders('llada')).toEqual({
      'X-Project-Id': 'llada',
    })
  })

  it('omits the header before a project has been reconciled', () => {
    expect(projectRequestHeaders(null)).toEqual({})
  })
})

describe('scopedQueryKey', () => {
  it('keeps cached project data in separate query families', () => {
    expect(scopedQueryKey(queryKeys.graph, 'llada', false)).toEqual([
      'graph',
      'llada',
      false,
    ])
    expect(scopedQueryKey(queryKeys.graph, 'metamorphosis', false)).not.toEqual(
      scopedQueryKey(queryKeys.graph, 'llada', false),
    )
  })
})

describe('shouldFetchSemanticSearch', () => {
  it('requires both a useful query and an active project', () => {
    expect(shouldFetchSemanticSearch('ab', true)).toBe(true)
    expect(shouldFetchSemanticSearch('a', true)).toBe(false)
    expect(shouldFetchSemanticSearch('ab', false)).toBe(false)
  })
})
