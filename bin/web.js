import express from 'express';
import fs from 'node:fs/promises';
import https from 'https';
import path from 'path';
import url from 'url';
import util from 'util';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* process command line */
let args;

try {
  args = util.parseArgs({
    options: {
      help: { type: 'boolean' },
      cert: { type: 'string' },
      key: { type: 'string' },
      port: { type: 'string', default: '8080' },
      content: { type: 'string', default: 'https://content.quakejs.com' }
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
  console.error('Usage: web.js --cert <cert.pem> --key <key.pem> [--port <num>] [--content <https://content.quakejs.com>]');

  if (e.message) {
    console.error();
    console.error(e.message);
  }

  process.exit(1);
}

/* setup app */
const app = express();

app.use(express.static(path.join(__dirname, '..', 'bin')));
app.use(express.static(path.join(__dirname, '..', 'build')));
app.use(express.static(path.join(__dirname, '..', 'lib')));
app.get('/', (req, res) => {
  const html =
`<!DOCTYPE html>
<html>
  <head>
    <title>quakejs</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <style>
      html, body {
        background: #000000;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }

      #viewport {
        position: absolute;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
      }

      #canvas {
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
        min-height: 100%;
        object-fit: contain;
      }

      #error-dialog {
        position: absolute;
        top: 50%;
        left: 50%;
        margin-top: -5em;
        margin-left: -12em;
        width: 24em;
        background: #2a2a2a;
      }

      #error-dialog .title {
        margin: 0;
        padding: 0.2em 0.5em;
        background: #333;
        color: #fff;
        font-family: "Open Sans";
        font-weight: bold;
        text-transform: uppercase;
      }

      #error-dialog .message {
        margin: 0;
        padding: 0.5em;
        color: #fff;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="viewport"></div>
  </body>

  <script type="module">
    import ioquake3 from './ioquake3.js';
    import demoq3 from './demoq3.js';

    const mountdir = '/home/web_user/.local/share/Quake3';
    const basepath = \`\${mountdir}/baseq3\`;
    const ioq3 = await ioquake3();

    (function initFiles () {
      try {
        ioq3.FS.mkdirTree(mountdir, 0o777);
      } catch (e) {
        if (e.errno !== ioq3.ERRNO_CODES.EEXIST) {
          throw e;
        }
      }

      try {
        ioq3.FS.mount(ioq3.FS.filesystems.IDBFS, {}, mountdir);
      } catch (e) {
        if (e.errno !== ioq3.ERRNO_CODES.EBUSY) {
          throw e;
        }
      }
    })();

    async function syncFiles (populate) {
      return new Promise((resolve, reject) => {
        ioq3.FS.syncfs(populate, function (err) {
          if (err) {
            console.log(err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    async function saveFiles () {
      return syncFiles(false);
    }

    async function loadFiles () {
      return syncFiles(true);
    }

    async function run (viewport, args) {
      Object.assign(ioq3, {
        Sys_PlatformInit: () => {
          const canvas = document.createElement('canvas');
          canvas.id = 'canvas';
          ioq3.canvas = viewport.appendChild(canvas);

          document.addEventListener('pointerlockchange', saveFiles);
        },
        Sys_PlatformExit: () => {
          document.removeEventListener('pointerlockchange', saveFiles);

          if (ioq3.dialog) {
            ioq3.dialog.remove();
            ioq3.dialog = null;
          }

          if (ioq3.canvas) {
            ioq3.canvas.remove();
            ioq3.canvas = null;
          }
        },
        Sys_ErrorDialog: (error) => {
          const dialog = document.createElement('div');
          dialog.id = 'error-dialog';
          dialog.innerHTML = \`<h4 class="title">Error</h4><p class="message">\${error}</p>\`;
          ioq3.dialog = viewport.appendChild(dialog);
        }
      });

      await loadFiles();

      ioq3.callMain(args);
    }

    async function install (contentBaseUrl) {
      await loadFiles();

      await demoq3.install(contentBaseUrl, async (pakname) => {
        const filename = \`\${basepath}/\${pakname}\`;
        return ioq3.FS.readFile(filename);
      }, async (pakname, data) => {
        const filename = \`\${basepath}/\${pakname}\`;
        const dirname = filename.match(/(.*)\\//)[1];
        ioq3.FS.mkdirTree(dirname, 0o777);
        ioq3.FS.writeFile(filename, data);
      });

      ioq3.FS.writeFile(\`\${basepath}/autoexec.cfg\`, \`
        // disable fullscreen so it's not requested immediately on load
        set r_fullscreen 0
        // disable expensive visuals
        set r_hdr 0
        set r_postProcess 0
        set r_normalMapping 0
        set r_specularMapping 0
        set r_deluxeMapping 0
        // use a more modern default fov
        set cg_fov 110
      \`);

      await saveFiles();
    }

    /* -------------------------------------------------------------------------- */

    const viewport = document.getElementById('viewport');
    const query = window.location.search.substring(1).split('&');
    const args = [];

    for (let arg of query) {
      arg = '+' + decodeURIComponent(arg);
      args.push.apply(args, arg.split(' '));
    }

    await install(\`\${args.values.content}\`);

    run(viewport, args);
  </script>
</html>`;

  res.send(html);
});

/* startup server */
const port = parseInt(args.values.port);
const server = https.createServer({
  cert: await fs.readFile(args.values.cert),
  key: await fs.readFile(args.values.key)
}, app);

server.listen(port, () => {
  console.log(`listening on ${server.address().address}:${server.address().port}`);
});
