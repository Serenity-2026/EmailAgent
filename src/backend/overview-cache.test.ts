import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailOverview } from '../shared/models'
import { overviewCache } from './overview-cache'

const accounts = [{ id: 'a', address: 'student@qq.com' }]
const overview: MailOverview = {
  since: '2026-11-13T00:00:00.000Z', received: 3, sent: 1, sampled: false,
  topSenders: [], topRecipients: [], topics: [], warnings: []
}

beforeEach(() => overviewCache.clearAll())
afterEach(() => vi.useRealTimers())

describe('overview cache', () => {
  it('reuses the overview while the account set is unchanged', () => {
    overviewCache.set('dmc', accounts, overview)
    expect(overviewCache.get('dmc', [{ id: 'a', address: 'student@qq.com' }])).toBe(overview)
  })

  it('ignores entries after the account set changes', () => {
    overviewCache.set('dmc', accounts, overview)
    expect(overviewCache.get('dmc', [{ id: 'a', address: 'other@qq.com' }])).toBeUndefined()
    expect(overviewCache.get('dmc', [...accounts, { id: 'b', address: 'student@163.com' }])).toBeUndefined()
  })

  it('keeps users apart and can be cleared', () => {
    overviewCache.set('dmc', accounts, overview)
    expect(overviewCache.get('student', accounts)).toBeUndefined()
    overviewCache.clear('dmc')
    expect(overviewCache.get('dmc', accounts)).toBeUndefined()
  })

  it('expires after the local day changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 13, 23, 0, 0))
    overviewCache.set('dmc', accounts, overview)
    vi.setSystemTime(new Date(2026, 10, 14, 0, 5, 0))
    expect(overviewCache.get('dmc', accounts)).toBeUndefined()
  })
})
