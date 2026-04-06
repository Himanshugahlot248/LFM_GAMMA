import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/common/ToastProvider";
import { ThemeProvider } from "@/context/ThemeContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Display serif for Gamma-style slide titles (preview). */
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});


export const metadata: Metadata = {
  title: "LF AI",
  description: "Create presentations from a prompt",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="relative z-10 flex flex-col min-h-full">
          <ThemeProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </ThemeProvider>
        </div>
      </body>
    </html>
  );
}
