import { useCallback, useEffect, useState } from 'react';
import { loadSettings, onSettingsChanged, updateSettings, type Settings } from '@/lib/storage/settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => alive && setSettings(s));
    const off = onSettingsChanged((s) => alive && setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const update = useCallback(async (mutate: (s: Settings) => Settings) => {
    const next = await updateSettings(mutate);
    setSettings(next);
    return next;
  }, []);
  return { settings, update };
}

/** The `update` function from `useSettings`, for components that receive it as a prop. */
export type UpdateSettings = ReturnType<typeof useSettings>['update'];
