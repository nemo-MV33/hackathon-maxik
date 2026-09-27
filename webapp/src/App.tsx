import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { startParam, webApp } from './bridge/max';
import type { Lesson } from './data/schedule';
import { decodeHomework, type SharedHomework } from './lib/homework';
import { useProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Schedule } from './screens/Schedule';
import { LessonScreen } from './screens/LessonScreen';
import { ImportScreen } from './screens/ImportScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { InviteScreen } from './screens/InviteScreen';
import { ExamsScreen } from './screens/ExamsScreen';
import { Loading } from './components/Status';
import { loadMe, syncProfile } from './lib/api';
import { isLang, useI18n } from './lib/i18n';

type Route =
  | { name: 'schedule' }
  | { name: 'onboarding' }
  | { name: 'lesson'; lesson: Lesson }
  | { name: 'import'; shared: SharedHomework | null }
  | { name: 'decoding' }
  | { name: 'profile' }
  | { name: 'welcome' }
  | { name: 'exams' }
  | { name: 'invite'; groupId: number; subgroup: 1 | 2 | null };

// Кнопки в уведомлениях бота открывают приложение с start_param: day_2026-10-02 или lesson_2026-10-02_2_0.
export type LaunchTarget = { date: string; lessonNumber?: number; subgroup?: number | null };

const launchTarget = (): LaunchTarget | undefined => {
  const value = startParam() ?? '';
  const day = value.match(/^day_(\d{4}-\d{2}-\d{2})$/);
  if (day) return { date: day[1] };
  const lesson = value.match(/^lesson_(\d{4}-\d{2}-\d{2})_(\d{1,2})_([012])$/);
  if (lesson) return { date: lesson[1], lessonNumber: Number(lesson[2]), subgroup: Number(lesson[3]) || null };
  return undefined;
};

// Приглашение одногруппника: startapp=group_478237_1 — новичок сразу видит свою группу.
const initialRoute = (): Route => {
  const value = startParam() ?? '';
  if (value.startsWith('hw')) return { name: 'decoding' };
  const invite = value.match(/^group_(\d+)_([012])$/);
  if (invite) return { name: 'invite', groupId: Number(invite[1]), subgroup: invite[2] === '0' ? null : (Number(invite[2]) as 1 | 2) };
  return { name: 'schedule' };
};

export const App = () => {
  const [profile, saveProfile] = useProfile();
  const [route, setRoute] = useState<Route>(initialRoute);
  const [launch, setLaunch] = useState(launchTarget);
  const [profileRevision, setProfileRevision] = useState(0);
  const scheduleScroll = useRef(0);
  const { lang, setLang } = useI18n();
  // В MAX профиль общий с ботом: сначала узнаём, что выбрано там, и только потом показываем экраны.
  const [ready, setReady] = useState(() => !webApp()?.initData);
  // null — неизвестно (открыто вне MAX), тогда экран знакомства не показываем.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (ready) return undefined;
    let active = true;
    const timer = window.setTimeout(() => setReady(true), 4_000);
    loadMe()
      .then(({ profile: remote }) => {
        if (!active) return;
        setOnboarded(remote.onboarded);
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

  const afterGroupChosen = () => {
    if (onboarded === false) setRoute({ name: 'welcome' });
    else toSchedule();
  };

  if (route.name === 'invite') {
    return (
      <InviteScreen
        groupId={route.groupId}
        subgroup={route.subgroup}
        onAccept={(group, subgroup) => {
          saveProfile({ group, subgroup });
          if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
          afterGroupChosen();
        }}
        onOther={() => setRoute({ name: 'onboarding' })}
      />
    );
  }

  if (route.name === 'welcome' && profile) {
    return (
      <WelcomeScreen
        groupTitle={profile.group.title}
        onDone={(next) => {
          setOnboarded(true);
          setRoute(next === 'profile' ? { name: 'profile' } : { name: 'schedule' });
        }}
      />
    );
  }

  if (!profile || route.name === 'onboarding') {
    return (
      <Onboarding
        current={profile}
        onDone={(value) => { saveProfile(value); afterGroupChosen(); }}
        onCancel={profile ? toSchedule : undefined}
      />
    );
  }

  if (route.name === 'exams') {
    return (
      <ExamsScreen
        profile={profile}
        onBack={toSchedule}
        onOpenLesson={(lesson) => setRoute({ name: 'lesson', lesson })}
      />
    );
  }

  if (route.name === 'profile') {
    return (
      <ProfileScreen
        profile={profile}
        onBack={toSchedule}
        onChangeGroup={() => setRoute({ name: 'onboarding' })}
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
      launch={launch}
      onLaunchHandled={() => setLaunch(undefined)}
      onOpenExams={() => {
        scheduleScroll.current = window.scrollY;
        setRoute({ name: 'exams' });
      }}
      onOpenProfile={() => {
        scheduleScroll.current = window.scrollY;
        setRoute({ name: 'profile' });
      }}
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
