# Run the FastAPI app without manual PYTHONPATH (package lives under src/).
# Usage:
#   .\run_api.ps1
#   .\run_api.ps1 -Mode bridge   # legacy TS backend
param(
    [ValidateSet("bridge", "native")]
    [string]$Mode = "native"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PYTHONPATH = (Join-Path $root "src")
if ($Mode -eq "bridge") {
    $env:USE_TS_BRIDGE = "1"
} else {
    Remove-Item Env:\USE_TS_BRIDGE -ErrorAction SilentlyContinue
}
$env:PPT_EXECUTION_MODE = $Mode
Set-Location $root
# Launcher adds src/ to path (avoids ModuleNotFoundError: agent_core)
python run_api.py
