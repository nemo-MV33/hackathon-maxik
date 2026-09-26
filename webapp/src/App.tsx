import { useEffect, useState } from 'react';
import { startParam } from './bridge/max';
import type { Lesson } from './data/schedule';
import { decodeHomework, type SharedHomework } from './lib/homework';
import { useProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Schedule } from './screens/Schedule';
import { LessonScreen } from './screens/LessonScreen';
import { ImportScreen } from './screens/ImportScreen';
import { Loading } from './components/Status';
import { syncProfile } from './lib/api';

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

  useEffect(() => {
    if (!profile) return;
    let active = true;
    syncProfile(profile.group.id, profile.subgroup)
      .then(() => { if (active) setProfileRevision((value) => value + 1); })
      .catch(() => {});
    return () => { active = false; };
  }, [profile?.group.id, profile?.subgroup]);

  useEffect(() => {
    if (route.name !== 'decoding') return;
    decodeHomework(startParam() ?? '').then((shared) => setRoute({ name: 'import', shared }));
  }, [route.name]);

  const toSchedule = () => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    setRoute({ name: 'schedule' });
  };

  if (route.name === 'decoding') return <Loading />;

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
    return <Onboarding onDone={(value) => { saveProfile(value); toSchedule(); }} />;
  }

  if (route.name === 'lesson') {
    return <LessonScreen lesson={route.lesson} profile={profile} profileRevision={profileRevision} onBack={toSchedule} />;
  }

  return (
    <Schedule
      profile={profile}
      profileRevision={profileRevision}
      onChangeGroup={() => setRoute({ name: 'onboarding' })}
      onOpenLesson={(lesson) => setRoute({ name: 'lesson', lesson })}
    />
  );
};
