# Owner AI handoff: YOLO26 pest detection and zone history

## Task for the owner's AI

Review and merge the pull request from `Aakarsh1806:codex/pest-fallback-ui-fixes` into `lucky2132621326/Bhoomitra:main`, then run the local prototype. PR #18 already introduced the YOLO26 model and zone history; this follow-up adds classifier fallback and layout fixes. Do not retrain or replace the weights. Read this document and the PR diff before changing anything.

1. Inspect the current branch, dirty worktree, latest upstream main and PR status. Preserve the owner's uncommitted work. Back up local `app/data/db.json`, `app/data/farmer_profile.json`, user/account files, `.env.local` and `app/data/pest-photos/` outside the repository before checkout or merge. Do not upload those backups or replace the owner's records with another developer's data.
2. Review the diff and run the checks below in a clean checkout. This PR adds confidence-gated classifier fallback when YOLO finds no boxes, purple pressure-unknown results, consistent history semantics, and responsive layout/CSS fixes. The detector and classifier checkpoints are already tracked on main. It excludes the submitting developer's farm database, profile, photos, virtual environments and mockups. Keep the original leaf-disease classifier; this PR does not add the rice segmentation model.
3. Preserve the owner's recent mobile Sheet navigation, structured React translations, live dashboard values, farm-map and hardware changes. Do not restore the removed DOM-mutating GlobalRuntimeTranslator. The new pest guidance uses React-rendered exact-string translations, not DOM rewriting. Only English and Hindi are exposed for this prototype; the owner's other translation dictionaries can remain in source for later use.
4. Merge through GitHub after the review/checks pass. If main has changed again, reconcile conflicts deliberately: keep the new detector-backed pest page and zone persistence, preserve newer unrelated owner changes, and re-run checks. Do not blindly choose all of either branch.
5. Pull the merged main into the owner's actual local project with a clean worktree. Keep one frontend on port 3000, the pest service on 5001 and the existing disease service on 5002 (or configure its existing port explicitly). Inspect listeners and stop only known Bhoomitra processes when replacing them; do not kill unrelated services. Do not operate pumps or other hardware during software checks.
6. Launch using the commands below and report the PR merge commit, model health, test results and localhost URL. If a check fails, report the real error rather than adding sample predictions or claiming the model is ready.

## Runtime models (already tracked on main)

- `pest_ml_service/models/pest_detector_yolo26_v1.pt` (~5 MB): trained YOLO26 object detector, not the old TorchScript classifier and not the generic pretrained `yolo26n.pt`.
- `pest_ml_service/models/pest_detector_yolo26_v1.classes.json`: exact output order, 10 classes.
- `pest_ml_service/model_registry.json`: default model ID `bhoomitra_pest_detector_yolo26_v1`.
- Checkpoint SHA-256: `09bd7c6428771a1bd8e779436ab5f069ffec2b5a2aaf706b9b95a654b4cc04dc`.
- Labels SHA-256: `0bb6142ebbfb32211477e638caf7d262da765f863917c372383ff7d77bd410f9`.

The service validates checkpoint labels against the JSON. Leave `PEST_MODEL_PATH` / `PEST_LABELS_PATH` unset unless intentionally overriding both. Restart the pest process after updating code or weights because it caches loaded models. The existing `models/pest_detector.pt` TorchScript classifier and `models/class_names.json` provide an explicit fallback after empty YOLO results. Acceptance requires confidence >= 0.70 and a top-two margin >= 0.20. Classifier results carry identificationSource=classifier, require identity review, have unknown pressure and no invented boxes/counts, and must not enable chemical treatment. Classifiers can still be wrong; these gates are not guarantees.

## macOS / Linux setup

Run from the merged repository root. Use separate environments for PyTorch and TensorFlow. The setup below uses Python 3.11 for compatibility; if pip cannot resolve platform-specific wheels, report that error rather than altering the checkpoint. Use Node 20 or newer (`File` and built-in fetch are needed by the regression script). Install the repository's requirements, including its pinned Ultralytics version.

```bash
npm ci
python3.11 -m venv pest_ml_service/.venv
pest_ml_service/.venv/bin/python -m pip install -r pest_ml_service/requirements.txt
python3.11 -m venv ml_service/.venv
ml_service/.venv/bin/python -m pip install -r ml_service/requirements.txt
shasum -a 256 pest_ml_service/models/pest_detector_yolo26_v1.pt
```

Terminal 1 — pest detector, CPU inference (Colab/GPU not required):

```bash
pest_ml_service/.venv/bin/python pest_ml_service/main.py
```

Terminal 2 — existing leaf-disease service, using 5002 to avoid macOS's system service on 5000:

```bash
ml_service/.venv/bin/python -m flask --app ml_service.main run --host 127.0.0.1 --port 5002 --no-debugger --no-reload
```

Terminal 3 — frontend, after installing dependencies:

