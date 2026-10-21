<#
.SYNOPSIS
  Coordinated run for the check-secrets probe (Windows PowerShell 5.1 and PowerShell 7+).
.DESCRIPTION
  probe       Confirm the new code is deployed (no auth, no window needed): waits for the x-fn-version header.
  closed      Window CLOSED (before go-live / after expiry): every POST must be refused with 410 before auth.
  negative    Window OPEN: unauthorized-caller tests (405 / 401 / 401 / 401).
  authorized  Window OPEN: the single authorized call; prints status + boolean body only.
  Env: PENDIA_FN_URL (required), PENDIA_JWT (needed for authorized and the tampered-signature test; never printed).
  Exit codes: 0 ok, 1 test failed / not deployed, 2 bad usage, 3 incomplete (token missing), 4 window closed.
.EXAMPLE
  $env:PENDIA_FN_URL = "https://yjcaqgwtvtmonzzzikur.supabase.co/functions/v1/check-secrets"
  .\scripts\check-secrets-run.ps1 -Mode probe
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('probe', 'closed', 'negative', 'authorized')][string]$Mode,
  [string]$ExpectedVersion = 'pinned-jwk-1'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$Url = $env:PENDIA_FN_URL
if (-not $Url) { Write-Host 'Set $env:PENDIA_FN_URL first.'; exit 2 }
$Jwt = $env:PENDIA_JWT
$script:Failed = $false
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(20)

# Returns @{ Status = <int>; Version = <string|$null>; Body = <string> }. The Authorization value is never echoed.
function Send-Probe([string]$Method, [string]$Bearer) {
  $req = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new($Method)), $Url
  if ($Bearer) { [void]$req.Headers.TryAddWithoutValidation('Authorization', "Bearer $Bearer") }
  try {
    $resp = $client.SendAsync($req).GetAwaiter().GetResult()
    $vals = $null
    $ver = $null
    if ($resp.Headers.TryGetValues('x-fn-version', [ref]$vals)) { $ver = ($vals | Select-Object -First 1) }
    return @{ Status = [int]$resp.StatusCode; Version = $ver; Body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
  } catch {
    return @{ Status = 0; Version = $null; Body = "request failed: $($_.Exception.GetType().Name)" }
  } finally { $req.Dispose() }
}

function Expect([string]$Name, [int]$Want, [int]$Got) {
  if ($Want -eq $Got) { Write-Host "PASS  $Name -> $Got" } else { Write-Host "FAIL  $Name -> got $Got, expected $Want"; $script:Failed = $true }
}

function ConvertFrom-B64Url([string]$s) {
  $s = $s.Replace('-', '+').Replace('_', '/')
  switch ($s.Length % 4) { 2 { $s += '==' } 3 { $s += '=' } }
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))
}

# Flip a MIDDLE character of the signature: the last char holds base64 padding bits and may not change the bytes.
function Get-TamperedToken([string]$t) {
  $parts = $t.Split('.')
  $sig = $parts[2]
  $c = if ($sig[10] -ceq 'A') { 'B' } else { 'A' }
  return "$($parts[0]).$($parts[1]).$($sig.Substring(0, 10))$c$($sig.Substring(11))"
}

# Prints alg, kid and minutes-to-expiry only (never the token) so you can compare kid with the pinned key.
function Show-TokenInfo([string]$t) {
  try {
    $parts = $t.Split('.')
    $h = ConvertFrom-B64Url $parts[0] | ConvertFrom-Json
    $p = ConvertFrom-B64Url $parts[1] | ConvertFrom-Json
    $mins = [math]::Round((([DateTimeOffset]::FromUnixTimeSeconds([long]$p.exp)) - [DateTimeOffset]::UtcNow).TotalMinutes, 1)
    Write-Host "token header: alg=$($h.alg) kid=$($h.kid); expires in $mins min"
    if ($h.alg -ne 'ES256') { Write-Host 'WARNING: token is not ES256; the function will refuse it.' }
    if ($mins -lt 20) { Write-Host 'WARNING: token expires soon; sign in again for a fresh one.' }
  } catch { Write-Host 'WARNING: PENDIA_JWT does not look like a JWT.' }
}

switch ($Mode) {
  'probe' {
    for ($i = 1; $i -le 30; $i++) {
      $r = Send-Probe 'GET' $null
      $v = if ($r.Version) { $r.Version } else { '<none>' }
      Write-Host "attempt $i`: status=$($r.Status) x-fn-version='$v'"
      if ($r.Version -eq $ExpectedVersion) { Write-Host "Deployed version confirmed: $v"; exit 0 }
      Start-Sleep -Seconds 10
    }
    Write-Host "Expected version '$ExpectedVersion' not seen after 5 minutes. Do NOT proceed."; exit 1
  }
  'closed' {
    Expect 'GET (wrong method)' 405 (Send-Probe 'GET' $null).Status
    Expect 'POST, no Authorization' 410 (Send-Probe 'POST' $null).Status
    Expect 'POST, garbage bearer' 410 (Send-Probe 'POST' 'not.a.jwt').Status
    if ($Jwt) { Expect 'POST, real token (still refused: window closed)' 410 (Send-Probe 'POST' $Jwt).Status }
    if ($script:Failed) { exit 1 } else { exit 0 }
  }
  'negative' {
    $first = Send-Probe 'POST' $null
    if ($first.Status -eq 410) { Write-Host "Window is CLOSED (410). Auth tests need an open window; use -Mode closed or ask for go-live."; exit 4 }
    if (-not $Jwt) { Write-Host 'Set $env:PENDIA_JWT (needed for the tampered-signature test).'; exit 3 }
    Show-TokenInfo $Jwt
    Expect 'GET (wrong method)' 405 (Send-Probe 'GET' $null).Status
    Expect 'POST, no Authorization' 401 $first.Status
    Expect 'POST, garbage bearer' 401 (Send-Probe 'POST' 'not.a.jwt').Status
    Expect 'POST, tampered signature' 401 (Send-Probe 'POST' (Get-TamperedToken $Jwt)).Status
    if ($script:Failed) { Write-Host 'Some tests FAILED. Do not run authorized.'; exit 1 }
    Write-Host 'All unauthorized-caller tests passed.'; exit 0
  }
  'authorized' {
    if (-not $Jwt) { Write-Host 'Set $env:PENDIA_JWT.'; exit 3 }
    $r = Send-Probe 'POST' $Jwt
    Write-Host "status: $($r.Status)"
    Write-Host "body:   $($r.Body)"
    switch ($r.Status) { 410 { Write-Host 'Window closed.' } 503 { Write-Host 'No pinned key configured.' } { $_ -in 401, 403 } { Write-Host 'Refused.' } }
  }
}
