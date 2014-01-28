var AssetGraph = require('../lib/asset-graph');
var async = require('async');
var fs = require('fs');
var logger = require('winston');
var path = require('path');
var exec = require('child_process').exec;
var execSync = require('execSync').exec;
var os = require('os');
var temp = require('temp');
var wrench = require('wrench');

var baseGame = 'basejs';
var commonReferenceThreshold = 3;
var commonPakMaxSize = 32 * 1024 * 1024;
var blacklist = [
	/_[123]{1}\.md3/,
	/\.map$/
];
var whitelist = [
	/\.cfg$/,
	/\.qvm$/,
	/scripts\/.+\.txt/,
	'botfiles/',
	'fonts/',
	'gfx/',
	'icons/',
	'include/',
	'menu/',
	'models/',
	'music/',
	'powerups/',  // powerup shaders
	'sprites/',
	'sound/',
	'ui/'
];

logger.cli();
logger.level = 'debug';

var src = process.argv[2];
var dest = process.argv[3];
var config = loadConfig();

function MatchList(entries) {
	this.entries = entries;
}

MatchList.prototype.matches = function (item) {
	for (var i = 0; i < this.entries.length; i++) {
		var entry = this.entries[i];

		if (typeof entry === 'object' && entry.test(item)) {
			return true;
		} else if (typeof entry === 'string' && item.indexOf(entry) !== -1) {
			return true;
		}
	}

	return false;
};

function loadConfig() {
	var config;

	// convert strings that look like regular expressions to RegExp instances
	var mapRegex = function (v, i) {
		var m = v.match(/^\/(.+)\/$/);
		if (m) {
			return new RegExp(m[1]);
		}
		return v;
	};

	try {
		config = require(__dirname + '/repak-config.json');

		config.games = config.games || {};

		Object.keys(config.games).forEach(function (game) {
			var gameConfig = config.games[game];

			gameConfig.exclude = (gameConfig.exclude ? gameConfig.exclude.map(mapRegex) : []);
			gameConfig.include = (gameConfig.include ? gameConfig.include.map(mapRegex) : []);

			gameConfig.maps = gameConfig.maps || {};

			Object.keys(gameConfig.maps).forEach(function (map) {
				var mapConfig = gameConfig.maps[map];

				mapConfig.include = (mapConfig.include ? mapConfig.include.map(mapRegex) : []);
			});
		});
	} catch (e) {
		config = { games: {} };
	}

	return config;
}

function getGames(root) {
	return fs.readdirSync(root).filter(function (file) {
		var absolute = path.join(root, file);
		try {
			var stats = fs.lstatSync(absolute);
			return stats.isDirectory();
		} catch (e) {
			return false;
		}
	});
}

function getPaks(root) {
	return fs.readdirSync(root).filter(function (file) {
		return path.extname(file).toLowerCase() === '.pk3';
	});
}

function extractPak(pak, dest) {
	logger.info('extracting pak ' + pak);

	execSync('unzip -o ' + pak + ' -d ' + dest);
}

function flattenPaks(paks) {
	var tempDir = temp.mkdirSync('flattened');

	// sort the paks in ascending order before extracting
	paks = paks.sort();

	paks.forEach(function (pak) {
		extractPak(pak, tempDir);
	});

	return tempDir;
}

function graphGame(graph, game, root) {
	var gameConfig = config.games[game];
	var gameBlacklist = new MatchList((gameConfig ? gameConfig.exclude : []).concat(blacklist));
	var gameWhitelist = new MatchList((gameConfig ? gameConfig.include : []).concat(whitelist));

	function graphFile(name) {
		var file = path.join(root, name);
		var ext = path.extname(file).toLowerCase();

		var v;

		if (ext === '.wav') {
			v = graph.addAudio(name, game);
		} else if (ext === '.bsp') {
			var mapName = path.basename(name).replace(path.extname(name), '');
			var mapConfig = gameConfig && gameConfig.maps[mapName];
			var mapWhitelist = mapConfig && new MatchList(mapConfig.include);

			v = graph.addMap(name, game, fs.readFileSync(file), mapWhitelist);
		} else if (ext === '.md3') {
			v = graph.addModel(name, game, fs.readFileSync(file));
		} else if (ext === '.shader') {
			v = graph.addScript(name, game, fs.readFileSync(file));
		} else if (ext === '.skin') {
			v = graph.addSkin(name, game, fs.readFileSync(file));
		} else if (ext === '.jpg' || ext === '.tga') {
			v = graph.addTexture(name, game);
		} else {
			v = graph.addMisc(name, game);
		}

		// add filename to node for help resolving later
		v.data.path = { root: root, name: name };

		return v;
	}

	var gameV = graph.addGame(game, gameWhitelist);

	var files = wrench.readdirSyncRecursive(root).filter(function (file) {
		var absolute = path.join(root, file);

		if (gameBlacklist.matches(file)) {
			return false;
		}

		try {
			var stats = fs.lstatSync(absolute);
			return stats.isFile();
		} catch (e) {
			return false;
		}
	});

	files.forEach(function (file) {
		graphFile(file);
	});
}

