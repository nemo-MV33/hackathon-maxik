import { useState } from 'react';
import { Sheet } from './Sheet';
import { ChevronRight, ClockIcon, CheckIcon } from './Icon';
import { useI18n } from '../lib/i18n';

const cities: Record<string, [string, string]> = {
  'Asia/Irkutsk': ['Иркутск', 'Irkutsk'], 'Europe/Moscow': ['Москва', 'Moscow'],
  'Europe/Kaliningrad': ['Калининград', 'Kaliningrad'], 'Europe/Samara': ['Самара', 'Samara'],
  'Asia/Yekaterinburg': ['Екатеринбург', 'Yekaterinburg'], 'Asia/Omsk': ['Омск', 'Omsk'],
  'Asia/Krasnoyarsk': ['Красноярск', 'Krasnoyarsk'], 'Asia/Novosibirsk': ['Новосибирск', 'Novosibirsk'],
  'Asia/Yakutsk': ['Якутск', 'Yakutsk'], 'Asia/Vladivostok': ['Владивосток', 'Vladivostok'],
  'Asia/Magadan': ['Магадан', 'Magadan'], 'Asia/Kamchatka': ['Камчатка', 'Kamchatka'],
};
export const TimeZonePicker = ({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (zone: string) => Promise<void> }) => {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const label = (zone: string) => {
    const city = cities[zone]?.[lang === 'ru' ? 0 : 1] ?? zone.split('/').at(-1)!.replace(/_/g, ' ');
    const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC');
    return `${city} · ${offset}`;
  };
  const all = [...new Set([value, ...Object.keys(cities), ...Intl.supportedValuesOf('timeZone')])];
  const options = (query.trim() ? all.filter((zone) => `${zone} ${label(zone)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : all.filter((zone) => zone === value || zone in cities)).slice(0, 40);
  return <>
    <button type="button" className="settings-row" disabled={disabled} onClick={() => { setQuery(''); setOpen(true); }}>
      <span className="settings-row__icon"><ClockIcon size={20} /></span>
      <span className="settings-row__text"><span className="settings-row__title">{t.timeZone}</span><span className="settings-row__hint">{label(value)}</span></span><ChevronRight size={18} />
    </button>
    {open && <Sheet title={t.timeZone} labelId="timezone-title" onClose={() => setOpen(false)} busy={disabled}>
      <label className="field-label">{t.searchTimeZone}<input autoFocus className="field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="choice-list choice-list--compact" role="radiogroup" aria-label={t.timeZone}>
        {options.map((zone) => <button key={zone} type="button" className="choice choice--compact timezone-choice" role="radio" aria-checked={value === zone} disabled={disabled} onClick={async () => { await onChange(zone); setOpen(false); }}><span className="choice__title">{label(zone)}</span>{value === zone && <CheckIcon size={18} />}</button>)}
      </div>
      {!options.length && <p className="hint">{t.noTimeZones}</p>}
    </Sheet>}
  </>;
};
