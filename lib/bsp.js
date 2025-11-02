import { BitStream } from 'bit-buffer';
import { Tokenizer } from './tokenizer.js';

const MAX_QPATH = 64;

const LUMP = {
  ENTITIES: 0,
  SHADERS: 1,
  PLANES: 2,
  NODES: 3,
  LEAFS: 4,
  LEAFSURFACES: 5,
  LEAFBRUSHES: 6,
  MODELS: 7,
  BRUSHES: 8,
  BRUSHSIDES: 9,
  DRAWVERTS: 10,
  DRAWINDEXES: 11,
  FOG: 12,
  SURFACES: 13,
  LIGHTMAPS: 14,
  LIGHTGRID: 15,
  VISIBILITY: 16,
  NUM_LUMPS: 17
};

class BspSurface {
  static size = 104;

  constructor () {
    this.shaderNum = 0;
    this.fogNum = 0;
    this.surfaceType = 0;
    this.vertex = 0;
    this.vertCount = 0;
    this.meshVert = 0;
    this.meshVertCount = 0;
    this.lightmapNum = 0;
    this.lightmapX = 0;
    this.lightmapY = 0;
    this.lightmapWidth = 0;
    this.lightmapHeight = 0;
    this.lightmapOrigin = [
      0, 0, 0
    ];
    this.lightmapVecs = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    this.patchWidth = 0;
    this.patchHeight = 0;
  }
}

class BspFog {
  static size = 72;

  constructor () {
    this.shaderName = null;
    this.brushNum = 0;
    this.visibleSide = 0;
  }
}

class BspVertex {
  static size = 44;

  constructor () {
    this.pos = [0, 0, 0];
    this.texCoord = [0, 0];
    this.lmCoord = [0, 0];
    this.normal = [0, 0, 0];
    this.color = [0, 0, 0, 0];
  }
}

class BspBrushSide {
  static size = 8;

  constructor () {
    this.planeNum = 0;
    this.shaderNum = 0;
  }
}

class BspBrush {
  static size = 12;

  constructor () {
    this.side = 0;
    this.numSides = 0;
    this.shaderNum = 0;
  }
}

class BspModel {
  static size = 40;

  constructor () {
    this.bounds = [
      [0, 0, 0],
      [0, 0, 0]
    ];
    this.firstSurface = 0;
    this.numSurfaces = 0;
    this.firstBrush = 0;
    this.numBrushes = 0;
  }
}

class BspLeaf {
  static size = 48;

  constructor () {
    this.cluster = 0;
    this.area = 0;
    this.mins = [0, 0, 0];
    this.maxs = [0, 0, 0];
    this.firstLeafSurface = 0;
    this.numLeafSurfaces = 0;
    this.firstLeafBrush = 0;
    this.numLeafBrushes = 0;
  }
}

class BspNode {
  static size = 36;

  constructor () {
    this.planeNum = 0;
    this.childrenNum = [0, 0];
    this.mins = [0, 0, 0];
    this.maxs = [0, 0, 0];
  }
}

class BspPlane {
  static size = 16;

  constructor () {
    this.normal = [0, 0, 0];
    this.dist = 0;
  }
}

class BspShader {
  static size = 72;

  constructor () {
    this.name = null;
    this.surfaceFlags = 0;
    this.contents = 0;
  }
}

class Bsp {
  constructor () {
    this.entities = null;
    this.shaders = null;
    this.planes = null;
    this.nodes = null;
    this.leafs = null;
    this.leafSurfaces = null;
    this.leafBrushes = null;
    this.bmodels = null;
    this.brushes = null;
    this.brushSides = null;
    this.verts = null;
    this.indexes = null;
    this.fog = null;
    this.surfaces = null;
    this.lightmaps = null;
    this.lightGridOrigin = [0, 0, 0];
    this.lightGridSize = [64, 64, 128];
    this.lightGridBounds = [0, 0, 0];
    this.lightGridData = null;
    this.numClusters = 0;
    this.clusterBytes = 0;
    this.vis = null;
  }
}

