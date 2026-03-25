import { create } from 'zustand';
import { Connection, Folder, Profile, Session, User } from '../types';

interface AppState {
  // Theme
  darkMode: boolean;
  toggleDarkMode: () => void;

  // Auth
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;

  // Tree data
  folders: Folder[];
  connections: Connection[];
  setFolders: (folders: Folder[]) => void;
  setConnections: (connections: Connection[]) => void;

  // Profiles
  profiles: Profile[];
  setProfiles: (profiles: Profile[]) => void;
  profileManagerOpen: boolean;
  setProfileManagerOpen: (open: boolean) => void;

  // Selected connection (properties panel)
  selectedConnectionId: string | null;
  setSelectedConnection: (id: string | null) => void;

  // Open sessions (tabs)
  sessions: Session[];
  activeSessionId: string | null;
  openSession: (connection: Connection, mode?: 'shell' | 'sftp', force?: boolean) => void;
  closeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  duplicateSession: (sessionId: string) => void;
  reconnectSession: (sessionId: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Theme
  darkMode: localStorage.getItem('darkMode') === 'true',
  toggleDarkMode: () => {
    set((state) => {
      const next = !state.darkMode;
      localStorage.setItem('darkMode', String(next));
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      return { darkMode: next };
    });
  },

  // Auth
  token: localStorage.getItem('token'),
  user: (() => {
    try {
      const u = localStorage.getItem('user');
      return u ? (JSON.parse(u) as User) : null;
    } catch {
      return null;
    }
  })(),

  setAuth: (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ token: null, user: null, sessions: [], activeSessionId: null });
  },

  // Tree
  folders: [],
  connections: [],
  setFolders: (folders) => set({ folders }),
  setConnections: (connections) => set({ connections }),

  // Profiles
  profiles: [],
  setProfiles: (profiles) => set({ profiles }),
  profileManagerOpen: false,
  setProfileManagerOpen: (open) => set({ profileManagerOpen: open }),

  // Selected connection
  selectedConnectionId: null,
  setSelectedConnection: (id) => set({ selectedConnectionId: id }),

  // Sessions
  sessions: [],
  activeSessionId: null,

  openSession: (connection, mode, force) => {
    const sessionMode = mode || (connection.protocol === 'rdp' ? undefined : 'shell');
    if (!force) {
      const existing = get().sessions.find(
        (s) => s.connection.id === connection.id && (s.mode || 'shell') === (sessionMode || 'shell')
      );
      if (existing) {
        set({ activeSessionId: existing.id });
        return;
      }
    }
    const id = `session-${Date.now()}-${Math.random()}`;
    const session: Session = { id, connection, mode: sessionMode };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: id,
    }));
  },

  closeSession: (sessionId) => {
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      const activeSessionId =
        state.activeSessionId === sessionId
          ? (sessions[sessions.length - 1]?.id ?? null)
          : state.activeSessionId;
      return { sessions, activeSessionId };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  duplicateSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const id = `session-${Date.now()}-${Math.random()}`;
    const newSession: Session = { id, connection: session.connection, mode: session.mode };
    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: id,
    }));
  },

  reconnectSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    // Replace session with a new ID to force React to remount the component
    const newId = `session-${Date.now()}-${Math.random()}`;
    const newSession: Session = { id: newId, connection: session.connection, mode: session.mode };
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? newSession : s)),
      activeSessionId: newId,
    }));
  },
}));
