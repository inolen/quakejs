var _ = require('underscore');
var async = require('async');
var crc32 = require('buffer-crc32');
var express = require('express');
var fs = require('fs');
var http = require('http');
var logger = require('winston');
var opt = require('optimist');
var path = require('path');
var send = require('send');
var wrench = require('wrench');
var zlib = require('zlib');

logger.cli();
logger.level = 'debug';

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

var validAssets = ['.pk3', '.run', '.sh'];
var currentManifestTimestamp;
var currentManifest;

function getAssets() {
	return wrench.readdirSyncRecursive(argv.root).filter(function (file) {
		var ext = path.extname(file);
		return validAssets.indexOf(ext) !== -1;
	}).map(function (file) {
		return path.join(argv.root, file);
	});
}

function generateManifest(callback) {
	logger.info('generating manifest from ' + argv.root);

	var assets = getAssets();
	var start = Date.now();

	async.map(assets, function (file, cb) {
		logger.info('processing ' + file);

		var name = path.relative(argv.root, file);
		var crc = crc32.unsigned('');
		var compressed = 0;
		var size = 0;

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
			crc = crc32.unsigned(data, crc);
			size += data.length;
			gzip.write(data);
		});
		stream.on('end', function () {
			gzip.end();
		});

		gzip.on('data', function (data) {
			compressed += data.length;
		});
		gzip.on('end', function () {
			cb(null, {
				name: name,
				compressed: compressed,
				checksum: crc
			});
		});
	}, function (err, entries) {
		if (err) return callback(err);
		logger.info('generated manifest (' + entries.length + ' entries) in ' + ((Date.now() - start) / 1000) + ' seconds');

		callback(err, entries);
	});
}

function handleManifest(req, res, next) {
	logger.info('serving manifest to ' + req.ip);

	res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
	res.setHeader('Last-Modified', currentManifestTimestamp.toUTCString());

	res.json(currentManifest);
}

function handleAsset(req, res, next) {
	var basedir = req.params[0];
	var checksum = parseInt(req.params[1], 10);
	var basename = req.params[2];
	var relativePath = path.join(basedir, basename);
	var absolutePath = path.join(argv.root, relativePath);

	// make sure they're requesting a valid asset
	var asset;
	for (var i = 0; i < currentManifest.length; i++) {
		var entry = currentManifest[i];

		if (entry.name === relativePath && entry.checksum === checksum) {
			asset = entry;
			break;
		}
	}

	if (!asset) {
		res.status(400).end();
		return;
	}

	logger.info('serving ' + relativePath + ' (crc32 ' + checksum + ') to ' + req.ip);

	res.sendfile(absolutePath, { maxAge: Infinity });
}

function loadConfig() {
	if (!argv.config) {
		return null;
	}

	var config = {};

	try {
		logger.info('loading config file from ' + argv.config + '..');
		var data = require(argv.config);
		_.extend(config, data);
	} catch (e) {
		logger.warn('failed to load config', e);
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
	app.use(express.compress({ filter: function(req, res) { return true; } }));
	app.get('/assets/manifest.json', handleManifest);
	app.get(/^\/assets\/(.+\/|)(\d+)-(.+?)$/, handleAsset);

	// generate an initial manifest
	generateManifest(function (err, manifest) {
		if (err) throw err;

		currentManifestTimestamp = new Date();
		currentManifest = manifest;

		// start listening
		var server = http.createServer(app);

		server.listen(argv.port, function () {
			logger.info('content server is now listening on port', server.address().address, server.address().port);
		});
	});
})();
