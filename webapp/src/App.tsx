import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { startParam, webApp } from './bridge/max';
import type { Lesson } from './data/schedule';
import { decodeHomework, type SharedHomework } from './lib/homework';
import { useProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Schedule } from './screens/Schedule';
import { LessonScreen } from './screens/LessonScreen';
import { ImportScreen } from './screens/ImportScreen';
import { ProfileScreen, type ProfileSection } from './screens/ProfileScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { InviteScreen } from './screens/InviteScreen';
import { ExamsScreen } from './screens/ExamsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PlannerScreen } from './screens/PlannerScreen';
import { HeadmanScreen } from './screens/HeadmanScreen';
import { EntityScheduleScreen, type EntityTarget } from './screens/EntityScheduleScreen';
import { AccountScreen } from './screens/AccountScreen';
import { UniversityScreen } from './screens/UniversityScreen';
import { DisciplinesScreen, DisciplineScreen } from './screens/DisciplinesScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { AbsencesScreen, StudentScreen } from './screens/AbsencesScreen';
import { FaqScreen } from './screens/FaqScreen';
import { TabBar, type Tab } from './components/TabBar';
import { Loading } from './components/Status';
import { loadMe, syncProfile } from './lib/api';
import { isLang, useI18n } from './lib/i18n';
import { MeProvider, useMe } from './lib/me';

// Экраны поверх вкладок: открываются стопкой, «Назад» возвращает к предыдущему.
type Screen =
  | { name: 'lesson'; lesson: Lesson }
  | { name: 'profile' }
  | { name: 'section'; section: ProfileSection }
  | { name: 'discipline'; subject: string }
  | { name: 'student'; id: number }
  | { name: 'exams' }
  | { name: 'entity'; target: EntityTarget };

type Route =
  | { name: 'main' }
  | { name: 'onboarding' }
  | { name: 'import'; shared: SharedHomework | null }
  | { name: 'decoding' }
  | { name: 'welcome' }
  | { name: 'invite'; groupId: number; subgroup: 1 | 2 | null };

// Кнопки в уведомлениях бота открывают приложение с start_param: day_2026-10-02, lesson_2026-10-02_2_0 или plan.
export type LaunchTarget = { date: string; lessonNumber?: number; subgroup?: number | null };

const launchTarget = (): LaunchTarget | undefined => {
  const value = startParam() ?? '';
  const day = value.match(/^day_(\d{4}-\d{2}-\d{2})$/);
  if (day) return { date: day[1] };
  const lesson = value.match(/^lesson_(\d{4}-\d{2}-\d{2})_(\d{1,2})_([012])$/);
  if (lesson) return { date: lesson[1], lessonNumber: Number(lesson[2]), subgroup: Number(lesson[3]) || null };
  return undefined;
};

const initialTab = (): Tab => {
  const value = startParam() ?? '';
  if (value === 'plan') return 'planner';
  if (launchTarget()) return 'schedule';
  return 'home';
};

// Приглашение одногруппника: startapp=group_478237_1 — новичок сразу видит свою группу.
const initialRoute = (): Route => {
  const value = startParam() ?? '';
  if (value.startsWith('hw')) return { name: 'decoding' };
  const invite = value.match(/^group_(\d+)_([012])$/);
  if (invite) return { name: 'invite', groupId: Number(invite[1]), subgroup: invite[2] === '0' ? null : (Number(invite[2]) as 1 | 2) };
  return { name: 'main' };
};

export const App = () => {
  const [profile, saveProfile] = useProfile();
  const [route, setRoute] = useState<Route>(initialRoute);
  const [profileRevision, setProfileRevision] = useState(0);
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
        } else saveProfile(null);
      })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

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

  const toMain = () => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    setRoute({ name: 'main' });
  };

  if (route.name === 'decoding' || !ready) return <Loading />;

  if (route.name === 'import') {
    return (
      <ImportScreen
        shared={route.shared}
        profile={profile}
        onDone={(group) => {
          if (group && route.shared) saveProfile({ group, subgroup: route.shared.subgroup });
          toMain();
        }}
      />
    );
  }

  const afterGroupChosen = () => {
    if (onboarded === false) setRoute({ name: 'welcome' });
    else toMain();
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
        onDone={() => {
          setOnboarded(true);
          toMain();
        }}
      />
    );
  }

  if (!profile || route.name === 'onboarding') {
    return (
      <Onboarding
        current={profile}
        onDone={(value) => { saveProfile(value); afterGroupChosen(); }}
        onCancel={profile ? toMain : undefined}
      />
    );
  }

  return (
    <MeProvider revision={profileRevision}>
      <Main
        profile={profile}
        profileRevision={profileRevision}
        onChangeGroup={() => setRoute({ name: 'onboarding' })}
        onAccountDeleted={() => {
          saveProfile(null);
          setOnboarded(false);
          setRoute({ name: 'onboarding' });
        }}
      />
    </MeProvider>
  );
};

