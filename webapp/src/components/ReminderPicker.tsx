import { useState } from 'react';
import { DateField } from './DateField';
import { hourAhead, selectedPreset } from '../lib/reminder-presets.mjs';
import { BellIcon, CheckIcon, ChevronDown } from './Icon';
import { addDays, formatMoment, fromDateKey, fromLocalInput, userMoment, toDateKey, toLocalInput } from '../lib/date';
import { useI18n } from '../lib/i18n';

type Option = { id: string; label: string; selected: boolean; disabled?: boolean; onSelect: () => void };

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  // День, к которому относится задача: от него считаются «накануне» и «утром».
  dateKey?: string;
  now: Date;
  // Варианты, которые считает сервер: «за 10 минут до пары», «за день до срока».
  options?: Option[];
  disabled?: boolean;
  title?: string;
};

type Preset = { id: string; label: string; at: string | null };

// Своё время по умолчанию — через пару часов, ровно по часам: 19:00, а не 18:37.
const roundedHourAhead = () => {
  const date = new Date(Date.now() + 2 * 3_600_000);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
};

// Напоминание одной строкой: текущее значение видно сразу, варианты раскрываются по нажатию.
export const ReminderPicker = ({ value, onChange, dateKey, now, options = [], disabled = false, title }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const future = (iso: string) => new Date(iso) > new Date();
  const presets: Preset[] = [{ id: 'none', label: t.remindNone, at: null }];
  if (dateKey) {
    const eve = userMoment(toDateKey(addDays(fromDateKey(dateKey), -1)), '19:00');
    const morning = userMoment(dateKey, '08:00');
    if (future(eve) || value === eve) presets.push({ id: 'eve', label: t.remindEve, at: eve });
    if (future(morning) || value === morning) presets.push({ id: 'morning', label: t.remindMorningOf, at: morning });
  } else {
    presets.push({ id: 'hour', label: t.remindHour, at: hourAhead(now) }, { id: 'tomorrow', label: t.remindTomorrow, at: userMoment(toDateKey(addDays(now, 1)), '08:00') });
  }
  const relative = options.find((option) => option.selected);
  const preset = relative ? null : selectedPreset(presets, value);
  const custom = !relative && (customOpen || (preset === 'custom' && Boolean(value)));
  const current = relative?.label ?? (value ? formatMoment(value) : t.remindNone);
  const pick = (action: () => void) => { action(); setCustomOpen(false); setOpen(false); };

  return (
    <div className={`reminder${open ? ' is-open' : ''}`}>
      <button type="button" className="reminder__row" aria-expanded={open} disabled={disabled} onClick={() => setOpen((state) => !state)}>
        <span className="reminder__icon" aria-hidden="true"><BellIcon size={18} /></span>
        <span className="reminder__text">
          <span className="reminder__title">{title ?? t.reminder}</span>
          <span className={`reminder__value${value || relative ? ' is-set' : ''}`}>{current}</span>
        </span>
        <ChevronDown size={18} className="reminder__chevron" />
      </button>
      {open && (
        <div className="reminder__options" role="radiogroup" aria-label={title ?? t.reminder}>
          {presets.map((item) => (
            <button key={item.id} type="button" role="radio" className="option" disabled={disabled}
              aria-checked={!custom && preset === item.id}
              onClick={() => pick(() => onChange(item.id === 'hour' ? hourAhead(new Date()) : item.at))}>
              <span className="option__label">{item.label}</span>
              {item.at && <span className="option__detail">{formatMoment(item.at)}</span>}
              <CheckIcon size={18} className="option__check" />
            </button>
          ))}
          {options.map((option) => (
            <button key={option.id} type="button" role="radio" className="option" aria-checked={option.selected}
              disabled={disabled || option.disabled} onClick={() => pick(option.onSelect)}>
              <span className="option__label">{option.label}</span>
              <CheckIcon size={18} className="option__check" />
            </button>
          ))}
          <button type="button" role="radio" className="option" aria-checked={custom} disabled={disabled}
            onClick={() => { setCustomOpen(true); if (!custom) onChange(roundedHourAhead()); }}>
            <span className="option__label">{t.remindCustom}</span>
            <CheckIcon size={18} className="option__check" />
          </button>
        </div>
      )}
      {open && custom && value && (
        <div className="reminder__custom">
          <DateField type="datetime-local" label={t.remindCustom} min={toLocalInput(new Date().toISOString())}
            value={toLocalInput(value)} onChange={(local) => onChange(fromLocalInput(local))} />
        </div>
      )}
    </div>
  );
};
