import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  invalidateProjectQueries,
  PROJECT_SCOPED_QUERY_KEYS,
  queryKeys,
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
