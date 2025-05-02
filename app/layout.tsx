import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'webhooky',
  description: 'see what those webhooks are up to',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
