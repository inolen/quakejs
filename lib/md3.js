import { BitStream } from 'bit-buffer';

const MAX_QPATH = 64;

const MD3_VERSION = 15;
const MD3_XYZ_SCALE = (1.0 / 64);

const SHADER_MAX_VERTEXES = 4096;
const SHADER_MAX_INDEXES = 6 * SHADER_MAX_VERTEXES;

class Md3Header {
  constructor () {
    this.ident = 0;
    this.version = 0;
    this.name = null;
    this.flags = 0;
    this.numFrames = 0;
    this.numTags = 0;
    this.numSurfaces = 0;
    this.numSkins = 0;
    this.ofsFrames = 0;
    this.ofsTags = 0;
    this.ofsSurfaces = 0;
    this.ofsEnd = 0;
  }
}

class Md3SurfaceHeader {
  constructor () {
    this.ident = 0;
    this.name = null;
    this.flags = 0;
    this.numFrames = 0;
    this.numShaders = 0;
    this.numVerts = 0;
    this.numTriangles = 0;
    this.ofsTriangles = 0;
    this.ofsShaders = 0;
    this.ofsSt = 0;
    this.ofsXyzNormals = 0;
    this.ofsEnd = 0;
  }
}

class Md3 {
  constructor (name) {
    this.name = name;
    this.flags = 0;
    this.frames = null;
    this.tags = null;
    this.surfaces = null;
    this.skins = null;
  }
}

class Md3Surface {
  constructor () {
    this.name = null;
    this.numFrames = 0;
    this.numVerts = 0;
    this.shaders = null;
    this.st = null;
    this.indexes = null; /* triangles grouped in 3s */
    this.xyz = null;
    this.normals = null;
    this.model = null;
  }
}

class Md3Frame {
  constructor () {
    this.bounds = [
      [0, 0, 0],
      [0, 0, 0]
    ];
    this.localOrigin = [
      0, 0, 0
    ];
    this.radius = 0;
    this.name = null;
  }
}

class Md3Tag {
  constructor () {
    this.name = null;
    this.origin = [
      0, 0, 0
    ];
    this.axis = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
  }
}

