import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import '../styles/globals.css';

// `next/font` inlina a fonte e evita o flash de texto sem estilo. `display:
// swap` para o console nao ficar em branco enquanto a fonte carrega.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'BaaS Connector',
  description: 'Console de operacao do BaaS Connector',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
