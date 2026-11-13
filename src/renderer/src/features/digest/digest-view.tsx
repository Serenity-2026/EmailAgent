import React from 'react'
import { Alert, Button, Empty, Select, Spin } from 'antd'
import type { DigestHistoryItem, MailSummary } from '../../../../shared/models'
import { Markdown } from '../../markdown'

export function DigestView({ digest, history, loading, error, onSelect, onRetry, onOpenSource, onOpenLink }: {
  digest: DigestHistoryItem | null; history: DigestHistoryItem[]; loading: boolean; error: string
  onSelect: (generatedAt: string) => void; onRetry: () => void; onOpenSource: (source: MailSummary) => void
  onOpenLink?: (url: string) => void
}): React.JSX.Element {
  return <section className="digest-view"><div className="digest-card">
    <h2>{digest?.date || '今日'} 邮件摘要</h2>
    {history.length > 0 && <Select value={digest?.generatedAt} onChange={onSelect} style={{ minWidth: 260, marginBottom: 16 }}
      options={history.map((item) => ({ value: item.generatedAt,
        label: `${item.date} · ${item.mode === 'auto' ? '自动' : '手动'} · ${new Date(item.generatedAt).toLocaleTimeString()}` }))} />}
    {error && <Alert type="error" title={error} style={{ marginBottom: 16 }}
      action={<Button size="small" onClick={onRetry}>立即重试</Button>} />}
    {loading ? <div className="top-spinner"><Spin /></div> : digest ? <>
      <div className="digest-meta">最近成功：{new Date(digest.generatedAt).toLocaleString()} ·
        {digest.mode === 'auto' ? ' 自动生成' : ' 手动生成'}</div>
      <div className="digest-body"><Markdown text={digest.content} onLink={onOpenLink} /></div>
      {digest.warnings.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
      {digest.sources.length > 0 && <>
        <div className="reader-divider" />
        <h3>来源邮件</h3>
        <div className="digest-sources">{digest.sources.map((source, index) =>
          <button key={`${source.accountId}-${source.uid}`} className="source-row" onClick={() => onOpenSource(source)}>
            [{index + 1}] {source.subject} · {source.from}
          </button>)}</div>
      </>}
    </> : <Empty description="还没有摘要" />}
  </div></section>
}
