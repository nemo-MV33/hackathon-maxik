type IconProps = { size?: number; className?: string };

const svg = (size: number, className: string | undefined, path: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {path}
  </svg>
);

export const ChevronLeft = ({ size = 20, className }: IconProps) => svg(size, className, <path d="M14.5 6 8.5 12l6 6" />);
export const ChevronRight = ({ size = 20, className }: IconProps) => svg(size, className, <path d="m9.5 6 6 6-6 6" />);
export const SearchIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
