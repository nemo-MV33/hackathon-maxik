import { useState } from 'react';
import { DateField } from './DateField';
import { hourAhead, selectedPreset } from '../lib/reminder-presets.mjs';
import { BellIcon } from './Icon';
import { addDays, formatMoment, fromDateKey, fromLocalInput, userMoment, toDateKey, toLocalInput } from '../lib/date';
import { useI18n } from '../lib/i18n';

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  // День, к которому относится задача: от него считаются «накануне» и «утром».
  dateKey?: string;
  now: Date;
  options?: { id: string; label: string; selected: boolean; disabled?: boolean; onSelect: () => void }[];
  disabled?: boolean;
};

type Preset = { id: string; label: string; at: string | null };

// Своё время по умолчанию — через пару часов, ровно по часам: 19:00, а не 18:37.
const roundedHourAhead = () => {
  const date = new Date(Date.now() + 2 * 3_600_000);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
};

// Напоминание: готовые варианты на частые случаи и своё время для остального.
export const ReminderPicker = ({ value, onChange, dateKey, now, options = [], disabled = false }: Props) => {
  const { t } = useI18n();
  const [hour, setHour] = useState(() => hourAhead(new Date()));
  const future = (iso: string) => new Date(iso) > new Date();
  const presets: Preset[] = [{ id: 'none', label: t.remindNone, at: null }];
  if (dateKey) {
    const eve = userMoment(toDateKey(addDays(fromDateKey(dateKey), -1)), '19:00');
    const morning = userMoment(dateKey, '08:00');
    if (future(eve) || value === eve) presets.push({ id: 'eve', label: t.remindEve, at: eve });
    if (future(morning) || value === morning) presets.push({ id: 'morning', label: t.remindMorningOf, at: morning });
  } else {
    const tomorrow = userMoment(toDateKey(addDays(now, 1)), '08:00');
    presets.push({ id: 'hour', label: t.remindHour, at: hour }, { id: 'tomorrow', label: t.remindTomorrow, at: tomorrow });
  }
  const selected = selectedPreset(presets, value);
  const relative = options.some((option) => option.selected);
  const custom = selected === 'custom' && !relative;
  const min = toLocalInput(new Date().toISOString());

  return (
    <div className="reminder">
      <div className="reminder-presets" role="radiogroup" aria-label={t.reminder}>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            className="chip-option"
            disabled={disabled}
            aria-checked={!relative && selected === preset.id}
            onClick={() => {
              if (preset.id === 'hour') { const at = hourAhead(new Date()); setHour(at); onChange(at); }
              else onChange(preset.at);
            }}
          >
            {preset.label}
          </button>
        ))}
        {options.map((option) => <button key={option.id} type="button" role="radio" className="chip-option" aria-checked={option.selected} disabled={disabled || option.disabled} onClick={option.onSelect}>{option.label}</button>)}
        <button
          disabled={disabled}
          type="button"
          role="radio"
          className="chip-option"
          aria-checked={custom}
          onClick={() => onChange(value && custom ? value : roundedHourAhead())}
        >
          {t.remindCustom}
        </button>
      </div>
      {custom && <DateField type="datetime-local" label={t.remindCustom} min={min} value={toLocalInput(value!)} onChange={(local) => onChange(fromLocalInput(local))} />}
      {value && !custom && <p className="reminder__note"><BellIcon size={16} /> {formatMoment(value)}</p>}
    </div>
  );
};
