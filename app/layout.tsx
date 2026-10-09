import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "Score a fixed synthetic contract review against reference answers and trace every finding to the words of the contract. No live model is called.";

export const metadata: Metadata = {
  title: "Contract Review Evidence Lab",
  description,
  openGraph: { title: "Contract Review Evidence Lab", description, type: "website" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#11293b" },
    { media: "(prefers-color-scheme: dark)", color: "#08111a" },
  ],
};

// Runs before first paint so a stored light or dark choice never flashes the other theme.
const applyStoredTheme = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The inline script may set data-theme before React hydrates, so the attribute can differ from the server markup.
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* First in the body, not in a hand-written head: the framework owns the head, and a second one shifts React's generated ids. */}
        <script dangerouslySetInnerHTML={{ __html: applyStoredTheme }} />
        {children}
      </body>
    </html>
  );
}
