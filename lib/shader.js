import Tokenizer from './tokenizer.js';
import { FLAGS, CONTENTS } from './surfaceflags.js';

const SORT = {
  BAD: 0,
  PORTAL: 1,
  ENVIRONMENT: 2,
  OPAQUE: 3,
  DECAL: 4,
  SEE_THROUGH: 5,

  BANNER: 6,
  FOG: 7,
  UNDERWATER: 8,
  BLEND0: 9,
  BLEND1: 10,
  BLEND2: 11,
  BLEND3: 12,
  BLEND6: 13,
  STENCIL_SHADOW: 14,
  ALMOST_NEAREST: 15,
  NEAREST: 16
};

const surfaceParams = {
  // server relevant contents
  water: { surface: 0, contents: CONTENTS.WATER },
  slime: { surface: 0, contents: CONTENTS.SLIME },
  lava: { surface: 0, contents: CONTENTS.LAVA },
  playerclip: { surface: 0, contents: CONTENTS.PLAYERCLIP },
  monsterclip: { surface: 0, contents: CONTENTS.MONSTERCLIP },
  nodrop: { surface: 0, contents: CONTENTS.NODROP },
  nonsolid: { surface: FLAGS.NONSOLID, contents: 0 },

  // utility relevant attributes
  origin: { surface: 0, contents: CONTENTS.ORIGIN },
  trans: { surface: 0, contents: CONTENTS.TRANSLUCENT },
  detail: { surface: 0, contents: CONTENTS.DETAIL },
  structural: { surface: 0, contents: CONTENTS.STRUCTURAL },
  areaportal: { surface: 0, contents: CONTENTS.AREAPORTAL },
  clusterportal: { surface: 0, contents: CONTENTS.CLUSTERPORTAL },
  donotenter: { surface: 0, contents: CONTENTS.DONOTENTER },

  fog: { surface: 0, contents: CONTENTS.FOG },
  sky: { surface: FLAGS.SKY, contents: 0 },
  lightfilter: { surface: FLAGS.LIGHTFILTER, contents: 0 },
  alphashadow: { surface: FLAGS.ALPHASHADOW, contents: 0 },
  hint: { surface: FLAGS.HINT, contents: 0 },

  // server attributes
  slick: { surface: FLAGS.SLICK, contents: 0 },
  noimpact: { surface: FLAGS.NOIMPACT, contents: 0 },
  nomarks: { surface: FLAGS.NOMARKS, contents: 0 },
  ladder: { surface: FLAGS.LADDER, contents: 0 },
  nodamage: { surface: FLAGS.NODAMAGE, contents: 0 },
  metalsteps: { surface: FLAGS.METALSTEPS, contents: 0 },
  flesh: { surface: FLAGS.FLESH, contents: 0 },
  nosteps: { surface: FLAGS.NOSTEPS, contents: 0 },

  // drawsurf attributes
  nodraw: { surface: FLAGS.NODRAW, contents: 0 },
  pointlight: { surface: FLAGS.POINTLIGHT, contents: 0 },
  nolightmap: { surface: FLAGS.NOLIGHTMAP, contents: 0 },
  nodlight: { surface: FLAGS.NODLIGHT, contents: 0 },
  dust: { surface: FLAGS.DUST, contents: 0 }
};

class Deform {
  constructor () {
    this.type = null;
    this.spread = 0.0;
    this.wave = null;
  }
}

class TexMod {
  constructor () {
    this.type = null;
    this.scaleX = 0.0;
    this.scaleY = 0.0;
    this.sSpeed = 0.0;
    this.tSpeed = 0.0;
    this.wave = null;
    this.turbulance = null;
  }
}

class Waveform {
  constructor () {
    this.funcName = null;
    this.base = 0.0;
    this.amp = 0.0;
    this.phase = 0.0;
    this.freq = 0.0;
  }
}

class ScriptStage {
  constructor () {
    this.hasBlendFunc = false;
    this.blendSrc = 'GL_ONE';
    this.blendDest = 'GL_ZERO';
    this.depthWrite = true;
    this.depthFunc = 'lequal';

    this.maps = [];
    this.animFreq = 0;
    this.clamp = false;
    this.tcGen = 'base';
    this.rgbGen = 'identity';
    this.rgbWave = null;
    this.alphaGen = '1.0';
    this.alphaFunc = null;
    this.alphaWave = null;
    this.isLightmap = false;
    this.tcMods = [];
  }
}

class Script {
  constructor (name, body) {
    this.name = name;
    this.body = body;
    this.sort = 0;
    this.surfaceFlags = 0;
    this.contentFlags = 0;
    this.cull = 'front';
    this.sky = false;
    this.cloudSize = 0;
    this.innerBox = [];
    this.outerBox = [];
    this.fog = false;
    this.polygonOffset = false;
    this.entityMergable = false;
    this.positionLerp = false;
    this.portalRange = 0;
    this.vertexDeforms = [];
    this.stages = [];
  }
}

