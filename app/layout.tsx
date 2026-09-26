import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SubastaMotor | Vehículos en tiempo real",
  description: "Plataforma de subastas de vehículos con pujas en tiempo real.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className="antialiased">{children}</body></html>;
}
