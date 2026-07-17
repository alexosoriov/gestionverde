import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ErrorReporter from "./error-reporter";
import FieldModeSupport from "./field-mode-support";
import GpsCameraGuard from "./gps-camera-guard";
import "./globals.css";
import "./mobile.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#123a31",
  colorScheme: "light",
};

export const metadata: Metadata = {
  title: "Ruta Verde · Santuario",
  description: "Control operativo seguro del recorrido de reciclaje.",
  applicationName: "Ruta Verde",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ruta Verde",
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  other: {
    "codex-preview": "development",
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon-192.png",
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-CL">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <GpsCameraGuard />
        <ErrorReporter />
        <FieldModeSupport />
      </body>
    </html>
  );
}
