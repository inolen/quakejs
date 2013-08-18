var fs = require('fs');
var path = require('path');
var repak = require('quakejs-repak');
var sh = require('execSync');
var spawn = require('child_process').spawn;
var temp = require('temp');

var src = process.argv[2];
var dest = process.argv[3];

function filterHasBuffer(asset) {
	return asset.buffer;
}

function transform(asset) {
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

repak(src, dest, {
	filter: function (file) {
		file = file.toLowerCase();
		var isBlacklistedMap = [
			'maps/pro-q3tourney2.aas', 'maps/pro-q3tourney2.bsp',
			'maps/pro-q3tourney4.aas', 'maps/pro-q3tourney4.bsp',
			'maps/q3dm1.aas', 'maps/q3dm1.bsp',
			'maps/q3dm7.aas', 'maps/q3dm7.bsp',
			'maps/q3dm9.aas', 'maps/q3dm9.bsp',
			'maps/q3dm17.aas', 'maps/q3dm17.bsp',
			'maps/q3tourney2.aas', 'maps/q3tourney2.bsp',
			'maps/q3tourney6_ctf.aas', 'maps/q3tourney6_ctf.bsp'].indexOf(file) !== -1;
		var isDemo = /\.dm[_]{0, 1}\d+/.test(file);
		var isROQ = file.indexOf('.roq') !== -1;
		var isLODMD3 = /_[123]{1}\.md3/.test(file);
		return !isBlacklistedMap && !isDemo && !isLODMD3 && !isROQ;
	},
	group: function (graph) {
		var paks = {};
		var maps = graph.maps();

		var common = graph.find(null, function (asset) {
			// maps aren't referenced by anything
			if (asset.type === graph.ASSET.MAP ||
			    asset.type === graph.ASSET.AAS) {
				return false;
			}
			return asset.ref <= 0 || asset.ref >= 3;
		}).map(transform).filter(filterHasBuffer);

		// split up common paks every ~50mb
		var num = 0;
		var total = 0;
		var assets = [];
		var maxBytes = 50 * 1024 * 1024;
		for (var i = 0; i < common.length; i++) {
			var asset = common[i];

			assets.push(asset);
			total += asset.buffer.length;

			if (total >= maxBytes || i === common.length-1) {
				paks['pak' + num + '.pk3'] = assets;
				num++;
				total = 0;
				assets = [];
			}
		}

		// generate a pak for each map
		for (var i = 0; i < maps.length; i++) {
			var map = maps[i];
			var filename = path.basename(map).replace('.bsp', '.pk3');
			paks[filename] = graph.find(map, function (asset) {
				if (asset.type === graph.ASSET.MAP) {
					return true;
				}
				return asset.ref > 0 && asset.ref < 3;
			}).map(transform).filter(filterHasBuffer);
		}

		return paks;
	}
}, function () {
	console.log('done');
});