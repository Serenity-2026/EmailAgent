import React from 'react'
import { Button, Empty, Spin } from 'antd'
import type { MailDetail, MailSummary } from '../../../../shared/models'
import { MailHtmlView } from '../../mail-html'

const dateText = (date: string): string => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(date))

export function MailView({ accountId, mails, selected, detail, mailLoading, detailLoading,
  onOpenMail, onOpenLink, onReply }: {
  accountId: string; mails: MailSummary[]; selected: MailSummary | null; detail: MailDetail | null
  mailLoading: boolean; detailLoading: boolean
  onOpenMail: (mail: MailSummary) => void; onOpenLink: (url: string) => void; onReply: () => void
}): React.JSX.Element {
  return <section className="content">
    <div className="mail-list">
      <div className="mail-list-head"><span>邮件列表</span><span>{mails.length} 封</span></div>
      {mailLoading ? <div className="top-spinner"><Spin /></div> : mails.length ? mails.map((mail) =>
        <button key={`${mail.folder}-${mail.uid}`}
          className={`mail-row ${mail.unread ? 'unread' : ''} ${selected?.uid === mail.uid ? 'selected' : ''}`}
          onClick={() => onOpenMail(mail)}>
          <div className="mail-row-top"><span className="mail-row-from">{mail.from}</span><span className="mail-row-date">{dateText(mail.date)}</span></div>
          <div className="mail-row-subject">{mail.subject}</div>
        </button>) : <Empty description={accountId ? '没有邮件' : '请先添加邮箱账户'} />}
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
