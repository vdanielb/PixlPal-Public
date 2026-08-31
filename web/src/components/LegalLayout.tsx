import { useEffect, type ReactNode } from "react";
import { formatLegalDate } from "../lib/legal";
import { SiteFooter } from "./SiteFooter";
import { Topbar } from "./Topbar";

export function LegalLayout({
  title,
  updatedIso,
  children,
}: {
  title: string;
  updatedIso: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · PixlPal`;
    return () => {
      document.title = "PixlPal";
    };
  }, [title]);

  return (
    <>
      <Topbar />
      <article className="legal-page">
        <header>
          <h1>{title}</h1>
          <p>
            Last updated: <time dateTime={updatedIso}>{formatLegalDate(updatedIso)}</time>
          </p>
        </header>
        {children}
      </article>
      <SiteFooter />
    </>
  );
}
