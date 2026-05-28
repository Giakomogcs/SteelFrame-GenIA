import Link from "next/link";

export type NavKey =
  | "terrenos"
  | "novo"
  | "briefings"
  | "relatorios"
  | "base"
  | "design";

interface Props {
  active?: NavKey;
  /** badge counts (server-resolved) */
  counts?: Partial<Record<NavKey, number>>;
}

const Icon = {
  grid: (
    <svg className="icon-stroke nav-icon" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  pin: (
    <svg className="icon-stroke nav-icon" viewBox="0 0 24 24">
      <path d="M12 21s-7-7.5-7-12a7 7 0 1 1 14 0c0 4.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  ),
  refresh: (
    <svg className="icon-stroke nav-icon" viewBox="0 0 24 24">
      <path d="M3 12a9 9 0 1 0 4.5-7.79L3 7" />
      <path d="M3 3v4h4" />
    </svg>
  ),
  doc: (
    <svg className="icon-stroke nav-icon" viewBox="0 0 24 24">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
    </svg>
  ),
  book: (
    <svg className="icon-stroke nav-icon" viewBox="0 0 24 24">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  target: (
    <svg className="icon-stroke nav-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
};

function Item({
  href,
  icon,
  label,
  active,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
}) {
  return (
    <Link href={href} className={`nav-item${active ? " active" : ""}`}>
      {icon}
      <span>{label}</span>
      {typeof badge === "number" && badge > 0 && (
        <span className="nav-badge">{badge}</span>
      )}
    </Link>
  );
}

export function Sidebar({ active, counts = {} }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img
          src="/brand/logo_dt.svg"
          alt="SENAI Distrito Tecnológico"
          className="brand-mark"
        />
        <div className="brand-text">
          <span className="brand-name">SteelFrame GenIA</span>
          <span className="brand-sub">SENAI · Distrito Tecnológico</span>
        </div>
      </div>

      <div className="sidebar-section">
        <span className="sidebar-section-label">Operação</span>
        <Item
          href="/"
          icon={Icon.grid}
          label="Meus terrenos"
          active={active === "terrenos"}
          badge={counts.terrenos}
        />
        <Item
          href="/terrenos/novo"
          icon={Icon.pin}
          label="Novo terreno"
          active={active === "novo"}
        />
        <Item
          href="/briefings"
          icon={Icon.refresh}
          label="Briefings ativos"
          active={active === "briefings"}
          badge={counts.briefings}
        />
        <Item
          href="/relatorios"
          icon={Icon.doc}
          label="Relatórios"
          active={active === "relatorios"}
          badge={counts.relatorios}
        />
      </div>

      <div className="sidebar-section">
        <span className="sidebar-section-label">Referências</span>
        <Item
          href="/base-conhecimento"
          icon={Icon.book}
          label="Base de conhecimento"
          active={active === "base"}
        />
      </div>

      <div className="sidebar-user">
        <div className="avatar">RC</div>
        <div className="user-meta">
          <span className="user-name">Renata Couto</span>
          <span className="user-role">Eng. Civil · SteelFrame BR</span>
        </div>
      </div>
    </aside>
  );
}
