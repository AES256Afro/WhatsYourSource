import { useEffect, useState } from 'react';
import { getShortcutLabel, shortcutLabelForPlatform } from '@/lib/shortcut';

/** The keyboard shortcut as currently bound, for labels; null when the user removed the binding. Starts with the platform default. */
export function useShortcutLabel(): string | null {
  const [label, setLabel] = useState<string | null>(() => shortcutLabelForPlatform());
  useEffect(() => {
    let alive = true;
    void getShortcutLabel().then((l) => alive && setLabel(l));
    return () => {
      alive = false;
    };
  }, []);
  return label;
}
