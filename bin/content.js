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

var argv = require('optimist')
	.describe('config', 'Location of the configuration file').default('config', './config.json')
	.argv;

if (argv.h || argv.help) {
	opt.showHelp();
	return;
}

logger.cli();
logger.level = 'debug';

var config = loadConfig(argv.config);
var validAssets = ['.pk3', '.run', '.sh'];
var currentManifestTimestamp;
var currentManifest;

function getAssets() {
	return wrench.readdirSyncRecursive(config.root).filter(function (file) {
		var ext = path.extname(file);
		return validAssets.indexOf(ext) !== -1;
	}).map(function (file) {
		return path.join(config.root, file);
	});
}

function generateManifest(callback) {
	logger.info('generating manifest from ' + config.root);

	var assets = getAssets();
	var start = Date.now();

	async.map(assets, function (file, cb) {
		logger.info('processing ' + file);

		var name = path.relative(config.root, file);
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
	var absolutePath = path.join(config.root, relativePath);

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

function loadConfig(configPath) {
	var config = {
		root: path.join(__dirname, '..', 'assets'),
		port: 9000
	};

	try {
		logger.info('loading config file from ' + configPath + '..');
		var data = require(configPath);
		_.extend(config, data);
	} catch (e) {
		logger.warn('failed to load config', e);
	}

	return config;
}

(function main() {
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

		server.listen(config.port, function () {
			logger.info('content server is now listening on port', server.address().address, server.address().port);
		});
	});
})();
