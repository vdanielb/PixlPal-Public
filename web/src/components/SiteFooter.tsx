import { InternalLink } from "./InternalLink";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Legal documents">
        <InternalLink href="/privacy">Privacy Policy</InternalLink>
        <InternalLink href="/terms">Terms of Service</InternalLink>
      </nav>
    </footer>
  );
}
