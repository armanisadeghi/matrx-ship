import type { Metadata } from "next";
import { ThemeProvider } from "@matrx/admin-ui/components/theme-provider";
import { ConfirmProvider } from "@matrx/admin-ui/components/confirm-dialog";
import { Toaster } from "@matrx/admin-ui/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matrx Server Manager",
  description: "Deploy and manage isolated application instances",
  icons: {
    icon: [
      { url: "/admin/matrx-icon-purple.svg", type: "image/svg+xml" },
    ],
    apple: "/admin/matrx-icon-purple.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ConfirmProvider>
            {children}
            <Toaster position="bottom-right" richColors />
          </ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
