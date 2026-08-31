import type { MouseEvent, ReactNode } from "react";
import { navigate, normalizePath } from "../lib/routing";

export function InternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const current = typeof window !== "undefined" ? normalizePath(window.location.pathname) : "/";
  const active = current === normalizePath(href);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} className={className} onClick={onClick} aria-current={active ? "page" : undefined}>
      {children}
    </a>
  );
}
