import demoq3 from '../lib/demoq3.js';
import fetchRetry from 'fetch-retry';
import fs from 'node:fs/promises';
import ioq3ded from '../build/ioq3ded.js';
import pak from '../lib/pak.js';
import path from 'path';
import util from 'node:util';

fetch = fetchRetry(fetch);

/* process command line */
let args;

try {
  args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      data: { type: 'string' },
      game: { type: 'string', default: 'baseq3' },
      cert: { type: 'string' },
      key: { type: 'string' },
      content: { type: 'string', default: 'http://localhost:8081' },
    },
    allowPositionals: true
  });

  if (args.values.help) {
    throw new Error();
  }

  if (!args.values.data) {
    throw new Error('Missing required argument --data');
  }

  if (!args.values.cert) {
    throw new Error('Missing required argument --cert');
  }

  if (!args.values.key) {
    throw new Error('Missing required argument --key');
  }
} catch (e) {
  console.error('Usage: dedicated.js --data <path> [--game <baseq3>] --cert <cert.pem> --key <key.pem> [--content <http://content.quakejs.com>] [cmdline]');

  if (e.message) {
    console.error();
    console.error(e.message);
  }

  process.exit(1);
}

/* setup server */
const ioq3 = await ioq3ded({
  cert: await fs.readFile(args.values.cert),
  key: await fs.readFile(args.values.key)
});

/* setup filesystem */
const datapath = path.resolve(args.values.data);
const mountdir = '/home/web_user/.local/share/Quake3';
const basepath = `${mountdir}/baseq3`;

try {
  ioq3.FS.mkdirTree(mountdir, 0o777);
} catch (e) {
  if (e.errno !== ioq3.ERRNO_CODES.EEXIST) {
    console.error(e);
    process.exit(1);
  }
}

try {
  ioq3.FS.mount(ioq3.FS.filesystems.NODEFS, { root: datapath }, mountdir);
} catch (e) {
  if (e.errno !== ioq3.ERRNO_CODES.EBUSY) {
    console.error(e);
    process.exit(1);
  }
}

/* download demo assets */
const contentBaseUrl = args.values.content;

await demoq3.install(contentBaseUrl, async (pakname) => {
  const filename = path.join(basepath, pakname);
  return ioq3.FS.readFile(filename);
}, async (pakname, data) => {
  const filename = path.join(basepath, pakname);
  ioq3.FS.mkdirTree(path.dirname(filename), 0o777);
  ioq3.FS.writeFile(filename, data);
});

/* download mod-specific assets */
const game = args.values.game;
const manifest = await fetch(`${contentBaseUrl}/${game}/manifest.json`).then(res => res.json());

for (const [pakname, paksum] of Object.entries(manifest)) {
  const pakpath = path.join(mountdir, game, pakname);
  const paksumRemote = parseInt(paksum, 16);

  try {
    const pakdata = ioq3.FS.readFile(pakpath);
    const paksumLocal = pak.checksum(pakdata);

    if (paksumLocal === paksumRemote) {
      continue;
    }
  } catch (e) {
    /* ignore */
  }

  const pakprint = pakname.replace('.pk3', `.${paksum}.pk3`);
  const pakurl = `${contentBaseUrl}/${game}/${pakprint}`;

  console.log(`downloading ${pakurl}`);

  const data = await fetch(pakurl).then(res => res.bytes());
  ioq3.FS.mkdirTree(path.dirname(pakpath), 0o777);
  ioq3.FS.writeFile(pakpath, data);
}

/* startup the server */
const port = parseInt(args.values.port);
const cmdline = '+set dedicated 2 ' +
                `+set fs_game ${game} ` +
                `+set sv_dlURL "${contentBaseUrl}"`;

ioq3.callMain([...cmdline.split(/\s+/), ...args.positionals]);
