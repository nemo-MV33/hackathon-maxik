import { useState } from 'react';
import { useProfile } from './lib/profile';
import { Onboarding } from './screens/Onboarding';
import { Schedule } from './screens/Schedule';

export const App = () => {
  const [profile, saveProfile] = useProfile();
  const [changing, setChanging] = useState(false);

  if (!profile || changing) {
    return <Onboarding onDone={(value) => { saveProfile(value); setChanging(false); }} />;
  }
  return <Schedule profile={profile} onChangeGroup={() => setChanging(true)} />;
};