function parseSkyparms (script, tokens) {
  const suffixes = ['rt', 'bk', 'lf', 'ft', 'up', 'dn'];
  const innerBox = tokens.next().toLowerCase();
  const cloudSize = parseInt(tokens.next(), 10);
  const outerBox = tokens.next().toLowerCase();

  script.sky = true;
  script.innerBox = innerBox === '-'
    ? []
    : suffixes.map((suf) => {
      return innerBox + '_' + suf + '.tga';
    });
  script.cloudSize = cloudSize;
  script.outerBox = outerBox === '-'
    ? []
    : suffixes.map((suf) => {
      return outerBox + '_' + suf + '.tga';
    });
  script.sort = SORT.ENVIRONMENT;
}

function parseSurfaceparm (script, tokens) {
  const token = tokens.next().toLowerCase();
  const param = surfaceParams[token];

  if (!param) {
    return;
  }

  script.surfaceFlags |= param.surface;
  script.contentFlags |= param.contents;
}

function parseDeform (script, tokens) {
  const deform = new Deform();

  deform.type = tokens.next().toLowerCase();

  switch (deform.type) {
    case 'wave':
      deform.spread = 1.0 / parseFloat(tokens.next());
      deform.wave = parseWaveForm(tokens);
      script.vertexDeforms.push(deform);
      break;
  }
}

function parseSort (script, tokens) {
  const token = tokens.next().toLowerCase();

  switch (token) {
    case 'portal': script.sort = SORT.PORTAL; break;
    case 'sky': script.sort = SORT.ENVIRONMENT; break;
    case 'opaque': script.sort = SORT.OPAQUE; break;
    case 'decal': script.sort = SORT.DECAL; break;
    case 'seeThrough': script.sort = SORT.SEE_THROUGH; break;
    case 'banner': script.sort = SORT.BANNER; break;
    case 'additive': script.sort = SORT.BLEND1; break;
    case 'nearest': script.sort = SORT.NEAREST; break;
    case 'underwater': script.sort = SORT.UNDERWATER; break;
    default: script.sort = parseInt(token, 10); break;
  }
}

function parseTexMod (stage, tokens) {
  const tcMod = new TexMod();

  tcMod.type = tokens.next().toLowerCase();

  switch (tcMod.type) {
    case 'rotate':
      tcMod.angle = parseFloat(tokens.next()) * (3.1415 / 180);
      break;

    case 'scale':
      tcMod.scaleX = parseFloat(tokens.next());
      tcMod.scaleY = parseFloat(tokens.next());
      break;

    case 'scroll':
      tcMod.sSpeed = parseFloat(tokens.next());
      tcMod.tSpeed = parseFloat(tokens.next());
      break;

    case 'stretch':
      tcMod.wave = parseWaveForm(tokens);
      if (!tcMod.wave) { tcMod.type = null; }
      break;

    case 'turb':
      tcMod.turbulance = new Waveform();
      tcMod.turbulance.base = parseFloat(tokens.next());
      tcMod.turbulance.amp = parseFloat(tokens.next());
      tcMod.turbulance.phase = parseFloat(tokens.next());
      tcMod.turbulance.freq = parseFloat(tokens.next());
      break;

    default:
      tcMod.type = null;
      break;
  }

  if (tcMod.type) {
    stage.tcMods.push(tcMod);
  }
}

function parseWaveForm (tokens) {
  const wave = new Waveform();

  wave.funcName = tokens.next().toLowerCase();
  wave.base = parseFloat(tokens.next());
  wave.amp = parseFloat(tokens.next());
  wave.phase = parseFloat(tokens.next());
  wave.freq = parseFloat(tokens.next());

  return wave;
}

