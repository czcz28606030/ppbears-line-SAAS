import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';
// v0.4.3 – live agent hours, immediate tagging, Chinese brand support
// Manual rebuild trigger after Git reconnect

export const metadata: Metadata = {
  title: 'PPBears CS Admin',
  description: 'PPBears Omnichannel AI Customer Service Administration Panel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
