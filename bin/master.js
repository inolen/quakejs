var _ = require('underscore');
var ansi = require('ansi');
var http = require('http');
var opt = require('optimist');
var url = require('url');
var WebSocketClient = require('ws');
var WebSocketServer = require('ws').Server;
var cursor = ansi(process.stdout);

var argv = require('optimist')
	.describe('config', 'Location of the configuration file').default('config', './master.json')
	.argv;

if (argv.h || argv.help) {
	opt.showHelp();
	return;
}

var clients = [];
var servers = {};
var pruneInterval = 350 * 1000;

function formatOOB(data) {
	var str = '\xff\xff\xff\xff' + data + '\x00';

	var buffer = new ArrayBuffer(str.length);
	var view = new Uint8Array(buffer);

	for (var i = 0; i < str.length; i++) {
		view[i] = str.charCodeAt(i);
	}

	return buffer;
}

function stripOOB(buffer) {
	var view = new DataView(buffer);

	if (view.getInt32(0) !== -1) {
		return null;
	}

	var str = '';
	for (var i = 4 /* ignore leading -1 */; i < buffer.byteLength - 1 /* ignore trailing \0 */; i++) {
		var c = String.fromCharCode(view.getUint8(i));
		str += c;
	}

	return str;
}

function parseInfoString(str) {
	var data = {};

	var split = str.split('\\');
	// throw when split.length isn't even?

	for (var i = 0; i < split.length - 1; i += 2) {
		var key = split[i];
		var value = split[i+1];
		data[key] = value;
	}
}

/**********************************************************
 *
 * messages
 *
 **********************************************************/
var CHALLENGE_MIN_LENGTH = 9;
var CHALLENGE_MAX_LENGTH = 12;
var GAMENAME_LENGTH = 64;
var GAMETYPE_LENGTH = 32;

function handleHeartbeat(conn, data) {
	cursor
		.brightGreen().write(conn.addr + ':' + conn.port).reset()
		.write(' ---> ')
		.magenta().write('heartbeat').reset()
		.write('\n');

	sendGetInfo(conn);
}

function handleInfoResponse(conn, data) {
	cursor
		.brightGreen().write(conn.addr + ':' + conn.port).reset()
		.write(' ---> ')
		.magenta().write('infoResponse').reset()
		.write('\n');

	var info = parseInfoString(data);

	// TODO validate data

	updateServer(conn.addr, conn.port);
}

function buildChallenge() {
	var challenge = '';
	var length = CHALLENGE_MIN_LENGTH - 1 +
		parseInt(Math.random() * (CHALLENGE_MAX_LENGTH - CHALLENGE_MIN_LENGTH + 1), 10);

	for (var i = 0; i < length; i++) {
		var c;
		do {
			c = 33 + parseInt(Math.random() * (126 - 33 + 1), 10);  // -> c = 33..126
		} while (c == '\\' || c == ';' || c == '"' || c == '%' || c == '/');

		challenge += String.fromCharCode(c);
	}

	return challenge;
}

function sendGetInfo(conn) {
	var challenge = buildChallenge();

	cursor
		.brightGreen().write(conn.addr + ':' + conn.port).reset()
		.write(' <--- ')
		.magenta().write('getinfo with challenge \"' + challenge + '\"').reset()
		.write('\n');

	var buffer = formatOOB('getinfo ' + challenge);
	conn.socket.send(buffer, { binary: true });
}

function sendGetServersResponse(conn, servers) {
	var msg = 'getserversResponse';
	for (var id in servers) {
		if (!servers.hasOwnProperty(id)) {
			continue;
		}
		var server = servers[id];
		var octets = server.addr.split('.').map(function (n) {
			return parseInt(n, 10);
		});
		msg += '\\';
		msg += String.fromCharCode(octets[0] & 0xff);
		msg += String.fromCharCode(octets[1] & 0xff);
		msg += String.fromCharCode(octets[2] & 0xff)
		msg += String.fromCharCode(octets[3] & 0xff);
		msg += String.fromCharCode((server.port & 0xff00) >> 8);
		msg += String.fromCharCode(server.port & 0xff);
	}

	cursor
		.brightGreen().write(conn.addr + ':' + conn.port).reset()
		.write(' <--- ')
		.magenta().write('getserversResponse with ' + Object.keys(servers).length + ' server(s)').reset()
		.write('\n');

	var buffer = formatOOB(msg);
	conn.socket.send(buffer, { binary: true });
}

/**********************************************************
 *
 * servers
 *
 **********************************************************/
function serverid(addr, port) {
	return addr + ':' + port;
}

