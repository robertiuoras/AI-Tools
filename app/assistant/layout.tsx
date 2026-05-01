import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Assistant | AI Tools Directory',
  description: 'Embedded dashboard for your local personal assistant',
}

export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
