import { randomUUID } from 'node:crypto'
import type { AgentAction, AgentActionResult, AgentProposal } from '../shared/models'

export class AgentProposalRegistry {
  private readonly proposals = new Map<string, {
    version: number; conversationId: string; actions: AgentAction[]; expiresAt: number
  }>()

  constructor(private readonly now: () => number = Date.now) {}

  create(version: number, conversationId: string, actions: AgentAction[]): AgentProposal {
    for (const [id, proposal] of this.proposals) {
      if (proposal.expiresAt < this.now()) this.proposals.delete(id)
    }
    const id = randomUUID()
    const expiresAt = this.now() + 10 * 60_000
    this.proposals.set(id, { version, conversationId, actions, expiresAt })
    return { id, actions, expiresAt: new Date(expiresAt).toISOString() }
  }

  take(id: string, version: number): { conversationId: string; actions: AgentAction[] } {
    const proposal = this.proposals.get(id)
    this.proposals.delete(id)
    if (!proposal || proposal.expiresAt < this.now() || proposal.version !== version) {
      throw new Error('操作提案已失效，请重新发起任务')
    }
    return { conversationId: proposal.conversationId, actions: proposal.actions }
  }

  clear(): void {
    this.proposals.clear()
  }
}

export async function executeConfirmedActions(
  actions: AgentAction[],
  execute: (action: AgentAction) => Promise<void>,
  ensureActive: () => void
): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = []
  for (const action of actions) {
    ensureActive()
    try {
      await execute(action)
      results.push({ ...action, success: true })
    } catch (error) {
      results.push({ ...action, success: false, error: error instanceof Error ? error.message : '操作失败' })
    }
  }
  ensureActive()
  return results
}
