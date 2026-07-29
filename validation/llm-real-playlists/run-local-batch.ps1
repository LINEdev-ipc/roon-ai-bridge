param(
  [string]$DataDir = "validation/llm-real-playlists/artifacts/runtime/local-roonia-data-r02-v12-true-cold",
  [string]$LabelPrefix = "v12",
  [string]$Cohort = "",
  [string]$RoonCoreHost = "10.0.60.39",
  [int]$RoonCorePort = 9330,
  [string[]]$Cases = @(
    "R03-p02-openai.json",
    "R04-p03-openai.json",
    "R05-p04-openai.json",
    "R06-p05-openai.json",
    "R07-p06-openai.json",
    "R08-p07-openai.json",
    "R09-p08-openai.json",
    "R10-p09-openai.json"
  )
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$runtime = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) {
  $nodeCommand.Source
} else {
  Join-Path $runtime "node\bin\node.exe"
}
if (-not (Test-Path -LiteralPath $node)) {
  throw "Node.js was not found in PATH or the bundled Codex runtime"
}

$runner = Join-Path $PSScriptRoot "run-local-case.js"
$output = Join-Path $PSScriptRoot "artifacts\runtime"
$progressPath = Join-Path $output "$LabelPrefix-batch.ndjson"

if ($Cohort -eq "mcp2-gpt56") {
  $Cases = @(
    "R06-p05-openai-mcp2-gpt56.json",
    "R07-p06-openai-mcp2-gpt56.json",
    "R08-p07-openai-mcp2-gpt56.json"
  )
}

if ($Cohort -eq "mcp3-gpt56") {
  $Cases = @(
    "R07-p06-openai-mcp3-gpt56.json",
    "R08-p07-openai-mcp3-gpt56.json"
  )
}

Set-Content -LiteralPath $progressPath -Value ""

Push-Location $root
try {
  $env:ROON_CORE_HOST = $RoonCoreHost
  $env:ROON_CORE_PORT = [string]$RoonCorePort
  $env:ROON_EXTENSION_ID = "com.local.roon-ai-bridge.validation"
  $env:ROON_EXTENSION_NAME = "RoonIA Local Validation"
  $env:ENABLE_AUTH = "false"
  $env:ENABLE_MCP = "false"
  $env:ENABLE_PORTAL = "false"
  foreach ($caseFile in $Cases) {
    $caseId = [System.IO.Path]::GetFileNameWithoutExtension($caseFile).Split("-")[0]
    $label = "$LabelPrefix-$caseId"
    $stdoutPath = Join-Path $output "$label.stdout.log"
    $stderrPath = Join-Path $output "$label.stderr.log"

    $ErrorActionPreference = "Continue"
    & $node $runner `
        "--case=$caseFile" `
        "--data-dir=$DataDir" `
        "--label=$label" `
        1> $stdoutPath `
        2> $stderrPath
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) {
      throw "Validation case $caseId failed. See $stderrPath"
    }

    $record = Get-Content -LiteralPath (Join-Path $output "$label.json") -Raw |
      ConvertFrom-Json
    $result = $record.result
    [pscustomobject]@{
      case_id = $caseId
      added_count = $result.added_count
      missing_count = $result.missing_count
      elapsed_ms = $result.performance.elapsed_ms
      candidates = $result.performance.candidates_started
      rejected = $result.performance.candidates_rejected
      musicbrainz_requests = $result.performance.musicbrainz_requests
      musicbrainz_cache_hits = $result.performance.musicbrainz_cache_hits
      listenbrainz_requests = $result.performance.listenbrainz_requests
      listenbrainz_cache_hits = $result.performance.listenbrainz_cache_hits
      roon_searches = $result.performance.roon_searches
      rejection_reasons = $result.rejection_summary.by_reason
    } | ConvertTo-Json -Compress -Depth 8 |
      Add-Content -LiteralPath $progressPath
  }
} finally {
  Pop-Location
}
