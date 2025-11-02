import pak from './pak.js';

const DEMO_INSTALLERS = [{
  name: 'linuxq3ademo-1.11-6.x86.gz.sh',
  offset: 5468,
  paks: [
    'demoq3/pak0.pk3'
  ]
}, {
  name: 'linuxq3apoint-1.32b-3.x86.run',
  offset: 8251,
  paks: [
    'baseq3/pak1.pk3',
    'baseq3/pak2.pk3',
    'baseq3/pak3.pk3',
    'baseq3/pak4.pk3',
    'baseq3/pak5.pk3',
    'baseq3/pak6.pk3',
    'baseq3/pak7.pk3',
    'baseq3/pak8.pk3'
  ]
}];

const DEMO_PAKS = {
  'pak0.pk3': { paksum: 0xb1f4d354 },
  'pak1.pk3': { paksum: 0x11c4fe9b },
  'pak2.pk3': { paksum: 0x18912474 },
  'pak3.pk3': { paksum: 0xb24e9894 },
  'pak4.pk3': { paksum: 0x476700a6 },
  'pak5.pk3': { paksum: 0xf39bc355 },
  'pak6.pk3': { paksum: 0xdd13d69b },
  'pak7.pk3': { paksum: 0x362c0725 },
  'pak8.pk3': { paksum: 0x3a3dc1a6 }
};

function * iterateTarball (tar) {
  function parseString (bytes) {
    const result = String.fromCharCode.apply(null, bytes);
    const index = result.indexOf('\u0000');
    return index >= 0 ? result.substr(0, index) : result;
  }

  function parseNumber (bytes) {
    const result = String.fromCharCode.apply(null, bytes);
    return parseInt(result.replace(/^0+$/g, ''), 8) || 0;
  }

  for (let offset = 0; offset < tar.length;) {
    const header = {
      name: parseString(tar.subarray(offset + 0, offset + 100)),
      size: parseNumber(tar.subarray(offset + 124, offset + 136))
    };

    offset += 512;

    const data = tar.subarray(offset, offset + header.size);

    yield { name: header.name, data };

    offset += Math.ceil(header.size / 512) * 512;
  }
}

async function validate (readPak) {
  for (const [pakname, entry] of Object.entries(DEMO_PAKS)) {
    const paksum = pak.checksum(await readPak(pakname));

    if (paksum !== entry.paksum) {
      console.log(`Failed to validate ${pakname}, invalid checksum`);
      return false;
    }
  }

  return true;
}

async function install (contentBaseUrl, readPak, writePak) {
  try {
    if (await validate(readPak)) {
      return;
    }
  } catch (e) {
    /* ignore */
  }

  for (const installer of DEMO_INSTALLERS) {
    const installerUrl = `${contentBaseUrl}/${installer.name}`;

    console.log(`downloading ${installerUrl}`);

    const response = await fetch(installerUrl);
    let bytes = 0;

    if (!response.ok) {
      throw new Error(`Failed to fetch ${installerUrl}, status ${response.status}`);
    }

    const script = response.body;
    const gzip = script.pipeThrough(new TransformStream({
      transform (chunk, controller) {
        const chunkStart = bytes;
        const chunkEnd = bytes + chunk.byteLength;
        bytes += chunk.byteLength;

        if (chunkStart < installer.offset && chunkEnd >= installer.offset) {
          controller.enqueue(chunk.subarray(installer.offset - chunkStart));
        } else if (chunkStart >= installer.offset) {
          controller.enqueue(chunk);
        }
      }
    }));
    const dec = gzip.pipeThrough(new DecompressionStream('gzip'));
    const tar = new Uint8Array(await new Response(dec).arrayBuffer());

    for (const entry of iterateTarball(tar)) {
      if (installer.paks.includes(entry.name)) {
        const pakname = entry.name.split('/').pop();
        await writePak(pakname, entry.data);
      }
    }
  }

  await validate(readPak);
}

export default { install };
export { install };
