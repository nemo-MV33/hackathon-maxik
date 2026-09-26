import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { startParam, webApp } from './bridge/max';
import type { Lesson } from './data/schedule';
import { decodeHomework, type SharedHomework } from './lib/homework';
import { useProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Schedule } from './screens/Schedule';
import { LessonScreen } from './screens/LessonScreen';
import { ImportScreen } from './screens/ImportScreen';
import { Loading } from './components/Status';
import { loadMe, syncProfile } from './lib/api';
import { isLang, useI18n } from './lib/i18n';

type Route =
  | { name: 'schedule' }
  | { name: 'onboarding' }
  | { name: 'lesson'; lesson: Lesson }
  | { name: 'import'; shared: SharedHomework | null }
  | { name: 'decoding' };

const initialRoute = (): Route => (startParam()?.startsWith('hw') ? { name: 'decoding' } : { name: 'schedule' });

export const App = () => {
  const [profile, saveProfile] = useProfile();
  const [route, setRoute] = useState<Route>(initialRoute);
  const [profileRevision, setProfileRevision] = useState(0);
  const scheduleScroll = useRef(0);
  const { lang, setLang } = useI18n();
  // В MAX профиль общий с ботом: сначала узнаём, что выбрано там, и только потом показываем экраны.
  const [ready, setReady] = useState(() => !webApp()?.initData);

  useEffect(() => {
    if (ready) return undefined;
    let active = true;
    const timer = window.setTimeout(() => setReady(true), 4_000);
    loadMe()
      .then(({ profile: remote }) => {
        if (!active) return;
        if (isLang(remote.lang) && remote.lang !== lang) setLang(remote.lang);
        if (remote.group) {
          saveProfile({
            group: { id: remote.group.id, title: remote.group.title, institute: remote.institute ?? '', course: remote.course },
            subgroup: remote.subgroup,
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  // Карточка пары открывается сверху, а расписание возвращается туда, где его листали.
  useLayoutEffect(() => {
    window.scrollTo(0, route.name === 'schedule' ? scheduleScroll.current : 0);
  }, [route]);

  useEffect(() => {
    if (!profile || !ready) return;
    let active = true;
    syncProfile(profile.group.id, profile.subgroup)
      .then(() => { if (active) setProfileRevision((value) => value + 1); })
      .catch(() => {});
    return () => { active = false; };
  }, [profile?.group.id, profile?.subgroup, ready]);

  useEffect(() => {
    if (route.name !== 'decoding') return;
    decodeHomework(startParam() ?? '').then((shared) => setRoute({ name: 'import', shared }));
  }, [route.name]);

  const toSchedule = () => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    setRoute({ name: 'schedule' });
  };

  if (route.name === 'decoding' || !ready) return <Loading />;

  if (route.name === 'import') {
    return (
      <ImportScreen
        shared={route.shared}
        profile={profile}
        onDone={(group) => {
          if (group && route.shared) saveProfile({ group, subgroup: route.shared.subgroup });
          toSchedule();
        }}
      />
    );
  }

  if (!profile || route.name === 'onboarding') {
    return (
      <Onboarding
        current={profile}
        onDone={(value) => { saveProfile(value); toSchedule(); }}
        onCancel={profile ? toSchedule : undefined}
      />
    );
  }

  if (route.name === 'lesson') {
    return <LessonScreen lesson={route.lesson} profile={profile} profileRevision={profileRevision} onBack={toSchedule} />;
  }

  return (
    <Schedule
      profile={profile}
      profileRevision={profileRevision}
      onChangeGroup={() => {
        scheduleScroll.current = window.scrollY;
        setRoute({ name: 'onboarding' });
      }}
      onOpenLesson={(lesson) => {
        scheduleScroll.current = window.scrollY;
        setRoute({ name: 'lesson', lesson });
      }}
    />
  );
};
