// Small localStorage wrapper so a mid-run page refresh doesn't lose context.
const KEYS = {
  lastTopic: 'researchmind:lastTopic',
  activeRunId: 'researchmind:activeRunId',
  activeSessionId: 'researchmind:activeSessionId',
};

function get(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — degrade silently
  }
}

export const storage = {
  getLastTopic: () => get(KEYS.lastTopic) || '',
  setLastTopic: (topic) => set(KEYS.lastTopic, topic),

  getActiveRunId: () => get(KEYS.activeRunId),
  setActiveRunId: (id) => set(KEYS.activeRunId, id != null ? String(id) : null),

  getActiveSessionId: () => get(KEYS.activeSessionId),
  setActiveSessionId: (id) => set(KEYS.activeSessionId, id),
};
