export interface ZonedClock {
  date: string
  time: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function isIanaTimeZone(value: string): boolean {
  if (!value || value.length > 100) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch { return false }
}

export function zonedClock(now: Date, timeZone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value)
  const year = value('year')
  const month = value('month')
  const day = value('day')
  const hour = value('hour')
  const minute = value('minute')
  const second = value('second')
  return {
    year, month, day, hour, minute, second,
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
}

export function startOfZonedDay(now: Date, timeZone: string): Date {
  const clock = zonedClock(now, timeZone)
  const target = Date.UTC(clock.year, clock.month - 1, clock.day)
  let candidate = target
  for (let index = 0; index < 3; index++) {
    const actual = zonedClock(new Date(candidate), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const adjustment = target - represented
    candidate += adjustment
    if (!adjustment) break
  }
  return new Date(candidate)
}
