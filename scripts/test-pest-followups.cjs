// Exercise the real TypeScript logic with an in-memory database and model stub.
// No server requests are sent and no farm history files are changed.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const ts = require("typescript")

const root = path.resolve(__dirname, "..")
function loadTS(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = new Module(filename, moduleParent)
  module.filename = filename
  module.paths = Module._nodeModulePaths(path.dirname(filename))
  const requireOriginal = module.require.bind(module)
  module.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : requireOriginal(id)
  module._compile(code, filename)
  return module.exports
}
const moduleParent = module
let db
function reset() { db = { pestDetections: [], activityLog: [] } }
const memoryDB = { readDB: () => structuredClone(db), writeDB: (next) => { db = structuredClone(next) } }
const records = loadTS("app/lib/pestRecords.ts", { "@/app/lib/database": memoryDB })
const knowledge = loadTS("app/data/pestKnowledge.ts")
const zoneLogic = loadTS("lib/pest-zone-types.ts")
const zoneHistory = loadTS("app/lib/pestZoneHistory.ts", {
  "@/app/lib/database": memoryDB, "@/app/lib/pestRecords": records, "@/app/data/pestKnowledge": knowledge,
})
const memoryPhotos = new Map()
const photos = loadTS("app/lib/pestPhotos.ts", { fs: {
  mkdirSync() {},
  writeFileSync(name, bytes) { memoryPhotos.set(name, bytes) },
  readFileSync(name) { if (!memoryPhotos.has(name)) throw new Error("Missing photo"); return memoryPhotos.get(name) },
} })
let currentUser = { blocked: false }
const mocks = {
  "next/server": { NextResponse: Response },
  "@/app/api/zones/data": { zones: [{ id: "A1" }] },
  "@/app/lib/pestRecords": records,
  "@/app/data/pestKnowledge": knowledge,
  "@/app/lib/pestZoneHistory": zoneHistory,
  "@/app/lib/pestPhotos": photos,
  "@/app/lib/session": { getCurrentUser: () => currentUser },
}
const route = loadTS("app/api/pest-detect/route.ts", mocks)
const historyRoute = loadTS("app/api/pests/route.ts", mocks)
const zoneRoute = loadTS("app/api/pest-zones/route.ts", mocks)
const photoRoute = loadTS("app/api/pest-photos/[name]/route.ts", mocks)

function seed() {
  return records.savePestRecord({
    zoneId: "A1", crop: "Maize", pestId: "aphids", pestName: "Aphids", scientificName: "Aphididae",
    confidence: 0.85, confidenceBand: "high", cropMatch: "matched", predictions: [], detections: [],
    imageWidth: 640, imageHeight: 480, visibleCount: 5, boxCoverageRatio: 0.1, pressureLevel: "moderate",
    imageName: "memory-only.png", modelId: "bhoomitra_pest_detector_yolo26_v1", modelVersion: "1.0.0", farmerConfirmed: false,
  })
}
function followUp(overrides = {}) {
  return {
    pestId: "aphids", pestName: "Aphids", scientificName: "Aphididae", confidence: 0.9,
    visibleCount: 5, boxCoverageRatio: 0.1, pressureLevel: "moderate", imageName: "memory-only.png",
    modelId: "bhoomitra_pest_detector_yolo26_v1", modelVersion: "1.0.0", ...overrides,
  }
}
const unclear = { pestId: null, pestName: "Could not confidently identify a pest", scientificName: null,
  confidence: 0, visibleCount: 0, boxCoverageRatio: 0, pressureLevel: "none" }
function assertNoConfidence(value) {
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    assert(!["confidence", "confidenceBand", "meanConfidence"].includes(key), `Unexpected public field: ${key}`)
    assertNoConfidence(child)
  }
}
async function post(serviceBody, recordId) {
  const originalFetch = global.fetch
  global.fetch = async () => Response.json(serviceBody)
  try {
    const form = new FormData()
    form.set("zoneId", "A1")
    form.set("crop", "Maize")
    form.set("file", new File([Buffer.from([137,80,78,71,13,10,26,10]), "memory-only"], "memory-only.png", { type: "image/png" }))
    form.set("comparablePhoto", "true")
    if (recordId) form.set("baselineRecordId", recordId)
    const response = await route.POST(new Request("http://localhost/api/pest-detect", { method: "POST", body: form }))
    assert.equal(response.status, 200)
    return response.json()
  } finally { global.fetch = originalFetch }
}

