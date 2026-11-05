import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './app.css';

export const metadata: Metadata = {
  title: 'Penny',
  description:
    'Penny is an AI CFO for businesses that bill through PayPal. She joins your video calls, chases invoices, handles disputes, pays people, and remembers every decision.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
