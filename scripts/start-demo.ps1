param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPython = $env:BHOOMITRA_BACKEND_PYTHON
if (-not $backendPython) {
  $candidates = @(
    (Join-Path $projectRoot "ml_service\venv\Scripts\python.exe"),
    (Join-Path $projectRoot "ml_service\.venv\Scripts\python.exe"),
    (Join-Path $projectRoot ".venv\Scripts\python.exe"),
    (Join-Path $projectRoot "venv\Scripts\python.exe"),
    "C:\mp-backend-venv\Scripts\python.exe"
  )
  $backendPython = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

$pestPython = $env:BHOOMITRA_PEST_PYTHON
if (-not $pestPython) {
  $pestCandidates = @(
    (Join-Path $projectRoot "pest_ml_service\.venv\Scripts\python.exe"),
    (Join-Path $projectRoot "pest_ml_service\venv\Scripts\python.exe")
  )
  $pestPython = $pestCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $backendPython) {
  throw "No backend Python found. Create a venv with ml_service requirements (e.g. 'python -m venv ml_service\venv' then 'ml_service\venv\Scripts\pip install -r ml_service\requirements.txt'), or set BHOOMITRA_BACKEND_PYTHON to your Python executable."
}

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-ForPort([int]$Port, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

if (-not (Test-Path -LiteralPath $backendPython)) {
  throw "Backend Python was not found at '$backendPython'. Set BHOOMITRA_BACKEND_PYTHON to the Python executable that has ml_service requirements installed."
}

if (-not $pestPython) {
  throw "No pest-service Python found. Create it with 'py -3.11 -m venv pest_ml_service\.venv' then 'pest_ml_service\.venv\Scripts\python.exe -m pip install -r pest_ml_service\requirements.txt', or set BHOOMITRA_PEST_PYTHON."
}

if (-not (Test-Path -LiteralPath $pestPython)) {
  throw "Pest-service Python was not found at '$pestPython'. Set BHOOMITRA_PEST_PYTHON to the Python executable that has pest_ml_service requirements installed."
}

Set-Location $projectRoot

if (-not (Test-Port 5000)) {
  Start-Process -FilePath $backendPython -ArgumentList "ml_service\main.py" -WorkingDirectory $projectRoot -WindowStyle Hidden
  if (-not (Wait-ForPort 5000)) {
    throw "The ML backend did not start on port 5000. Run '$backendPython ml_service\main.py' to view the error."
  }
}

if (-not (Test-Port 5001)) {
  Start-Process -FilePath $pestPython -ArgumentList "pest_ml_service\main.py" -WorkingDirectory $projectRoot -WindowStyle Hidden
  if (-not (Wait-ForPort 5001)) {
    throw "The pest ML service did not start on port 5001. Run '$pestPython pest_ml_service\main.py' to view the error."
  }
}

if (-not (Test-Port 3000)) {
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $projectRoot -WindowStyle Hidden
  if (-not (Wait-ForPort 3000)) {
    throw "The frontend did not start on port 3000. Run 'npm run dev' to view the error."
  }
}

if (-not $NoBrowser) {
  Start-Process "http://localhost:3000"
}

Write-Host "Bhoomitra is ready: http://localhost:3000"
