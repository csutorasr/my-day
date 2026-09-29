// Web push via VAPID. Degrades to "disabled" when web-push isn't installed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSubscriptions, removeSubscription } from '../lib/db.mjs';

export async function createPush(dir, subject) {
  let webpush;
  try {
    webpush = (await import('web-push')).default;
  } catch {
    return { enabled: false, publicKey: null, send: async () => 0 };
  }
  const file = join(dir, '.vapid.json');
  let keys = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  return {
    enabled: true,
    publicKey: keys.publicKey,
    async send(db, payload) {
      let sent = 0;
      for (const sub of listSubscriptions(db)) {
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(db, sub.endpoint);
          else console.error(`push failed: ${e.message}`);
        }
      }
      return sent;
    },
  };
}