function parseStage (script, tokens) {
  const stage = new ScriptStage();

  while (!tokens.EOF()) {
    const token = tokens.next().toLowerCase();

    if (token === '}') {
      break;
    }

    if (token === 'map') {
      const map = tokens.next();
      if (map === '$lightmap') {
        stage.isLightmap = true;
      }
      stage.maps.push(map);
    } else if (token === 'clampmap') {
      const map = tokens.next();
      stage.maps.push(map);
      stage.clamp = true;
    } else if (token === 'animmap') {
      let map;

      stage.animFreq = parseFloat(tokens.next());

      map = tokens.next();
      while (map.match(/\.[^/.]+$/)) {
        stage.maps.push(map);
        map = tokens.next();
      }

      tokens.prev();
    } else if (token === 'rgbgen') {
      stage.rgbGen = tokens.next().toLowerCase();

      switch (stage.rgbGen) {
        case 'wave':
          stage.rgbWave = parseWaveForm(tokens);
          if (!stage.rgbWave) {
            stage.rgbGen = 'identity';
          }
          break;
      }
    } else if (token === 'alphagen') {
      stage.alphaGen = tokens.next().toLowerCase();

      switch (stage.alphaGen) {
        case 'wave':
          stage.alphaWave = parseWaveForm(tokens);
          if (!stage.alphaWave) {
            stage.alphaGen = '1.0';
          }
          break;
        case 'portal':
          script.portalRange = parseFloat(tokens.next().toLowerCase());
          break;
      }
    } else if (token === 'alphafunc') {
      stage.alphaFunc = tokens.next().toUpperCase();
    } else if (token === 'blendfunc') {
      stage.blendSrc = tokens.next().toUpperCase();
      stage.hasBlendFunc = true;

      if (!stage.depthWriteOverride) {
        stage.depthWrite = false;
      }

      switch (stage.blendSrc) {
        case 'ADD':
          stage.blendSrc = 'GL_ONE';
          stage.blendDest = 'GL_ONE';
          break;
        case 'BLEND':
          stage.blendSrc = 'GL_SRC_ALPHA';
          stage.blendDest = 'GL_ONE_MINUS_SRC_ALPHA';
          break;
        case 'FILTER':
          stage.blendSrc = 'GL_DST_COLOR';
          stage.blendDest = 'GL_ZERO';
          break;
        default:
          stage.blendDest = tokens.next().toUpperCase();
          break;
      }
    } else if (token === 'depthfunc') {
      stage.depthFunc = tokens.next().toLowerCase();
    } else if (token === 'depthwrite') {
      stage.depthWrite = true;
      stage.depthWriteOverride = true;
    } else if (token === 'tcmod') {
      parseTexMod(stage, tokens);
    } else if (token === 'tcgen') {
      stage.tcGen = tokens.next();
    }
  }

  if (stage.blendSrc === 'GL_ONE' && stage.blendDest === 'GL_ZERO') {
    stage.hasBlendFunc = false;
    stage.depthWrite = true;
  }

  if (stage.isLightmap && stage.hasBlendFunc) {
    stage.blendSrc = 'GL_DST_COLOR';
    stage.blendDest = 'GL_ZERO';
  }

  script.stages.push(stage);
}

function loadScript (text) {
  const tokens = new Tokenizer(text);
  const script = new Script(tokens.next(), text);

  if (tokens.next() !== '{') {
    return null;
  }

  while (!tokens.EOF()) {
    const token = tokens.next().toLowerCase();

    if (token === '}') {
      break;
    }

    switch (token) {
      case '{':
        parseStage(script, tokens);
        break;

      case 'sort':
        parseSort(script, tokens);
        break;

      case 'cull':
        script.cull = tokens.next();
        break;

      case 'deformvertexes':
        parseDeform(script, tokens);
        break;

      case 'surfaceparm':
        parseSurfaceparm(script, tokens);
        continue;

      case 'polygonoffset':
        script.polygonOffset = true;
        break;

      case 'entitymergable':
        script.entityMergable = true;
        break;

      case 'portal':
        script.sort = SORT.PORTAL;
        break;

      case 'fogparms':
        script.fog = true;
        script.sort = SORT.FOG;
        break;

      case 'skyparms':
        parseSkyparms(script, tokens);
        break;

      default:
        break;
    }
  }

  if (script.polygonOffset && !script.sort) {
    script.sort = SORT.DECAL;
  }

  for (const stage of script.stages) {
    /* determine sort order and fog color adjustment */
    if (script.stages[0].hasBlendFunc && stage.hasBlendFunc) {
      /* don't screw with sort order if this is a portal or environment */
      if (!script.sort) {
        /* see through item, like a grill or grate */
        if (stage.depthWrite) {
          script.sort = SORT.SEE_THROUGH;
        } else {
          script.sort = SORT.BLEND0;
        }
      }
    }
  }

  if (!script.sort) {
    script.sort = SORT.OPAQUE;
  }

  return script;
}

function loadShader (text) {
  const tokens = new Tokenizer(text);
  const scripts = {};

  while (!tokens.EOF()) {
    const name = tokens.next().toLowerCase();
    let buffer = name + ' ';
    let depth = 0;

    while (true) {
      const token = tokens.next();

      if (token === '{') {
        depth++;
      } else if (token === '}') {
        depth--;
      }

      buffer += token;

      if (!depth || tokens.EOF()) {
        break;
      }

      buffer += ' ';
    }

    scripts[name] = buffer;
  }

  return scripts;
}

export { loadShader, loadScript };
