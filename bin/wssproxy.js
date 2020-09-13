// Copyright 2020 QuakeJS authors.

var _ = require('underscore');
var httpProxy = require('http-proxy');
var fs = require('fs');
var https = require('https');
var logger = require('winston');
var opt = require('optimist');

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
        listenPort: 27961,
        proxyAddr: 'localhost',
        proxyPort: 27960,
        key: "/etc/letsencrypt/live/quakejs.com/privkey.pem",
        cert: "/etc/letsencrypt/live/quakejs.com/fullchain.pem"
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

var proxy = new httpProxy.createProxyServer({
    target: {
        host: config.proxyAddr,
        port: config.proxyPort
    }
});

const opts = {
    key: fs.readFileSync(config.key),
    cert: fs.readFileSync(config.cert)
};
var proxyServer = https.createServer(opts, function (req, res) {
    proxy.web(req, res);
});

proxyServer.on('upgrade', function (req, socket, head) {
    proxy.ws(req, socket, head);
});

proxyServer.listen(config.listenPort, '0.0.0.0',  function() {
    logger.info('wssproxy server forwarding from wss://' + proxyServer.address().address + ":" + proxyServer.address().port + " to ws://" + config.proxyAddr + ":" + config.proxyPort);
});
