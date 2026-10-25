// Mugen Studio host kit: the Worker's main module. One Worker serves the
// lobby relay, the matchmaking queue and the online names + leaderboard for a
// host who pressed "Set up my servers" in the Studio (hostkit/deploy.js puts
// it on the host's own Cloudflare account and uploads this file with every
// module it imports).
//
//   relay.js        Room and Queue (the /ws relay and matchmaking)
//   ladder.js       Ladder (online names + leaderboard), on ladder-core.js
//   router.js       the HTTP layer: routes, CORS, body cap, rate limits
//
// Bindings (deploy.js): ROOM, QUEUE and LADDER, SQLite-backed Durable Object
// namespaces from migration tag v1; ADMIN_KEY, a secret for /admin/mugen/*.
//
// KEEP THIS FILE'S EXPORTS TO HANDLERS AND CLASSES. workerd refuses to start a
// Worker whose main module exports anything else (a constant is a startup
// error), which is why the settings live in router.js.

import { Room, Queue } from './relay.js';
import { Ladder } from './ladder.js';
import { createWorker } from './router.js';

export { Room, Queue, Ladder };

export default createWorker();
