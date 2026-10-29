# Mugen Studio

Mugen Studio is a free Windows app that builds a MUGEN game for you. Drop in
characters, stages, music and a screenpack, lay them out, and export a website
anyone can play in a browser, or a desktop folder that runs on
[Ikemen GO](https://github.com/ikemen-engine/Ikemen-GO).

**Just want to use it?** Download the latest Mugen Studio from
[Releases](https://github.com/energyjp/mugen-studio/releases/latest), extract
the zip and double-click `MugenStudio.exe`. This repository is its source.

## License

MIT (`LICENSE.txt`): change it, fork it, make your own version.

Mugen Studio also ships work by others under their own terms: Ikemen GO (MIT),
Elecbyte's Kung Fu Man, screens and sounds (CC BY-NC 3.0), the DotGothic16 font
(SIL Open Font License) and more. `THIRD-PARTY-NOTICES.txt` lists all of it with
its license.

## What's here

| Folder | What it is |
|---|---|
| `app/` | The program: a Node.js server (`server.js` and the modules beside it) and the pages it serves (`public/`). `program-layout.json` says where everything lives. |
| `app/starter/` | Kung Fu Man and a stage, copied into `Content\default` the first time the Studio starts. |
| `app/addons/` | Optional add-ons: the Training frame meter and the Japanese move-name font. |
| `app/hostkit/` | The blank relay, queue and leaderboard server a host deploys to their own Cloudflare account. |
| `studio-go/cmd/mugenstudio/` | The native window, `MugenStudio.exe` (Go and WebView2). |
| `scripts/` | Builds the two programs. |

Not in this repository: `app/Dependencies/` (third-party, about 106 MB: the
official Ikemen GO 1.0.0 release, the web engine and Elecbyte's data) and the
two `.exe` files. Take them from the release zip.

## Run it from source

Windows 10 or 11.

1. Download the latest Mugen Studio from Releases and extract it.
2. Copy its `app\Dependencies` folder into this repository's `app` folder.
3. Then either:
   - copy `MugenStudio.exe` and `app\studio-server.exe` from the zip to the same
     places here, and double-click `MugenStudio.exe`, or
   - run the server with [Node.js](https://nodejs.org/) 24, the version the
     release is built on:

     ```
     node app/server.js 8934
     ```

     and open http://localhost:8934/studio.html in your browser.

`Content\`, `Settings\` and the two export folders appear beside `app\` the
first time it runs.

## Build the programs

```
node scripts/build-app.js
```

builds both: `MugenStudio.exe`, which needs [Go](https://go.dev/) 1.23 or later,
and `app\studio-server.exe`, Node's single-executable build of
`scripts/sea-entry.cjs`. That second step runs on Node.js 24 and has `npx`
download [postject](https://github.com/nodejs/postject) while it builds.
`node scripts/build-exe.js` builds only the server.

## The engine

- The web engine, Ikemen GO compiled to WebAssembly, is its own repository:
  [energyjp/ikemen-go-web](https://github.com/energyjp/ikemen-go-web). The
  release ships it built, as `app\Dependencies\ikemen-go-src\bin\ikemen-v2.wasm`.
- Desktop exports use the official Ikemen GO 1.0.0 release,
  `app\Dependencies\Ikemen_GO-v1.0.0-windows.zip`.

## About this repository

Each release is published here as one snapshot. Development happens elsewhere,
so pull requests may not be merged; fork it instead.
