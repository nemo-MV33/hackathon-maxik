import { addDays, formatMoment, fromDateKey, fromIrkutskInput, irkutskMoment, toDateKey, toIrkutskInput } from '../lib/date';
import { useI18n } from '../lib/i18n';

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  // День, к которому относится задача: от него считаются «накануне» и «утром».
  dateKey?: string;
  now: Date;
};

type Preset = { id: string; label: string; at: string | null };

// Своё время по умолчанию — через пару часов, ровно по часам: 19:00, а не 18:37.
const roundedHourAhead = () => {
  const date = new Date(Date.now() + 2 * 3_600_000);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
};

// Напоминание: готовые варианты на частые случаи и своё время для остального.
export const ReminderPicker = ({ value, onChange, dateKey, now }: Props) => {
  const { t } = useI18n();
  const future = (iso: string) => new Date(iso) > new Date();
  const presets: Preset[] = [{ id: 'none', label: t.remindNone, at: null }];
  if (dateKey) {
    const eve = irkutskMoment(toDateKey(addDays(fromDateKey(dateKey), -1)), '19:00');
    const morning = irkutskMoment(dateKey, '08:00');
    if (future(eve)) presets.push({ id: 'eve', label: t.remindEve, at: eve });
    if (future(morning)) presets.push({ id: 'morning', label: t.remindMorningOf, at: morning });
  } else {
    const hour = new Date(Date.now() + 3_600_000).toISOString();
    const tomorrow = irkutskMoment(toDateKey(addDays(now, 1)), '08:00');
    presets.push({ id: 'hour', label: t.remindHour, at: hour }, { id: 'tomorrow', label: t.remindTomorrow, at: tomorrow });
  }
  const matched = presets.find((preset) => preset.at === value);
  const custom = value !== null && !matched;
  const min = toIrkutskInput(new Date().toISOString());

  return (
    <div className="reminder">
      <div className="chips" role="radiogroup" aria-label={t.reminder}>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            className="chip-option"
            aria-checked={preset.at === value}
            onClick={() => onChange(preset.at)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          className="chip-option"
          aria-checked={custom}
          onClick={() => onChange(value && custom ? value : roundedHourAhead())}
        >
          {t.remindCustom}
        </button>
      </div>
      {custom && (
        <input
          className="field"
          type="datetime-local"
          min={min}
          value={toIrkutskInput(value!)}
          onChange={(event) => onChange(fromIrkutskInput(event.target.value))}
          aria-label={t.remindCustom}
        />
      )}
      {value && <p className="reminder__note">🔔 {formatMoment(value)} · {t.irkutskTime}</p>}
    </div>
  );
};
