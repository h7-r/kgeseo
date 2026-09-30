$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repositoryRoot ".venv\Scripts\python.exe"
$python = if (Test-Path $venvPython) { $venvPython } else { "python" }
Push-Location $repositoryRoot

try {
    & $python -m pytest
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    & $python -m ruff check .
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    & $python -m ruff format --check .
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}