```bash
export PEST_ML_SERVICE_URL=http://127.0.0.1:5001
export ML_SERVICE_URL=http://127.0.0.1:5002
export NEXT_PUBLIC_ML_SERVICE_URL=http://127.0.0.1:5002
npm run build
npm start
```

For development, use `npx next dev -p 3000` instead of the last two commands. The existing `npm run dev` pre-hook kills port 3000 and clears build output, so avoid it while another process owns that port. If generated CSS is stale, stop only the project's frontend, move its generated `.next` directory to a temporary backup, then rebuild before restarting. Do not delete project data.

## Windows PowerShell equivalents

Run from the repository root. Perform setup once:

```powershell
npm ci
py -3.11 -m venv pest_ml_service/.venv
& ./pest_ml_service/.venv/Scripts/python.exe -m pip install -r pest_ml_service/requirements.txt
py -3.11 -m venv ml_service/.venv
& ./ml_service/.venv/Scripts/python.exe -m pip install -r ml_service/requirements.txt
Get-FileHash ./pest_ml_service/models/pest_detector_yolo26_v1.pt -Algorithm SHA256
```

Run each of these service commands in a separate terminal:

```powershell
# Terminal 1
& ./pest_ml_service/.venv/Scripts/python.exe pest_ml_service/main.py
```

```powershell
# Terminal 2
& ./ml_service/.venv/Scripts/python.exe -m flask --app ml_service.main run --host 127.0.0.1 --port 5002 --no-debugger --no-reload
```

```powershell
# Terminal 3
$env:PEST_ML_SERVICE_URL = "http://127.0.0.1:5001"
$env:ML_SERVICE_URL = "http://127.0.0.1:5002"
$env:NEXT_PUBLIC_ML_SERVICE_URL = "http://127.0.0.1:5002"
npm run build
npm start
```

The old `scripts/start-demo.ps1` does not start the new pest service; use the explicit three-terminal commands above.

## Verification before declaring success

```bash
node scripts/test-pest-followups.cjs
node scripts/check-ui-regressions.mjs
node scripts/check-translations.mjs
node scripts/check-built-layout.mjs
pest_ml_service/.venv/bin/python -m unittest discover -s pest_ml_service -p 'test_*.py'
curl http://127.0.0.1:5001/health
```

On Windows, replace the Python executable with `./pest_ml_service/.venv/Scripts/python.exe` and use `Invoke-RestMethod http://127.0.0.1:5001/health`. The health response must report `ready: true`, `classCount: 10`, `task: object-detection`, and the model ID above; HTTP 200 alone is not enough.

- Open `http://localhost:3000/dashboard/pests` after normal login or guest entry.
- The compact uploader and A1–A6/B1–B6 farm layout must be present. Confirm mobile navigation and English/Hindi switching still work, with no stale dashboard text.
- Use a real, authorised test photo. A successful scan should save its selected zone/crop, original photo and result; clicking that zone should reopen the image, boxes, count, plan, treatment guidance and dated history after reload. Real UI scans intentionally create history, so test in an isolated data copy if the owner does not want test observations in the live farm.
- A new photo of the same crop/pest and comparable plants/distance may show High → Moderate. Do not claim improvement across different pests/crops or inconclusive results. An empty scan stays grey/recheck; only an explicit farmer field check can turn it green. Older observations without saved photos must remain readable without fabricated images.
- All 10 class names must resolve to pest-specific guidance. Confidence remains stored privately, not displayed in the UI. Model/service failure must show an error, never a sample or manufactured result.
- Accepted classifier-only results must show purple pressure-unknown zones, without detection boxes or a severity claim. A failed/unavailable classifier must not produce a confirmed identification. Detector health alone does not verify the fallback; exercise it through the regression tests and an authorised real photo.

The automated JS tests use an in-memory database and image storage; they do not alter real farm history. The Python tests use model doubles for preprocessing and retry regression checks. Real model readiness is checked separately with `/health`. The submitting developer also tested real inference through the route with in-memory persistence.

## Model limits to preserve

Supported classes: rice leaf roller, yellow rice borer, brown planthopper, white-backed planthopper, rice leafhopper, corn borer, armyworm, aphids, greenhouse whitefly and tobacco caterpillar.

The training-run report supplied by the model author recorded 516 test images / 633 boxes: precision 0.8083, recall 0.7386, mAP50 0.8130, mAP50–95 0.4968. These are reported detector metrics, not an 81% guaranteed field accuracy. The test dataset is not bundled, and this PR does not independently reproduce those metrics. White-backed planthopper and armyworm recall were weaker; field-domain and class-label quality still need validation.

Runtime first tries 640 px, then retries an empty result once at 1280 px with the same 0.35 threshold. It does not invent boxes or guarantee dense-colony counts. The pressure colour is a photo-level heuristic based on visible detections/box coverage, not measured field infestation or crop-damage severity. It must not automatically authorise pesticide use. The local JSON/guest-session prototype is not production-grade multi-farm authentication.
