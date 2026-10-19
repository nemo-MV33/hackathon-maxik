import { useI18n } from '../lib/i18n';
import { CalendarIcon, ClockIcon } from './Icon';

// Нативный календарь остаётся доступен, видимая подпись не зависит от языка iOS.
export const DateField = ({ value, onChange, label, type = 'date', min, required, disabled, displayValue }: {
  displayValue?: string;
  value: string; onChange: (value: string) => void; label: string;
  type?: 'date' | 'datetime-local' | 'time'; min?: string; required?: boolean; disabled?: boolean;
}) => {
  const { t } = useI18n();
  const display = type === 'time' ? value : value ? new Intl.DateTimeFormat(t.locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    ...(type === 'datetime-local' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(new Date(`${value}${type === 'date' ? 'T12:00:00Z' : ':00Z'}`)) : '—';
  return <label className="date-field">
    <span className="date-field__label">{label}</span>
    <span className="date-field__control"><span>{displayValue ?? display}</span>{type === 'time' ? <ClockIcon size={18} /> : <CalendarIcon size={18} />}
      <input type={type} lang={t.locale} value={value} min={min} required={required} disabled={disabled}
        aria-label={label} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* Нативное открытие остаётся доступным в старых клиентах. */ } }}
        onChange={(event) => onChange(event.currentTarget.value)} />
    </span>
  </label>;
};
