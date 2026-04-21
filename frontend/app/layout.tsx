import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";
import { ToastProvider } from "@/components/ui/ToastProvider";

export const metadata: Metadata = {
  title: "KevStack AI",
  description: "KevStack AI execution dashboard",
  icons: {
    icon: "/kevstack-icon.svg",
    shortcut: "/kevstack-icon.svg",
    apple: "/kevstack-icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <div className="app-shell">
            <Sidebar />
            <main className="app-main">
              <Navbar />
              <div className="app-content">{children}</div>
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
