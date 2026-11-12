import { describe, expect, it } from 'vitest'
import type { DigestHistoryItem } from '../shared/models'
import { DailyDigestCoordinator } from './digest-scheduler'
import { startOfZonedDay, zonedClock } from './timezone'

const saved = (date: string): DigestHistoryItem => ({
  date, generatedAt: `${date}T01:00:00.000Z`, mode: 'auto', content: '摘要', sources: [], warnings: []
})

describe('daily digest time zone and retries', () => {
  it('uses the user time zone across UTC midnight', () => {
    const now = new Date('2026-11-11T16:30:00.000Z')
    expect(zonedClock(now, 'Asia/Shanghai')).toMatchObject({ date: '2026-11-12', time: '00:30' })
    expect(zonedClock(now, 'America/Los_Angeles')).toMatchObject({ date: '2026-11-11', time: '08:30' })
  })

  it('calculates local midnight correctly on both sides of daylight saving time', () => {
    expect(startOfZonedDay(new Date('2026-03-08T16:00:00.000Z'), 'America/New_York').toISOString())
      .toBe('2026-03-08T05:00:00.000Z')
    expect(startOfZonedDay(new Date('2026-11-01T17:00:00.000Z'), 'America/New_York').toISOString())
      .toBe('2026-11-01T04:00:00.000Z')
  })

  it('backs off after failure and stops after the bounded attempt count', () => {
    const scheduler = new DailyDigestCoordinator(3, [1_000, 2_000, 4_000])
    let now = new Date('2026-11-11T01:00:00.000Z')
    expect(scheduler.claim(now, 'UTC', '01:00', [])?.attempt).toBe(1)
    expect(scheduler.claim(now, 'UTC', '01:00', [])).toBeNull()
    expect(scheduler.fail(now)).toMatchObject({ attempts: 1, retriesRemaining: 2 })
    now = new Date(now.getTime() + 999)
    expect(scheduler.claim(now, 'UTC', '01:00', [])).toBeNull()
    now = new Date(now.getTime() + 1)
    expect(scheduler.claim(now, 'UTC', '01:00', [])?.attempt).toBe(2)
    scheduler.fail(now)
    now = new Date(now.getTime() + 2_000)
    expect(scheduler.claim(now, 'UTC', '01:00', [])?.attempt).toBe(3)
    scheduler.fail(now)
    now = new Date(now.getTime() + 60_000)
    expect(scheduler.claim(now, 'UTC', '01:00', [])).toBeNull()
  })

  it('deduplicates a completed day after backend or desktop reconnection', () => {
    const now = new Date('2026-11-11T09:30:00.000Z')
    const first = new DailyDigestCoordinator()
    expect(first.claim(now, 'Asia/Shanghai', '09:00', [])).not.toBeNull()
    first.succeed()
    const reconnected = new DailyDigestCoordinator()
    expect(reconnected.claim(now, 'Asia/Shanghai', '09:00', [saved('2026-11-11')])).toBeNull()
  })

  it('does not start a second job when an earlier run crosses local midnight', () => {
    const scheduler = new DailyDigestCoordinator()
    expect(scheduler.claim(new Date('2026-11-11T23:59:00.000Z'), 'UTC', '23:00', [])).not.toBeNull()
    expect(scheduler.claim(new Date('2026-11-12T00:01:00.000Z'), 'UTC', '00:00', [])).toBeNull()
    scheduler.succeed()
    expect(scheduler.claim(new Date('2026-11-12T00:02:00.000Z'), 'UTC', '00:00', [])).not.toBeNull()
  })
})
