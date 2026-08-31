import type { ReactNode } from "react";
import { InternalLink } from "./InternalLink";

export function Topbar({
  titleIsHeading = false,
  children,
}: {
  /** True on the editor so the brand remains the page heading. */
  titleIsHeading?: boolean;
  children?: ReactNode;
}) {
  const brand = (
    <InternalLink href="/" className="brand-link">
      Pixl<em>Pal</em>
    </InternalLink>
  );

  return (
    <header className="topbar">
      {titleIsHeading ? <h1 className="brand">{brand}</h1> : <p className="brand">{brand}</p>}
      <nav className="legal-links" aria-label="Legal">
        <InternalLink href="/privacy">Privacy</InternalLink>
        <InternalLink href="/terms">Terms</InternalLink>
      </nav>
      {children}
    </header>
  );
}
