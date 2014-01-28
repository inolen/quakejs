var DirectedGraph = require('./directed-graph');
var qkfiles = require('quakejs-files');
var path = require('path');

var ASSET = {
	AUDIO:   0,
	MAP:     1,
	MODEL:   2,
	SCRIPT:  3,
	SHADER:  4,
	SKIN:    5,
	TEXTURE: 6,
	MISC:    7
};

function sanitize(p) {
	return p.toLowerCase().replace(/\\/g, '/');
}

function generalize(p, type) {
	var newExt;

	switch (type) {
		case ASSET.AUDIO:
			newExt = '.audio';
			break;
		case ASSET.MAP:
			newExt = '.map';
			break;
		case ASSET.MODEL:
			newExt = '.model';
			break;
		case ASSET.SCRIPT:
			newExt = '.script';
			break;
		case ASSET.SHADER:
			newExt = '.shader';
			break;
		case ASSET.SKIN:
			newExt = '.skin';
			break;
		case ASSET.TEXTURE:
			newExt = '.texture';
			break;
	}

	if (newExt) {
		var ext = path.extname(p);
		p = ext ? p.replace(ext, newExt) : (p + newExt);
	}

	return p;
}

var AssetGraph = function (baseGame, referenceThreshold) {
	DirectedGraph.call(this);

	this.games = {};
	this.maps = {};

	this.baseGameV = this.addGame(baseGame);
	this.referenceThreshold = referenceThreshold;
};

AssetGraph.prototype = Object.create(DirectedGraph.prototype);

AssetGraph.ASSET = ASSET;
AssetGraph.prototype.ASSET = ASSET;

AssetGraph.prototype._key = function (name, game, type) {
	return game + '/' + generalize(sanitize(name), type);
}

AssetGraph.prototype._getAsset = function (name, game, type) {
	var key = this._key(name, game, type);

	return this.getVertex(key);
}

AssetGraph.prototype._addAsset = function (name, game, type) {
	var self = this;
	var key = this._key(name, game, type);
	var v = this.getVertex(key);

	if (!v) {
		var gameV = this.addGame(game);

		v = this.addVertex(key, {
			type: type,
			basename: path.basename(name).replace(path.extname(name), ''),
			game: gameV.id
		});

		// if there is a vertex with the same name in the base game, we
		// need to check if it had any relations with assets for this game
		// and update them to point to the new vertex at this time
		var isMod = gameV !== this.baseGameV;

		if (isMod) {
			var baseKey = this._key(name, this.baseGameV.id, type);
			var baseV = this.getVertex(baseKey);

			if (baseV) {
				var removeE = [];

				baseV.inEdges.forEach(function (inE) {
					var outV = inE.outVertex;

					if (outV.data.game === gameV.id) {
						self.addEdge(outV, v);

						removeE.push(inE);
					}
				});

				baseV.outEdges.forEach(function (outE) {
					var inV = outE.inVertex;

					if (inV.data.game === gameV.id) {
						self.addEdge(v, inV);

						removeE.push(inE);
					}
				});

				removeE.forEach(function (e) { 
					self.removeEdge(e);
				});
			}
		}

		// if we're adding a non-map asset, see if it should be added to an existing map
		if (type !== ASSET.MAP) {
			var mapVerts = this.getMaps(gameV);

			if (mapVerts) {
				mapVerts.forEach(function (mapV) {
					if (v.id.indexOf(mapV.data.basename + '.') !== -1 || (mapV.data.whitelist && mapV.data.whitelist.matches(v.id))) {
						self._addReference(mapV, v);
					}
				});
			}
		}

		this.addEdge(gameV, v);
	}

	return v;
};

AssetGraph.prototype._getOrAddAsset = function (name, game, type) {
	var v = this._getAsset(name, game, type);

	if (!v) {
		v = this._getAsset(name, this.baseGameV.id, type);

		if (!v) {
			v = this._addAsset(name, this.baseGameV.id, type);
		}
	}

	return v;
};

AssetGraph.prototype._getOrAddShader = function (name, game) {
	var v = this._getAsset(name, game, ASSET.SHADER);

	if (!v) {
		v = this._getAsset(name, game, ASSET.TEXTURE);

		if (!v) {
			v = this._getAsset(name, this.baseGameV.id, ASSET.SHADER);

			if (!v) {
				v = this._addAsset(name, this.baseGameV.id, ASSET.TEXTURE);
			}
		}
	}

	return v;
};

AssetGraph.prototype._addReference = function (a, b) {
	for (var i = 0; i < a.outEdges.length; i++) {
		if (a.outEdges[i].inVertex == b) {
			return;
		}
	}
	return this.addEdge(a, b);
};

AssetGraph.prototype.addGame = function (game, whitelist) {
	var gameV = this.getVertex(game);

	if (!gameV) {
		gameV = this.addVertex(game);
	}

	if (whitelist) {
		gameV.data.whitelist = whitelist;
	}

	// add game to cached list
	this.games[game] = gameV;

	return gameV;
};

