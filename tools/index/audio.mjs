import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { openDb } from "../../lib/db.mjs"
import { assetFile } from "../../lib/config.mjs"

const run = promisify(execFile)

/**
 * Audio facts: duration, sample rate, channels and loudness, measured from the
 * file by ffprobe and ffmpeg. Deterministic and free, like the structural tier
 * for images.
 *
 * Loudness is EBU R128 integrated loudness (LUFS). R128 gates in 400 ms
 * blocks, so a clip shorter than that has no integrated value: ffmpeg reports
 * the -70 LUFS floor, which is stored as NULL rather than as a fake number.
 * Peak and mean level (volumedetect, dBFS) exist for every clip.
 *
 * A failed measurement leaves the row NULL and is reported; it is retried on
 * the next run. Nothing is ever recorded as zero for lack of a value.
 */

const LUFS_FLOOR = -70

async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "format=duration:stream=sample_rate,channels,duration",
    "-of", "json", file,
  ], { windowsHide: true, maxBuffer: 1 << 20 })
  const j = JSON.parse(stdout)
  const s = j.streams?.[0]
  if (!s) throw new Error("no audio stream")
  const duration = Number(j.format?.duration ?? s.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("no duration")
  return {
    duration,
    sampleRate: Number(s.sample_rate) || null,
    channels: Number(s.channels) || null,
  }
}

async function loudness(file) {
  // ffmpeg writes filter summaries to stderr and exits 0.
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostdin", "-nostats", "-i", file,
    "-af", "volumedetect,ebur128", "-f", "null", "-",
  ], { windowsHide: true, maxBuffer: 16 << 20 })
  const num = (re, text) => { const m = text.match(re); return m ? Number(m[1]) : null }
  const mean = num(/mean_volume:\s*(-?[\d.]+|-inf) dB/, stderr)
  const peak = num(/max_volume:\s*(-?[\d.]+|-inf) dB/, stderr)
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"))
  const lufs = stderr.includes("Summary:") ? num(/I:\s*(-?[\d.]+) LUFS/, summary) : null
  if (peak === null && mean === null && lufs === null) throw new Error("ffmpeg printed no levels")
  return {
    lufs: lufs !== null && Number.isFinite(lufs) && lufs > LUFS_FLOOR ? lufs : null,
    peak: Number.isFinite(peak) ? peak : null,
    mean: Number.isFinite(mean) ? mean : null,
  }
}

async function checkTools() {
  for (const t of ["ffprobe", "ffmpeg"]) {
    try { await run(t, ["-version"], { windowsHide: true }) }
    catch { throw new Error(`${t} not found on PATH (needed by assets audio)`) }
  }
}

/**
 * @param packs        restrict to these packs
 * @param force        re-measure rows that already have facts
 * @param concurrency  parallel ffmpeg processes
 */
export async function measureAudio({ packs = null, force = false, concurrency = 6 } = {}) {
  await checkTools()
  const db = openDb()
  let sql = "SELECT id, pack, path FROM assets WHERE kind='audio'"
  const params = []
  if (!force) sql += " AND duration_s IS NULL"
  if (packs) { sql += ` AND pack IN (${packs.map(() => "?").join(",")})`; params.push(...packs) }
  const rows = db.prepare(sql + " ORDER BY pack, path").all(...params)
  const total = db.prepare("SELECT count(*) c FROM assets WHERE kind='audio'").get().c

  const update = db.prepare(`UPDATE assets SET duration_s=?, sample_rate=?, channels=?,
    loudness_lufs=?, peak_db=?, mean_db=?, audio_at=? WHERE id=?`)
  const failures = []
  let done = 0, ok = 0, noLufs = 0
  const started = Date.now()

  let next = 0
  async function worker() {
    while (next < rows.length) {
      const r = rows[next++]
      try {
        const file = assetFile(r.pack, r.path)
        const p = await probe(file)
        const l = await loudness(file)
        update.run(p.duration, p.sampleRate, p.channels, l.lufs, l.peak, l.mean, new Date().toISOString(), r.id)
        ok++
        if (l.lufs === null) noLufs++
      } catch (err) {
        failures.push({ id: r.id, pack: r.pack, path: r.path, error: String(err.message ?? err).split("\n")[0].slice(0, 200) })
      }
      done++
      if (process.stdout.isTTY) process.stdout.write(`\r  measured ${done}/${rows.length}`)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, worker))
  if (process.stdout.isTTY && rows.length) process.stdout.write("\n")

  const have = db.prepare("SELECT count(*) c FROM assets WHERE kind='audio' AND duration_s IS NOT NULL").get().c
  db.close()

  console.log(`  audio:    ${rows.length} to measure, ${ok} measured, ${failures.length} failed` +
    ` (${((Date.now() - started) / 1000).toFixed(1)} s)`)
  if (noLufs) console.log(`  loudness: ${noLufs} too short for integrated LUFS (peak/mean dB still stored)`)
  for (const f of failures.slice(0, 20)) console.log(`  FAILED  ${f.id}  ${f.pack}/${f.path}: ${f.error}`)
  if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more failures`)
  console.log(`  coverage: ${have} / ${total} audio assets have facts`)
  if (failures.length) process.exitCode = 1
  return { measured: ok, failed: failures, total, have }
}
