var _ = require('underscore');
var async = require('async');
var crypto = require('crypto');
var express = require('express');
var fs = require('fs');
var http = require('http');
var opt = require('optimist');
var path = require('path');
// var Throttle = require('throttle');

var argv = require('optimist')
	.options({
		'root': {
			'description': 'Root assets path',
			'demand': true
		},
		'port': {
			'description': 'Server port',
			'default': 9000
		}
	})
	.argv;

if (argv.h || argv.help) {
	opt.showHelp();
	return;
}

var compressedAssets = [ '.pk3' ];
var currentManifest;

function checksum(filename, callback) {
	var sum = crypto.createHash('md5');
	var s = fs.ReadStream(filename);
	s.on('error', function (err) {
		callback(err);
	});
	s.on('data', function (data) {
		sum.update(data);
	});
	s.on('end', function () {
		callback(null, sum.digest('hex'));
	});
}

// // debug throttled sendfile
// function sendfile2(file, res) {
// 	var stat = fs.statSync(file);

// 	res.statusCode = 200;
// 	if (!res.getHeader('Content-Type')) {
// 		if (path.extname(file) === '.js') {
// 			res.setHeader('Content-Type', 'application/javascript');
// 		} else {
// 			res.setHeader('Content-Type', 'application/octet-stream');
// 		}
// 	}
// 	res.setHeader('Content-Length', stat.size);

// 	var rs = fs.createReadStream(file);
// 	rs.pipe(new Throttle(1024 * 1024 * 5)).pipe(res);
// }

function getMods(callback) {
	fs.readdir(argv.root, function(err, files) {
		if (err) return callback(err);

		async.filter(files, function (file, cb) {
			var absolute = path.join(argv.root, file);
			fs.stat(absolute, function (err, stats) {
				if (err) return callback(err);

				return cb(stats.isDirectory());
			});
		}, function (results) {
			callback(null, results);
		});
	});
}

function getModFiles(mod, callback) {
	var gamePath = path.join(argv.root, mod);
	var valid = ['.pk3'];
	
	fs.readdir(gamePath, function(err, files) {
		if (err) return callback(err);

		async.filter(files, function (file, cb) {
			var ext = path.extname(file);
			cb(valid.indexOf(ext) !== -1);
		}, function (files) {
			// Convert files to absolute paths.
			files = files.map(function (file) { return path.join(gamePath, file); });

			callback(null, files);
		});
	});
}

function generateManifest(callback) {
	console.log('generating manifest..');

	getMods(function (err, mods) {
		if (err) return callback(err);

		async.concat(mods, getModFiles, function (err, files) {
			if (err) return callback(err);

			async.map(files, function (file, cb) {
				fs.stat(file, function (err, stat) {
					if (err) return cb(err);

					checksum(file, function (err, checksum) {
						if (err) return cb(err);

						cb(null, {
							name: path.relative(argv.root, file),
							size: stat.size,
							checksum: checksum
						});
					});
				});
			}, function (err, entries) {
				if (err) return callback(err);
				console.log('done generating manifest, ' + entries.length + ' entries');
				callback(err, entries);
			});
		});
	});
}

function handleManifest(req, res, next) {
	res.json(currentManifest);
}

function handlePak(req, res, next) {
	var pakName = req.params[0];
	var checksum = req.params[1];
	var ext = req.params[2];
	var relativePath = pakName + ext;
	var absolutePath = path.join(argv.root, relativePath);

	// Make sure they're requesting a valid asset, else return a 400.
	var valid = currentManifest.some(function (entry) {
		return entry.name === relativePath && entry.checksum === checksum;
	});

	if (!valid) {
		res.status(400).end();
		return;
	}

	console.log('serving ' + relativePath + ' ' + checksum);

	res.sendfile(absolutePath, function (err) {
		if (err) return next(err);
	});
	// sendfile2(absolutePath, res);
}

(function main() {
	// Setup the express app.
	var app = express();
	app.use(function (req, res, next) {
		res.setHeader('Access-Control-Allow-Origin', '*');
		next();
	});
	app.use(express.compress({
		filter: function(req, res) {
			var ext = path.extname(req.url);
			return (/json|text|javascript/).test(res.getHeader('Content-Type')) ||
				compressedAssets.indexOf(ext) !== -1;
		}
	}));
	app.get('/assets/manifest.json', handleManifest);
	app.get(/^\/assets\/(.+)\.(.+)(\.pk3)$/, handlePak);

	// Startup the HTTP server.
	var server = http.createServer(app);
	server.listen(argv.port, function () {
		console.log('content server is now listening on port', server.address().address, server.address().port);
	});

	// Generate an initial manifest.
	generateManifest(function (err, manifest) {
		if (err) throw err;
		currentManifest = manifest;
	});
})();