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
export const ChevronDown = ({ size = 20, className }: IconProps) => svg(size, className, <path d="m6 9.5 6 6 6-6" />);
export const SearchIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
export const UserIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8" /></>);
export const HomeIcon = ({ size = 22, className }: IconProps) =>
  svg(size, className, <><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>);
export const CalendarIcon = ({ size = 22, className }: IconProps) =>
  svg(size, className, <><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /></>);
export const ChecklistIcon = ({ size = 22, className }: IconProps) =>
  svg(size, className, <><path d="m4.5 7 1.8 1.8L9.5 5.5M4.5 15.5l1.8 1.8 3.2-3.3" /><path d="M12.5 7.5h7M12.5 16h7" /></>);
export const MegaphoneIcon = ({ size = 22, className }: IconProps) =>
  svg(size, className, <><path d="M4 10v4a1 1 0 0 0 1 1h2.5L14 19V5L7.5 9H5a1 1 0 0 0-1 1Z" /><path d="M17.5 9a4 4 0 0 1 0 6M8 15l1.2 4.5" /></>);
export const PlusIcon = ({ size = 20, className }: IconProps) => svg(size, className, <path d="M12 5v14M5 12h14" />);
export const CloseIcon = ({ size = 20, className }: IconProps) => svg(size, className, <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />);
export const BellIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>);
export const BookIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z" /><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5" /></>);
export const ClockIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>);
export const HelpIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8v.2" /></>);
export const PaletteIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.8 1.6-1.6 0-1.2-1-1.6-1-2.6 0-1 .8-1.6 1.8-1.6h2.1a4 4 0 0 0 4-4C20.5 6.6 16.7 3.5 12 3.5Z" /><circle cx="7.8" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="14.8" cy="7.8" r="1" /></>);
export const SchoolIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><path d="m3 9 9-4.5L21 9l-9 4.5z" /><path d="M7 11v4.5c1.4 1.3 3 2 5 2s3.6-.7 5-2V11M21 9v5" /></>);
export const IdIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><rect x="3.5" y="5" width="17" height="14" rx="3" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.6-1.4 1.6-2 3-2s2.4.6 3 2M14.5 10h3M14.5 13.5h3" /></>);
export const TrashIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" /><path d="M10.2 11v5M13.8 11v5" /></>);
export const RunIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="14.5" cy="4.8" r="1.8" /><path d="m7 21 3-6 3 2.5V21M10 15l1.5-5.5L16 12l2.5-1.5M11.5 9.5 8 9l-2.5 3" /></>);
export const ShareIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><path d="M12 15V4M8 8l4-4 4 4" /><path d="M6 11.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7.5" /></>);
export const GlobeIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5Z" /></>);
