# QuakeJS

QuakeJS is a port of [ioquake3](http://www.ioquake3.org) to JavaScript with the help of [Emscripten](http://github.com/kripken/emscripten).

To see a live demo, check out [http://www.quakejs.com](http://www.quakejs.com).


## Building binaries

As a prerequisite, you'll need to have a working build of [Emscripten](http://github.com/kripken/emscripten), then:

```shell
cd quakejs/ioq3
make PLATFORM=js EMSCRIPTEN=<path_to_emscripten>
```

Binaries will be placed in `ioq3/build/release-js-js/`.

To note, if you're trying to run a dedicated server, the most up to date binaries are already included in the `build` directory of this repository.


## Running locally

Install the required node.js modules:

```shell
npm install
```

Set `content.quakejs.com` as the content server:

```shell
echo '{ "content": "content.quakejs.com" }' > bin/web.json
```

Run the server:

```shell
node bin/web.js --config ./web.json
```

Your server is now running on: [http://0.0.0.0:8080](http://0.0.0.0:8080)


## Running a dedicated server

If you'd like to run a dedicated server, the only snag is that unlike regular Quake 3, you'll need to double check the content server to make sure it supports the mod / maps you want your server to run (which you can deduce from the [public manifest](http://content.quakejs.com/assets/manifest.json)).

Also, networking in QuakeJS is done through WebSockets, which unfortunately means that native builds and web builds currently can't interact with eachother.

Otherwise, running a dedicated server is similar to running a dedicated native server command-line wise.

Setup a config for the mod you'd like to run, and startup the server with `+set dedicated 2`:

```shell
node build/ioq3ded.js +set fs_game <game> +set dedicated 2 +exec <server_config>
```

If you'd just like to run a dedicated server that isn't broadcast to the master server:

```shell
node build/ioq3ded.js +set fs_game <game> +set dedicated 1 +exec <server_config>
```

### baseq3 server, step-by-step

*Note: for the initial download of game files you will need a server wth around 1GB of RAM. If the server exits with the message `Killed` then you need more memory*

On your server clone this repository. `cd` into the `quakejs` clone and run the following commands:

```
git submodule update --init
npm install
node build/ioq3ded.js +set fs_game baseq3 +set dedicated 2
```

After running the last command continue pressing Enter until you have read the EULA, and then answer the `Agree? (y/n)` prompt. The base game files will download. When they have finished press Ctrl+C to quit the server.

In the newly created `base/baseq3` directory add a file called `server.cfg` with the following contents (adapted from [Quake 3 World](http://www.quake3world.com/q3guide/servers.html)):

```
seta sv_hostname "CHANGE ME"
seta sv_maxclients 12
seta g_motd "CHANGE ME"
seta g_quadfactor 3
seta g_gametype 0
seta timelimit 15
seta fraglimit 25
seta g_weaponrespawn 3
seta g_inactivity 3000
seta g_forcerespawn 0
seta rconpassword "CHANGE_ME"
set d1 "map q3dm7 ; set nextmap vstr d2"
set d2 "map q3dm17 ; set nextmap vstr d1"
vstr d1
```

replacing the `sv_hostname`, `g_motd` and `rconpassword`, and any other configuration options you desire.

You can now run the server with 

```
node build/ioq3ded.js +set fs_game baseq3 +set dedicated 2 +exec server.cfg
```

and you should be able to join at http://www.quakejs.com/play?connect%20SERVER_IP:27960, replacing `SERVER_IP` with the IP of your server.

## Running a content server

QuakeJS loads assets directly from a central content server. A public content server is available at `content.quakejs.com`, however, if you'd like you run your own (to perhaps provide new mods) you'll need to first repackage assets into the format QuakeJS expects.

### Repackaging assets

When repackaging assets, an asset graph is built from an incoming directory of pk3s, and an optimized set of map-specific pk3s is output to a destination directory.

To run this process:

```shell
node bin/repak.js --src <assets_src> --dest <assets>
```

And to launch the content server after the repackaging is complete:

```shell
node bin/content.js
```

Note: `./assets` is assumed to be the default asset directory. If you'd like to change that, you'll need to modify the JSON configuration used by the content server.

Once the content server is available, you can use it by launching your local or dedicated server with `+set fs_cdn <server_address>`.

## License

MIT
