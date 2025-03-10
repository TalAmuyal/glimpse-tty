import { app, session as ElectronSession, type Session } from 'electron';

export const sessionPromise = new Promise<Session>((resolve) => {
  app.whenReady().then(() => {
    const session = ElectronSession.fromPartition('persist:custom');
    session.clearHostResolverCache();
    resolve(session);
  });
});
