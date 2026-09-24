import { useEffect, useState } from 'react';
import { startParam } from './bridge/max';
import type { Lesson } from './data/schedule';
import { decodeHomework, type SharedHomework } from './lib/homework';
import { useProfile } from './lib/profile';
import { loadGroups } from './data/schedule';
import { Onboarding } from './screens/Onboarding';
import { Schedule } from './screens/Schedule';
import { LessonScreen } from './screens/LessonScreen';
import { ImportScreen } from './screens/ImportScreen';
import { Loading } from './components/Status';

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
        onDone={async () => {
          const shared = route.shared;
          if (!profile && shared) {
            const group = (await loadGroups().catch(() => [])).find((item) => item.id === shared.groupId);
            if (group) saveProfile({ group, subgroup: shared.subgroup === 1 || shared.subgroup === 2 ? shared.subgroup : null });
          }
          toSchedule();
        }}
      />
    );
  }

  if (!profile || route.name === 'onboarding') {
    return <Onboarding onDone={(value) => { saveProfile(value); toSchedule(); }} />;
  }

  if (route.name === 'lesson') {
    return <LessonScreen lesson={route.lesson} profile={profile} onBack={toSchedule} />;
  }

  return (
    <Schedule
      profile={profile}
      onChangeGroup={() => setRoute({ name: 'onboarding' })}
      onOpenLesson={(lesson) => setRoute({ name: 'lesson', lesson })}
    />
  );
};
