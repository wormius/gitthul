import type { SessionSnapshot } from '@core/domain/session';

export interface SessionPort {
  read: () => Promise<SessionSnapshot>;
  write: (snapshot: SessionSnapshot) => Promise<void>;
  flush: () => Promise<void>;
}
