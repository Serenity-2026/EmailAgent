import React from 'react'
import { Button, Empty, Input, Modal, Spin, Alert } from 'antd'
import type { AgentConversation, AgentProposal, AgentStep, MailDraft, MailOverview, MailSummary } from '../../../../shared/models'
import { Markdown } from '../../markdown'

const RadarChart = React.lazy(async () => ({ default: (await import('@ant-design/plots')).Radar }))

function StepList({ steps }: { steps: AgentStep[] }): React.JSX.Element {
  return <div className="agent-steps">
    {steps.map((step) => <div key={step.id} className={`agent-step is-${step.status}`}>
      <span className="agent-step-dot" aria-hidden="true" />
      <div className="agent-step-body">
        <span className="agent-step-label">{step.label}</span>
        <span className="agent-step-detail">{step.summary || step.detail}</span>
      </div>
    </div>)}
  </div>
}

export function AgentView({ conversations, conversationId, activeConversation, busy, status, steps, proposal,
  prompt, overview, overviewLoading, overviewError, dark, accountCount, messagesRef,
  onClear, onSelectConversation, onLoadOverview, onOpenSource, onOpenDraft, onConfirm, onPrompt, onRun, onCancel, onOpenLink }: {
  conversations: AgentConversation[]; conversationId: string; activeConversation?: AgentConversation
  busy: boolean; status: string; steps?: AgentStep[]; proposal: AgentProposal | null; prompt: string
  overview: MailOverview | null; overviewLoading: boolean; overviewError: string; dark: boolean
  accountCount: number; messagesRef: React.RefObject<HTMLDivElement | null>
  onClear: () => void; onSelectConversation: (id: string) => void; onLoadOverview: (force?: boolean) => void
  onOpenSource: (source: MailSummary) => void; onOpenDraft: (draft: MailDraft) => void
  onConfirm: (proposal: AgentProposal) => Promise<void>; onPrompt: (value: string) => void; onRun: () => void
  onCancel: () => void; onOpenLink?: (url: string) => void
}): React.JSX.Element {
  const chartRef = React.useRef<HTMLDivElement | null>(null)
  const [chartKey, setChartKey] = React.useState(0)
  const [overviewCollapsed, setOverviewCollapsed] = React.useState(() => {
    try { return window.sessionStorage.getItem('agent-overview-collapsed') === '1' } catch { return false }
  })
  const toggleOverview = (): void => {
    setOverviewCollapsed((value) => {
      const next = !value
      try { window.sessionStorage.setItem('agent-overview-collapsed', next ? '1' : '0') } catch { /* Storage unavailable. */ }
      return next
    })
  }
  React.useEffect(() => {
    const target = chartRef.current
    if (!target || typeof ResizeObserver === 'undefined') return
    let timer = 0
    let width = Math.round(target.getBoundingClientRect().width)
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const next = Math.round(target.getBoundingClientRect().width)
        if (next === width) return
        width = next
        setChartKey((key) => key + 1)
      }, 150)
    })
    observer.observe(target)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [overview?.topics.length])
  return <section className="agent-layout">
    <div className="agent-history">
      <div className="agent-history-head"><span>对话记录</span><button onClick={onClear}
        disabled={!conversations.length && !busy}>清除</button></div>
      {conversations.map((conversation) => <button key={conversation.id}
        className={`agent-history-item ${conversation.id === conversationId ? 'active' : ''}`}
        onClick={() => onSelectConversation(conversation.id)}>
        {conversation.messages.find((message) => message.role === 'user')?.content || '新对话'}
      </button>)}
    </div>
    <div className="agent-chat">
      <div className="agent-messages" ref={messagesRef}>
        <div className={`agent-overview${overviewCollapsed ? ' is-collapsed' : ''}`}>
          <div className="agent-overview-head"><strong>最近 30 天</strong>
            <div className="agent-overview-actions">
              {!overviewCollapsed && <Button size="small" loading={overviewLoading}
                onClick={() => onLoadOverview(true)}>刷新</Button>}
              <Button size="small" aria-expanded={!overviewCollapsed} onClick={toggleOverview}>
                {overviewCollapsed ? '展开' : '收起'}</Button>
            </div></div>
          {overviewCollapsed ? null : overviewLoading && !overview ? <div className="top-spinner"><Spin /></div> : overviewError ?
            <Alert type="error" message={overviewError} /> : overview && <>
              <div className="overview-metrics">
                <div><span>收到</span><strong>{overview.received}</strong><span>封</span></div>
                <div><span>发出</span><strong>{overview.sent}</strong><span>封</span></div>
              </div>
              <div className="overview-people">
                <div><h3>常见发件人</h3>{overview.topSenders.length ? overview.topSenders.map((item) =>
                  <p key={item.address}>{item.address}<span>{item.count} 封</span></p>) : <span>暂无</span>}</div>
                <div><h3>常见收件人</h3>{overview.topRecipients.length ? overview.topRecipients.map((item) =>
                  <p key={item.address}>{item.address}<span>{item.count} 封</span></p>) : <span>暂无</span>}</div>
              </div>
              <div className="overview-chart"><h3>内容星图</h3>
                {overview.topics.length ? <div ref={chartRef}><React.Suspense fallback={<div className="top-spinner"><Spin /></div>}>
                  <RadarChart key={chartKey} data={overview.topics} xField="name" yField="count"
                    height={300} theme={dark ? 'classicDark' : 'classic'} />
                </React.Suspense></div> : <Empty description="暂无主题分布" />}
              </div>
              {overview.warnings.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
            </>}
        </div>
        {activeConversation?.messages.map((message) => <div key={message.id}
          className={`agent-message ${message.role}`}>
          <div className={`agent-message-text${message.role === 'assistant' ? '' : ' is-plain'}`}>
            {message.role === 'assistant' ? <Markdown text={message.content} onLink={onOpenLink}
              onCitation={message.sources?.length ? (number) => {
                const source = message.sources?.find((item) => item.citationNumber === number)
                if (source) onOpenSource(source)
              } : undefined} /> : message.content}
          </div>
          {message.scope && <div className="agent-scope">检索范围：{message.scope}</div>}
          {message.truncated && <div className="agent-limit">结果较多，仅分析了最近的部分邮件。请缩小检索条件。</div>}
          {message.warnings?.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
          {!!message.steps?.length && <details className="agent-steps-log">
            <summary>执行过程 · {message.steps.length} 步</summary>
            <StepList steps={message.steps} />
          </details>}
          {!!message.sources?.length && <div className="agent-sources">
            {message.sources.map((source, index) => <button key={`${source.accountId}-${source.folder}-${source.uid}-${index}`}
              onClick={() => onOpenSource(source)}>[{source.citationNumber || index + 1}] 查看原文：{source.subject} · {source.from}</button>)}
          </div>}
          {message.draft && <Button onClick={() => onOpenDraft(message.draft!)}>打开回复草稿</Button>}
          {message.actionResults?.map((result, index) => <div key={index}
            className={result.success ? 'agent-action-ok' : 'agent-warning'}>
            {result.success ? '已完成' : '失败'}：{result.mail.subject} ·
            {result.kind === 'archive' ? '归档' : result.kind === 'markRead' ? '标记已读' : '标记未读'}
            {result.error ? `（${result.error}）` : ''}
          </div>)}
        </div>)}
        {busy && !!steps?.length && <div className="agent-live">
          <div className="agent-live-head">执行过程</div>
          <StepList steps={steps} />
        </div>}
        {status && <div className="agent-progress">{busy && <Spin size="small" />}{status}</div>}
        {proposal && <div className="agent-proposal">
          <strong>待确认的整理操作</strong>
          {proposal.actions.map((action, index) => <div key={index}>
            {action.kind === 'archive' ? '归档' : action.kind === 'markRead' ? '标记已读' : '标记未读'} ·
            {action.mail.subject} · {action.mail.from} · {action.mail.accountAddress}
          </div>)}
          <Button type="primary" onClick={() => Modal.confirm({
            title: '确认整理这些邮件？',
            content: <div className="agent-confirm-list">{proposal.actions.map((action, index) => <div key={index}>
              {action.kind === 'archive' ? '归档' : action.kind === 'markRead' ? '标记已读' : '标记未读'} ·
              {action.mail.subject} · {action.mail.accountAddress}
            </div>)}</div>,
            okText: '确认执行', cancelText: '取消', onOk: () => onConfirm(proposal)
          })}>确认整理</Button>
        </div>}
      </div>
      <div className="agent-compose">
        <Input.TextArea value={prompt} rows={3} maxLength={1000}
          placeholder="例如：找出最近导师关于课程报告的邮件，总结待办并起草回复"
          onChange={(event) => onPrompt(event.target.value)} />
        {busy ? <Button danger onClick={onCancel}>取消任务</Button> :
          <Button type="primary" disabled={!prompt.trim() || !accountCount} onClick={onRun}>执行任务</Button>}
      </div>
    </div>
  </section>
}
