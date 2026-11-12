import type { DigestHistoryItem } from '../shared/models'
import { zonedClock } from './timezone'

export interface DigestScheduleClaim {
  date: string
  attempt: number
}

export interface DigestRetryState {
  attempts: number
  retriesRemaining: number
  nextRetryAt?: string
}

export class DailyDigestCoordinator {
  private date = ''
  private failures = 0
  private nextAttemptAt = 0
  private running = false

  constructor(private readonly maximumAttempts = 4,
    private readonly backoffMs = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]) {}

  claim(now: Date, timeZone: string, dailyTime: string, history: DigestHistoryItem[]): DigestScheduleClaim | null {
    const local = zonedClock(now, timeZone)
    if (local.date !== this.date) {
      if (this.running) return null
      this.date = local.date
      this.failures = 0
      this.nextAttemptAt = 0
      this.running = false
    }
    if (this.running || local.time < dailyTime || this.failures >= this.maximumAttempts || now.getTime() < this.nextAttemptAt) return null
    if (history.some((item) => item.mode === 'auto' && item.date === local.date)) return null
    this.running = true
    return { date: local.date, attempt: this.failures + 1 }
  }

  succeed(): void {
    this.running = false
    this.failures = 0
    this.nextAttemptAt = 0
  }

  fail(now: Date): DigestRetryState {
    this.running = false
    const delay = this.backoffMs[Math.min(this.failures, this.backoffMs.length - 1)]
    this.failures++
    this.nextAttemptAt = this.failures < this.maximumAttempts ? now.getTime() + delay : Number.POSITIVE_INFINITY
    return {
      attempts: this.failures,
      retriesRemaining: Math.max(0, this.maximumAttempts - this.failures),
      ...(Number.isFinite(this.nextAttemptAt) ? { nextRetryAt: new Date(this.nextAttemptAt).toISOString() } : {})
    }
  }
}
