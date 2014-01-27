var AssetGraph = require('../lib/asset-graph');
var async = require('async');
var fs = require('fs');
var logger = require('winston');
var path = require('path');
var exec = require('child_process').exec;
var execSync = require('execSync').exec;
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

function loadConfig() {
	var config;

	try {
		config = require(__dirname + '/repak-config.json');

		// convert strings that look like regular expressions to RegExp instances
		var mapRegex = function (v, i) {
			var m = v.match(/^\/(.+)\/$/);
			if (m) {
				return new RegExp(m[1]);
			}
			return v;
		};

		Object.keys(config.games).forEach(function (game) {
			var gameConfig = config.games[game];

			gameConfig.exclude = (gameConfig.exclude ? gameConfig.exclude.map(mapRegex) : []);
			gameConfig.include = (gameConfig.include ? gameConfig.include.map(mapRegex) : []);
		});
	} catch (e) {
		config = { games: {} };
	}

	return config;
}

function isListed(list, file) {
	file = file.toLowerCase();

	for (var i = 0; i < list.length; i++) {
		var entry = list[i];

		if (typeof entry === 'object' && entry.test(file)) {
			return true;
		} else if (typeof entry === 'string' && file.indexOf(entry) !== -1) {
			return true;
		}
	}

	return false;
}

function isBlacklisted(game, file) {
	var list = config.games[game] ? config.games[game].exclude : [];
	list = list.concat(blacklist);
	return isListed(list, file);
}

function isWhitelisted(game, file) {
	var list = config.games[game] ? config.games[game].include : [];
	list = list.concat(whitelist);
	return isListed(list, file);
}

function getGameConfig(game) {
	var gameConfig = config.games[game];
	return gameConfig;
}

function getMapConfig(game, map) {
	var gameConfig = config.games[game];
	return gameConfig && gameConfig.maps && gameConfig.maps[mapName];
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
	function graphFile(name) {
		var file = path.join(root, name);
		var ext = path.extname(file).toLowerCase();

		var v;

		if (ext === '.wav') {
			v = graph.addAudio(name, game);
		} else if (ext === '.bsp') {
			var mapName = name.replace(path.extname(name), '');
			var gameConfig = config.games[game];
			var mapConfig = gameConfig && gameConfig.maps && gameConfig.maps[mapName];
			v = graph.addMap(name, game, fs.readFileSync(file), mapConfig && mapConfig.whitelist);
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

	var files = wrench.readdirSyncRecursive(root).filter(function (file) {
		var absolute = path.join(root, file);

		if (isBlacklisted(game, file)) {
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
var mods = graph.getMods();

mods.forEach(function (mod) {
	var maps = graph.getMaps(mod);

	// write out paks for each map
	maps.forEach(function (map) {
		var assets = graph.getMapAssets(mod, map);
		var fileMap = vertsToFileMap(assets);
		var pakName = path.resolve(path.join(dest, mod, map + '.pk3'));

		tasks.push(function (cb) {
			writePak(pakName, fileMap, cb);
		});
	});

	// write out paks for common assets
	var assets = graph.getCommonAssets(mod, function (file) { return isWhitelisted(mod, file); });
	var fileMap = vertsToFileMap(assets);
	var pakName = path.resolve(path.join(dest, mod, 'pak.pk3'));

	tasks.push(function (cb) {
		writePak(pakName, fileMap, commonPakMaxSize, cb);
	});
});

// then the base game
var maps = graph.getMaps(baseGame);

maps.forEach(function (map) {
	var assets = graph.getMapAssets(baseGame, map);
	var fileMap = vertsToFileMap(assets);
	var pakName = path.resolve(path.join(dest, baseGame, map + '.pk3'));

	tasks.push(function (cb) {
		writePak(pakName, fileMap, cb);
	});
});

var assets = graph.getCommonAssets(baseGame, function (file) { return isWhitelisted(baseGame, file); });
var fileMap = vertsToFileMap(assets);
var pakName = path.resolve(path.join(dest, baseGame, 'pak.pk3'));

tasks.push(function (cb) {
	writePak(pakName, fileMap, commonPakMaxSize, cb);
});

// write out everything
async.parallelLimit(tasks, 8, function (err) {
	if (err) throw err;
});
