import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumb">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span
            key={i}
            style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
          >
            {it.href && !last ? (
              <Link href={it.href}>{it.label}</Link>
            ) : (
              <span className={last ? "crumb-current" : ""}>{it.label}</span>
            )}
            {!last && <span className="sep">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