AssetGraph.prototype.addAudio = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.AUDIO);
};

AssetGraph.prototype.addMap = function (name, game, buffer, whitelist) {
	name = sanitize(name);

	var self = this;
	var mapV = this._addAsset(name, game, ASSET.MAP);
	var map = qkfiles.bsp.load(buffer, { lumps: [qkfiles.bsp.LUMP.ENTITIES, qkfiles.bsp.LUMP.SHADERS] });

	mapV.data.whitelist = whitelist;

	// process entities for asset references
	for (var i = 0; i < map.entities.length; i++) {
		var ent = map.entities[i];
		var assets = [];

		if (ent.music) {
			assets.push(this._getOrAddAsset(ent.music, game, ASSET.AUDIO));
		}

		if (ent.noise && ent.noise.charAt(0) !== '*') {
			assets.push(this._getOrAddAsset(ent.noise, game, ASSET.AUDIO));
		}

		// ignore the model property as it has been embedded in the map geometry

		if (ent.model2 && ent.model2.charAt(0) !== '*') {
			assets.push(this._getOrAddAsset(ent.model2, game, ASSET.MODEL));
		}

		for (var j = 0; j < assets.length; j++) {
			this._addReference(mapV, assets[j]);
		}
	}

	// process shader lump for textures
	for (var i = 0; i < map.shaders.length; i++) {
		var shaderName = map.shaders[i].shaderName;

		// ignore special textures (e.g. *lightmap)
		if (shaderName.charAt(0) === '*') {
			continue;
		}

		var textureV = this._getOrAddShader(shaderName, game);
		this._addReference(mapV, textureV);
	}

	// see if any assets exist for this game contains the new map's basenae or
	// whitelist. if they do, add a reference
	var mapName = path.basename(name).replace(path.extname(name), '');
	var gameV = this.games[game];

	gameV.getOutVertices().forEach(function (assetV) {
		if (assetV.data.type === ASSET.MAP) {
			return;
		}

		if (assetV.id.indexOf(mapName + '.') !== -1 || (mapV.data.whitelist && mapV.data.whitelist.matches(assetV.id))) {
			self._addReference(mapV, assetV);
		}
	});

	// add map to cached list
	if (!this.maps[game]) {
		this.maps[game] = {};
	}
	this.maps[game][mapV.data.basename] = mapV;

	return mapV;
};

AssetGraph.prototype.addMisc = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.MISC);
};

AssetGraph.prototype.addModel = function (name, game, buffer) {
	name = sanitize(name);

	var modelV = this._addAsset(name, game, ASSET.MODEL);
	var model = qkfiles.md3.load(buffer);

	for (var i = 0; i < model.skins.length; i++) {
		var skin = model.skins[i];
		if (!skin) {
			// models often have bad data, including empty skin / shader names
			continue;
		}
		var skinV = this._getOrAddAsset(texture, game, ASSET.SKIN);
		this._addReference(modelV, skinAsset);
	}

	for (var i = 0; i < model.surfaces.length; i++) {
		var surface = model.surfaces[i];

		for (var j = 0; j < surface.shaders.length; j++) {
			var texture = surface.shaders[j];
			if (!texture) {
				continue;
			}

			var textureV = this._getOrAddShader(texture, game);
			this._addReference(modelV, textureV);
		}
	}

	return modelV;
};

AssetGraph.prototype.addScript = function (name, game, buffer) {
	name = sanitize(name);

	var self = this;
	var scriptV = this._addAsset(name, game, ASSET.SCRIPT);
	var script = qkfiles.shader.loadScript(buffer.toString('utf8'));

	Object.keys(script).forEach(function (key) {
		// note: while scripts do contain shaders organizationally,
		// scripts are never referenced, therefor we model the
		// relationship as:
		//                                      / - base_wall.shader (script)
		// textures/base_wall/foobar (shader) -> -- textures/base_wall/foobar_stage1.tga (texture)
		//                                      \ - textures/base_wall/foobar_stage2.tga (texture)
		var shaderV = self.addShader(key, game, script[key]);

		self._addReference(shaderV, scriptV);
	});

	return scriptV;
};

