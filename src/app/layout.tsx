import './globals.css'
export const metadata = { title: 'Thesis Assistant', description: 'AI 논문 연구 보조 도우미' }
export default function RootLayout({ children }: { children: React.ReactNode }) { return ( <html lang="ko"><body>{children}</body></html> ) }
