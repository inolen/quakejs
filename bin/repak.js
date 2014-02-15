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

var baseGame = 'baseq3';
var commonReferenceThreshold = 3;
var commonPakMaxSize = 16 * 1024 * 1024;
var blacklist = [
	/_[123]{1}\.md3/,
	/\.map$/
];
var whitelist = [
	/\.cfg$/,
	/\.qvm$/,
	/scripts\/.+\.bot/,
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

var argv = require('optimist')
	.options({
		'config': {
			'description': 'Repak asset config script',
			'default': path.join(__dirname, 'repak-config.json')
		},
		'src': {
			'description': 'Source directory'
		},
		'dest': {
			'description': 'Destination directory'
		}
	})
	.demand(['src', 'dest'])
	.argv;

if (argv.h || argv.help) {
	opt.showHelp();
	return;
}

var src = argv.src;
var dest = argv.dest;
var config = loadConfig(argv.config);

function MatchList(entries) {
	this.entries = entries;
}

MatchList.prototype.matches = function (item) {
	item = item.toLowerCase();

	for (var i = 0; i < this.entries.length; i++) {
		var entry = this.entries[i];

		if (typeof entry === 'object' && entry.test(item)) {
			return true;
		} else if (typeof entry === 'string') {
			entry = entry.toLowerCase();

			if (item.indexOf(entry) !== -1) {
				return true;
			}
		}
	}

	return false;
};

function loadConfig(configPath) {
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
		logger.info('loading config file from ' + configPath + '..');

		config = require(configPath);

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
		var stats = fs.lstatSync(absolute);
		return stats.isDirectory();
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

		var stats = fs.lstatSync(absolute);
		return stats.isFile();
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
		logger.error('.. failed to opus encode ' + src);
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

	var part = 100;
	var currentPak = nextPartName(pak);
	var files = Object.keys(fileMap).sort();

	function nextPartName(pak) {
		if (splitThreshold) {
			var ext = path.extname(pak);
			pak = pak.replace(ext, part + ext);
			part++;
		}
		return pak;
	}

	function nextFile() {
		if (!files.length) {
			return callback();
		}

		var relative = files.shift();
		var absolute = fileMap[relative];
		var baseDir = path.normalize(absolute.replace(relative, ''));

		exec('zip \"' + currentPak + '\" \"' + relative + '\"', { cwd: baseDir }, function (err) {
			if (err) return cb(err);

			if (splitThreshold) {
				var stats = fs.statSync(currentPak);

				if (stats.size >= splitThreshold) {
					// went over the threshold, remove the file from the
					// zip and put it into the next part
					exec('zip -d \"' + currentPak + '\" \"' + relative + '\"', { cwd: baseDir }, function (err) {
						if (err) return cb(err);

						files.unshift(relative);

						currentPak = nextPartName(pak);

						logger.info('writing ' + currentPak);

						nextFile();
					});

					return;
				}
			}

			nextFile();
		});
	}

	logger.info('writing ' + currentPak);

	wrench.mkdirSyncRecursive(path.dirname(currentPak));

	nextFile();
}

//
// clean out old assets
//
getGames(dest).map(function (file) {
	return path.join(dest, file);
}).forEach(function (dir) {
	logger.info('deleting ' + dir);
	wrench.rmdirSyncRecursive(dir);
});

//
// initialize the graph
//
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

async.parallelLimit(tasks, os.cpus().length, function (err) {
	if (err) throw err;
});
