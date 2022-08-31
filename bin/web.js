var _ = require('underscore');
var express = require('express');
var http = require('http');
var https = require('https');
var logger = require('winston');
var opt = require('optimist');
var path = require('path');
var fs = require('fs');

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

function loadConfig(configPath) {
	var config = {
		port: 8080,
		content: 'localhost:9000'
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
	const secure = config.key !== undefined && config.cert !== undefined;

	var app = express();

	app.set('views', __dirname);
	app.set('view engine', 'ejs');

	app.use(express.static(path.join(__dirname, '..', 'build')));
	app.use(function (req, res, next) {
		res.locals.content = config.content;
		res.locals.ioquake3js = secure ? '/ioquake3_secure.js' : '/ioquake3.js';
		res.render('index');
	});

	var server = null;
	var serverType = null;
	if (secure) {
		const opts = {
			key: fs.readFileSync(config.key),
			cert: fs.readFileSync(config.cert)
		};
		server = https.createServer(opts, app);
		serverType = 'https';
	} else {
		server = http.createServer(app);
		serverType = 'http';
	}
	server.listen(config.port, function () {
		logger.info(serverType, 'web server is now listening on ' +  server.address().address + ":" + server.address().port);
	});

	return server;
})();
