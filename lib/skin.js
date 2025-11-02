class SkinSurface {
  constructor (name, shader) {
    this.name = name;
    this.shader = shader;
  }
}

class Skin {
  constructor () {
    this.surfaces = [];
  }
}

function loadSkin (data) {
  const skin = new Skin();

  /* trim before splitting */
  const lines = data.replace(/^\s+|\s+$/g, '').split(/\r\n/);

  for (const line of lines) {
    const split = line.split(/,/);
    const name = split[0].toLowerCase();
    const shader = split[1];

    if (name.includes('tag_')) {
      continue;
    }

    skin.surfaces.push(new SkinSurface(name, shader));
  }

  return skin;
}

export { loadSkin };
