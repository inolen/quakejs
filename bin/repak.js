import AdmZip from 'adm-zip';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import fs from 'node:fs/promises';
import path from 'node:path';
import stream from 'node:stream';
import util from 'node:util';

import { AssetGraph } from '../lib/asset-graph.js';
import { execFile } from 'node:child_process';
import { minimatch } from 'minimatch';

/* handle command line */
let args;

try {
  args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      path: { type: 'string', multiple: true },
      common: { type: 'string', multiple: true },
      maps: { type: 'string', multiple: true },
      out: { type: 'string' }
    }
  });

  if (args.values.help) {
    throw new Error();
  }

  if (!args.values.path) {
    throw new Error('Missing required argument --path');
  }

  if (!args.values.common) {
    throw new Error('Missing required argument --common');
  }

  if (!args.values.maps) {
    throw new Error('Missing required argument --maps');
  }

  if (!args.values.out) {
    throw new Error('Missing required argument --out');
  }
} catch (e) {
  console.error('Usage: repak.js --path <path/to/baseq3> --path <path/to/demoq3> --path <path/to/mod> --maps <mod/maps/*.bsp> --common <mod/**> --out <path>');

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
  const paknames = (await fs.readdir(searchpath)).filter((x) => {
    return x.toLowerCase().endsWith('.pk3');
  }).sort();

  for (const pakname of paknames) {
    const pak = new AdmZip(path.join(searchpath, pakname));

    console.log(`graphing ${pakname}...`);

    for (const entry of pak.getEntries()) {
      if (entry.isDirectory) {
        continue;
      }

      const name = entry.entryName.toLowerCase();
      const data = pak.readFile(entry);

      graph.addAsset(name, data, {
        game: searchdir,
        pak: pakname,
        data
      });
    }
  }
}

/* chop up the assets */
const maps = graph.getAssets('*.bsp').filter((x) => {
  return args.values.maps.some(q => minimatch(x.fullname, q));
});
const mapAssets = {};

for (const map of maps) {
  mapAssets[map.name] = graph.getDependencies(map.name);
}

const commonAssets = graph.getAssets().filter((x) => {
  if (maps.some(map => mapAssets[map.name].includes(x))) {
    return false;
  }

  return args.values.common.some(q => minimatch(x.fullname, q));
});

/* write them out */
const reencodeTga = async (name, data) => {
  /* console.log(`reencoding ${name}`); */

  name = name.replace('.tga', '.png');

  const res = await new Promise((resolve, reject) => {
    const child = execFile(ffmpeg.path, [
      '-f', 'image2pipe', '-c:v', 'targa', '-frame_size', data.byteLength, '-i', '-', '-f', 'image2', '-c:v', 'png', '-'
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      resolve({ stdout, stderr });
    });

    const dataStream = new stream.Readable();
    dataStream.push(data);
    dataStream.push(null);
    dataStream.pipe(child.stdin);
  });

  return { name, data: res.stdout };
};

const reencodeWav = async (name, data) => {
  /* console.log(`reencoding ${name}`); */

  name = name.replace('.wav', '.opus');

  const res = await new Promise((resolve, reject) => {
    const child = execFile(ffmpeg.path, [
      '-i', '-', '-f', 'opus', '-c:a', 'libopus', '-'
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      resolve({ stdout, stderr });
    });

    const dataStream = new stream.Readable();
    dataStream.push(data);
    dataStream.push(null);
    dataStream.pipe(child.stdin);
  });

  return { name, data: res.stdout };
};

const writePak = async (pakname, assets) => {
  const filename = path.join(args.values.out, pakname);
  const pak = new AdmZip();

  console.log(`writing ${pakname}...`);

  /* ignore missing */
  assets = assets.filter(x => x.available);

  for (const asset of assets) {
    let name = asset.name;
    let data = asset.data;

    if (asset.name.endsWith('.wav')) {
      ({ name, data } = await reencodeWav(name, data));
    } else if (asset.name.endsWith('.tga')) {
      ({ name, data } = await reencodeTga(name, data));
    }

    pak.addFile(name, data);
  }

  pak.writeZip(filename);
};

for (const map of maps) {
  await writePak(`repak-${map.basename}.pk3`, mapAssets[map.name]);
}

writePak('repak-common0.pk3', commonAssets);
