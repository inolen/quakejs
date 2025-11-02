import crc32 from 'crc/crc32';
import express from 'express';
import fs from 'node:fs/promises';
import https from 'https';
import pak from '../lib/pak.js';
import path from 'path';
import util from 'util';

/* process command line */
let args;

try {
  args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      data: { type: 'string' },
      cert: { type: 'string' },
      key: { type: 'string' },
      port: { type: 'string', default: '8081' }
    }
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
  console.error('Usage: content.js --data <path> --cert <cert.pem> --key <key.pem> [--port <num>]');

  if (e.message) {
    console.error();
    console.error(e.message);
  }

  process.exit(1);
}

/* generate manifest(s) */
const datapath = path.resolve(args.values.data);
const dataents = await fs.readdir(datapath, { withFileTypes: true });

const installers = {};
const games = {};

for (const ent of dataents) {
  if (ent.isFile()) {
    const tarpath = path.join(datapath, ent.name);
    const crc = crc32(await fs.readFile(tarpath));

    installers[ent.name] = crc.toString(16).padStart(8, '0');
  } else if (ent.isDirectory() && ent.name !== 'baseq3') {
    const game = ent.name;
    const gamepath = path.join(datapath, game);
    const gameents = await fs.readdir(gamepath);
    const gamepaks = gameents.filter(x => x.toLowerCase().endsWith('.pk3'));

    games[game] = {};

    for (const pakname of gamepaks) {
      const pakpath = path.join(gamepath, pakname);
      const pakdata = await fs.readFile(pakpath);
      const paksum = pak.checksum(pakdata);

      games[game][pakname] = paksum.toString(16).padStart(8, '0');
    }
  }
}

/* sanity check installers */
if (installers['linuxq3ademo-1.11-6.x86.gz.sh'] !== '3322a4f8') {
  console.error(`Invalid crc or missing linuxq3ademo-1.11-6.x86.gz.sh in ${datapath}`);
  process.exit(1);
}

if (installers['linuxq3apoint-1.32b-3.x86.run'] !== '11b179b7') {
  console.error(`Invalid crc or missing linuxq3apoint-1.32b-3.x86.run in ${datapath}`);
  process.exit(1);
}

/* setup app */
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

for (const installer in installers) {
  app.get(`/${installer}`, (req, res) => res.sendFile(path.join(datapath, installer)));
}

for (const [game, manifest] of Object.entries(games)) {
  app.get(`/${game}/manifest.json`, (req, res) => res.json(manifest));

  for (const [pakname, checksum] of Object.entries(manifest)) {
    const pakprint = pakname.replace('.pk3', `.${checksum}.pk3`);

    app.get(`/${game}/${pakprint}`, (req, res) => res.sendFile(path.join(datapath, game, pakname)));
  }
}

/* startup server */
const port = parseInt(args.values.port);
const server = https.createServer({
  cert: await fs.readFile(args.values.cert),
  key: await fs.readFile(args.values.key)
}, app);

server.listen(port, () => {
  console.log(`listening on ${server.address().address}:${server.address().port}`);
});
