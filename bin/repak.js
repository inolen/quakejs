var archiver = require('archiver');
var AssetGraph = require('quakejs-asset-graph');
var async = require('async');
var fs = require('fs');
var path = require('path');
var sh = require('execSync');
var spawn = require('child_process').spawn;
var temp = require('temp');
var unzip = require('unzip');

var src = process.argv[2];
var dest = process.argv[3];
var tempdir = temp.mkdirSync('repak');

var blacklist = [
	/\.dm[_]*\d+/,
	/_[123]{1}\.md3/,
	'.map',
	'.roq',
	'.qvm',
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

var common = [
	'scripts/common.shader',
	'scripts/gfx.shader',
	'scripts/menu.shader',
	'scripts/models.shader',
	'scripts/sfx.shader'
];

function walk(dir) {
	var results = [];
	var list = fs.readdirSync(dir);
	list.forEach(function (file) {
		file = dir + '/' + file;
		var stat = fs.statSync(file);
		if (stat && stat.isDirectory()) {
			results = results.concat(walk(file));
		} else {
			results.push(file);
		}
	});
	return results;
}

function get_paks(root, callback) {
	console.log('get_paks', root);

	fs.readdir(root, function (err, files) {
		if (err) return callback(err);

		var paks = files.filter(function (file) {
			return path.extname(file).toLowerCase() === '.pk3';
		});

		// convert to absolute paths
		paks = paks.map(function (file) { return path.join(root, file); });

		callback(null, paks);
	});
}

function extract_pak(pak, root, callback) {
	console.log('extracting ' + pak);
	fs.createReadStream(pak)
		.pipe(unzip.Extract({ path: root }))
		.on('finish', function () {
			callback(null);
		})
		.on('error', function (err) {
			callback(err);
		});
}

function filter_file(file) {
	file = file.toLowerCase();
	for (var i = 0; i < blacklist.length; i++) {
		var entry = blacklist[i];
		if (typeof entry === 'object' && entry.test(file)) {
			return false;
		} else if (typeof entry === 'string' && file.indexOf(entry) !== -1) {
			return false;
		}
	}
	return true;
}

function graph_files(root, files) {
	var graph = new AssetGraph();

	// filter out files we don't care about
	files = files.filter(filter_file);

	for (var i = 0; i < files.length; i++) {
		var file = files[i];
		var absolute = path.join(root, file);
		var ext = path.extname(file);
		var load = ext === '.bsp' || ext === '.md3' || ext === '.shader' || ext === '.skin';
		graph.add(file, load ? fs.readFileSync(absolute) : null);
	}

	return graph;
}

function find_map_verts(root, verts, references) {
	verts = verts || [];
	references = references || []

	if (common.indexOf(root.data.key) !== -1 ||
		  root.data.key.indexOf('textures/effects') !== -1 ||
		  root.data.key.indexOf('textures/sfx') !== -1) {
		return verts;
	}

	var fn = function (v) {
		for (var i = 0; i < v.in_edges.length; i++) {
			var src = v.in_edges[i].source;
			if (src === v) {
				continue;
			}
			if (src.data.type === 1 /*ASSET.MAP*/ && references.indexOf(src.data.key) === -1) {
				references.push(src.data.key);
			}
			fn(src);
		}
	};
	fn(root);

	if (references.length >= 3) {
		return verts;
	}

	verts.push(root);

	// test each each of its out_edges
	for (var i = 0; i < root.out_edges.length; i++) {
		var dest = root.out_edges[i].dest;
		if (dest === root) {
			continue;  // happens with shaders
		}
		find_map_verts(dest, verts, references.slice(0));
	}

	return verts;
}

function group_verts(graph) {
	var paks = {};
	var maps = graph.maps();
	var referenced = [];

	// get each map's assets
	for (var key in maps) {
		if (!maps.hasOwnProperty(key)) {
			continue;
		}
		var map = maps[key];
		var filename = path.basename(key).replace('.bsp', '.pk3');
		var verts = find_map_verts(map);

		for (var i = 0; i < verts.length; i++) {
			referenced[verts[i].id] = true;
		}

		paks[filename] = verts;
	}

	// find any assets _not_ consumed by a map pack
	paks['pak0.pk3'] = graph.filter(function (v) {
		if (referenced[v.id]) {
			return false;
		}

		// don't pak unreferenced textures from the /textures folder
		if (v.data.type === graph.ASSET.TEXTURE) {
			var hasValidRef = false;
			// recurse up the in-edges of the texture
			var fn = function (r) {
				for (var i = 0; i < r.in_edges.length; i++) {
					var src = r.in_edges[i].source;
					if (src === r) {
						continue;
					}
					if (src.data.type !== graph.ASSET.TEXTURE) {
						hasValidRef = true;
						return;
					}
					fn(src);
				}
			};
			fn(v);

			if (!hasValidRef &&
				  v.data.key.indexOf('textures/') !== -1 &&
				  v.data.key.indexOf('textures/effects') === -1 &&
				  v.data.key.indexOf('textures/sfx') === -1) {
				return false;
			}
		}

		return true;
	})
	.sort(function (a,b) {
		return a.data.key.localeCompare(b.data.key);
	});

	return paks;
}

function transform_asset(assetsRoot, asset) {
	if (asset.path.indexOf('.wav') === -1) {
		return asset;
	}

	var absoluteSrc = path.join(assetsRoot, asset.path);
	var absoluteDest = absoluteSrc.replace('.wav', '.opus');

	// do the transform
	var result = sh.exec('opusenc ' + absoluteSrc + ' ' + absoluteDest);
	if (result.code) {
		console.log('.. failed to opus encode ' + asset.path);
		return asset;
	}

	// update the asset
	asset.path = asset.path.replace('.wav', '.opus');

	return asset;
}

function write_pak(filename, assetsRoot, assets, callback) {
	var output = fs.createWriteStream(filename);
	var archive = archiver.create('zip', {
		// highWaterMark: 1024 * 1024,
		zlib: { level: 0 }
	});

	console.log('writing pak ' + filename);

	archive.on('error', function (err) {
		callback(err);
	});

	archive.pipe(output);

	async.eachSeries(assets, function (asset, cb) {
		var absolute = path.join(assetsRoot, asset.path);

		console.log('.. adding ' + asset.path);

		// using fs.readFileSync due to
		// https://github.com/ctalkington/node-archiver/issues/32
		archive.append(fs.readFileSync(absolute), {
			date: new Date(1970, 0, 1),  // use the epoch reference time to keep the checksums consistent
			name: asset.path
		}, cb);
	}, function (err) {
		if (err) return callback(err);

		archive.finalize(function (err, written) {
			if (err) return callback(err);

			output.on('finish', function () {
				console.log('done writing ' + filename);
				callback(null);
			});
		});
	});
}

async.waterfall([
	function (cb) {
		get_paks(src, cb);
	},
	function (paks, cb) {
		// sort the paks in ascending order and extract
		paks = paks.sort();
		async.eachSeries(paks, function (pak, cb) {
			extract_pak(pak, tempdir, cb);
		}, cb);
	},
	function (cb) {
		var files = walk(tempdir).map(function (file) {
			return path.relative(tempdir, file);
		});
		var graph = graph_files(tempdir, files);
		var paks = group_verts(graph);

		function vert_to_asset(v) {
			var names = v.data.names;
			var path;

			// each vert may have multiple names it was referenced as (e.g.
			// foobar.jpg or foobar.tga). find it's canonical entry based
			// on the directory walk.
			for (var i = 0; i < names.length; i++) {
				var name = names[i];
				if (files.indexOf(name) === -1) {
					continue;
				}
				path = name;
				break;
			}

			v.data.path = path;

			return v.data;
		}

		// map vert lists to asset lists
		for (var pak in paks) {
			if (!paks.hasOwnProperty(pak)) continue;
			paks[pak] = paks[pak]
				.map(vert_to_asset)
				.filter(function (a) { return !!a.path; })
				.map(function (asset) { return transform_asset(tempdir, asset); });
		}

		// split up common pak every ~50mb
		var common = paks['pak0.pk3'];
		delete paks['pak0.pk3'];

		var num = 0;
		var total = 0;
		var assets = [];
		var maxBytes = 50 * 1024 * 1024;
		for (var i = 0; i < common.length; i++) {
			var asset = common[i];

			try {
				var absolute = path.join(tempdir, asset.path);
				var stat = fs.statSync(absolute);
				total += stat.size;
			} catch (e) {
				return cb(err);
			}

			assets.push(asset);

			if (total >= maxBytes || i === common.length-1) {
				paks['pak' + num + '.pk3'] = assets;
				num++;
				total = 0;
				assets = [];
			}
		}

		// write out each pak
		var keys = Object.keys(paks);
		async.eachSeries(keys, function (key, cb) {
			var filename = path.join(dest, key);
			var assets = paks[key];
			write_pak(filename, tempdir, assets, cb);
		}, cb);
	}
], function (err) {
	if (err) throw err;
});