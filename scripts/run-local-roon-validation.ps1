param(
  [string]$RoonCoreHost = "10.0.60.39",
  [int]$RoonCorePort = 9330
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) {
  $nodeCommand.Source
} else {
  Join-Path $runtimeRoot "node\bin\node.exe"
}
$pnpmPath = if ($pnpmCommand) {
  $pnpmCommand.Source
} else {
  Join-Path $runtimeRoot "bin\fallback\pnpm.cmd"
}

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Node.js was not found in PATH or the bundled Codex runtime"
}
if (-not (Test-Path -LiteralPath $pnpmPath)) {
  throw "pnpm was not found in PATH or the bundled Codex runtime"
}

$validationRoot = Join-Path $repositoryRoot "validation\llm-real-playlists\artifacts\runtime"
$dataDirectory = Join-Path $validationRoot "local-roonia-data"
$stdoutPath = Join-Path $validationRoot "local-roonia.stdout.log"
$stderrPath = Join-Path $validationRoot "local-roonia.stderr.log"
$pidPath = Join-Path $validationRoot "local-roonia.pid"

New-Item -ItemType Directory -Force -Path $validationRoot | Out-Null

if (Test-Path -LiteralPath $pidPath) {
  $existingPid = [int](Get-Content -LiteralPath $pidPath -Raw)
  if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
    throw "RoonIA Local Validation is already running with PID $existingPid"
  }
}

Push-Location $repositoryRoot
try {
  & $pnpmPath run build
  if ($LASTEXITCODE -ne 0) {
    throw "TypeScript build failed"
  }

  $environment = @{
    PORT = "3100"
    PORTAL_PORT = "3101"
    ENABLE_PORTAL = "false"
    ENABLE_BROWSE = "true"
    ENABLE_MCP = "false"
    ENABLE_AUTH = "false"
    AUTOMATIC_UPDATE_CHECKS = "false"
    ROON_EXTENSION_NAME = "RoonIA Local Validation"
    ROON_EXTENSION_ID = "com.local.roon-ai-bridge.validation"
    ROON_CORE_HOST = $RoonCoreHost
    ROON_CORE_PORT = [string]$RoonCorePort
    DATA_DIR = $dataDirectory
    LOG_LEVEL = "info"
    ROON_LOG_LEVEL = "none"
  }

  foreach ($entry in $environment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }

  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList "dist/index.js" `
    -WorkingDirectory $repositoryRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  Set-Content -LiteralPath $pidPath -Value $process.Id
  Write-Output "RoonIA Local Validation started with PID $($process.Id)"
  Write-Output "Core: ${RoonCoreHost}:${RoonCorePort}"
  Write-Output "Logs: $stdoutPath"
} finally {
  Pop-Location
}
