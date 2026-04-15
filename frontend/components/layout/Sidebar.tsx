"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/content-studio", label: "Content Studio" },
  { href: "/analytics", label: "Analytics" },
  { href: "/automation-control", label: "Automation Control" },
  { href: "/logs", label: "Logs" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">KevStack AI</div>
      <nav className="sidebar__nav">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`sidebar__link ${active ? "is-active" : ""}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
