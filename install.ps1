# Installs the add-sg-mcp standalone executable on Windows (no Node.js needed) and runs it.
#
#   irm https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://github.com/StackGuardian/add-sg-mcp/releases/latest/download/install.ps1))) --region eu -a claude-code
#
# ADD_SG_MCP_VERSION       release to install, e.g. v0.2.0 (default: latest)
# ADD_SG_MCP_INSTALL_DIR   install directory (default: %LOCALAPPDATA%\add-sg-mcp\bin, added to your user PATH)
# ADD_SG_MCP_DOWNLOAD_URL  base URL serving the release files, e.g. an internal mirror or a file:// share
# ADD_SG_MCP_NO_RUN=1      install only; do not run add-sg-mcp afterwards

# A script block keeps variables and helpers out of the caller's session under `irm | iex`.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $releases = 'https://github.com/StackGuardian/add-sg-mcp/releases'

  function Save-Url($url, $path) {
    $uri = [Uri]$url
    if ($uri.IsFile) { Copy-Item -LiteralPath $uri.LocalPath -Destination $path }
    else { Invoke-WebRequest -Uri $uri -OutFile $path -UseBasicParsing }
  }

  $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($cpu -ne 'AMD64') { throw "add-sg-mcp: no build for $cpu Windows; run: npx add-sg-mcp" }
  $archive = 'add-sg-mcp-windows-x64.zip'
  $base = if ($env:ADD_SG_MCP_DOWNLOAD_URL) { $env:ADD_SG_MCP_DOWNLOAD_URL.TrimEnd('/') }
  elseif ($env:ADD_SG_MCP_VERSION) { "$releases/download/v$($env:ADD_SG_MCP_VERSION.TrimStart('v'))" }
  else { "$releases/latest/download" }
  $defaultDir = Join-Path $env:LOCALAPPDATA 'add-sg-mcp\bin'
  $dir = if ($env:ADD_SG_MCP_INSTALL_DIR) { $env:ADD_SG_MCP_INSTALL_DIR } else { $defaultDir }
  $exe = Join-Path $dir 'add-sg-mcp.exe'

  $tmp = Join-Path ([IO.Path]::GetTempPath()) "add-sg-mcp-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Write-Host "add-sg-mcp: downloading $archive"
    Save-Url "$base/$archive" (Join-Path $tmp $archive)
    Save-Url "$base/SHA256SUMS" (Join-Path $tmp 'SHA256SUMS')
    $expected = Get-Content (Join-Path $tmp 'SHA256SUMS') | ForEach-Object {
      $hash, $name = $_ -split '\s+'
      if ($name -eq $archive) { $hash }
    }
    if (-not $expected) { throw "add-sg-mcp: $archive is not listed in SHA256SUMS" }
    if ((Get-FileHash (Join-Path $tmp $archive) -Algorithm SHA256).Hash -ne $expected) {
      throw "add-sg-mcp: checksum mismatch for $archive; nothing was installed"
    }
    Expand-Archive (Join-Path $tmp $archive) -DestinationPath (Join-Path $tmp 'x')
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item (Join-Path $tmp 'x\add-sg-mcp.exe') $exe -Force
  }
  finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
  Write-Host "add-sg-mcp: installed $exe"

  if ($dir -eq $defaultDir) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $dir) {
      [Environment]::SetEnvironmentVariable('Path', ((@($userPath, $dir) | Where-Object { $_ }) -join ';'), 'User')
      Write-Host "add-sg-mcp: added $dir to your user PATH"
    }
    if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$env:Path;$dir" }
  }
  elseif (($env:Path -split ';') -notcontains $dir) {
    Write-Host "add-sg-mcp: $dir is not on your PATH"
  }

  if ($env:ADD_SG_MCP_NO_RUN -eq '1') { return }
  & $exe @args
} @args

# Pass a failure on when run as a file; `exit` would close the session under `irm | iex`.
if ($PSCommandPath -and $LASTEXITCODE) { exit $LASTEXITCODE }
