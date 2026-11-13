import React from 'react'

export type IconName = 'mail' | 'digest' | 'chat' | 'search' | 'filter' | 'refresh' | 'pen' | 'reply'

export function Icon({ name, size = 15, className }: {
  name: IconName; size?: number; className?: string
}): React.JSX.Element {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    focusable="false" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    {name === 'mail' && <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </>}
    {name === 'digest' && <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>}
    {name === 'chat' && <>
      <path d="M20 12a8 8 0 0 1-8 8H7l-3.5 2.5V15A8 8 0 0 1 12 4a8 8 0 0 1 8 8Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </>}
    {name === 'search' && <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>}
    {name === 'filter' && <>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </>}
    {name === 'refresh' && <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20 3.5V9h-5.5" />
    </>}
    {name === 'pen' && <>
      <path d="m4 20 1-4.2L16.2 4.6l3.2 3.2L8.2 19 4 20Z" />
      <path d="m13.4 7.4 3.2 3.2" />
    </>}
    {name === 'reply' && <>
      <path d="m9.5 7-5 5 5 5" />
      <path d="M4.5 12h9a5.5 5.5 0 0 1 5.5 5.5V19" />
    </>}
  </svg>
}