function loadVisibility (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.numClusters = bb.readInt32();
  bsp.clusterBytes = bb.readInt32();
  bsp.vis = new Uint8Array(bsp.numClusters * bsp.clusterBytes);

  for (let i = 0; i < bsp.vis.size; i++) {
    bsp.vis[i] = bb.readUint8();
  }
}

function loadLightGrid (bsp, lump) {
  const wMins = bsp.bmodels[0].bounds[0];
  const wMaxs = bsp.bmodels[0].bounds[1];

  for (let i = 0; i < 3; i++) {
    const t = bsp.lightGridSize[i] * Math.floor(wMaxs[i] / bsp.lightGridSize[i]);

    bsp.lightGridOrigin[i] = bsp.lightGridSize[i] * Math.ceil(wMins[i] / bsp.lightGridSize[i]);
    bsp.lightGridBounds[i] = (t - bsp.lightGridOrigin[i]) / bsp.lightGridSize[i] + 1;
  }

  const numGridPoints = bsp.lightGridBounds[0] * bsp.lightGridBounds[1] * bsp.lightGridBounds[2];

  if (lump.length !== numGridPoints * 8) {
    bsp.lightGridData = null;
    return;
  }

  /* read light grid data */
  const bb = new BitStream(lump);

  bsp.lightGridData = new Uint8Array(lump.length);

  for (let i = 0; i < lump.length; i++) {
    bsp.lightGridData[i] = bb.readUint8();
  }
}

function loadLightmaps (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.lightmaps = new Uint8Array(lump.length);

  for (let i = 0; i < lump.length; i++) {
    bsp.lightmaps[i] = bb.readUint8();
  }
}

function loadSurfaces (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.surfaces = new Array(lump.length / BspSurface.size);

  for (let i = 0; i < bsp.surfaces.length; i++) {
    const surface = bsp.surfaces[i] = new BspSurface();

    surface.shaderNum = bb.readInt32();
    surface.fogNum = bb.readInt32();
    surface.surfaceType = bb.readInt32();
    surface.vertex = bb.readInt32();
    surface.vertCount = bb.readInt32();
    surface.meshVert = bb.readInt32();
    surface.meshVertCount = bb.readInt32();
    surface.lightmapNum = bb.readInt32();
    surface.lightmapX = bb.readInt32();
    surface.lightmapY = bb.readInt32();
    surface.lightmapWidth = bb.readInt32();
    surface.lightmapHeight = bb.readInt32();
    surface.lightmapOrigin[0] = bb.readFloat32();
    surface.lightmapOrigin[1] = bb.readFloat32();
    surface.lightmapOrigin[2] = bb.readFloat32();
    surface.lightmapVecs[0][0] = bb.readFloat32();
    surface.lightmapVecs[0][1] = bb.readFloat32();
    surface.lightmapVecs[0][2] = bb.readFloat32();
    surface.lightmapVecs[1][0] = bb.readFloat32();
    surface.lightmapVecs[1][1] = bb.readFloat32();
    surface.lightmapVecs[1][2] = bb.readFloat32();
    surface.lightmapVecs[2][0] = bb.readFloat32();
    surface.lightmapVecs[2][1] = bb.readFloat32();
    surface.lightmapVecs[2][2] = bb.readFloat32();
    surface.patchWidth = bb.readInt32();
    surface.patchHeight = bb.readInt32();
  }
}

function loadFogs (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.fog = new Array(lump.length / BspFog.size);

  for (let i = 0; i < bsp.fog.length; i++) {
    const fog = bsp.fog[i] = new BspFog();

    fog.shaderName = bb.readASCIIString(MAX_QPATH);
    fog.brushNum = bb.readInt32();
    fog.visibleSide = bb.readInt32();
  }
}

function loadIndexes (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.indexes = new Array(lump.length / 4);

  for (let i = 0; i < bsp.indexes.length; i++) {
    bsp.indexes[i] = bb.readInt32();
  }
}

