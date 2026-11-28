import { describe, expect, it } from 'vitest';
import { pickFrameSelection, sameSelection } from '@/lib/messaging/selectionTrust';

const at = (text: string) => ({ text, pageUrl: 'https://example.com/a', pageTitle: 'A' });
const USER = 'Vaccine X causes Y.';

describe('a right-click selection counts only with the words the browser reported', () => {
  it('matches across line breaks and runs of spaces', () => {
    expect(sameSelection('Vaccine X\ncauses   Y.', '  Vaccine X causes Y. ')).toBe(true);
  });

  it('refuses a swapped selection', () => {
    expect(sameSelection(USER, 'PAGE-CHOSEN: the bridge passed every inspection.')).toBe(false);
  });

  it('refuses a selection the page extended past the user’s text', () => {
    expect(sameSelection(USER, `${USER} PAGE-CHOSEN: and it is safe.`)).toBe(false);
  });

  it('refuses a shortened one', () => {
    expect(sameSelection(USER, 'Vaccine X')).toBe(false);
  });

  it('never matches an empty menu text', () => {
    expect(sameSelection('', '')).toBe(false);
    expect(sameSelection('   ', 'anything')).toBe(false);
  });
});

describe('frames', () => {
  it('with the menu text known, only a frame holding those words', () => {
    const found = [at('PAGE-CHOSEN: the bridge passed.'), at(USER)];
    expect(pickFrameSelection(found, USER)).toEqual(at(USER));
  });

  it('with no frame matching, none (the caller falls back to the browser’s text)', () => {
    expect(pickFrameSelection([at('PAGE-CHOSEN: the bridge passed.'), at(`${USER} and more`)], USER)).toBeNull();
  });

  it('without menu text (the keyboard shortcut), the first frame with a selection', () => {
    expect(pickFrameSelection([at('first'), at('second')], '')).toEqual(at('first'));
    expect(pickFrameSelection([], '')).toBeNull();
  });
});
