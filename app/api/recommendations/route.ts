import { NextResponse } from "next/server"
import { readDB } from "@/app/lib/database"
import { zones, irrigationSettings, getFarmClimate } from "@/app/api/zones/data"
import { getForecast } from "@/app/lib/weatherService"
import { decideFarmActions } from "@/app/lib/farmDecisionService"
import { buildSpreadPlan } from "@/app/lib/spreadEngine"
import { getTreatmentOptions } from "@/app/lib/mlProcessor"
import { readLeafPhoto } from "@/app/lib/leafPhotos"
import {
  isGeminiConfigured,
  isInternetAvailable,
  requestGeminiRecommendation,
  type LLMFarmContext,
} from "@/app/lib/llmRecommendationEngine"

/**
 * Recommendations engine.
 *
 * This is the "fusion" the UI has always claimed but never had: it combines
 *   - the ML disease diagnosis (real per-detection model confidence),
 *   - the live farm climate / VPD (real DHT11 sensor),
 *   - the weather forecast (rain, wind, fungal pressure),
 * through the same decision engine that gates the real spray/irrigation
 * hardware, so a recommendation and the action it triggers can never disagree.
 *
 * Everything here is computed from real state. Confidence is the model's own
 * diagnosis confidence (not a random number); "insights" are operational
 * metrics tallied from the detection/spray history, not invented accuracy
 * percentages.
 *
 * Offline/online modes (see app/lib/llmRecommendationEngine.ts):
 * every treatment recommendation is fully built from the ML model + decision
 * engine first — that object is the complete offline recommendation and is
 * always returned as-is. When the internet is reachable and GEMINI_API_KEY is
 * configured, that same recommendation is optionally handed to Gemini (with
 * the ML diagnosis, live sensors, weather, and the saved leaf photo(s)) to
 * produce a more contextual explanation. If Gemini is unavailable, times out,
 * or returns anything that fails validation, the ML-built recommendation is
 * left untouched — the online path can only add, never replace the ML
 * diagnosis or the chemical/dosage used to drive sprays.
 */

type Severity = "low" | "moderate" | "high"
// "ml-offline": Gemini was never attempted (no internet or no GEMINI_API_KEY).
// "gemini": Gemini was attempted and returned a validated enhancement.
// "ml-fallback": Gemini was attempted (internet + key available) but failed,
// timed out, or returned invalid output — the ML recommendation was kept.
type RecommendationSource = "ml-offline" | "gemini" | "ml-fallback"

function normalizeSeverity(level?: string): Severity {
  if (level === "high") return "high"
  if (level === "medium" || level === "moderate") return "moderate"
  return "low"
}

function isHealthy(disease?: string) {
  return String(disease || "").toLowerCase().includes("healthy")
}

function recommendationImpact(severity: Severity): string {
  if (severity === "high") return "Model projection: high-priority containment before spread increases"
  if (severity === "moderate") return "Model projection: contain and re-scout before the next spread window"
  return "Model projection: monitor the next field observation"
}