function loadVerts (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.verts = new Array(lump.length / BspVertex.size);

  for (let i = 0; i < bsp.verts.length; i++) {
    const vert = bsp.verts[i] = new BspVertex();

    vert.pos[0] = bb.readFloat32();
    vert.pos[1] = bb.readFloat32();
    vert.pos[2] = bb.readFloat32();
    vert.texCoord[0] = bb.readFloat32();
    vert.texCoord[1] = bb.readFloat32();
    vert.lmCoord[0] = bb.readFloat32();
    vert.lmCoord[1] = bb.readFloat32();
    vert.normal[0] = bb.readFloat32();
    vert.normal[1] = bb.readFloat32();
    vert.normal[2] = bb.readFloat32();
    vert.color[0] = bb.readUint8();
    vert.color[1] = bb.readUint8();
    vert.color[2] = bb.readUint8();
    vert.color[3] = bb.readUint8();
  }
}

function loadBrushSides (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.brushSides = new Array(lump.length / BspBrushSide.size);

  for (let i = 0; i < bsp.brushSides.length; i++) {
    const side = bsp.brushSides[i] = new BspBrushSide();

    side.planeNum = bb.readInt32();
    side.shaderNum = bb.readInt32();
  }
}

function loadBrushes (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.brushes = new Array(lump.length / BspBrush.size);

  for (let i = 0; i < bsp.brushes.length; i++) {
    const brush = bsp.brushes[i] = new BspBrush();

    brush.side = bb.readInt32();
    brush.numSides = bb.readInt32();
    brush.shaderNum = bb.readInt32();
  }
}

function loadBrushModels (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.bmodels = new Array(lump.length / BspModel.size);

  for (let i = 0; i < bsp.bmodels.length; i++) {
    const model = bsp.bmodels[i] = new BspModel();

    model.bounds[0][0] = bb.readFloat32();
    model.bounds[0][1] = bb.readFloat32();
    model.bounds[0][2] = bb.readFloat32();

    model.bounds[1][0] = bb.readFloat32();
    model.bounds[1][1] = bb.readFloat32();
    model.bounds[1][2] = bb.readFloat32();

    model.firstSurface = bb.readInt32();
    model.numSurfaces = bb.readInt32();
    model.firstBrush = bb.readInt32();
    model.numBrushes = bb.readInt32();
  }
}

function loadLeafBrushes (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.leafBrushes = new Array(lump.length / 4);

  for (let i = 0; i < bsp.leafBrushes.length; i++) {
    bsp.leafBrushes[i] = bb.readInt32();
  }
}

function loadLeafSurfaces (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.leafSurfaces = new Array(lump.length / 4);

  for (let i = 0; i < bsp.leafSurfaces.length; i++) {
    bsp.leafSurfaces[i] = bb.readInt32();
  }
}

function loadLeafs (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.leafs = new Array(lump.length / BspLeaf.size);

  for (let i = 0; i < bsp.leafs.length; i++) {
    const leaf = bsp.leafs[i] = new BspLeaf();

    leaf.cluster = bb.readInt32();
    leaf.area = bb.readInt32();
    leaf.mins[0] = bb.readInt32();
    leaf.mins[1] = bb.readInt32();
    leaf.mins[2] = bb.readInt32();
    leaf.maxs[0] = bb.readInt32();
    leaf.maxs[1] = bb.readInt32();
    leaf.maxs[2] = bb.readInt32();
    leaf.firstLeafSurface = bb.readInt32();
    leaf.numLeafSurfaces = bb.readInt32();
    leaf.firstLeafBrush = bb.readInt32();
    leaf.numLeafBrushes = bb.readInt32();
  }
}

function loadNodes (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.nodes = new Array(lump.length / BspNode.size);

  for (let i = 0; i < bsp.nodes.length; i++) {
    const node = bsp.nodes[i] = new BspNode();

    node.planeNum = bb.readInt32();
    node.childrenNum[0] = bb.readInt32();
    node.childrenNum[1] = bb.readInt32();
    node.mins[0] = bb.readInt32();
    node.mins[1] = bb.readInt32();
    node.mins[2] = bb.readInt32();
    node.maxs[0] = bb.readInt32();
    node.maxs[1] = bb.readInt32();
    node.maxs[2] = bb.readInt32();
  }
}

