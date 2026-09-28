import { useState } from 'react';
import type { Lesson } from '../data/schedule';
import type { ControlForm } from '../lib/api';
import { formatDay, fromDateKey, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { loadSemesterLessons } from '../lib/lessons';
import { lessonKindName } from '../lib/lessonKind';
import { haptic } from '../bridge/max';
import { BackHeader } from '../components/BackHeader';
import { Empty, ErrorState, ScheduleSkeleton } from '../components/Status';
import { ChevronDown, ChevronRight } from '../components/Icon';

// Цвет закреплён за предметом: шесть пастелей по порядку в алфавитном списке, соседи не совпадают.
const subjectClass = (index: number) => `subject-${index % 6}`;

const FORMS: ControlForm[] = ['exam', 'credit', 'graded_credit', 'coursework', 'none'];

type Discipline = {
  subject: string;
  kinds: Map<string, number>;
  teachers: Map<string, Set<string>>;
  next: Lesson | null;
  total: number;
};

// Дисциплины собираются из расписания группы за семестр: предметы, виды занятий и полные ФИО преподавателей.
const collect = (lessons: Lesson[], todayKey: string) => {
  const map = new Map<string, Discipline>();
  for (const lesson of lessons) {
    const item = map.get(lesson.subject) ?? { subject: lesson.subject, kinds: new Map(), teachers: new Map(), next: null, total: 0 };
    item.total += 1;
    item.kinds.set(lesson.lessonType, (item.kinds.get(lesson.lessonType) ?? 0) + 1);
    for (const teacher of lesson.teachers) {
      const kinds = item.teachers.get(teacher) ?? new Set();
      kinds.add(lesson.lessonType);
      item.teachers.set(teacher, kinds);
    }
    if (!item.next && lesson.date >= todayKey) item.next = lesson;
    map.set(lesson.subject, item);
  }
  return [...map.values()].sort((left, right) => left.subject.localeCompare(right.subject, 'ru'));
};

const useDisciplines = (profile: LocalProfile) => {
  const todayKey = toDateKey(useNow());
  const [lessons, retry] = useAsync(() => loadSemesterLessons(profile.group.id, profile.subgroup), [profile.group.id, profile.subgroup]);
  const list = lessons.status === 'ready' ? collect(lessons.data, todayKey) : [];
  return { lessons, retry, list };
};

export const DisciplinesScreen = ({ profile, onBack, onOpen }: { profile: LocalProfile; onBack: () => void; onOpen: (subject: string) => void }) => {
  const { t } = useI18n();
  const { me } = useMe();
  const { lessons, retry, list } = useDisciplines(profile);
  const controls = me?.profile.controls ?? {};
  return (
    <div className="screen screen--section">
      <BackHeader label={t.profile} onBack={onBack} title={t.disciplines} />
      <p className="lead">{t.disciplinesLead(profile.group.title)}</p>
      {lessons.status === 'loading' && <ScheduleSkeleton rows={4} />}
      {lessons.status === 'error' && <ErrorState message={lessons.message} onRetry={retry} />}
      {lessons.status === 'ready' && list.length === 0 && <Empty title={t.disciplinesEmpty} />}
      <div className="discipline-list">
        {list.map((item, index) => (
          <button key={item.subject} type="button" className={`discipline ${subjectClass(index)}`} onClick={() => onOpen(item.subject)}>
            <span className="discipline__title">{item.subject}</span>
            <span className="discipline__meta">{[...item.teachers.keys()].slice(0, 2).join(', ') || t.noTeacher}</span>
            <span className="discipline__tags">
              {[...item.kinds.keys()].map((kind) => <span key={kind} className="tag">{lessonKindName(kind)}</span>)}
              {controls[item.subject] && controls[item.subject] !== 'none' && <span className="tag tag--control">{t.controlForms[controls[item.subject]]}</span>}
            </span>
            <ChevronRight size={18} className="discipline__chevron" />
          </button>
        ))}
      </div>
    </div>
  );
};

export const DisciplineScreen = ({ profile, subject, onBack }: { profile: LocalProfile; subject: string; onBack: () => void }) => {
  const { t } = useI18n();
  const { me, update } = useMe();
  const { lessons, retry, list } = useDisciplines(profile);
  const item = list.find((candidate) => candidate.subject === subject);
  const current = me?.profile.controls?.[subject] ?? '';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (value: string) => {
    setSaving(true);
    setError(null);
    try {
      await update({ controls: { [subject]: (value || null) as ControlForm | null } });
      haptic.tap();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen screen--section">
      <BackHeader label={t.disciplines} onBack={onBack} />
      <header className={`lesson-head ${subjectClass(item ? list.indexOf(item) : 0)}`}>
        <p className="eyebrow">{t.discipline}</p>
        <h1 className="display">{subject}</h1>
      </header>
      {lessons.status === 'loading' && <ScheduleSkeleton rows={2} />}
      {lessons.status === 'error' && <ErrorState message={lessons.message} onRetry={retry} />}
      {item && (
        <>
          <label className="select-field">
            <span className="field-label">{t.controlForm}</span>
            <span className="select-field__box">
              <select value={current} disabled={saving || !me} onChange={(event) => choose(event.target.value)}>
                <option value="">{t.controlNotSet}</option>
                {FORMS.map((form) => <option key={form} value={form}>{t.controlForms[form]}</option>)}
              </select>
              <ChevronDown size={18} />
            </span>
            <span className="hint">{t.controlHint}</span>
          </label>
          {error && <p className="toast toast--error" role="alert">{error}</p>}

          <p className="field-label">{t.teachers}</p>
          <div className="settings-list">
            {[...item.teachers.entries()].map(([teacher, kinds]) => (
              <div key={teacher} className="settings-row settings-row--static">
                <span className="settings-row__text">
                  <span className="settings-row__title">{teacher}</span>
                  <span className="settings-row__hint first-letter">{[...kinds].map(lessonKindName).join(', ')}</span>
                </span>
              </div>
            ))}
            {item.teachers.size === 0 && <p className="settings-row settings-row--static hint">{t.noTeacher}</p>}
          </div>

          <p className="field-label">{t.semesterLoad}</p>
          <dl className="facts facts--wide">
            {[...item.kinds.entries()].map(([kind, count]) => (
              <div key={kind}><dt>{lessonKindName(kind)}</dt><dd>{t.pairs(count)}</dd></div>
            ))}
            <div><dt>{t.nextLesson}</dt><dd className="first-letter">{item.next ? `${formatDay(fromDateKey(item.next.date))}, ${item.next.time.slice(0, 5)}` : t.noMoreLessons}</dd></div>
          </dl>
        </>
      )}
    </div>
  );
};
