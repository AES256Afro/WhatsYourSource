import type { CheckInput } from '../messaging/protocol';
import type { RawSource } from '../providers/types';
import type { CheckEvent } from './runCheck';

/** What the checking view shows while a provider streams: built here, displayed by CheckingView. */
export interface RunState {
  input: CheckInput;
  providerLabel: string;
  statuses: string[];
  /** Claims the first pass found, shown while the main pass runs. */
  claims: string[];
  text: string;
  queries: string[];
  sources: RawSource[];
  startedAt: number;
}

export function emptyRunState(input: CheckInput, providerLabel: string, statuses: string[] = [], claims: string[] = []): RunState {
  return { input, providerLabel, statuses, claims, text: '', queries: [], sources: [], startedAt: Date.now() };
}

/** Status rows that repeat per query or per page replace their predecessor; the chips keep the history. */
const REPEATING = /^(Searching|Reading)\b/;

/** Fold one stream event into the progress shown to the user. Pure: returns a new state. */
export function reduceProgress(state: RunState, ev: CheckEvent): RunState {
  switch (ev.type) {
    case 'status': {
      if (ev.done) return state;
      const kind = REPEATING.exec(ev.message)?.[1];
      const kept = kind ? state.statuses.filter((s) => !s.startsWith(kind)) : state.statuses;
      return { ...state, statuses: [...kept, ev.message] };
    }
    case 'delta':
      return { ...state, text: state.text + ev.text };
    case 'searchQueries':
      return {
        ...state,
        queries: ev.queries,
        statuses: [
          ...state.statuses.filter((x) => !x.startsWith('Searched')),
          `Searched · ${ev.queries.length} ${ev.queries.length === 1 ? 'query' : 'queries'}`,
        ],
      };
    case 'sources':
      return { ...state, sources: [...state.sources, ...ev.sources] };
    default:
      return state;
  }
}