function updateServer(addr, port) {
	var id = serverid(addr, port);
	var server = servers[id];
	if (!server) {
		server = servers[id] = { addr: addr, port: port };
	}
	server.lastUpdate = Date.now();

	// Send partial update to all clients.
	for (var i = 0; i < clients.length; i++) {
		sendGetServersResponse(clients[i], { id: server });
	}
}

function removeServer(id) {
	var server = servers[id];

	delete servers[id];

	cursor
		.brightGreen().write(server.addr + ':' + server.port).reset()
		.write(' timed out, ' + Object.keys(servers).length + ' server(s) currently registered\n');
}

function pruneServers() {
	var now = Date.now();

	for (var id in servers) {
		if (!servers.hasOwnProperty(id)) {
			continue;
		}

		var server = servers[id];
		var delta = now - server.lastUpdate;

		if (delta > pruneInterval) {
			removeServer(id);
		}
	}
}

/**********************************************************
 *
 * clients
 *
 **********************************************************/
function handleSubscribe(conn) {
	addClient(conn);

	// Send all servers upon subscribing.
	sendGetServersResponse(conn, servers);
}

function addClient(conn) {
	var idx = clients.indexOf(conn);

	if (idx !== -1) {
		return;  // already subscribed
	}

	cursor
		.brightGreen().write(conn.addr + ':' + conn.port).reset()
		.write(' ---> ')
		.magenta().write('subscribe').reset()
		.write('\n');

	clients.push(conn);
}

function removeClient(conn) {
	var idx = clients.indexOf(conn);
	if (idx === -1) {
		return;  // conn may have belonged to a server
	}

	var conn = clients[idx];

	cursor
		.brightGreen().write(conn.addr + ':' + conn.port).reset()
		.write(' ---> ')
		.magenta().write('unsubscribe').reset()
		.write('\n');

	clients.splice(idx, 1);
}

/**********************************************************
 *
 * main
 *
 **********************************************************/
function loadConfig() {
	var config = {
		port: 45735
	};

	try {
		cursor.write('loading config file from ' + argv.config + '.. ');
		var data = require(argv.config);
		_.extend(config, data);
		cursor.write('ok\n');
	} catch (e) {
		cursor.write('error\n');
	}

	return config;
}

function getRemoteAddress(ws) {
	// By default, check the underlying socket's remote address.
	var address = ws._socket.remoteAddress;

	// If this is an x-forwarded-for header (meaning the request
	// has been proxied), use it.
	if (ws.upgradeReq.headers['x-forwarded-for']) {
		address = ws.upgradeReq.headers['x-forwarded-for'];
	}

	return address;
}

function getRemotePort(ws) {
	var port = ws._socket.remotePort;

	if (ws.upgradeReq.headers['x-forwarded-port']) {
		port = ws.upgradeReq.headers['x-forwarded-port'];
	}

	return port;
}

function connection(ws) {
	this.socket = ws;
	this.addr = getRemoteAddress(ws);
	this.port = getRemotePort(ws);
}

(function main() {
	var config = loadConfig();

	var server = http.createServer();

	var wss = new WebSocketServer({
		server: server
	});

	wss.on('connection', function (ws) {
		var conn = new connection(ws);
		var first = true;

		ws.on('message', function (buffer, flags) {
			if (!flags.binary) {
				return;
			}

			buffer = (new Uint8Array(buffer)).buffer;  // node Buffer to ArrayBuffer

			// check to see if this is emscripten's port identifier message
			if (first &&
				buffer.byteLength === 10 &&
				buffer[0] === 255 && buffer[1] === 255 && buffer[2] === 255 && buffer[3] === 255 &&
				buffer[4] === 'p'.charCodeAt(0) && buffer[5] === 'o'.charCodeAt(0) && buffer[6] === 'r'.charCodeAt(0) && buffer[7] === 't'.charCodeAt(0)) {
				conn.port = ((buffer[8] << 8) | buffer[9]);
			}
			first = false;

			var msg = stripOOB(buffer);
			if (!msg) {
				removeClient(conn);
				return;
			}

			if (msg.indexOf('heartbeat ') === 0) {
				handleHeartbeat(conn, msg.substr(10));
			} else if (msg.indexOf('infoResponse\n') === 0) {
				handleInfoResponse(conn, msg.substr(13));
			} else if (msg.indexOf('subscribe') === 0) {
				handleSubscribe(conn);
			}
		});

		ws.on('error', function (err) {
			removeClient(conn);
		});

		ws.on('close', function () {
			removeClient(conn);
		});
	});

	server.listen(config.port, function() {
		console.log('master server is listening on port ' + server.address().port);
	});

	setInterval(pruneServers, pruneInterval);
})();