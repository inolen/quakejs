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

//
//
//
function get_paks(root, callback) {
	console.log('get_paks', root);

	fs.readdir(root, function (err, files) {
		if (err) return callback(err);

		var paks = files.filter(function (file) {
			return path.extname(file).toLowerCase() === '.pk3';
		});

		// convert to absolute paths
		paks = paks.map(function (file) { return path.join(root, file); });

		// sort the paks in ascending order
		paks = paks.sort();

		callback(null, paks);
	});
}

function get_pak_entries(pak, callback) {
	console.log('ls', pak);

	var files = [];
	fs.createReadStream(pak)
		.pipe(unzip.Parse())
		.on('entry', function (entry) {
			var type = entry.type;
			if (type === 'File') {
				files.push(entry.path);
			}
			entry.autodrain();
		})
		.on('close', function () {
			callback(null, files);
		})
		.on('error', function (err) {
			callback(err);
		})
}

function merge_pak_entries(paks, callback) {
	var filemap = {};

	// paks are sorted in ascending alphabetical order, the
	// intent here is to allow the contents of paks with a 
	// higher sort value to overwrite the contents of a pak
	// with a lower sort value.
	async.eachSeries(paks, function (pak, cb) {
		get_pak_entries(pak, function (err, files) {
			if (err) return cb(err);

			for (var i = 0; i < files.length; i++) {
				filemap[files[i]] = pak;
			}

			cb(null);
		});
	}, function (err) {
		callback(err, filemap);
	});
}

function get_pak_files(pak, files, callback) {
	var buffers = {};
	fs.createReadStream(pak)
		.pipe(unzip.Parse())
		.on('entry', function (entry) {
			if (files.indexOf(entry.path) !== -1) {
				var bufs = [];
				entry.on('data', function (d) { bufs.push(d); });
				entry.on('end', function () { buffers[entry.path] = Buffer.concat(bufs); });
			} else {
				entry.autodrain();
			}
		})
		.on('close', function () {
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				if (!buffers[file]) {
					return callback(new Error('Couldn\'t find file "' + file + '"'));
				}
			}
			callback(null, buffers);
		})
		.on('error', function (err) {
			callback(err);
		});
}

function write_pak(filename, assets, callback) {
	var output = fs.createWriteStream(filename);
	var archive = archiver.create('zip', { /*highWaterMark: 1024 * 1024, */ zlib: { level: 0 } });

	console.log('writing pak ' + filename);

	archive.on('error', function (err) {
		callback(err);
	});

	archive.pipe(output);

	async.eachSeries(assets, function (asset, cb) {
		console.log('.. adding ' + asset.name);

		archive.append(asset.buffer, {
			date: new Date(1970, 0, 1),  // use the epoch reference time to keep the checksums consistent
			name: asset.name
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

//
//
//
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
	'maps/q3dm1.aas',
	'maps/q3dm1.bsp',
	'maps/q3dm9.aas',
	'maps/q3dm9.bsp',
	'maps/q3dm17.aas',
	'maps/q3dm17.bsp',
	'maps/q3tourney2.aas',
	'maps/q3tourney2.bsp',
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

function find_map_verts(root, verts, references) {
	verts = verts || [];
	references = references || []

	if (common.indexOf(root.data.name) !== -1 ||
		  root.data.name.indexOf('textures/effects') !== -1 ||
		  root.data.name.indexOf('textures/sfx') !== -1) {
		return verts;
	}

	var fn = function (v) {
		for (var i = 0; i < v.in_edges.length; i++) {
			var src = v.in_edges[i].source;
			if (src === v) {
				continue;
			}
			if (src.data.type === 1 /*ASSET.MAP*/ && references.indexOf(src.data.name) === -1) {
				references.push(src.data.name);
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

function group_graph_verts(graph) {
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
		var verts = find_map_verts(map).filter(function (v) { return v.data.buffer; });

		for (var i = 0; i < verts.length; i++) {
			referenced[verts[i].id] = true;
		}

		paks[filename] = verts;
	}

	// find any assets _not_ consumed by a map pack
	var common = graph.filter(function (v) {
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
				  v.data.name.indexOf('textures/') !== -1 &&
				  v.data.name.indexOf('textures/effects') === -1 &&
				  v.data.name.indexOf('textures/sfx') === -1) {
				return false;
			}
		}

		return true;
	})
	.filter(function (v) { return v.data.buffer; })
	.sort(function (a,b) {
		return a.data.name.localeCompare(b.data.name);
	});

	// split up common paks every ~50mb
	var num = 0;
	var total = 0;
	var assets = [];
	var maxBytes = 50 * 1024 * 1024;
	for (var i = 0; i < common.length; i++) {
		var asset = common[i];

		total += asset.data.buffer.length;

		assets.push(asset);

		if (total >= maxBytes || i === common.length-1) {
			paks['pak' + num + '.pk3'] = assets;
			num++;
			total = 0;
			assets = [];
		}
	}

	return paks;
}

function transform_asset(asset) {
	if (!asset.buffer || asset.name.indexOf('.wav') === -1) {
		return asset;
	}

	var tempsrc = temp.openSync('repak');
	var tempdest = temp.openSync('repak');

	// write out the input
	fs.writeSync(tempsrc.fd, asset.buffer, 0, asset.buffer.length, 0);
	fs.closeSync(tempsrc.fd);

	// do the transform
	var result = sh.exec('opusenc ' + tempsrc.path + ' ' + tempdest.path);
	if (result.code) {
		console.log('.. failed to opus encode ' + asset.name);
		asset.buffer = null;
		return asset;
	}

	// read in the output
	var stat = fs.fstatSync(tempdest.fd);
	var buffer = new Buffer(stat.size);
	fs.readSync(tempdest.fd, buffer, 0, stat.size, 0);
	fs.closeSync(tempdest.fd);

	// update the asset
	asset.name = asset.name.replace('.wav', '.opus');
	asset.buffer = buffer;

	return asset;
}

async.waterfall([
	function (cb) {
		get_paks(src, cb);
	},
	function (paks, cb) {
		merge_pak_entries(paks, cb);
	},
	function (filemap, cb) {
		// reverse the filemap such that each file is grouped by pak
		var pakmap = {};
		for (var file in filemap) {
			if (!filemap.hasOwnProperty(file)) {
				continue;
			}
			// filter out files we don't care about
			if (!filter_file(file)) {
				continue;
			}
			var pak = filemap[file];
			if (!pakmap[pak]) {
				pakmap[pak] = [];
			}
			pakmap[pak].push(file);
		}

		cb(null, pakmap);
	},
	function (pakmap, cb) {
		var graph = new AssetGraph();
		// load up each file and add to the asset graph
		var paks = Object.keys(pakmap);
		async.eachSeries(paks, function (pak, cb) {
			var files = pakmap[pak];
			get_pak_files(pak, files, function (err, buffers) {
				if (err) return callback(err);

				for (var i = 0; i < files.length; i++) {
					var file = files[i];
					graph.add(file, buffers[file]);
				}

				cb(null);
			});
		}, function (err) {
			cb(err, graph);
		});
	},
	function (graph, cb) {
		var paks = group_graph_verts(graph);
		var keys = Object.keys(paks);

		function vert_to_asset(v) {
			return v.data;
		}
		function has_buffer(asset) {
			return asset.buffer;
		}

		async.eachSeries(keys, function (key, cb) {
			var filename = path.join(dest, key);
			var verts = paks[key];
			var assets = verts.map(vert_to_asset).map(transform_asset).filter(has_buffer);
			write_pak(filename, assets, cb);
		}, cb);
	}
], function (err) {
	if (err) throw err;
});