function loadMd3 (data) {
  const bb = new BitStream(data);

  const header = new Md3Header();
  header.ident = bb.readInt32();
  header.version = bb.readInt32();

  if (header.version !== MD3_VERSION) {
    throw new Error('Wrong version (' + header.version + ' should be ' + MD3_VERSION + ')');
  }

  header.name = bb.readASCIIString(MAX_QPATH);
  header.flags = bb.readInt32();
  header.numFrames = bb.readInt32();
  header.numTags = bb.readInt32();
  header.numSurfaces = bb.readInt32();
  header.numSkins = bb.readInt32();
  header.ofsFrames = bb.readInt32();
  header.ofsTags = bb.readInt32();
  header.ofsSurfaces = bb.readInt32();
  header.ofsEnd = bb.readInt32();

  if (header.numFrames < 1) {
    throw new Error('LoadMd3: 0 frames');
  }

  const md3 = new Md3(header.name);
  md3.frames = new Array(header.numFrames);
  md3.tags = new Array(header.numFrames * header.numTags);
  md3.surfaces = new Array(header.numSurfaces);
  md3.skins = new Array(header.numSkins);

  /* read frames */
  bb.index = header.ofsFrames << 3;

  for (let i = 0; i < header.numFrames; i++) {
    const frame = md3.frames[i] = new Md3Frame();

    for (let j = 0; j < 6; j++) {
      frame.bounds[Math.floor(j / 3)][j % 3] = bb.readFloat32();
    }

    for (let j = 0; j < 3; j++) {
      frame.localOrigin[j] = bb.readFloat32();
    }

    frame.radius = bb.readFloat32();
    frame.name = bb.readASCIIString(16);
  }

  /* read tags */
  bb.index = header.ofsTags << 3;

  for (let i = 0; i < header.numFrames * header.numTags; i++) {
    const tag = md3.tags[i] = new Md3Tag();

    tag.name = bb.readASCIIString(MAX_QPATH);

    for (let j = 0; j < 3; j++) {
      tag.origin[j] = bb.readFloat32();
    }
    for (let j = 0; j < 9; j++) {
      tag.axis[Math.floor(j / 3)][j % 3] = bb.readFloat32();
    }
  }

  /* read meshes */
  let meshOffset = header.ofsSurfaces;

  for (let i = 0; i < header.numSurfaces; i++) {
    bb.index = meshOffset << 3;

    const surfheader = new Md3SurfaceHeader();
    surfheader.ident = bb.readInt32();
    surfheader.name = bb.readASCIIString(MAX_QPATH);
    surfheader.flags = bb.readInt32();
    surfheader.numFrames = bb.readInt32();
    surfheader.numShaders = bb.readInt32();
    surfheader.numVerts = bb.readInt32();
    surfheader.numTriangles = bb.readInt32();
    surfheader.ofsTriangles = bb.readInt32();
    surfheader.ofsShaders = bb.readInt32();
    surfheader.ofsSt = bb.readInt32();
    surfheader.ofsXyzNormals = bb.readInt32();
    surfheader.ofsEnd = bb.readInt32();

    if (surfheader.numVerts > SHADER_MAX_VERTEXES) {
      throw new Error('Num vertices exceeeded SHADER_MAX_VERTEXES');
    }

    if (surfheader.numTriangles * 3 > SHADER_MAX_INDEXES) {
      throw new Error('Num indices exceeeded SHADER_MAX_INDEXESj');
    }

    const surf = md3.surfaces[i] = new Md3Surface();
    surf.name = surfheader.name.toLowerCase().replace(/_\d+/, '');
    surf.numFrames = surfheader.numFrames;
    surf.numVerts = surfheader.numVerts;
    surf.shaders = new Array(surfheader.numShaders);
    surf.indexes = new Array(surfheader.numTriangles * 3);
    surf.st = new Array(surfheader.numVerts);
    surf.xyz = new Array(surfheader.numFrames * surfheader.numVerts);
    surf.normals = new Array(surfheader.numFrames * surfheader.numVerts);

    /* read shaders */
    bb.index = (meshOffset + surfheader.ofsShaders) << 3;

    for (let j = 0; j < surfheader.numShaders; j++) {
      const name = bb.readASCIIString(MAX_QPATH).replace(/\.[^/.]+$/, '');

      surf.shaders[j] = name;
    }

    /* read triangles */
    bb.index = (meshOffset + surfheader.ofsTriangles) << 3;

    for (let j = 0; j < surfheader.numTriangles; j++) {
      for (let k = 0; k < 3; k++) {
        surf.indexes[j * 3 + k] = bb.readInt32();
      }
    }

    /* read st coordinates */
    bb.index = (meshOffset + surfheader.ofsSt) << 3;

    for (let j = 0; j < surfheader.numVerts; j++) {
      const st = surf.st[j] = [0, 0];

      st[0] = bb.readFloat32();
      st[1] = bb.readFloat32();
    }

    /* read normals */
    bb.index = (meshOffset + surfheader.ofsXyzNormals) << 3;

    for (let j = 0; j < surfheader.numFrames * surfheader.numVerts; j++) {
      const xyz = surf.xyz[j] = [0, 0, 0];
      const normal = surf.normals[j] = [0, 0, 0];

      for (let k = 0; k < 3; k++) {
        xyz[k] = bb.readInt16() * MD3_XYZ_SCALE;
      }

      /* convert from spherical coordinates to normalized vectors */
      const zenith = bb.readInt8();
      const azimuth = bb.readInt8();

      const lat = zenith * (2 * Math.PI) / 255;
      const lng = azimuth * (2 * Math.PI) / 255;

      normal[0] = Math.cos(lng) * Math.sin(lat);
      normal[1] = Math.sin(lng) * Math.sin(lat);
      normal[2] = Math.cos(lat);

      let len = normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2];

      if (len > 0) {
        len = 1 / Math.sqrt(len);
        normal[0] = normal[0] * len;
        normal[1] = normal[1] * len;
        normal[2] = normal[2] * len;
      }
    }

    meshOffset += surfheader.ofsEnd;
  }

  return md3;
}

export { loadMd3 };
