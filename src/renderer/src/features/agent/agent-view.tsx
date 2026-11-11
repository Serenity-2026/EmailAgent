import React from 'react'
import { Button, Empty, Input, Modal, Spin, Alert } from 'antd'
import type { AgentConversation, AgentProposal, MailDraft, MailOverview, MailSummary } from '../../../../shared/models'

const RadarChart = React.lazy(async () => ({ default: (await import('@ant-design/plots')).Radar }))

export function AgentView({ conversations, conversationId, activeConversation, busy, status, proposal,
  prompt, overview, overviewLoading, overviewError, dark, accountCount, messagesRef,
  onClear, onSelectConversation, onLoadOverview, onOpenSource, onOpenDraft, onConfirm, onPrompt, onRun }: {
  conversations: AgentConversation[]; conversationId: string; activeConversation?: AgentConversation
  busy: boolean; status: string; proposal: AgentProposal | null; prompt: string
  overview: MailOverview | null; overviewLoading: boolean; overviewError: string; dark: boolean
  accountCount: number; messagesRef: React.RefObject<HTMLDivElement | null>
  onClear: () => void; onSelectConversation: (id: string) => void; onLoadOverview: () => void
  onOpenSource: (source: MailSummary) => void; onOpenDraft: (draft: MailDraft) => void
  onConfirm: (proposal: AgentProposal) => Promise<void>; onPrompt: (value: string) => void; onRun: () => void
}): React.JSX.Element {
  return <section className="agent-layout">
    <div className="agent-history">
      <div className="agent-history-head"><span>对话记录</span><button onClick={onClear}
        disabled={!conversations.length || busy}>清除</button></div>
      {conversations.map((conversation) => <button key={conversation.id}
        className={`agent-history-item ${conversation.id === conversationId ? 'active' : ''}`}
        onClick={() => onSelectConversation(conversation.id)}>
        {conversation.messages.find((message) => message.role === 'user')?.content || '新对话'}
      </button>)}
    </div>
    <div className="agent-chat">
      <div className="agent-messages" ref={messagesRef}>
        <div className="agent-overview">
          <div className="agent-overview-head"><strong>最近 30 天</strong>
            <Button size="small" loading={overviewLoading} onClick={onLoadOverview}>刷新</Button></div>
          {overviewLoading && !overview ? <div className="top-spinner"><Spin /></div> : overviewError ?
            <Alert type="error" message={overviewError} /> : overview && <>
              <div className="overview-metrics">
                <div><span>收到</span><strong>{overview.sampled ? '至少 ' : ''}{overview.received}</strong><span>封</span></div>
                <div><span>发出</span><strong>{overview.sampled ? '至少 ' : ''}{overview.sent}</strong><span>封</span></div>
              </div>
              <div className="overview-people">
                <div><h3>常见发件人</h3>{overview.topSenders.length ? overview.topSenders.map((item) =>
                  <p key={item.address}>{item.address}<span>{item.count} 封</span></p>) : <span>暂无</span>}</div>
                <div><h3>常见收件人</h3>{overview.topRecipients.length ? overview.topRecipients.map((item) =>
                  <p key={item.address}>{item.address}<span>{item.count} 封</span></p>) : <span>暂无</span>}</div>
              </div>
              <div className="overview-chart"><h3>内容星图</h3>
                {overview.topics.length ? <React.Suspense fallback={<div className="top-spinner"><Spin /></div>}>
                  <RadarChart data={overview.topics} xField="name" yField="count"
                    height={280} theme={dark ? 'classicDark' : 'classic'} />
                </React.Suspense> : <Empty description="暂无主题分布" />}
              </div>
              {overview.sampled && <div className="agent-warning">邮件数量超过检索上限，以上为抽样统计。</div>}
              {overview.warnings.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
            </>}
        </div>
        {activeConversation?.messages.map((message) => <div key={message.id}
          className={`agent-message ${message.role}`}>
          <div className="agent-message-text">{message.content.split(/(\[\d+\])/g).map((part, index) => {
            const number = /^\[(\d+)\]$/.exec(part)?.[1]
            const source = message.sources?.find((item) => item.citationNumber === Number(number))
            return source ? <button key={index} className="agent-inline-source"
              onClick={() => onOpenSource(source)}>{part}</button> : part
          })}</div>
          {message.scope && <div className="agent-scope">检索范围：{message.scope}</div>}
          {message.truncated && <div className="agent-limit">结果较多，仅分析了最近的部分邮件。请缩小检索条件。</div>}
          {message.warnings?.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
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
        {busy && <div className="agent-progress"><Spin size="small" />{status}</div>}
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
        <Button type="primary" loading={busy} disabled={!prompt.trim() || !accountCount} onClick={onRun}>执行任务</Button>
      </div>
    </div>
  </section>
}
