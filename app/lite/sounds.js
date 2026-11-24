// WebMUGEN lite - lossy character sounds (packer side only).
//
// A .snd is WAV files end to end, and the engine only reads WAV. So the
// sounds travel as MP3 and are turned back into WAV samples by the BROWSER'S
// OWN decoder (decodeAudioData, which every browser has for MP3) before the
// engine starts. The .snd the engine opens has the same layout, the same
// sizes and the same sample counts as the original; only the sample values
// are the decoded ones.
//
// Decoding thousands of small files one by one would be slow, so the clips
// are laid end to end into a few long tracks ("jobs"), one sample rate and
// channel count each:
//
//   [LEAD silence][MARK: a short loud step][GAP silence][clip][GAP][clip]...
//
// The step is how the page finds where sample 0 is: MP3 decoders do not all
// agree on how many samples of start-up padding to drop. The gaps keep one
// clip's sound from smearing into the next (MP3 frames overlap).
//
// This file makes the jobs and the MP3s (through ffmpeg) and can decode them
// again to measure what was lost. The page-side half is in codecs.js
// (soundMarker, soundWrite) and lite-main.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const LEAD = 1152, MARK = 32, GAP = 1152, MARK_LEVEL = 19660;   // samples; 0.6 of full scale
const MPEG_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const MAX_JOB_SAMPLES = 22050 * 150;        // about two and a half minutes at 22 kHz a job

function ffmpegPath(opt) { return (opt && opt.ffmpeg) || 'ffmpeg'; }
function haveFfmpeg(opt) {
  const r = spawnSync(ffmpegPath(opt), ['-hide_banner', '-encoders']);
  return !r.error && r.status === 0 && /libmp3lame/.test(r.stdout.toString());
}

// A clip can go lossy when MP3 has its sample rate and it is long enough to
// be worth a frame. `op` is a 'pcm' op from transform.js.
function eligible(op) {
  return MPEG_RATES.has(op.rate) && (op.width === 1 || op.width === 2) && (op.ch === 1 || op.ch === 2) &&
    op.len >= op.width * op.ch * 64 && op.len % (op.width * op.ch) === 0;
}

// clips: [{ b, off, len, width, ch, rate, ...anything the caller wants back }]
// -> jobs: [{ rate, ch, samples, pcm: Int16Array (interleaved), clips: [{ clip, start, n }] }]
function buildJobs(clips) {
  const groups = new Map();
  for (const c of clips) {
    const k = c.rate + '/' + c.ch;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const jobs = [];
  for (const list of groups.values()) {
    let cur = null;
    const open = () => { cur = { rate: list[0].rate, ch: list[0].ch, samples: LEAD + MARK + GAP, clips: [] }; jobs.push(cur); };
    for (const c of list) {
      const n = Math.floor(c.len / (c.width * c.ch));
      if (!cur || (cur.clips.length && cur.samples + n + GAP > MAX_JOB_SAMPLES * (cur.rate / 22050))) open();
      cur.clips.push({ clip: c, start: cur.samples, n });
      cur.samples += n + GAP;
    }
  }
  for (const j of jobs) {
    const pcm = new Int16Array(j.samples * j.ch);
    for (let i = 0; i < MARK; i++) for (let k = 0; k < j.ch; k++) pcm[(LEAD + i) * j.ch + k] = MARK_LEVEL;
    for (const { clip: c, start, n } of j.clips) {
      const b = c.b;
      let o = start * j.ch;
      if (c.width === 1) for (let i = 0, e = n * c.ch; i < e; i++) pcm[o++] = (b[c.off + i] - 128) << 8;
      else for (let i = 0, e = n * c.ch; i < e; i++) { const v = b[c.off + i * 2] | (b[c.off + i * 2 + 1] << 8); pcm[o++] = v > 32767 ? v - 65536 : v; }
    }
    j.pcm = pcm;
  }
  return jobs;
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => reject(new Error('could not run ' + cmd + ': ' + e.message)));
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(cmd + ' failed: ' + Buffer.concat(err).toString().trim().split('\n').slice(-3).join(' | '))));
    p.stdin.on('error', () => { /* reported by close */ });
    p.stdin.end(input || Buffer.alloc(0));
  });
}

let tmpSeq = 0;
// job -> MP3 bytes. `quality` is LAME's -V number: 0 best/biggest .. 9 smallest.
async function encodeJob(job, quality, opt) {
  // Through a file, not a pipe: the header that says how much padding the
  // encoder added is written last, at the start of the file.
  const tmp = path.join(os.tmpdir(), `wmlite-${process.pid}-${tmpSeq++}.mp3`);
  try {
    await run(ffmpegPath(opt), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(job.rate), '-ac', String(job.ch), '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-q:a', String(quality), '-ar', String(job.rate), '-ac', String(job.ch), '-id3v2_version', '0', '-write_id3v1', '0', tmp],
      Buffer.from(job.pcm.buffer, job.pcm.byteOffset, job.pcm.byteLength));
    return fs.readFileSync(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* never made */ }
  }
}

// MP3 bytes -> [Float32Array per channel], the way a browser hands them over.
async function decodeJob(mp3, job, opt) {
  const tmp = path.join(os.tmpdir(), `wmlite-${process.pid}-${tmpSeq++}.mp3`);
  fs.writeFileSync(tmp, mp3);
  try {
    const raw = await run(ffmpegPath(opt), ['-hide_banner', '-loglevel', 'error', '-i', tmp, '-f', 'f32le', '-ar', String(job.rate), '-ac', String(job.ch), 'pipe:1']);
    const all = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
    const frames = Math.floor(all.length / job.ch);
    const chans = [];
    for (let k = 0; k < job.ch; k++) { const c = new Float32Array(frames); for (let i = 0; i < frames; i++) c[i] = all[i * job.ch + k]; chans.push(c); }
    return chans;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* gone */ }
  }
}

module.exports = { LEAD, MARK, GAP, MARK_LEVEL, MPEG_RATES, eligible, buildJobs, encodeJob, decodeJob, haveFfmpeg };
