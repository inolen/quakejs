import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'path';
import util from 'node:util';

import { AssetGraph } from '../lib/asset-graph.js';

/* handle command line */
let args;

try {
  args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      path: { type: 'string', multiple: true }
    },
    allowPositionals: true
  });

  if (args.values.help) {
    throw new Error();
  }

  if (!args.values.path) {
    throw new Error('Missing required argument --path');
  }

  if (!args.positionals.length) {
    throw new Error('No asset specified');
  }
} catch (e) {
  console.error('Usage: deps.js --path <path/to/baseq3> --path <path/to/demoq3> --path <path/to/mod> <path/to/asset>');

  if (e.message) {
    console.error();
    console.error(e.message);
  }

  process.exit(1);
}

/* plot the assets */
const graph = new AssetGraph();

for (const searchpath of args.values.path) {
  const searchdir = path.basename(searchpath);

  const paknames = fs.readdirSync(searchpath).filter((x) => {
    return x.toLowerCase().endsWith('.pk3');
  }).sort();

  for (const pakname of paknames) {
    const pak = new AdmZip(path.join(searchpath, pakname));

    for (const entry of pak.getEntries()) {
      if (entry.isDirectory) {
        continue;
      }

      const name = entry.entryName.toLowerCase();
      const data = pak.readFile(entry);

      graph.addAsset(name, data, {
        game: searchdir,
        pak: pakname
      });
    }
  }
}

/* print the dependencies */
graph.printDependencies(args.positionals[0]);
