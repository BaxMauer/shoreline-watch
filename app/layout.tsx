import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shoreline Watch",
  description: "Live und offline den Abstand zur kroatischen Küste sehen.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest?v=20",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Shoreline Watch",
  },
};

export const viewport: Viewport = {
  themeColor: "#06151b",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('shoreline-theme');if(['ocean','xp','dark','nautical'].includes(t))document.documentElement.dataset.theme=t;}catch(e){}})();` }} />
        <script dangerouslySetInnerHTML={{ __html: `(function(){if(!('serviceWorker' in navigator))return;navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(function(){return navigator.serviceWorker.ready;}).then(function(r){if(r.active)r.active.postMessage({type:'WARM_OFFLINE_BASE'});if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(function(){});}).catch(function(){});}());` }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
