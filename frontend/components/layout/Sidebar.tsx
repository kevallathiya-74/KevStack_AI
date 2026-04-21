"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/content-studio", label: "Content Studio" },
  { href: "/analytics", label: "Analytics" },
  { href: "/automation-control", label: "Automation Control" },
  { href: "/settings", label: "Settings" },
  { href: "/logs", label: "Logs" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="sidebar__brand" aria-label="KevStack AI Home">
        <Image
          src="/kevstack-logo.png"
          width={186}
          height={40}
          alt="KevStack AI"
          className="sidebar__brand-image"
          priority
        />
      </Link>
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