export async function GET() {
  const db = readDB()
  const weather = await getForecast()
  const climate = getFarmClimate()
  const now = Date.now()

  // ── Offline vs. online recommendation mode ─────────────────────────────────
  // Offline (no internet, or no GEMINI_API_KEY configured): recommendations
  // come entirely from the ML model + decision engine, exactly as before this
  // feature was added — Gemini is never called and never awaited. Online: the
  // same ML-based recommendation is built first (so it always exists as the
  // fallback), then optionally enhanced by a Gemini call that interprets the
  // diagnosis together with live sensor, weather, and photo evidence. A
  // failed/invalid/timed-out Gemini call never blocks or breaks the response —
  // it just leaves the ML recommendation as-is.
  const llmAvailable = isGeminiConfigured() && (await isInternetAvailable())

  const detections: any[] = db.detections || []
  const sprays: any[] = (db.sprays || []).filter(
    (spray: any) => spray.applicationMode !== "water-validation" && spray.applicationStatus !== "queued",
  )

  const activeDetections = detections.filter(
    (d) => d.status === "active" && !isHealthy(d.diseaseName || d.disease),
  )
  const cropReviewDetections = activeDetections.filter((d) => d.cropMatch === "review")
  const actionableDetections = activeDetections.filter((d) => d.cropMatch !== "review")
  const spreadPlan = buildSpreadPlan({
    zones: zones.map((zone) => ({
      id: zone.id,
      row: zone.row,
      col: zone.col,
      soilMoisture: zone.soilMoisture,
      disease: zone.disease,
      severityLevel: zone.severityLevel,
      severityScore: zone.severityScore,
      mlConfidence: zone.mlConfidence,
    })),
    detections,
    weather,
    climate: {
      fresh: climate.fresh,
      humidity: climate.humidity,
      temperature: climate.temperature,
      vpd: climate.vpd,
    },
    days: 5,
    budget: 2,
  })
  const bottleneckImpactByZone = new Map(
    spreadPlan.bottlenecks.map((target) => [target.zoneId, target.projectedInfectionsAvoided]),
  )
  const sourceContainmentLeverage = Number(
    Math.max(0, spreadPlan.baseline.finalExpectedInfected - spreadPlan.generatedFrom.seedZoneIds.length).toFixed(2),
  )

  const recommendations: any[] = []
  let weatherAwareCount = 0
  // Treatment recommendations queued for optional LLM enhancement. Each entry's
  // `rec` is the already-complete ML-based recommendation (the guaranteed
  // fallback); enhancement only overlays fields onto it if the LLM call
  // succeeds and validates.
  const enhancementTargets: { rec: any; context: LLMFarmContext }[] = []

  // ── Treatment recommendations from real active detections ─────────────────
  for (const det of actionableDetections) {
    // The crop is the farmer's selected crop (or the model's crop family) —
    // never parsed from det.disease, which is a crop-stripped label like
    // "Black Rot" and would otherwise print "Black Rot on Black Rot".
    const cropLabel = det.scanCrop || det.modelCrop || "the crop"
    const diseaseLabel = String(det.disease || "")
      .split("___")[1]?.replace(/_/g, " ")
      .trim() || det.disease || "disease"
    const severity = normalizeSeverity(det.severityLevel)
    const confidencePct = Math.round((Number(det.confidence) || 0) * 100)

    // Consult the live treatment catalog (not the possibly-stale chemical
    // recorded on an older detection) so a non-curable systemic condition —
    // Esca and any future addition like it — always gets cultural/structural
    // guidance here, never a foliar-fungicide "spray plan" funnel, even if it
    // was scanned before the catalog had a cultural-only entry for it.
    const canonicalDisease = det.canonicalDisease || det.disease
    const currentTreatment = getTreatmentOptions(canonicalDisease, det.scanCrop || cropLabel)
    const currentChemicalName = currentTreatment.chemicals?.[0]?.chemicalName
    const isCulturalOnly = Boolean(currentChemicalName && /no curative|not applicable|no chemical/i.test(currentChemicalName))

    // Leaf photo(s) for this detection/zone: this scan's own photo plus up to
    // two other recent scans of the SAME zone and disease (from treatment
    // history), most recent first. Filenames are exposed to the UI for
    // display regardless of connectivity; only when Gemini is actually
    // called are the bytes read and base64-encoded (below).
    const photoNames: string[] = []
    {
      const seen = new Set<string>()
      const related = [det, ...detections.filter((other) =>
        other.id !== det.id && other.zoneId === det.zoneId && (other.canonicalDisease || other.disease) === canonicalDisease,
      ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())]
      for (const r of related) {
        if (photoNames.length >= 3) break
        if (!r.photoName || seen.has(r.photoName)) continue
        seen.add(r.photoName)
        photoNames.push(r.photoName)
      }
    }

    if (isCulturalOnly) {
      const guidance = currentTreatment.offlineRecommendation?.organicAlternative || det.organicAlternative || "Cultural and structural management — no curative spray exists for this condition."
      recommendations.push({
        id: `treat-${det.id}`,
        kind: "preventive",
        severity,
        priority: severity === "high" ? "high" : severity === "moderate" ? "medium" : "low",
        type: severity === "high" ? "urgent" : "important",
        zone: det.zoneId,
        title: `${severity[0].toUpperCase()}${severity.slice(1)} alert: ${diseaseLabel} in ${det.zoneId}`,
        description: `${diseaseLabel} detected on ${cropLabel}. This is a non-curable systemic condition — no foliar fungicide cures it, so no spray plan is offered.`,
        confidence: confidencePct,
        confidenceBasis: "Diagnosis confidence (ML model)",
        action: guidance,
        timing: "Ongoing structural/cultural management, not weather-gated",
        estimatedImpact: "Slows decline and limits spread to healthy wood/plants; does not cure the existing infection",
        reasoning: [
          `Diagnosis: ${diseaseLabel} on ${cropLabel} — ${severity} severity, ${confidencePct}% model confidence.`,
          `Treatment catalog: ${currentChemicalName} — do not present a fungicide as a cure for this condition.`,
        ],
        weatherGated: false,
        decisionAction: "cultural_management_only",
        detectionId: det.id,
        disease: det.disease,
        scannedAt: det.timestamp,
        // No curative spray exists for this condition — Gemini has nothing
        // safe to add here, so this stays ML-only regardless of connectivity.
        recommendationSource: "ml-offline" as RecommendationSource,
        photoNames,
      })
      continue
    }

    const zone = zones.find((z) => z.id === det.zoneId)
    const chemical = det.recommendedChemical && det.recommendedChemical !== "No chemical required"
      ? det.recommendedChemical
      : det.organicAlternative || "IPM treatment"

    // Run the same decision engine the spray hardware uses.
    const decision = zone
      ? decideFarmActions({
          soilMoisture: zone.soilMoisture,
          dryThreshold: irrigationSettings.dryThreshold,
          climate,
          weather,
          now,
        })
      : null

    const spray = decision?.spray
    const weatherGated = Boolean(spray && spray.action !== "allowed")
    if (weatherGated) weatherAwareCount++

    // Concrete, weather-aware action + timing.
    let action: string
    let timing: string
    if (!zone || !decision || !spray) {
      // The fusion/decision engine never actually ran for this zone (e.g. it
      // no longer exists in the live zone list) — never default to "safe to
      // treat" here, since that would assert a weather/VPD check that never
      // happened.
      action = `Confirm zone ${det.zoneId} conditions on site before spraying`
      timing = "Zone data unavailable — verify soil, weather, and VPD manually"
    } else if (spray.action === "allowed") {
      action = `Spray ${chemical} on zone ${det.zoneId}`
      timing = "Conditions are safe — treat now"
    } else if (spray.action === "hold_for_rain") {
      const h = weather.derived.sprayWindow.nextSafeInHours
      action = `Prepare ${chemical}, but hold the spray on zone ${det.zoneId}`
      timing = h != null ? `Rain risk — treat in the ~${h}h dry window` : "Rain risk — treat after it clears"
    } else if (spray.action === "hold_for_wind") {
      action = `Hold spray on zone ${det.zoneId} until winds ease`
      timing = "Winds too high for even coverage"
    } else if (spray.action === "hold_for_vpd") {
      action = `Hold spray on zone ${det.zoneId} for the optimal VPD window`
      timing = "Leaf conditions not yet ideal for uptake"
    } else {
      action = `Confirm conditions before spraying zone ${det.zoneId}`
      timing = "Forecast is reconnecting — verify conditions on site"
    }

    // Real fusion trace: the actual factors that drove the call.
    const reasoning: string[] = [
      `Diagnosis: ${diseaseLabel} on ${cropLabel} — ${severity} severity, ${confidencePct}% model confidence.`,
    ]
    if (weather.derived?.fungalPressure) {
      reasoning.push(
        `Weather: disease pressure ${weather.derived.fungalPressure.band} (${weather.derived.fungalPressure.score}/100), ${weather.current.description.toLowerCase()}.`,
      )
    }
    if (climate.fresh && climate.vpd != null) {
      reasoning.push(`Live farm sensor: VPD ${climate.vpd} kPa (${climate.vpdBand} band).`)
    }
    if (spray?.reason) reasoning.push(`Spray window: ${spray.reason}`)
    const spreadLeverage = bottleneckImpactByZone.get(det.zoneId) ?? sourceContainmentLeverage
    if (spreadLeverage > 0) {
      reasoning.push(`Spread model: containing this active detection is associated with ~${spreadLeverage.toFixed(1)} projected secondary infections over the next 5 days.`)
    }

    const treatmentRec = {
      id: `treat-${det.id}`,
      kind: "treatment",
      severity,
      priority: severity === "high" ? "high" : severity === "moderate" ? "medium" : "low",
      type: severity === "high" ? "urgent" : "important",
      zone: det.zoneId,
      title: `${severity[0].toUpperCase()}${severity.slice(1)} alert: ${diseaseLabel} in ${det.zoneId}`,
      description: `${diseaseLabel} detected on ${cropLabel}. Recommendation fuses the diagnosis with live sensor and forecast conditions.`,
      confidence: confidencePct,
      confidenceBasis: "Diagnosis confidence (ML model)",
      action,
      timing,
      estimatedImpact: `${recommendationImpact(severity)}${spreadLeverage > 0 ? ` · model spread leverage ~${spreadLeverage.toFixed(1)} infections` : ""}`,
      reasoning,
      weatherGated,
      decisionAction: spray?.action || "unknown",
      detectionId: det.id,
      // Fields the UI needs to trigger the real spray command (closes the loop).
      // These always come from the ML model / offline catalog, never the LLM.
      chemical,
      dosage: det.dosage || "",
      disease: det.disease || diseaseLabel,
      spreadLeverage,
      scannedAt: det.timestamp,
      // "ml-fallback" means Gemini was attempted this request but did not
      // produce a usable result; it flips to "gemini" below on success. When
      // llmAvailable is false, Gemini is never attempted, so this stays the
      // plain offline label.
      recommendationSource: (llmAvailable ? "ml-fallback" : "ml-offline") as RecommendationSource,
      // Structured sensor/weather snapshot for this recommendation — the same
      // values already computed above for the decision engine and (below) for
      // the Gemini context, now also exposed to the UI so it can render them
      // as evidence chips instead of parsing them back out of `reasoning`.
      photoNames,
      soilMoisturePct: zone?.soilMoisture ?? null,
      temperatureC: climate.fresh ? climate.temperature : null,
      humidityPct: climate.fresh ? climate.humidity : null,
      vpdKpa: climate.fresh ? climate.vpd : null,
      vpdBand: climate.fresh ? climate.vpdBand : null,
      weatherDescription: weather.current?.description ?? null,
      windSpeedKmh: weather.current?.windSpeed ?? null,
      nextRainHours: weather.derived?.nextRainHours ?? null,
    }
    recommendations.push(treatmentRec)

    if (llmAvailable) {
      const photos: LLMFarmContext["photos"] = []
      for (const name of photoNames) {
        const stored = readLeafPhoto(name)
        if (stored) photos.push({ base64: stored.bytes.toString("base64"), mimeType: stored.contentType })
      }

      enhancementTargets.push({
        rec: treatmentRec,
        context: {
          zoneId: det.zoneId,
          crop: cropLabel,
          disease: diseaseLabel,
          mlConfidencePct: confidencePct,
          severity,
          mlChemical: chemical,
          mlDosage: det.dosage || undefined,
          mlOrganicAlternative: currentTreatment.organic?.[0],
          soilMoisturePct: zone?.soilMoisture ?? null,
          temperatureC: climate.fresh ? climate.temperature : null,
          humidityPct: climate.fresh ? climate.humidity : null,
          vpdKpa: climate.fresh ? climate.vpd : null,
          vpdBand: climate.fresh ? climate.vpdBand : null,
          weatherDescription: weather.current?.description ?? null,
          windSpeedKmh: weather.current?.windSpeed ?? null,
          windDirectionDeg: weather.current?.windDirection ?? null,
          nextRainHours: weather.derived?.nextRainHours ?? null,
          totalRain24hMm: weather.derived?.totalRain24h ?? null,
          fungalPressureBand: weather.derived?.fungalPressure?.band ?? null,
          sprayWindowSafeNow: weather.derived?.sprayWindow?.safeNow ?? null,
          photos,
        },
      })
    }
  }

  // ── Optional online enhancement pass (Gemini) ───────────────────────────────
  // Runs after the ML-based recommendations are fully built, so every one of
  // them already has a complete, correct fallback. Calls run concurrently and
  // each has its own timeout (see llmRecommendationEngine), so one slow/failed
  // call cannot block the others or the response as a whole.
  if (llmAvailable && enhancementTargets.length > 0) {
    const results = await Promise.allSettled(
      enhancementTargets.map((target) => requestGeminiRecommendation(target.context)),
    )
    results.forEach((result, index) => {
      const target = enhancementTargets[index]
      if (result.status !== "fulfilled" || !result.value.ok) return // stays "ml-fallback"
      const llm = result.value.data
      target.rec.recommendationSource = "gemini"
      target.rec.llm = llm
      target.rec.action = `${llm.recommended_action} ${llm.treatment}`.trim()
      target.rec.timing = llm.timing
      target.rec.reasoning = [
        ...target.rec.reasoning,
        `AI interpretation: ${llm.reasoning}`,
        `Weather consideration: ${llm.weather_consideration}`,
        `Safety notes: ${llm.safety_notes}`,
      ]
    })
  }

  // A classifier label from a different crop family must never turn into a
  // pesticide instruction. Keep the scan visible and make confirmation the
  // first action instead.
  for (const det of cropReviewDetections) {
    const selectedCrop = det.scanCrop || "the selected crop"
    const modelCrop = det.modelCrop || "the model crop family"
    recommendations.push({
      id: `crop-review-${det.id}`,
      kind: "preventive",
      severity: normalizeSeverity(det.severityLevel),
      priority: "high",
      type: "urgent",
      zone: det.zoneId,
      title: `Confirm crop before treatment in ${det.zoneId}`,
      description: `The scan was marked as ${selectedCrop}, while the classifier label belongs to ${modelCrop}. No chemical action is enabled.`,
      confidence: Math.round((Number(det.confidence) || 0) * 100),
      confidenceBasis: "Crop-consistency check",
      action: "Confirm the photographed crop and rescan a clear leaf before preparing any treatment.",
      timing: "Before any spray decision",
      estimatedImpact: "Safety gate: prevents an unsupported crop–disease treatment from entering the queue",
      reasoning: [
        `Selected scan crop: ${selectedCrop}.`,
        `Classifier crop family: ${modelCrop}.`,
        "No spray recommendation is issued until those records agree.",
      ],
      weatherGated: false,
      decisionAction: "crop_confirmation_required",
      detectionId: det.id,
      disease: det.disease,
      scannedAt: det.timestamp,
    })
  }

  // ── Irrigation recommendations from real soil moisture + weather ──────────
  const zonesNeedingWater = zones.filter(
    (z) => z.soilMoisture < irrigationSettings.dryThreshold && !activeDetections.some((d) => d.zoneId === z.id),
  )
  for (const zone of zonesNeedingWater) {
    const decision = decideFarmActions({
      soilMoisture: zone.soilMoisture,
      dryThreshold: irrigationSettings.dryThreshold,
      climate,
      weather,
      now,
    })
    const irr = decision.irrigation
    if (irr.action === "no_irrigation_needed") continue
    const weatherGated = irr.action === "defer_for_rain" || irr.action === "monitor_after_rain"
    if (weatherGated) weatherAwareCount++

    const dataConfidence = weather.source === "live" && climate.fresh ? 90 : weather.source === "fallback" ? 55 : 72

    recommendations.push({
      id: `irrigate-${zone.id}`,
      kind: "irrigation",
      severity: zone.soilMoisture <= 25 ? "high" : "moderate",
      priority: zone.soilMoisture <= 25 ? "high" : "medium",
      type: zone.soilMoisture <= 25 ? "urgent" : "important",
      zone: zone.id,
      title: irr.allowsStart
        ? `Irrigate ${zone.id} — soil at ${Math.round(zone.soilMoisture)}%`
        : `Hold irrigation on ${zone.id} — rain expected`,
      description: `Soil moisture ${Math.round(zone.soilMoisture)}% is below the ${irrigationSettings.dryThreshold}% dry threshold.`,
      confidence: dataConfidence,
      confidenceBasis: "Sensor + forecast data quality",
      action: irr.allowsStart ? `Run a timed irrigation cycle on ${zone.id}` : `Defer irrigation on ${zone.id}`,
      timing: irr.allowsStart ? "Start now" : "Re-check after the forecast rain",
      estimatedImpact: irr.allowsStart ? "Restores the crop to its target moisture band" : "Avoids wasting water before rainfall",
      reasoning: [
        `Soil moisture ${Math.round(zone.soilMoisture)}% vs ${irrigationSettings.dryThreshold}% dry threshold.`,
        `Forecast: ${weather.current.description.toLowerCase()}${
          weather.derived.nextRainHours != null ? `, rain in ~${weather.derived.nextRainHours}h` : ", no rain expected soon"
        }.`,
        irr.reason,
      ],
      weatherGated,
      decisionAction: irr.action,
    })
  }

  // Sort: urgency first. Within an urgency tier, favour the combined signal
  // the farmer sees: severity × model confidence × simulated spread leverage.
  const rank = { urgent: 0, important: 1, suggestion: 2, optimization: 3 } as Record<string, number>
  const recommendationScore = (recommendation: any) => {
    const severityWeight = recommendation.severity === "high" ? 3 : recommendation.severity === "moderate" ? 2 : 1
    const confidenceWeight = Math.max(0, Number(recommendation.confidence) || 0) / 100
    const leverageWeight = Math.max(0, Number(recommendation.spreadLeverage) || 0)
    return severityWeight * confidenceWeight * (1 + leverageWeight)
  }
  recommendations.sort(
    (a, b) => (rank[a.type] - rank[b.type]) || recommendationScore(b) - recommendationScore(a) || b.confidence - a.confidence,
  )

  // ── Honest operational insights (computed, not invented) ──────────────────
  const treated = detections.filter((d) => d.status === "treated").length
  const resolved = detections.filter((d) => d.status === "resolved").length
  const totalNonHealthy = detections.filter((d) => !isHealthy(d.diseaseName || d.disease)).length
  const confidences = detections
    .map((d) => Number(d.confidence))
    .filter((c) => Number.isFinite(c) && c > 0)
  const avgConfidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
    : null

  const insights = {
    activeCount: activeDetections.length,
    treatedCount: treated,
    resolvedCount: resolved,
    totalDetections: detections.length,
    totalSprays: sprays.length,
    avgDetectionConfidence: avgConfidence,
    containmentRate: totalNonHealthy > 0 ? Math.round((treated / totalNonHealthy) * 100) : null,
    weatherAwareDecisions: weatherAwareCount,
  }

  return NextResponse.json({
    generatedAt: new Date(now).toISOString(),
    recommendations,
    insights,
    context: {
      weatherSource: weather.source,
      weatherUsable: decideFarmActions({
        soilMoisture: 100,
        dryThreshold: irrigationSettings.dryThreshold,
        climate,
        weather,
        now,
      }).weather.usableForDecisions,
      fungalPressure: weather.derived.fungalPressure,
      sprayWindow: weather.derived.sprayWindow,
      climateLive: climate.fresh,
      climateLastValidAt: climate.lastValidAt,
      weatherFetchedAt: weather.fetchedAt,
      location: weather.location.name,
      locationConfigured: weather.location.isConfigured,
      // "online" = Gemini-enhanced recommendations were attempted this request
      // (internet reachable + GEMINI_API_KEY configured); "offline" = pure
      // ML/rule based recommendations, identical to the pre-LLM behaviour.
      recommendationMode: llmAvailable ? "online" : "offline",
    },
  })
}
