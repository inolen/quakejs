var AssetGraph = require('../lib/asset-graph');
var fs = require('fs');
var logger = require('winston');
var path = require('path');
var sh = require('execSync');
var temp = require('temp');
var wrench = require('wrench');

var src = process.argv[2];
var dest = process.argv[3];

var baseGame = 'basejs';
var commonReferenceThreshold = 3;
var blacklist = [
	/\.dm[_]*\d+/,
	/_[123]{1}\.md3/,
	'.map',
	'maps/pro-q3tourney2.aas',
	'maps/pro-q3tourney2.bsp',
	'maps/pro-q3tourney4.aas',
	'maps/pro-q3tourney4.bsp',
	'maps/q3ctf1.aas',
	'maps/q3ctf2.aas',
	'maps/q3ctf3.aas',
	'maps/q3ctf4.aas',
	'maps/q3ctf5.aas',
	'maps/q3dm0.aas',
	'maps/q3dm1.aas',
	'maps/q3dm1.bsp',
	'maps/q3dm2.aas',
	'maps/q3dm3.aas',
	'maps/q3dm4.aas',
	'maps/q3dm5.aas',
	'maps/q3dm6.aas',
	'maps/q3dm8.aas',
	'maps/q3dm9.aas',
	'maps/q3dm9.bsp',
	'maps/q3dm10.aas',
	'maps/q3dm11.aas',
	'maps/q3dm12.aas',
	'maps/q3dm13.aas',
	'maps/q3dm14.aas',
	'maps/q3dm15.aas',
	'maps/q3dm16.aas',
	'maps/q3dm17.aas',
	'maps/q3dm17.bsp',
	'maps/q3dm18.aas',
	'maps/q3tourney1.aas',
	'maps/q3tourney2.aas',
	'maps/q3tourney2.bsp',
	'maps/q3tourney3.aas',
	'maps/q3tourney4.aas',
	'maps/q3tourney5.aas',
	'maps/q3tourney6.aas',
	'maps/q3tourney6_ctf.aas',
	'maps/q3tourney6_ctf.bsp',
	'models/players/brandon',
	'models/players/carmack',
	'models/players/cash',
	'models/players/light',
	'models/players/medium',
	'models/players/paulj',
	'models/players/tim'
];
var whitelist = [
	/scripts\/.+\.txt/,
	'.cfg',
	'.qvm',
	'botfiles/',
	'fonts/',
	'gfx/',
	'icons/',
	'include/',
	'menu/',
	'models/',
	'music/',
	'sprites/',
	'sound/',
	'textures/effects/',
	'textures/sfx/',
	'textures/q3f_hud/',
	'ui/'
];

logger.cli();
logger.level = 'debug';

function isBlacklisted(file) {
	file = file.toLowerCase();
	for (var i = 0; i < blacklist.length; i++) {
		var entry = blacklist[i];
		if (typeof entry === 'object' && entry.test(file)) {
			return true;
		} else if (typeof entry === 'string' && file.indexOf(entry) !== -1) {
			return true;
		}
	}
	return false;
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

	sh.exec('unzip -o ' + pak + ' -d ' + dest);
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
			v = graph.addMap(name, game, fs.readFileSync(file));
		} else if (ext === '.md3') {
			v = graph.addModel(name, game, fs.readFileSync(file));
		} else if (ext === '.shader') {
			v = graph.addShader(name, game, fs.readFileSync(file));
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
	var result = sh.exec('opusenc ' + src + ' ' + dest);
	if (result.code) {
		console.log('.. failed to opus encode ' + src);
		return asset;
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

function writePak(pak, fileMap) {
	var tempDir = temp.mkdirSync('working');

	logger.info('writing ' + pak);

	// copy all the files to a temp directory
	Object.keys(fileMap).forEach(function (relative) {
		var src = fileMap[relative];
		var dest = path.join(tempDir, relative);

		var buffer = fs.readFileSync(src);
		wrench.mkdirSyncRecursive(path.dirname(dest));
		fs.writeFileSync(dest, buffer);
	});

	// zip up the temp directory
	var absolutePak = path.resolve(process.cwd(), pak);
	sh.exec('cd ' + tempDir + ' && zip -FSr ' + absolutePak + ' .');
}

// initialize the graph with each game's files
var graph = new AssetGraph(baseGame);

getGames(src).forEach(function (game) {
	var dir = path.join(src, game);
	var paks = getPaks(dir).map(function (pak) {
		return path.join(dir, pak);
	});
	var flattened = flattenPaks(paks);

	graphGame(graph, game, flattened);
});

//
// write out each mod's assets
//
var mods = graph.getMods();

mods.forEach(function (mod) {
	var maps = graph.getMaps(mod);

	// write out paks for each map
	maps.forEach(function (map) {
		var pakName = path.join(dest, mod, map + '.pk3');
		var assets = graph.getMapAssets(mod, map, commonReferenceThreshold);
		var fileMap = vertsToFileMap(assets);

		writePak(pakName, fileMap);
	});

	// write out paks for common assets
	var pakName = path.join(dest, mod, 'pak0.pk3');
	var assets = graph.getCommonAssets(mod, whitelist, commonReferenceThreshold);
	var fileMap = vertsToFileMap(assets);

	writePak(pakName, fileMap);
});

//
// write out base assets
//
var maps = graph.getMaps(baseGame);

maps.forEach(function (map) {
	var pakName = path.join(dest, baseGame, map + '.pk3');
	var assets = graph.getMapAssets(baseGame, map, commonReferenceThreshold);
	var fileMap = vertsToFileMap(assets);

	writePak(pakName, fileMap);
});

var pakName = path.join(dest, baseGame, 'pak0.pk3');
var assets = graph.getCommonAssets(baseGame, whitelist, commonReferenceThreshold);
var fileMap = vertsToFileMap(assets);

writePak(pakName, fileMap);
