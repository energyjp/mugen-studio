'use strict';
const fs = require('fs');
const path = require('path');

// Post-export sanity check.
//
// An export that "succeeds" while producing an unplayable build has shipped
// more than once in this project's history: an empty kit roster, a roster that
// silently dropped to two characters, and a kit whose export could not run at
// all (it copied a ranked-only file that redistributable trees never contain,
// so it threw ENOENT before writing anything - broken in every kit v1.4-v1.7,
// invisible from the author's own tree because the file exists there).
//
// The common shape of all three: the export reported success. Failing loudly
// here is always cheaper than uploading it, because the person who discovers
// the problem otherwise is a stranger who cannot play and has no way to report.

// Entries in a select.def section, ignoring comments and blank lines. Counting
// raw lines would score a file of nothing but comments as healthy.
function sectionEntries(text, name) {
    const lines = text.split(/\r?\n/);
    const want = '[' + name.toLowerCase();
    let inside = false;
    const out = [];
    for (const raw of lines) {
        const line = raw.replace(/;.*$/, '').trim();
        if (!line) continue;
        if (line.startsWith('[')) {
            inside = line.toLowerCase().startsWith(want);
            continue;
        }
        if (inside) out.push(line);
    }
    return out;
}

// Throws with every problem found, rather than the first - one run should tell
// you everything that is wrong.
// `userWork`: the data/work-shaped files the build read from the user's own
// folders (vfslib build().userWork); see the data/work check.
function selfCheck(dist, { requireContent = true, userWork = [] } = {}) {
    const problems = [];

    for (const f of ['index.html', 'play.html', 'ikemen.wasm', 'vfs.js', 'webrtc.js', 'wasm_exec.js']) {
        if (!fs.existsSync(path.join(dist, f))) problems.push('missing ' + f);
    }

    // EVERY local <script src> in EVERY shipped page must resolve to a file in
    // the build. A dangling tag 404s on load and the page then dies on the
    // first call into the missing module - with nothing in the export output to
    // suggest anything is wrong.
    //
    // This check used to name identity.js specifically and look only at
    // index.html and play.html. That is why v1.8 shipped: studio-lite.html
    // (which is index.html on a public build) had gained three new modules -
    // motif-core.js, sffdec-core.js, sffdec-browser.js - the hand-written copy
    // list in export.js had not, and a check that only knew one filename saw
    // nothing. The uploaded Studio threw "motifCore is not defined" the moment
    // anyone added a character, and its select-screen grid never rendered.
    // Generic beats specific: this now catches the next module too.
    for (const page of fs.readdirSync(dist).filter((f) => f.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(dist, page), 'utf8');
        for (const m of html.matchAll(/<script[^>]+src="(?!https?:|\/\/)\.?\/?([^"]+)"/g)) {
            if (!fs.existsSync(path.join(dist, m[1]))) {
                problems.push(page + ' loads ' + m[1] + ' but the file was not shipped');
            }
        }
        // ...and every library it loads later by itself, from a folder it
        // names (./vendor/<name>/<version>/, studio-lite's .rar and .7z
        // unpacker): the folder, with each file and license its VENDOR.json
        // lists. A missing one is an unpacker that fails the first time
        // somebody drops a .rar, long after this build was uploaded.
        for (const d of new Set([...html.matchAll(/['"]\.\/(vendor\/[\w.-]+\/[\w.-]+)\/['"]/g)].map((x) => x[1]))) {
            const dir = path.join(dist, ...d.split('/'));
            let rec = null;
            try { rec = JSON.parse(fs.readFileSync(path.join(dir, 'VENDOR.json'), 'utf8')); } catch (e) { /* below */ }
            if (!rec) { problems.push(page + ' loads ' + d + '/ but the folder (or its VENDOR.json) was not shipped'); continue; }
            const need = new Set([...Object.keys(rec.files || {}), ...(rec.components || []).map((c) => c.file)]);
            for (const f of need) {
                if (!fs.existsSync(path.join(dir, f))) problems.push(page + ' loads ' + d + '/ but its ' + f + ' was not shipped');
            }
        }
    }

    // The engine's authoring source (data/work/, data/<motif>/work/) must not
    // ship: nothing loads it, and it was 1006 entries / 7.4 MB of every pak up
    // to v1.8. vfslib filters it at the ENGINE-LAYER walks (WORK_DIR); this
    // refuses a build where that filter was bypassed or a new layer
    // reintroduced it. Pack builds are checked through the manifest, loose
    // builds through the directory.
    //
    // A USER'S THEME IS NOT CHECKED. Content/<bundle>/themes/<Name>/ mounts at
    // data/<Name>/, and vfslib ships a theme whole, a work/ folder of its own
    // included (a user's themes are theirs). `userWork` lists the files of that
    // shape the build read from the user's own folders (vfslib build().userWork,
    // chosen by where each file came from, passed by export.js); exactly those
    // are not refused. Refusing them made every export of a screenpack that
    // carries its own work/ fail (2.4), with an error that blamed the engine
    // files. Per file, not per folder: a theme can share its folder name with
    // an engine motif (or be called "work") and must not hide an engine leak.
    // Without the list every match is refused, as before.
    const WORK = /^data\/(?:[^/]+\/)?work\//i;
    const mine = new Set((userWork || []).map((v) => String(v).toLowerCase()));
    const manifest = path.join(dist, 'ikemen-fs', 'manifest.json');
    if (fs.existsSync(manifest)) {
        let files = {};
        try { files = JSON.parse(fs.readFileSync(manifest, 'utf8')).files || {}; }
        catch (e) { problems.push('ikemen-fs/manifest.json is not valid JSON: ' + e.message); }
        const work = Object.keys(files).filter((v) => WORK.test(v) && !mine.has(v.toLowerCase()));
        if (work.length) {
            problems.push(work.length + ' of the Studio\'s own engine authoring files (data/work) in the pak, e.g. '
                + work[0] + ' - they did not come from your screenpacks');
        }
    } else if (fs.existsSync(path.join(dist, 'ikemen-fs', 'data', 'work'))) {
        problems.push('engine authoring source shipped at ikemen-fs/data/work');
    }

    // A screenpack's manifest and its options store (themeopts.js) are the
    // Studio's own records, kept in the theme folder; the ship filter leaves
    // them out of every build, and this refuses one where it did not.
    const STUDIO_ONLY = /^data\/[^/]+\/(?:studio-pack\.json$|studio-options\/)/i;
    if (fs.existsSync(manifest)) {
        let files = {};
        try { files = JSON.parse(fs.readFileSync(manifest, 'utf8')).files || {}; } catch (e) { files = {}; }
        const own = Object.keys(files).filter((v) => STUDIO_ONLY.test(v));
        if (own.length) problems.push(own.length + ' Studio-only screenpack files in the pak, e.g. ' + own[0]);
    } else {
        const data = path.join(dist, 'ikemen-fs', 'data');
        let dirs = [];
        try { dirs = fs.readdirSync(data, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (e) { dirs = []; }
        for (const d of dirs) {
            for (const n of ['studio-pack.json', 'studio-options']) {
                if (fs.existsSync(path.join(data, d, n))) problems.push('Studio-only screenpack file shipped at ikemen-fs/data/' + d + '/' + n);
            }
        }
    }

    // The engine is MIT-licensed (its notice must accompany any copy of the
    // binary) and the release screenpack is CC BY-NC. export.js copies both
    // notices from release/; a build without them is not redistributable and
    // must not report success. Nothing shipped them from v1.0 to v1.8.
    for (const lic of ['License.txt', 'ScreenpackLicense.txt']) {
        if (!fs.existsSync(path.join(dist, lic))) {
            problems.push('missing ' + lic + ' (engine / screenpack license notice)');
        }
    }

    if (requireContent) {
        const sel = path.join(dist, 'ikemen-fs', 'base-select.def');
        if (!fs.existsSync(sel)) {
            problems.push('missing ikemen-fs/base-select.def');
        } else {
            const text = fs.readFileSync(sel, 'utf8');
            const chars = sectionEntries(text, 'characters');
            const stages = sectionEntries(text, 'extrastages');
            if (chars.length < 1) problems.push('select.def lists no characters - the build has no game in it');
            if (stages.length < 1) problems.push('select.def lists no stages');
        }
    }

    if (problems.length) {
        const err = new Error(
            'export self-check failed: ' + problems.join('; ') +
            ' (build left in ' + dist + ' for inspection)');
        err.problems = problems;
        throw err;
    }
    return true;
}

module.exports = { selfCheck, sectionEntries };
