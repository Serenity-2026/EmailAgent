// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../../../../shared/models'
import { AgentView } from './agent-view'

describe('Agent cancellation controls', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })) })
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
  })

  afterEach(() => { container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('shows the current and final status and makes repeated cancel clicks safe', async () => {
    const onCancel = vi.fn()
    const root = createRoot(container)
    const render = (busy: boolean, status: string): void => root.render(<AgentView
      conversations={[]} conversationId="" busy={busy} status={status} proposal={null} prompt="总结邮件"
      overview={null} overviewLoading={false} overviewError="" dark={false} accountCount={1}
      messagesRef={{ current: null }} onClear={() => undefined} onSelectConversation={() => undefined}
      onLoadOverview={() => undefined} onOpenSource={() => undefined} onOpenDraft={() => undefined}
      onConfirm={async () => undefined} onPrompt={() => undefined} onRun={() => undefined} onCancel={onCancel} />)
    await act(async () => render(true, '正在检索邮件'))
    const cancel = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '取消任务')
    await act(async () => { cancel?.click(); cancel?.click() })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('正在检索邮件')
    await act(async () => render(false, '任务已取消'))
    expect(container.textContent).toContain('任务已取消')
    expect(container.textContent).toContain('执行任务')
    await act(async () => root.unmount())
  })

  it('renders assistant answers as markdown and keeps citation sources clickable', async () => {
    const openSource = vi.fn()
    const conversation: AgentConversation = {
      id: 'c1', updatedAt: new Date().toISOString(), messages: [
        { id: 'm1', role: 'user', content: '总结邮件\n第二行', createdAt: new Date().toISOString() },
        { id: 'm2', role: 'assistant', createdAt: new Date().toISOString(), content: '## 结论\n\n- 课程作业 [1]\n- 报告截止 [2]',
          sources: [{ accountId: 'a', accountAddress: 'me@example.com', uidValidity: '9', folder: 'INBOX', uid: 7, subject: '课程', from: 'teacher@example.com',
            date: new Date().toISOString(), unread: false, citationNumber: 1 }] }
      ]
    }
    const root = createRoot(container)
    await act(async () => root.render(<AgentView conversations={[conversation]} conversationId="c1"
      activeConversation={conversation} busy={false} status="" proposal={null} prompt=""
      overview={null} overviewLoading={false} overviewError="" dark={false} accountCount={1}
      messagesRef={{ current: null }} onClear={() => undefined} onSelectConversation={() => undefined}
      onLoadOverview={() => undefined} onOpenSource={openSource} onOpenDraft={() => undefined}
      onConfirm={async () => undefined} onPrompt={() => undefined} onRun={() => undefined}
      onCancel={() => undefined} />))
    const answer = container.querySelector('.agent-message.assistant')
    expect(answer?.querySelector('h2')?.textContent).toBe('结论')
    expect(answer?.querySelectorAll('li')).toHaveLength(2)
    expect(answer?.textContent).not.toContain('##')
    expect(container.querySelector('.agent-message.user .agent-message-text.is-plain')?.textContent).toContain('第二行')
    const citation = answer?.querySelector<HTMLButtonElement>('button.agent-inline-source')
    expect(citation?.textContent).toBe('[1]')
    await act(async () => citation?.click())
    expect(openSource).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})