function loadPlanes (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.planes = new Array(lump.length / BspPlane.size);

  for (let i = 0; i < bsp.planes.length; i++) {
    const plane = bsp.planes[i] = new BspPlane();

    plane.normal[0] = bb.readFloat32();
    plane.normal[1] = bb.readFloat32();
    plane.normal[2] = bb.readFloat32();
    plane.dist = bb.readFloat32();
  }
}

function loadShaders (bsp, lump) {
  const bb = new BitStream(lump);

  bsp.shaders = new Array(lump.length / BspShader.size);

  for (let i = 0; i < bsp.shaders.length; i++) {
    const shader = bsp.shaders[i] = new BspShader();

    shader.name = bb.readASCIIString(MAX_QPATH);
    shader.surfaceFlags = bb.readInt32();
    shader.contents = bb.readInt32();
  }
}

function loadEntities (bsp, lump) {
  const bb = new BitStream(lump);

  /* entities consist of a list of key / value pairs inside a pair of curly brackets */
  const data = bb.readASCIIString(lump.byteLength);
  const tokens = new Tokenizer(data);
  let ent = null;

  bsp.entities = [];

  while (!tokens.EOF()) {
    const token = tokens.next();

    if (token === '{') {
      ent = { classname: 'unknown' };
    } else if (token === '}') {
      bsp.entities.push(ent);
      ent = null;
    } else {
      ent[token] = tokens.next();
    }
  }

  /* parse worldspawn */
  const worldspawn = bsp.entities[0];

  if (worldspawn.classname !== 'worldspawn') {
    throw new Error('worldspawn isn\'t the first entity');
  }

  if (worldspawn.gridsize) {
    const split = worldspawn.gridsize.split(' ');

    bsp.lightGridSize[0] = parseFloat(split[0]);
    bsp.lightGridSize[1] = parseFloat(split[1]);
    bsp.lightGridSize[2] = parseFloat(split[2]);
  }
}

function loadBsp (data, opts) {
  const bb = new BitStream(data);

  /* parse header */
  const ident = bb.readASCIIString(4);
  const version = bb.readInt32();

  if (ident !== 'IBSP' && version !== 46) {
    throw new Error(`Invalid BSP version: ${version}`);
  }

  /* parse lumps */
  const bsp = new Bsp();

  for (let i = 0; i < LUMP.NUM_LUMPS; i++) {
    const offset = bb.readInt32();
    const size = bb.readInt32();

    if (opts && opts.lumps && !opts.lumps.includes(i)) {
      continue;
    }

    const lump = data.subarray(offset, offset + size);

    switch (i) {
      case LUMP.ENTITIES:
        loadEntities(bsp, lump);
        break;
      case LUMP.SHADERS:
        loadShaders(bsp, lump);
        break;
      case LUMP.PLANES:
        loadPlanes(bsp, lump);
        break;
      case LUMP.NODES:
        loadNodes(bsp, lump);
        break;
      case LUMP.LEAFS:
        loadLeafs(bsp, lump);
        break;
      case LUMP.LEAFSURFACES:
        loadLeafSurfaces(bsp, lump);
        break;
      case LUMP.LEAFBRUSHES:
        loadLeafBrushes(bsp, lump);
        break;
      case LUMP.MODELS:
        loadBrushModels(bsp, lump);
        break;
      case LUMP.BRUSHES:
        loadBrushes(bsp, lump);
        break;
      case LUMP.BRUSHSIDES:
        loadBrushSides(bsp, lump);
        break;
      case LUMP.DRAWVERTS:
        loadVerts(bsp, lump);
        break;
      case LUMP.DRAWINDEXES:
        loadIndexes(bsp, lump);
        break;
      case LUMP.FOG:
        loadFogs(bsp, lump);
        break;
      case LUMP.SURFACES:
        loadSurfaces(bsp, lump);
        break;
      case LUMP.LIGHTMAPS:
        loadLightmaps(bsp, lump);
        break;
      case LUMP.LIGHTGRID:
        loadLightGrid(bsp, lump);
        break;
      case LUMP.VISIBILITY:
        loadVisibility(bsp, lump);
        break;
    }
  }

  return bsp;
}

export { LUMP, loadBsp };
