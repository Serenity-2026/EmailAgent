import { describe, expect, it, vi } from 'vitest'
import type { AgentAction } from '../shared/models'
import { AgentProposalRegistry, executeConfirmedActions } from './agent-proposals'

const action = (uid: number): AgentAction => ({
  kind: 'markRead',
  mail: { uid, accountId: 'one', accountAddress: 'one@qq.com', folder: 'INBOX', uidValidity: '22',
    from: 'sender@example.com', subject: `Mail ${uid}`, date: '2026-09-30T00:00:00.000Z', unread: true }
})

describe('confirmed Agent actions', () => {
  it('consumes a proposal exactly once and rejects an expired or previous-session proposal', () => {
    let now = 1_000
    const registry = new AgentProposalRegistry(() => now)
    const first = registry.create(4, 'conversation', [action(1)])
    expect(registry.take(first.id, 4).actions).toHaveLength(1)
    expect(() => registry.take(first.id, 4)).toThrow('失效')
    const second = registry.create(4, 'conversation', [action(2)])
    expect(() => registry.take(second.id, 5)).toThrow('失效')
    const third = registry.create(4, 'conversation', [action(3)])
    now += 10 * 60_000 + 1
    expect(() => registry.take(third.id, 4)).toThrow('失效')
  })

  it('reports each success and failure without claiming a failed action succeeded', async () => {
    const execute = vi.fn(async (item: AgentAction) => {
      if (item.mail.uid === 2) throw new Error('该邮箱没有可用的归档文件夹')
    })
    const results = await executeConfirmedActions([action(1), action(2), action(3)], execute, () => undefined)
    expect(results.map((item) => item.success)).toEqual([true, false, true])
    expect(results[1].error).toContain('归档文件夹')
  })

  it('stops before the next mailbox operation when the user logs out', async () => {
    let active = true
    const execute = vi.fn(async () => { active = false })
    await expect(executeConfirmedActions([action(1), action(2)], execute, () => {
      if (!active) throw new Error('登录状态已变化')
    })).rejects.toThrow('登录状态已变化')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