async function main() {
  reset()
  const fallback = await post({ modelId: "bhoomitra_pest_classifier_v1", identificationSource: "classifier",
    primaryPrediction: { label: "Aphids", confidence: 0.87 }, predictions: [{ label: "Aphids", confidence: 0.87 }], detections: [], pressure: null })
  assert.equal(fallback.summary.primaryPestName, "Aphids")
  assert.equal(fallback.summary.pressureLevel, "unknown")
  assert.equal(fallback.advice.pesticide.eligible, false)
  assert.equal(fallback.observation.result.identificationSource, "classifier")
  assert.equal(zoneLogic.zoneState(fallback.observation), "unmeasured")
  assert.equal(records.listPestRecords().length, 1)
  assertNoConfidence(fallback)
  const prior = structuredClone(fallback.observation)
  prior.id = "prior"
  prior.result.identificationSource = "detector"
  prior.result.summary.pressureLevel = "high"
  assert.equal(zoneLogic.zoneTrend(fallback.observation, [fallback.observation, prior]).status, "recheck")
  assert.equal(zoneLogic.zoneTrend(prior, [prior, fallback.observation]).status, "recheck")
  for (const label of JSON.parse(fs.readFileSync(path.join(root, "pest_ml_service/models/class_names.json")))) {
    assert.notEqual(knowledge.getPestKnowledge(label).id, "unknown", label)
  }
  reset()
  const baseline = seed()
  const missed = records.savePestFollowUp(baseline.id, followUp(unclear))
  assert.equal(missed.record.status, "needs_recheck")
  assert.equal(missed.followUp.comparison, "needs_recheck")
  assert.equal(missed.followUp.countChangePercent, null)
  assert.equal(missed.followUp.coverageChangePercent, null)
  assert(Date.parse(missed.record.followUpDue) <= Date.now())
  records.savePestFollowUp(baseline.id, followUp(unclear))
  const resumed = records.savePestFollowUp(baseline.id, followUp())
  assert.equal(resumed.previous.visibleCount, 5)
  assert.equal(resumed.followUp.comparison, "stable")
  assert.equal(resumed.followUp.countChangePercent, 0)
  assert.equal(records.savePestFollowUp(baseline.id, followUp({ visibleCount: 1, boxCoverageRatio: .02 })).followUp.comparison, "improving")
  assert.equal(records.savePestFollowUp(baseline.id, followUp()).followUp.comparison, "worsening")
  assert.equal(records.savePestFollowUp(baseline.id, followUp({ pestId: "corn_borer", pestName: "Corn borer" })).followUp.comparison, "different_pest")

  reset()
  const emptyService = {
    detected: false, predictions: [], primaryPrediction: null, detections: [], image: { width: 547, height: 365 },
    inference: { inputSize: 1280, retryUsed: true, attemptedSizes: [640, 1280] },
  }
  const emptyInitial = await post(emptyService)
  assert.equal(emptyInitial.persisted, true)
  assert.match(emptyInitial.message, /may still be present/)
  assert.equal(db.pestDetections.length, 1)
  assert.equal(zoneLogic.zoneState(emptyInitial.observation), "recheck")
  assertNoConfidence(emptyInitial)
  const savedPhoto = emptyInitial.observation.photoUrl.split("/").at(-1)
  assert.equal(photos.readPestPhoto(savedPhoto).contentType, "image/png")
  assert.equal((await photoRoute.GET(new Request("http://localhost"), { params: { name: savedPhoto } })).headers.get("Content-Type"), "image/png")
  currentUser = null
  assert.equal((await photoRoute.GET(new Request("http://localhost"), { params: { name: savedPhoto } })).status, 401)
  assert.equal((await zoneRoute.GET()).status, 401)
  currentUser = { blocked: true }
  assert.equal((await zoneRoute.GET()).status, 403)
  currentUser = { blocked: false }
  assert.equal(photos.readPestPhoto("../../db.json"), null)
  assert.equal(photos.photoExtension(Buffer.from("<svg></svg>")), null)
  assert.equal(photos.photoExtension(Buffer.from([255,216,255])), "jpg")
  assert.equal(photos.photoExtension(Buffer.from("RIFF1234WEBPdata")), "webp")
  const clear = zoneHistory.confirmNoPests(emptyInitial.observation.id)
  assert.equal(zoneLogic.zoneState(clear), "clear")
  assert.equal(zoneLogic.zoneState(zoneHistory.listPestZoneObservations()[0]), "clear")
  reset()
  const tracked = seed()
  const emptyFollowUp = await post(emptyService, tracked.id)
  assert.equal(emptyFollowUp.persisted, true)
  assert.equal(emptyFollowUp.followUpComparison.comparison, "needs_recheck")
  assert.match(emptyFollowUp.message, /remains open/)
  assertNoConfidence(emptyFollowUp)
  let history = await (await historyRoute.GET()).json()
  assert.equal(history.summary.active, 1)
  assert.equal(history.summary.followUpsDue, 1)
  assert.equal(history.records[0].status, "needs_recheck")
  assertNoConfidence(history)

  const prediction = { classId: 7, label: "aphids", confidence: .9, count: 5, boxCoverageRatio: .1 }
  const foundService = { ...emptyService, detected: true, primaryPrediction: prediction, predictions: [prediction],
    pressure: { level: "moderate", visibleCount: 5, boxCoverageRatio: .1 } }
  const recovered = await post(foundService, tracked.id)
  assert.equal(recovered.followUpComparison.comparison, "stable")
  assert.equal(recovered.followUpBaseline.visibleCount, 5)
  assertNoConfidence(recovered)
  assert.equal(db.pestDetections[0].followUps.at(-1).confidence, .9)
  assert.equal(db.pestDetections[0].followUps.at(-1).inference.retryUsed, true)

  // Every new scan is found through its zone, without a follow-up ID or extra UI mode.
  reset()
  let older = await post({ ...foundService, pressure: { level: "high", visibleCount: 8, boxCoverageRatio: .1 } })
  // Control timestamps so this test is deterministic even within the same millisecond.
  db.pestDetections[0].timestamp = "2026-09-01T10:00:00Z"
  db.pestDetections[0].snapshot.result.scan.timestamp = db.pestDetections[0].timestamp
  const newer = await post(foundService)
  let observations = (await (await zoneRoute.GET()).json()).observations
  assert.equal(observations.length, 2)
  assert.equal(observations[0].id, newer.observation.id)
  assert.equal(zoneLogic.zoneState(observations[0]), "moderate")
  assert.equal(zoneLogic.zoneTrend(observations[0], observations).status, "improving")
  assert.equal(observations[0].result.advice.inspectToday[0], knowledge.getPestKnowledge("aphids").inspectToday[0])
  assert(observations.every((item) => item.photoUrl))
  assertNoConfidence(observations)
  assert.throws(() => zoneHistory.confirmNoPests(newer.observation.id), /latest inconclusive/)
  const current = structuredClone(observations[0])
  const past = structuredClone(observations[1])
  current.result.scan.comparablePhoto = false
  assert.equal(zoneLogic.zoneTrend(current, [current, past]).status, "not_comparable")
  current.result.scan.comparablePhoto = true
  current.result.scan.crop = "Cotton"
  assert.equal(zoneLogic.zoneTrend(current, [current, past]).status, "different_crop")
  current.result.scan.crop = past.result.scan.crop
  current.result.summary.primaryPestId = "corn_borer"
  assert.equal(zoneLogic.zoneTrend(current, [current, past]).status, "different_pest")
  current.result.summary.primaryPestId = past.result.summary.primaryPestId
  current.result.predictions.push({ pestId: "corn_borer" })
  assert.equal(zoneLogic.zoneTrend(current, [current, past]).status, "different_pest")
  current.result.predictions.pop()
  past.result.scan.zoneId = "B1"
  assert.equal(zoneLogic.zoneTrend(current, [current, past]).status, "first")
  assert.equal(zoneLogic.zoneState(), "untested")
  for (const level of ["low", "moderate", "high"]) {
    current.result.summary.pressureLevel = level
    assert.equal(zoneLogic.zoneState(current), level)
  }
  const patchWithoutConfirmation = await zoneRoute.PATCH(new Request("http://localhost/api/pest-zones", { method: "PATCH", body: JSON.stringify({ observationId: newer.observation.id }) }))
  assert.equal(patchWithoutConfirmation.status, 400)
  db.pestDetections.at(-1).timestamp = "2026-09-02T10:00:00Z"
  db.pestDetections.at(-1).snapshot.result.scan.timestamp = "2026-09-02T10:00:00Z"
  const anotherMiss = await post(emptyService)
  observations = zoneHistory.listPestZoneObservations()
  assert.equal(zoneLogic.zoneState(observations[0]), "recheck")
  assert.equal(zoneLogic.zoneTrend(observations[0], observations).status, "recheck")
  assert.equal(zoneLogic.zoneState(zoneHistory.confirmNoPests(anotherMiss.observation.id)), "clear")
  db.pestDetections.at(-1).timestamp = "2026-09-03T10:00:00Z"
  db.pestDetections.at(-1).snapshot.result.scan.timestamp = "2026-09-03T10:00:00Z"
  await post(foundService)
  assert.equal(zoneLogic.zoneState(zoneHistory.listPestZoneObservations()[0]), "moderate")
  assert.throws(() => zoneHistory.confirmNoPests(anotherMiss.observation.id), /latest inconclusive/)

  reset()
  seed()
  const legacy = zoneHistory.listPestZoneObservations()[0]
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.photoUrl, null)
  assert(legacy.result.advice.inspectToday.length)
  assertNoConfidence(legacy)

  const labels = JSON.parse(fs.readFileSync(path.join(root, "pest_ml_service/models/pest_detector_yolo26_v1.classes.json"), "utf8"))
  for (const label of labels) assert.notEqual(knowledge.getPestKnowledge(label).id, "unknown", label)
  const translations = loadTS("lib/translations.ts")
  const phraseMap = loadTS("lib/pest-phrase-map.ts", { "@/lib/translations": translations })
  const copy = loadTS("components/pest-zone-copy.ts", {
    react: { useMemo: (fn) => fn() }, "@/lib/language-context": { useLanguage: () => ({ language: "hi" }) },
    "@/lib/pest-phrase-map": phraseMap,
  }).usePestText()
  const untranslated = new Set()
  for (const label of labels) {
    const entry = knowledge.getPestKnowledge(label)
    for (const phrase of [entry.commonName, ...entry.inspectToday, ...entry.next48Hours, ...entry.prevention, ...entry.biologicalControl,
      ...["product", "application", "labelRate", "interval", "safety", "resistanceNote", "preHarvestInterval", "trigger"].map((key) => entry.chemical[key])]) {
      if (copy.text(phrase) === phrase) untranslated.add(phrase)
    }
  }
  assert.deepEqual([...untranslated], [], "All 10 pest plans must be available in Hindi")
  console.log("PASS: saved zone photos, legacy history, chronological comparisons, crop/pest isolation, all colours, explicit field-clear confirmation, stale-confirmation rejection, confidence privacy, inference retry metadata, and all 10 advisory mappings. Farm data unchanged.")

  // Optional end-to-end inference: real service and image, in-memory persistence only.
  const flag = process.argv.indexOf("--real-model")
  if (flag >= 0) {
    for (const imagePath of process.argv.slice(flag + 1)) {
      reset()
      const form = new FormData()
      form.set("zoneId", "A1"); form.set("crop", "Maize")
      form.set("file", new File([fs.readFileSync(imagePath)], path.basename(imagePath), { type: "image/jpeg" }))
      const response = await route.POST(new Request("http://localhost/api/pest-detect", { method: "POST", body: form }))
      const result = await response.json()
      assert.equal(response.status, 200, JSON.stringify(result))
      assert.equal(result.persisted, true)
      assert(result.observation.photoUrl)
      assert.equal(zoneHistory.listPestZoneObservations()[0].id, result.observation.id)
      assertNoConfidence(result)
      console.log("REAL MODEL (memory only):", path.basename(imagePath), result.summary?.primaryPestName || "Needs recheck", result.summary?.visibleCount || 0, "boxes", zoneLogic.zoneState(result.observation))
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