type MainProps = {
  profile: NonNullable<ReturnType<typeof useProfile>[0]>;
  profileRevision: number;
  onChangeGroup: () => void;
  onAccountDeleted: () => void;
};

const Main = ({ profile, profileRevision, onChangeGroup, onAccountDeleted }: MainProps) => {
  const { me } = useMe();
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [stack, setStack] = useState<Screen[]>([]);
  const [launch, setLaunch] = useState(launchTarget);
  const scroll = useRef(new Map<string, number>());
  const top = stack.at(-1);
  const isHeadman = me?.role === 'headman';
  const key = top ? `${stack.length}:${top.name}` : `tab:${tab}`;

  // Каждая вкладка и экран помнит, где его листали.
  useLayoutEffect(() => {
    window.scrollTo(0, scroll.current.get(key) ?? 0);
  }, [key]);

  const remember = () => scroll.current.set(key, window.scrollY);
  const push = (screen: Screen) => { remember(); setStack((current) => [...current, screen]); };
  const pop = () => {
    scroll.current.delete(key);
    setStack((current) => current.slice(0, -1));
  };
  const setTab = (next: Tab) => {
    remember();
    setStack([]);
    if (next === tab) scroll.current.set(`tab:${next}`, 0);
    setTabState(next);
  };
  const openLesson = (lesson: Lesson) => push({ name: 'lesson', lesson });
  const openProfile = () => push({ name: 'profile' });

  useEffect(() => {
    if (tab === 'headman' && me && !isHeadman) setTabState('home');
  }, [tab, me, isHeadman]);

  if (top?.name === 'lesson') {
    return <LessonScreen lesson={top.lesson} profile={profile} profileRevision={profileRevision} onBack={pop} />;
  }
  if (top?.name === 'exams') return <ExamsScreen profile={profile} onBack={pop} onOpenLesson={openLesson} />;
  if (top?.name === 'entity') return <EntityScheduleScreen target={top.target} onBack={pop} />;
  if (top?.name === 'profile') {
    return (
      <ProfileScreen
        profile={profile}
        onBack={pop}
        onOpen={(section) => push({ name: 'section', section })}
        onAccountDeleted={onAccountDeleted}
      />
    );
  }
  if (top?.name === 'section') {
    const back = pop;
    switch (top.section) {
      case 'account': return <AccountScreen profile={profile} onBack={back} />;
      case 'university': return <UniversityScreen profile={profile} onBack={back} onChangeGroup={onChangeGroup} />;
      case 'disciplines': return <DisciplinesScreen profile={profile} onBack={back} onOpen={(subject) => push({ name: 'discipline', subject })} />;
      case 'notifications': return <NotificationsScreen onBack={back} />;
      case 'absences': return <AbsencesScreen profile={profile} onBack={back} onOpenStudent={(id) => push({ name: 'student', id })} />;
      case 'faq': return <FaqScreen onBack={back} />;
      default: return null;
    }
  }
  if (top?.name === 'discipline') return <DisciplineScreen profile={profile} subject={top.subject} onBack={pop} />;
  if (top?.name === 'student') return <StudentScreen id={top.id} onBack={pop} />;

  return (
    <>
      {tab === 'home' && (
        <HomeScreen
          profile={profile}
          profileRevision={profileRevision}
          onOpenLesson={openLesson}
          onOpenProfile={openProfile}
          onOpenExams={() => push({ name: 'exams' })}
          onOpenPlanner={() => setTab('planner')}
        />
      )}
      {tab === 'schedule' && (
        <Schedule
          profile={profile}
          profileRevision={profileRevision}
          launch={launch}
          onLaunchHandled={() => setLaunch(undefined)}
          onOpenLesson={openLesson}
          onOpenProfile={openProfile}
          onOpenEntity={(target) => push({ name: 'entity', target })}
        />
      )}
      {tab === 'planner' && (
        <PlannerScreen profile={profile} profileRevision={profileRevision} onOpenLesson={openLesson} onOpenProfile={openProfile} />
      )}
      {tab === 'headman' && isHeadman && (
        <HeadmanScreen onOpenProfile={openProfile} onOpenStudent={(id) => push({ name: 'student', id })} />
      )}
      <TabBar tab={tab} onChange={setTab} headman={isHeadman} />
    </>
  );
};
