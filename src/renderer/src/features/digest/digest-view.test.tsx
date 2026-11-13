// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DigestHistoryItem } from '../../../../shared/models'
import { DigestView } from './digest-view'

const digest: DigestHistoryItem = {
  date: '2026-11-11', generatedAt: '2026-11-11T01:30:00.000Z', mode: 'auto',
  content: '今日摘要内容', sources: [], warnings: []
}

describe('digest history view', () => {
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

  it('shows generation metadata, history choice and a manual retry entry after failure', async () => {
    const retry = vi.fn()
    const root = createRoot(container)
    await act(async () => root.render(<DigestView digest={digest} history={[digest]} loading={false}
      error="自动摘要生成失败" onSelect={() => undefined} onRetry={retry} onOpenSource={() => undefined} />))
    expect(container.textContent).toContain('自动生成')
    expect(container.textContent).toContain('最近成功')
    expect(container.textContent).toContain('自动摘要生成失败')
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '立即重试')
    await act(async () => button?.click())
    expect(retry).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it('renders the AI summary as markdown instead of raw text', async () => {
    const root = createRoot(container)
    await act(async () => root.render(<DigestView digest={{
      ...digest, content: '## 总体概览\n\n共 **2 封** 邮件。\n\n- 第一项\n- 第二项'
    }} history={[]} loading={false} error="" onSelect={() => undefined} onRetry={() => undefined}
    onOpenSource={() => undefined} />))
    expect(container.querySelector('.digest-body h2')?.textContent).toBe('总体概览')
    expect(container.querySelector('.digest-body strong')?.textContent).toBe('2 封')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.textContent).not.toContain('##')
    await act(async () => root.unmount())
  })
})
