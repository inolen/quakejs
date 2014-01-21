var _ = require('underscore');
var async = require('async');
var crypto = require('crypto');
var express = require('express');
var fs = require('fs');
var http = require('http');
var opt = require('optimist');
var path = require('path');
var zlib = require('zlib');

var argv = require('optimist')
	.options({
		'config': {
			'description': 'Location of optional configuration file'
		},
		'root': {
			'description': 'Root assets path',
			'default': path.join(__dirname, '..', 'assets')
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

var compressedAssets = [ '.js', '.pk3' ];
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
	var valid = ['.js', '.pk3'];
	
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
	console.log('generating manifest from ' + argv.root);

	getMods(function (err, mods) {
		if (err) return callback(err);

		async.concatSeries(mods, getModFiles, function (err, files) {
			if (err) return callback(err);

			async.mapSeries(files, function (file, cb) {
				console.log('processing ' + file);

				var length = 0;
				var sum = crypto.createHash('md5');

				// stream each file in, generating a hash for it's original
				// contents, and gzip'ing the buffer to determine the compressed
				// length for the client so it can present accurate progress info
				var stream = fs.createReadStream(file);

				// gzip the file contents to determine the compressed length
				// of the file so the client can present correct progress info
				var gzip = zlib.createGzip();

				stream.on('error', function (err) {
					callback(err);
				});
				stream.on('data', function (data) {
					gzip.write(data);
					sum.update(data);
				});
				stream.on('end', function () {
					gzip.end();
				});

				gzip.on('data', function (data) {
					length += data.length;
				});
				gzip.on('end', function () {
					cb(null, {
						name: path.relative(argv.root, file),
						size: length,
						checksum: sum.digest('hex')
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
	console.log('serving manifest');

	res.json(currentManifest);
}

function handleAsset(req, res, next) {
	var basename = req.params[0];
	var checksum = req.params[1];
	var ext = req.params[2];
	var relativePath = basename + ext;
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
}

function loadConfig() {
	if (!argv.config) {
		return null;
	}

	var config = {};

	try {
		console.log('loading config file from ' + argv.config + '..');
		var data = require(argv.config);
		_.extend(config, data);
	} catch (e) {
		console.log('failed to load config', e);
	}

	return config;
}

(function main() {
	var config = loadConfig();
	if (config) _.extend(argv, config);

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
	app.get(/^\/assets\/(.+)\.(.+)(\.js|\.pk3)$/, handleAsset);

	var server = http.createServer(app);
	server.listen(argv.port, function () {
		console.log('content server is now listening on port', server.address().address, server.address().port);
	});

	// generate an initial manifest
	generateManifest(function (err, manifest) {
		if (err) throw err;
		currentManifest = manifest;
	});
})();
