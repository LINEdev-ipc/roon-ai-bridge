$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $repositoryRoot "validation\llm-real-playlists\artifacts\runtime\local-roonia.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Output "RoonIA Local Validation is not running"
  exit 0
}

$processId = [int](Get-Content -LiteralPath $pidPath -Raw)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $processId
  $process.WaitForExit(10000)
  Write-Output "RoonIA Local Validation stopped (PID $processId)"
} else {
  Write-Output "RoonIA Local Validation process $processId was not running"
}

Remove-Item -LiteralPath $pidPath -Force
