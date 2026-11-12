import React from 'react'
import { Alert, Button, Empty, Input, Select, Spin } from 'antd'
import type { MailDetail, MailSearchQuery, MailSummary } from '../../../../shared/models'
import { MailHtmlView } from '../../mail-html'

const dateText = (date: string): string => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(date))

export function MailView({ accountId, mails, selected, detail, mailLoading, detailLoading,
  search, warnings, truncated, hasMore, loadingMore,
  onSearch, onApplySearch, onClearSearch, onLoadMore, onOpenMail, onOpenLink, onReply }: {
  accountId: string; mails: MailSummary[]; selected: MailSummary | null; detail: MailDetail | null
  mailLoading: boolean; detailLoading: boolean
  search: MailSearchQuery; warnings: string[]; truncated: boolean; hasMore: boolean; loadingMore: boolean
  onSearch: (query: MailSearchQuery) => void; onApplySearch: () => void; onClearSearch: () => void; onLoadMore: () => void
  onOpenMail: (mail: MailSummary) => void; onOpenLink: (url: string) => void; onReply: () => void
}): React.JSX.Element {
  return <section className="content">
    <div className="mail-list">
      <div className="mail-list-head"><span>邮件列表</span><span>{mails.length} 封</span></div>
      <div className="mail-search">
        <Input size="small" placeholder="主题" value={search.subject || ''}
          onChange={(event) => onSearch({ ...search, subject: event.target.value })} />
        <Input size="small" placeholder="发件人" value={search.from || ''}
          onChange={(event) => onSearch({ ...search, from: event.target.value })} />
        <div className="mail-search-row">
          <Input size="small" type="date" aria-label="开始日期" value={search.since || ''}
            onChange={(event) => onSearch({ ...search, since: event.target.value || undefined })} />
          <Input size="small" type="date" aria-label="结束日期" value={search.before || ''}
            onChange={(event) => onSearch({ ...search, before: event.target.value || undefined })} />
        </div>
        <div className="mail-search-row">
          <Select size="small" value={search.unread === undefined ? 'all' : search.unread ? 'unread' : 'read'}
            onChange={(value) => onSearch({ ...search, unread: value === 'all' ? undefined : value === 'unread' })}
            options={[{ value: 'all', label: '全部状态' }, { value: 'unread', label: '仅未读' }, { value: 'read', label: '仅已读' }]} />
          <Button size="small" type="primary" onClick={onApplySearch}>搜索</Button>
          <Button size="small" onClick={onClearSearch}>清除</Button>
        </div>
      </div>
      {warnings.map((warning, index) => <Alert key={`${warning}-${index}`} type="warning" title={warning} showIcon />)}
      {truncated && <Alert type="info" title="搜索结果超过 200 封，仅提供最近 200 封，请缩小条件。" showIcon />}
      {mailLoading ? <div className="top-spinner"><Spin /></div> : mails.length ? mails.map((mail) =>
        <button key={`${mail.folder}-${mail.uid}`}
          className={`mail-row ${mail.unread ? 'unread' : ''} ${selected?.uid === mail.uid ? 'selected' : ''}`}
          onClick={() => onOpenMail(mail)}>
          <div className="mail-row-top"><span className="mail-row-from">{mail.from}</span><span className="mail-row-date">{dateText(mail.date)}</span></div>
          <div className="mail-row-subject">{mail.subject}</div>
        </button>) : <Empty description={accountId ? '当前文件夹或搜索条件下没有邮件' : '请先添加邮箱账户'} />}
      {!mailLoading && hasMore && <div className="mail-load-more"><Button loading={loadingMore} onClick={onLoadMore}>继续加载</Button></div>}
    </div>
    <div className="reader">
      {detailLoading ? <div className="top-spinner"><Spin /></div> : detail ? <article className="reader-card">
        <h2>{detail.subject}</h2>
        <div className="reader-meta">
          <div><strong>发件人：</strong>{detail.from}</div>
          <div><strong>收件人：</strong>{detail.to}</div>
          <div><strong>时间：</strong>{new Date(detail.date).toLocaleString('zh-CN')}</div>
          {detail.attachmentNames.length > 0 && <div><strong>附件：</strong>{detail.attachmentNames.join('、')}</div>}
        </div>
        <div className="reader-divider" />
        {detail.html ? <MailHtmlView key={`${detail.accountId}-${detail.folder}-${detail.uid}`}
          detail={detail} onOpenLink={onOpenLink} /> : <div className="mail-body">{detail.text}</div>}
        <div className="reader-actions"><Button onClick={onReply}>回复</Button></div>
      </article> : <div className="empty-pane"><Empty description="选择一封邮件查看" /></div>}
    </div>
  </section>
}