AssetGraph.prototype.addShader = function (name, game, buffer) {
	name = sanitize(name);

	var self = this;
	var shaderV = this._addAsset(name, game, ASSET.SHADER);
	var shader = qkfiles.shader.loadShader(buffer);

	shader.stages.forEach(function (stage) {
		stage.maps.forEach(function (map) {
			// ignore special textures (e.g. *white)
			if (map.charAt(0) === '*') {
				return;
			}

			var stageV = self._getOrAddAsset(map, game, ASSET.TEXTURE);
			self._addReference(shaderV, stageV);
		});
	});

	// add inner / outer box maps for sky shaders
	shader.innerBox.forEach(function (map) {
		var mapV = self._getOrAddAsset(map, game, ASSET.TEXTURE);
		self._addReference(shaderV, mapV);
	});

	shader.outerBox.forEach(function (map) {
		var mapV = self._getOrAddAsset(map, game, ASSET.TEXTURE);
		self._addReference(shaderV, mapV);
	});

	// by default, all composite assets (maps, md3s, etc.) treat shaders as
	// textures. if this new shader has the same name as an existing texture,
	// we need to update any of these relationships (as shaders take precedence)
	var games = game !== this.baseGameV.id ? [game, this.baseGameV.id] : [this.baseGameV.id];

	games.forEach(function (textureGame) {
		var textureKey = self._key(name, textureGame, ASSET.TEXTURE);
		var textureV = self.getVertex(textureKey);

		if (!textureV) {
			return;
		}

		var removeE = [];

		textureV.inEdges.forEach(function (inE) {
			var outV = inE.outVertex;

			if ((outV.data.type === ASSET.MAP || outV.data.type === ASSET.MODEL) && outV.data.game === game) {
				self.addEdge(outV, shaderV);

				removeE.push(inE);
			}
		});

		removeE.forEach(function (e) {
			self.removeEdge(e);
		});
	});

	return shaderV;
};

AssetGraph.prototype.addSkin = function (name, game) {
	name = sanitize(name);

	// TODO parse skin asset

	return this._addAsset(name, game, ASSET.SKIN);
};

AssetGraph.prototype.addTexture = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.TEXTURE);
};

AssetGraph.prototype.getMods = function () {
	var self = this;

	return Object.keys(this.games).filter(function (game) {
		return self.games[game] !== self.baseGameV;
	}).map(function (game) {
		return self.games[game];
	});
};

AssetGraph.prototype.getMaps = function (gameV) {
	var maps = this.maps[gameV.id];

	if (!maps) {
		return null;
	}

	return Object.keys(maps).map(function (map) {
		return maps[map];
	});
};

AssetGraph.prototype._getMapReferences = function (startV, gameV) {
	var checked = {};
	var references = [];

	function check(v) {
		v.getInVertices().forEach(function (inV) {
			if (checked[inV.id]) {
				return;
			}
			checked[inV.id] = true;

			if (inV.data.type === AssetGraph.ASSET.MAP) {
				if ((!gameV || inV.data.game === gameV.id) && references.indexOf(inV) === -1) {
					references.push(inV);
				}
				return;
			}

			check(inV);
		});
	}

	check(startV);

	return references;
};

AssetGraph.prototype.getMapAssets = function (mapV) {
	var self = this;
	var verts = [];
	var checked = {};

	var gameV = this.games[mapV.data.game];

	// add map as first asset
	checked[mapV.id] = true;
	verts.push(mapV);

	function check(outV) {
		if (checked[outV.id]) {
			return;
		}
		checked[outV.id] = true;

		// if the asset is unique to the mod, see how many maps for the current mod reference it,
		// if the asset is from the base directory, see how many maps from all maps it
		var isModAsset = gameV !== self.baseGameV && outV.data.game === gameV.id;
		var references = self._getMapReferences(outV, isModAsset ? gameV : null);

		// if the asset is referenced by >= referenceThreshold maps,
		// ignore it and any of its dependencies, it will be added
		// to a common pak
		if (references.length >= self.referenceThreshold) {
			return;
		}

		// don't actually add shaders (they're not real files), we just care about their dependencies
		if (outV.data.type !== ASSET.SHADER && verts.indexOf(outV) === -1) {
			verts.push(outV);
		}

		outV.getOutVertices().forEach(check);
	}

	mapV.getOutVertices().forEach(check);

	return verts;
};

AssetGraph.prototype.getCommonAssets = function (gameV) {
	var self = this;
	var verts = [];
	var checked = {};
	var isMod = gameV !== this.baseGameV;

	function check(outV) {
		if (checked[outV.id]) {
			return;
		}
		checked[outV.id] = true;

		if (outV.data.type !== ASSET.SHADER && verts.indexOf(outV) === -1) {
			verts.push(outV);
		}

		outV.getOutVertices().forEach(check);
	}

	gameV.getOutVertices().forEach(function (outV) {
		// if a mod, iterate over all assets unique to the mod, adding assets _not_ packed by a mod map
		// if the base game, iterate over all assets unique to the mod, adding assets _not_ packed by any map
		var references = self._getMapReferences(outV, isMod ? gameV : null);

		// if the asset is referenced by >= referenceThreshold, or it's whitelisted,
		// we should add it and all of its dependencies to the common pak
		if (references.length >= self.referenceThreshold || (gameV.data.whitelist && gameV.data.whitelist.matches(outV.id))) {
			check(outV);
		}
	});

	return verts;
};

module.exports = AssetGraph;
