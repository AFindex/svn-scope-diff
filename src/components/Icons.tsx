import type { SVGProps } from "react";

type IconName =
  | "app"
  | "folder"
  | "folderOpen"
  | "file"
  | "refresh"
  | "open"
  | "search"
  | "filter"
  | "chevron"
  | "external"
  | "empty"
  | "warning"
  | "repository"
  | "tree"
  | "list"
  | "sortAsc"
  | "sortDesc"
  | "commit"
  | "close";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const content = {
    app: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M12 4v16M8 9l-3 3 3 3M16 9l3 3-3 3" />
      </>
    ),
    folder: <path d="M3 7.5h7l2-2h3.5a2 2 0 0 1 2 2H21v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    folderOpen: (
      <>
        <path d="M3 8V6.5a2 2 0 0 1 2-2h5l2 2h6a2 2 0 0 1 2 2v1" />
        <path d="M4.5 9.5H22l-3 9H2z" />
      </>
    ),
    file: (
      <>
        <path d="M6 2.8h8l4 4V21H6z" />
        <path d="M14 2.8v4h4" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M18.2 16a8 8 0 1 1 .7-8.2L20 12" />
      </>
    ),
    open: (
      <>
        <path d="M3 7.5h7l2-2h3.5a2 2 0 0 1 2 2H21v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M8 13h8M12 9v8" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m16 16 4 4" />
      </>
    ),
    filter: (
      <>
        <path d="M4 6h16M7 12h10M10 18h4" />
        <circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    external: (
      <>
        <path d="M14 5h5v5M19 5l-8 8" />
        <path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </>
    ),
    empty: (
      <>
        <path d="M4 8h16v11H4z" />
        <path d="M8 8V5h8v3M9 13h6" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.5 20h19z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    repository: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="8" cy="19" r="2" />
        <path d="M7.5 6.3 16.5 6.8M7.2 6.8 7.8 17" />
      </>
    ),
    tree: (
      <>
        <path d="M6 4v16M6 8h5M6 16h5" />
        <rect x="11" y="5.5" width="8" height="5" rx="1" />
        <rect x="11" y="13.5" width="8" height="5" rx="1" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    sortAsc: (
      <>
        <path d="M8 18V5M4.5 8.5 8 5l3.5 3.5M14 7h6M14 12h4.5M14 17h3" />
      </>
    ),
    sortDesc: (
      <>
        <path d="M8 5v13M4.5 14.5 8 18l3.5-3.5M14 7h3M14 12h4.5M14 17h6" />
      </>
    ),
    commit: (
      <>
        <path d="M12 3v11M8 10l4 4 4-4" />
        <path d="M5 14v5h14v-5" />
        <path d="M8 19v-2h8v2" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
  }[name];

  return (
    <svg {...common} {...props}>
      {content}
    </svg>
  );
}
