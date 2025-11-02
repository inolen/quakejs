import { minimatch } from 'minimatch';
import { Tokenizer } from './tokenizer.js';
import { LUMP, loadBsp } from '../lib/bsp.js';
import { loadMd3 } from '../lib/md3.js';
import { loadScript, loadShader } from '../lib/shader.js';
import { loadSkin } from '../lib/skin.js';

function extname (filename) {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0] : null;
}

function basename (filename) {
  const m = filename.match(/([^/]+)\.[^.]+$/);
  return m ? m[1] : null;
}

function normalize (filename) {
  filename = filename.toLowerCase();
  filename = filename.replace(/\\/g, '/');
  filename = filename.replace(/^\//, '');
  return filename;
}

function setext (filename, newext) {
  const oldext = extname(filename);

  if (!oldext) {
    return filename + newext;
  }

  return filename.replace(oldext, newext);
}

class AssetNode {
  constructor (name) {
    this.name = name;
    this.deps = [];

    /* tracks if asset was explicitly added to graph */
    this.added = false;

    /* controls if this asset is depicted as missing or not */
    this.optional = false;

    /* shader containing the asset */
    this.shader = null;

    /* directory containing the pak */
    this.game = null;

    /* pak containing the asset */
    this.pak = null;
  }

  get type () {
    return extname(this.name);
  }

  get basename () {
    return basename(this.name);
  }

  get fullname () {
    return `${this.game}/${this.name}`;
  }

  get required () {
    return !this.optional;
  }

  get available () {
    return this.shader || this.added;
  }
}

class AssetGraph {
  #nodes;

  constructor () {
    this.#nodes = {};
  }

  #addDependency (node, dep, cmp) {
    const sortedPush = (arr, el, cmp) => {
      let m = 0;
      let n = arr.length;

      while (m < n) {
        const k = (m + n) >>> 1;

        if (cmp(arr[k], el) < 0) {
          m = k + 1;
        } else {
          n = k;
        }
      }

      arr.splice(m, 0, el);
    };

    if (!node.deps.includes(dep)) {
      sortedPush(node.deps, dep, (a, b) => a.name.localeCompare(b.name, { numeric: true }));
    }
  }

  #processSkin (node, data) {
    const skin = loadSkin(data.toString('utf8'));

    for (const surf of skin.surfaces) {
      const scriptNode = this.#demandScript(surf.shader);
      this.#addDependency(node, scriptNode);
    }
  }

  #processScript (node, data) {
    const script = loadScript(data);

    for (const stage of script.stages) {
      for (const map of stage.maps) {
        /* ignore built-in textures */
        if (map.charAt(0) === '$' || map.charAt(0) === '*') {
          continue;
        }

        const texNode = this.#demandAsset(map);
        this.#addDependency(node, texNode);
      }
    }

    for (const map of script.innerBox) {
      const texNode = this.#demandAsset(map);
      this.#addDependency(node, texNode);
    }

    for (const map of script.outerBox) {
      const texNode = this.#demandAsset(map);
      this.#addDependency(node, texNode);
    }
  }

  #processShader (node, data) {
    const scripts = loadShader(data.toString('utf8'));

    for (const [name, body] of Object.entries(scripts)) {
      const scriptNode = this.#demandAsset(setext(name, '.script'));
      scriptNode.deps = [];
      scriptNode.shader = node;

      this.#processScript(scriptNode, body);
    }
  }

  #processSoundScript (node, data) {
    const tokens = new Tokenizer(data.toString('utf8'));
    let classname = null;

    while (!tokens.EOF()) {
      const token = tokens.next();

      if (classname === null) {
        classname = token;
      } else if (token === '{') {
        /* nop */
      } else if (token === '}') {
        classname = null;
      } else if (token === 'noise') {
        const noise = tokens.next();
        const noiseNode = this.#demandAsset(noise);
        this.#addDependency(node, noiseNode);
      } else if (token === 'origin') {
        tokens.next(); /* x */
        tokens.next(); /* y */
        tokens.next(); /* z */
      } else if (token === 'random') {
        tokens.next();
      } else if (token === 'wait') {
        tokens.next();
      } else {
        throw new Error(`Unexpected sound script key '${token}'`);
      }
    }
  }

  #processMd3 (node, data) {
    const md3 = loadMd3(data);

    for (const skin of md3.skins) {
      if (!skin) {
        continue;
      }

      const skinNode = this.#demandAsset(skin);
      this.#addDependency(node, skinNode);
    }

    for (const surface of md3.surfaces) {
      for (const shader of surface.shaders) {
        if (!shader) {
          continue;
        }

        const scriptNode = this.#demandScript(shader);
        this.#addDependency(node, scriptNode);
      }
    }
  }

  #processBsp (node, data) {
    const bsp = loadBsp(data, { lumps: [LUMP.ENTITIES, LUMP.SHADERS, LUMP.FOG] });

    /* parse entities */
    for (const ent of bsp.entities) {
      if (ent.music) {
        const musicNode = this.#demandAsset(ent.music);
        this.#addDependency(node, musicNode);
      }

      if (ent.noise) {
        if (ent.noise.charAt(0) !== '*') {
          const noiseNode = this.#demandAsset(ent.noise);
          this.#addDependency(node, noiseNode);
        }
      }

      /* ignore the model property as it has been embedded in the map geometry */

      if (ent.model2) {
        if (ent.model2.charAt(0) !== '*') {
          const modelNode = this.#demandAsset(ent.model2);
          this.#addDependency(node, modelNode);
        }
      }
    }

    /* process shaders */
    for (const shader of bsp.shaders) {
      if (shader.name.charAt(0) === '$' || shader.name.charAt(0) === '*') {
        continue;
      }

      const scriptNode = this.#demandScript(shader.name);
      this.#addDependency(node, scriptNode);
    }

    /* process fog */
    for (const fog of bsp.fog) {
      const scriptNode = this.#demandScript(fog.shaderName);
      this.#addDependency(node, scriptNode);
    }

    /* implicit dependencies */
    const implicit = [
      `levelshots/${node.basename}.jpg`,
      `maps/${node.basename}.aas`,
      /* used by ra3 */
      `arenashots/${node.basename}_1.jpg`,
      `arenashots/${node.basename}_2.jpg`,
      `arenashots/${node.basename}_3.jpg`,
      `arenashots/${node.basename}_4.jpg`,
      `arenashots/${node.basename}_5.jpg`,
      `arenashots/${node.basename}_6.jpg`,
      `arenashots/${node.basename}_7.jpg`,
      `arenashots/${node.basename}_8.jpg`,
      `scripts/${node.basename}.txt`,
      `text/${node.basename}.txt`,
      `${node.basename}.cfg`,
      `${node.basename}.txt`,
      /* used by q3f2 */
      `maps/${node.basename}.sscr`
    ];

    for (const name of implicit) {
      const implicitNode = this.#demandAsset(name, { optional: true });

      this.#addDependency(node, implicitNode);
    }
  }

  #demandScript (name) {
    const scriptName = setext(name, '.script');
    const scriptNode = this.#demandAsset(scriptName);

    /* if a placeholder was added, go ahead and reference a texture by the same name

       demandScript is used for assets where quake3 would call R_FindShader, which will
       first look for a script and fallback to a texture if no scripts are found

       adding this reference now, ensures the dependency chain remains valid if a real
       script or real texture is added later */
    if (!scriptNode.shader) {
      const texName = setext(scriptName, '.tga');
      const texNode = this.#demandAsset(texName);
      this.#addDependency(scriptNode, texNode);
    }

    return scriptNode;
  }

  #demandAsset (name, meta) {
    name = normalize(name);

    /* use consistent id when multiple file types are supported */
    const ext = extname(name);
    let node;
    let id;

    if (ext === '.jpg' || ext === '.png') {
      id = name.replace(ext, '.tga');
    } else {
      id = name;
    }

    node = this.#nodes[id];

    if (!node) {
      node = this.#nodes[id] = new AssetNode(name);
    }

    if (meta) {
      for (const key of Object.keys(meta)) {
        node[key] = meta[key];
      }
    }

    return node;
  }

  #walkDependencies (node, cb, depth, leafstate) {
    if (typeof node === 'string') {
      node = this.#nodes[node];
    }

    if (depth === undefined) {
      depth = 0;
    }

    if (leafstate === undefined) {
      leafstate = 0;
    }

    if (!node) {
      return;
    }

    cb(node, depth, leafstate);
    depth += 1;

    /* ignore placeholders */
    const effective = node.deps.filter((x) => {
      return x.required || x.available;
    }).map((x) => {
      const intermediate = x.type === '.script' && x.shader === null;
      return intermediate ? x.deps[0] : x;
    });

    for (let i = 0; i < effective.length; i++) {
      const dep = effective[i];

      if (i === effective.length - 1) {
        leafstate |= 1 << depth;
      } else {
        leafstate &= ~(1 << depth);
      }

      this.#walkDependencies(dep, cb, depth, leafstate);
    }
  }

  printDependencies (name) {
    name = normalize(name);

    this.#walkDependencies(name, (node, depth, leafstate) => {
      let indent = '';
      let prefix = '';
      let pretty = '';
      let game = null;
      let pak = null;

      if (depth > 0) {
        for (let i = 1; i < depth; i++) {
          if (leafstate & (1 << i)) {
            indent += ' ';
          } else {
            indent += '|';
          }

          indent += '    ';
        }

        if (leafstate & (1 << depth)) {
          prefix = '\\--- ';
        } else {
          prefix = '|--- ';
        }
      }

      if (node.shader) {
        pretty = `${node.name} \x1b[33m(${node.shader.name})\x1b[0m`;
        game = node.shader.game;
        pak = node.shader.pak;
      } else if (node.added) {
        pretty = `${node.name}`;
        game = node.game;
        pak = node.pak;
      } else {
        pretty = `\x1b[31m${node.name}\x1b[0m`;
      }

      if (game && pak) {
        pretty += ` \x1b[35m(${game}/${pak})\x1b[0m`;
      }

      console.log(`${indent}${prefix}${pretty}`);
    });
  }

  getDependencies (name) {
    let deps = [];

    name = normalize(name);

    this.#walkDependencies(name, x => deps.push(x.shader ?? x));

    deps = [...new Set(deps)];

    return deps;
  }

  getAssets (query) {
    let assets = Object.values(this.#nodes).filter((x) => {
      const intermediate = x.type === '.script' && x.shader === null;
      return (x.required || x.available) && !intermediate;
    }).map(x => x.shader ?? x);

    assets = [...new Set(assets)];

    if (query) {
      assets = assets.filter(x => minimatch(x.name, query, { matchBase: true }));
    }

    return assets;
  }

  addAsset (name, data, meta) {
    const node = this.#demandAsset(name, meta);

    node.added = true;

    /* override state if node already existed (placeholder or duplicate) */
    node.name = normalize(name);
    node.deps = [];

    if (node.type === '.bsp') {
      this.#processBsp(node, data);
    } else if (node.type === '.md3') {
      this.#processMd3(node, data);
    } else if (node.type === '.sscr') {
      this.#processSoundScript(node, data);
    } else if (node.type === '.shader') {
      this.#processShader(node, data);
    } else if (node.type === '.skin') {
      this.#processSkin(node, data);
    }

    return node;
  }
}

export default AssetGraph;
export { AssetGraph };
