import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import util from 'node:util';

import { Http3Server } from '@fails-components/webtransport';

/* process command line */
let args;

try {
  args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      cert: { type: 'string' },
      key: { type: 'string' },
      port: { type: 'string', default: '27950' }
    }
  });

  if (args.values.help) {
    throw new Error();
  }

  if (!args.values.cert) {
    throw new Error('Missing required argument --cert');
  }

  if (!args.values.key) {
    throw new Error('Missing required argument --key');
  }
} catch (e) {
  console.error('Usage: master.js --cert <cert.pem> --key <key.pem> [--port <num>]');

  if (e.message) {
    console.error();
    console.error(e.message);
  }

  process.exit(1);
}

/* -- clients ----------------------------------------------------------------------------------- */

const clients = [];

function removeClient (session) {
  const idx = clients.indexOf(session);

  if (idx === -1) {
    return;
  }

  clients.splice(idx, 1);
}

function addClient (session) {
  const idx = clients.indexOf(session);

  if (idx !== -1) {
    return;
  }

  clients.push(session);
}

function handleSubscribe (session) {
  addClient(session);

  /* send all servers upon subscribing */
  sendGetServersResponse(session, servers);
}

/* -- servers ----------------------------------------------------------------------------------- */

const SERVER_PRUNE_INTERVAL = 350 * 1000;
const servers = {};

function serverid (addr, port) {
  return `${addr}:${port}`;
}

function updateServer (addr, port, info) {
  const id = serverid(addr, port);
  let server = servers[id];

  if (!server) {
    server = servers[id] = { addr, port };
  }

  /* FIXME does anything use info... */
  server.lastUpdate = Date.now();
  server.info = info;

  /* send partial update to all clients */
  for (const client of clients) {
    sendGetServersResponse(client, { id: server });
  }
}

function removeServer (id) {
  delete servers[id];

  console.log(`${id} timed out, ${Object.keys(servers).length} server(s) currently registered`);
}

function pruneServers () {
  const now = Date.now();

  for (const [id, server] of Object.entries(servers)) {
    const delta = now - server.lastUpdate;

    if (delta > SERVER_PRUNE_INTERVAL) {
      removeServer(id);
    }
  }
}

/* -- messages ---------------------------------------------------------------------------------- */

const CHALLENGE_MIN_LENGTH = 9;
const CHALLENGE_MAX_LENGTH = 12;

function prettyOOB (msg) {
  let pretty = '';

  for (let i = 0; i < msg.length; i++) {
    if (msg[i] >= 32 && msg[i] <= 126) {
      pretty += String.fromCharCode(msg[i]);
    } else {
      pretty += `\\x${msg[i].toString(16).padStart(2, '0')}`;
    }
  }

  return pretty;
}

function parseInfoString (str) {
  const info = {};
  const split = str.split('\\');

  // force to even
  split.length &= ~1;

  for (let i = 0; i < split.length - 1; i += 2) {
    info[split[i]] = split[i + 1];
  }

  return info;
}

function buildChallenge () {
  const CHALLENGE_CHARS = [
    '!', '#', '$', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', '<', '=', '>', '?', '@',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '[', ']', '^', '_', '`',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '{', '|', '}', '~'
  ];

  let challenge = '';
  let length = CHALLENGE_MIN_LENGTH - 1;

  length += parseInt(Math.random() * (CHALLENGE_MAX_LENGTH - CHALLENGE_MIN_LENGTH + 1), 10);

  for (let i = 0; i < length; i++) {
    challenge += CHALLENGE_CHARS[Math.floor(Math.random() * CHALLENGE_CHARS.length)];
  }

  return challenge;
}

function sendGetInfo (session) {
  const msg = buildChallenge();

  const buffer = Uint8Array.from(`\xff\xff\xff\xffgetinfo ${msg}\x00`, x => x.charCodeAt(0));
  console.log(`${session.addr}:${session.port} <--- ${prettyOOB(buffer)}`);
  session.write(buffer);
}

function sendGetServersResponse (session, servers) {
  let msg = '';
  for (const server of Object.values(servers)) {
    const octets = server.addr.split('.').map(x => parseInt(x, 10));

    msg += '\\';
    msg += String.fromCharCode(octets[0] & 0xff);
    msg += String.fromCharCode(octets[1] & 0xff);
    msg += String.fromCharCode(octets[2] & 0xff);
    msg += String.fromCharCode(octets[3] & 0xff);
    msg += String.fromCharCode((server.port & 0xff00) >> 8);
    msg += String.fromCharCode((server.port & 0x00ff) >> 0);
  }
  msg += '\\EOT';

  const buffer = Uint8Array.from(`\xff\xff\xff\xffgetserversResponse ${msg}\x00`, x => x.charCodeAt(0));
  console.log(`${session.addr}:${session.port} <--- ${prettyOOB(buffer)}`);
  session.write(buffer);
}

function handleInfoResponse (session, data) {
  const info = parseInfoString(data);

  updateServer(session.addr, session.port, info);
}

function handleHeartbeat (session, data) {
  sendGetInfo(session);
}

function handleGetServers (session, data) {
  sendGetServersResponse(session, servers);
}

function handleEmscriptenPort (session, data) {
  session.port = parseInt(data, 10);
}

/* ---------------------------------------------------------------------------------------------- */

const port = parseInt(args.values.port);
const cert = await fs.readFile(args.values.cert);
const key = await fs.readFile(args.values.key);
const secret = crypto.randomBytes(16).toString('hex');

const h3 = new Http3Server({
  host: '0.0.0.0',
  port,
  secret,
  cert,
  privKey: key
});

h3.startServer();

h3.ready.then(async () => {
  const sessionStream = await h3.sessionStream('/');
  const sessionReader = sessionStream.getReader();

  console.log(`listening on ${h3.host}:${h3.port}`);

  while (true) {
    const { done, value } = await sessionReader.read();
    const session = value;

    if (done) {
      break;
    }

    session.ready.then(async () => {
      const reader = session.datagrams.readable.getReader();
      const writer = session.datagrams.writable.getWriter();
      const [addr, port] = session.peerAddress.split(':');
      let first = true;

      session.addr = addr;
      session.port = port;

      session.write = (data) => {
        writer.write(data);
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          return;
        }

        console.log(`${session.addr}:${session.port} ---> ${prettyOOB(value)}`);

        const msg = String.fromCharCode.apply(null, value);

        if (first && msg.startsWith('\xff\xff\xff\xffport')) {
          handleEmscriptenPort(session, msg.substr(9));
        } else if (msg.startsWith('\xff\xff\xff\xffgetservers')) {
          handleGetServers(session, msg.substr(15));
        } else if (msg.startsWith('\xff\xff\xff\xffheartbeat')) {
          handleHeartbeat(session, msg.substr(14));
        } else if (msg.startsWith('\xff\xff\xff\xffinfoResponse')) {
          handleInfoResponse(session, msg.substr(18));
        } else if (msg.startsWith('\xff\xff\xff\xffsubscribe')) {
          handleSubscribe(session);
        } else {
          console.error(`unexpected message '${msg}'`);
        }

        first = false;
      }
    }).catch((e) => {
      console.error(`Stream error, peer ${session.addr}:${session.port}`, e);
    });

    session.closed.catch((e) => {
      console.error(`Stream error, peer ${session.addr}:${session.port}`, e);
    }).finally(() => {
      removeClient(session);
    });
  }
}).catch((e) => {
  console.error(e);
});

setInterval(pruneServers, SERVER_PRUNE_INTERVAL);
