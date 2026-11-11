import React from 'react'
import { Empty, Spin } from 'antd'
import type { DailyDigest, MailSummary } from '../../../../shared/models'

export function DigestView({ digest, loading, onOpenSource }: {
  digest: DailyDigest | null; loading: boolean; onOpenSource: (source: MailSummary) => void
}): React.JSX.Element {
  return <section className="digest-view"><div className="digest-card">
    <h2>{digest?.date || '今日'}邮件摘要</h2>
    {loading ? <div className="top-spinner"><Spin /></div> : digest ? <>
      <div className="digest-body">{digest.content}</div>
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
