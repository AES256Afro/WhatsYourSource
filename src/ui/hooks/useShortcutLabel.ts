import { useEffect, useState } from 'react';
import { getShortcutLabel, shortcutLabelForPlatform } from '@/lib/shortcut';

/** The keyboard shortcut as currently bound, for labels. Starts with the platform default. */
export function useShortcutLabel(): string {
  const [label, setLabel] = useState(() => shortcutLabelForPlatform());
  useEffect(() => {
    let alive = true;
    void getShortcutLabel().then((l) => alive && setLabel(l));
    return () => {
      alive = false;
    };
  }, []);
  return label;
}