function transformFile(src) {
	if (src.indexOf('.wav') === -1) {
		return src;
	}

	var dest = src.replace('.wav', '.opus');

	// do the transform
	var result = execSync('opusenc ' + src + ' ' + dest);
	if (result.code) {
		console.log('.. failed to opus encode ' + src);
		return src;
	}

	return dest;
}

function vertsToFileMap(verts) {
	var fileMap = {};

	verts.forEach(function (v) {
		if (!v.data.path) {
			logger.warn('missing asset ' + v.id);
			return;
		}

		var absolute = transformFile(path.join(v.data.path.root, v.data.path.name));
		var relative = path.relative(v.data.path.root, absolute);

		fileMap[relative] = absolute;
	});

	return fileMap;
}

function writePak(pak, fileMap, splitThreshold, callback) {
	if (callback === undefined) {
		callback = splitThreshold;
		splitThreshold = undefined;
	}

	var currentPak = pak;
	var part = 0;

	var nextPart = function () {
		if (splitThreshold) {
			var ext = path.extname(pak);
			currentPak = pak.replace(ext, part + ext);
			part++;
		}

		// remove an existing pak if it exists
		try {
			fs.unlinkSync(currentPak);
		} catch (e) {
		}

		// create the directory tree
		wrench.mkdirSyncRecursive(path.dirname(currentPak));

		logger.info('writing ' + currentPak);
	};

	var checkNextPart = function () {
		if (splitThreshold) {
			var stats = fs.statSync(currentPak);

			if (stats.size >= splitThreshold) {
				nextPart();
			}
		}
	};

	nextPart();

	async.eachSeries(Object.keys(fileMap), function (relative, cb) {
		var absolute = fileMap[relative];
		var baseDir = path.normalize(absolute.replace(relative, ''));

		exec('zip \"' + currentPak + '\" \"' + relative + '\"', { cwd: baseDir }, function (err) {
			if (err) return cb(err);
			checkNextPart();
			cb();
		});
	}, callback);
}

// initialize the graph with each game's files
var graph = new AssetGraph(baseGame, commonReferenceThreshold);

getGames(src).forEach(function (game) {
	var dir = path.join(src, game);
	var paks = getPaks(dir).map(function (pak) {
		return path.join(dir, pak);
	});
	var flattened = flattenPaks(paks);

	graphGame(graph, game, flattened);
});

//
// write out each game's assets
//
var tasks = [];

// do each mod first
var modVerts = graph.getMods();

modVerts.forEach(function (modV) {
	var mapVerts = graph.getMaps(modV);

	// write out paks for each map
	mapVerts.forEach(function (mapV) {
		var assetVerts = graph.getMapAssets(mapV);
		var fileMap = vertsToFileMap(assetVerts);
		var pakName = path.resolve(path.join(dest, modV.id, mapV.data.basename + '.pk3'));

		tasks.push(function (cb) {
			writePak(pakName, fileMap, cb);
		});
	});

	// write out paks for common assets
	var assetVerts = graph.getCommonAssets(modV);
	var fileMap = vertsToFileMap(assetVerts);
	var pakName = path.resolve(path.join(dest, modV.id, 'pak.pk3'));

	tasks.push(function (cb) {
		writePak(pakName, fileMap, commonPakMaxSize, cb);
	});
});

// then the base game
var mapVerts = graph.getMaps(graph.baseGameV);

if (mapVerts) {
	mapVerts.forEach(function (mapV) {
		var assetVerts = graph.getMapAssets(mapV);
		var fileMap = vertsToFileMap(assetVerts);
		var pakName = path.resolve(path.join(dest, graph.baseGameV.id, mapV.data.basename + '.pk3'));

		tasks.push(function (cb) {
			writePak(pakName, fileMap, cb);
		});
	});
}

var assetVerts = graph.getCommonAssets(graph.baseGameV);
var fileMap = vertsToFileMap(assetVerts);
var pakName = path.resolve(path.join(dest, graph.baseGameV.id, 'pak.pk3'));

tasks.push(function (cb) {
	writePak(pakName, fileMap, commonPakMaxSize, cb);
});

// write out everything
async.parallelLimit(tasks, os.cpus().length, function (err) {
	if (err) throw err;
});
