import { describe, expect, it } from 'vitest'
import { LoginAttemptLimiter } from './login-limiter'

describe('login attempt limiter', () => {
  it('blocks repeated failures by source and account, then recovers after the block', () => {
    let now = 1_000
    const limiter = new LoginAttemptLimiter(() => now, 3, 60_000, 30_000)
    for (let index = 0; index < 3; index++) limiter.recordFailure('127.0.0.1', 'DMC')
    expect(limiter.isBlocked('127.0.0.1', 'dmc')).toBe(true)
    expect(limiter.isBlocked('127.0.0.2', 'dmc')).toBe(false)
    expect(limiter.isBlocked('127.0.0.1', 'other')).toBe(false)
    now += 30_001
    expect(limiter.isBlocked('127.0.0.1', 'dmc')).toBe(false)
  })

  it('clears failures after a successful login', () => {
    const limiter = new LoginAttemptLimiter(() => 1_000, 2)
    limiter.recordFailure('local', 'dmc')
    limiter.recordSuccess('local', 'dmc')
    limiter.recordFailure('local', 'dmc')
    expect(limiter.isBlocked('local', 'dmc')).toBe(false)
  })
})
