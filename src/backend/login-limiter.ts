interface LoginAttempts {
  failures: number[]
  blockedUntil: number
}

export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, LoginAttempts>()

  constructor(private readonly now: () => number = Date.now, private readonly maximumFailures = 5,
    private readonly windowMs = 10 * 60_000, private readonly blockMs = 5 * 60_000) {}

  private key(source: string, username: string): string {
    return `${source}\0${username.trim().toLowerCase()}`
  }

  isBlocked(source: string, username: string): boolean {
    const key = this.key(source, username)
    const entry = this.attempts.get(key)
    if (!entry) return false
    if (entry.blockedUntil > this.now()) return true
    const cutoff = this.now() - this.windowMs
    entry.failures = entry.failures.filter((time) => time > cutoff)
    if (!entry.failures.length) this.attempts.delete(key)
    return false
  }

  recordFailure(source: string, username: string): void {
    const key = this.key(source, username)
    const now = this.now()
    const cutoff = now - this.windowMs
    const entry = this.attempts.get(key) || { failures: [], blockedUntil: 0 }
    entry.failures = entry.failures.filter((time) => time > cutoff)
    entry.failures.push(now)
    if (entry.failures.length >= this.maximumFailures) entry.blockedUntil = now + this.blockMs
    this.attempts.set(key, entry)
  }

  recordSuccess(source: string, username: string): void {
    this.attempts.delete(this.key(source, username))
  }
}
