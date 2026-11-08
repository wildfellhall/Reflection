import { EXPRESSIONS, type Expression } from './expressions';
import { PROMPT_BY_ID } from './prompts';

export const COMPLETED_PREFIX = 'reflection.completed.v1:';
export const SESSION_KEY = 'reflection.session.v1';
export type WritingSession = { promptId: string; expression: Expression | null; started: true; sent: boolean; draft: string };

/** Completed IDs are durable; response text exists only in the current tab's
 * session storage and is erased when sent. Separate completion keys prevent
 * concurrent tabs from overwriting each other's history. No identity tracking. */
export class ReflectionStore {
  completed(): Set<string> {
    const ids = new Set<string>();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(COMPLETED_PREFIX) && localStorage.getItem(key) === '1') ids.add(key.slice(COMPLETED_PREFIX.length));
      }
    } catch { /* The send operation reports unavailable persistence explicitly. */ }
    return ids;
  }
  loadSession(): WritingSession | null {
    try {
      const state = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
      if (!state || state.started !== true || !PROMPT_BY_ID.has(state.promptId) || typeof state.sent !== 'boolean'
        || typeof state.draft !== 'string' || state.draft.length > 20000
        || (state.expression !== null && !EXPRESSIONS.includes(state.expression))) return null;
      return state as WritingSession;
    } catch { return null; }
  }
  saveSession(state: WritingSession): boolean {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); return true; }
    catch { return false; }
  }
  complete(state: WritingSession): boolean {
    if (!PROMPT_BY_ID.has(state.promptId)) return false;
    // Persist the closed session before retiring the prompt. On failure restore
    // the draft; the UI must not claim a successful send without durable history.
    if (!this.saveSession({ ...state, sent: true, draft: '' })) return false;
    try {
      localStorage.setItem(COMPLETED_PREFIX + state.promptId, '1');
      return true;
    } catch {
      this.saveSession(state); return false;
    }
  }
}
