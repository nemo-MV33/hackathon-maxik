import { haptic } from '../bridge/max';
import { useI18n } from '../lib/i18n';
import { CalendarIcon, ChecklistIcon, HomeIcon, MegaphoneIcon } from './Icon';

export type Tab = 'home' | 'schedule' | 'planner' | 'headman';

type Props = { tab: Tab; onChange: (tab: Tab) => void; headman: boolean };

// Нижняя навигация: три раздела у всех, четвёртый — инструменты старосты.
export const TabBar = ({ tab, onChange, headman }: Props) => {
  const { t } = useI18n();
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: t.tabHome, icon: <HomeIcon /> },
    { id: 'schedule', label: t.tabSchedule, icon: <CalendarIcon /> },
    { id: 'planner', label: t.tabPlanner, icon: <ChecklistIcon /> },
    ...(headman ? [{ id: 'headman' as Tab, label: t.tabHeadman, icon: <MegaphoneIcon /> }] : []),
  ];
  return (
    <nav className="tabbar" aria-label={t.sections}>
      <div className="tabbar__inner" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tabbar__item"
            aria-current={tab === item.id ? 'page' : undefined}
            aria-label={item.label}
            onClick={() => { if (tab !== item.id) haptic.tap(); onChange(item.id); }}
          >
            <span className="tabbar__icon">{item.icon}</span>
            <span className="tabbar__label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};
