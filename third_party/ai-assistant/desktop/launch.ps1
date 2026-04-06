param(
  [string]$WslProjectPath = "/home/thovinh/NemoClaw/third_party/ai-assistant",
  [int]$Port = 4317,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Start-AiAssistantBackend {
  param(
    [string]$ProjectPath,
    [int]$AppPort,
    [bool]$ShouldBuild
  )

  $buildStep = if ($ShouldBuild) { "npm run build && " } else { "" }
  $logPath = "$ProjectPath/desktop/backend-launch.log"
  $command = @'
source ~/.bashrc >/dev/null 2>&1 || true
source ~/.profile >/dev/null 2>&1 || true
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
if command -v nvm >/dev/null 2>&1; then
  nvm use 22 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi
cd __PROJECT_PATH__ || exit 1
command -v node >/dev/null 2>&1 || { echo 'node not found on PATH' > __LOG_PATH__; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm not found on PATH' > __LOG_PATH__; exit 1; }
node -v > __LOG_PATH__
printf '\n' >> __LOG_PATH__
{ __BUILD_STEP__ AI_ASSISTANT_HOST=127.0.0.1 AI_ASSISTANT_PORT=__APP_PORT__ npm run start; } >> __LOG_PATH__ 2>&1
'@
  $escapedProjectPath = $ProjectPath.Replace('\', '/')
  $escapedLogPath = $logPath.Replace('\', '/')
  $command = $command.Replace('__PROJECT_PATH__', $escapedProjectPath)
  $command = $command.Replace('__LOG_PATH__', $escapedLogPath)
  $command = $command.Replace('__BUILD_STEP__', $buildStep)
  $command = $command.Replace('__APP_PORT__', [string]$AppPort)

  Start-Process "wsl.exe" `
    -WindowStyle Hidden `
    -ArgumentList @("bash", "-lc", $command) | Out-Null
}

function Wait-ForBackend {
  param([int]$AppPort)

  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$AppPort/health" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  return $false
}

function Show-FallbackBrowser {
  param([int]$AppPort)

  Start-Process "http://127.0.0.1:$AppPort"
}

function Start-EdgeAppWindow {
  param([int]$AppPort)

  $edgeCandidates = @(
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($edgePath in $edgeCandidates) {
    if (Test-Path $edgePath) {
      Start-Process $edgePath -ArgumentList @(
        "--app=http://127.0.0.1:$AppPort",
        "--window-size=980,860"
      )
      return $true
    }
  }

  return $false
}

function Show-DesktopWindow {
  param([int]$AppPort)

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "AI Assistant"
  $form.Width = 980
  $form.Height = 860
  $form.MinimumSize = New-Object System.Drawing.Size(760, 620)
  $form.TopMost = $true
  $form.StartPosition = "CenterScreen"
  $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#081A44")
  $form.ForeColor = [System.Drawing.Color]::White

  try {
    Add-Type -AssemblyName Microsoft.Web.WebView2.WinForms
    Add-Type -AssemblyName Microsoft.Web.WebView2.Core

    $webview = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $webview.Dock = [System.Windows.Forms.DockStyle]::Fill
    $form.Controls.Add($webview)
    $form.Add_Shown({
      $null = $webview.EnsureCoreWebView2Async($null)
      $webview.Source = [System.Uri]::new("http://127.0.0.1:$AppPort")
    })
  } catch {
    if (Start-EdgeAppWindow -AppPort $AppPort) {
      return
    }

    Write-Warning "WebView2 is unavailable. Falling back to the default browser because the legacy IE-based control renders the UI incorrectly."
    Show-FallbackBrowser -AppPort $AppPort
    return
  }

  [System.Windows.Forms.Application]::Run($form)
}

Start-AiAssistantBackend -ProjectPath $WslProjectPath -AppPort $Port -ShouldBuild (-not $SkipBuild)

if (-not (Wait-ForBackend -AppPort $Port)) {
  Write-Warning "AI Assistant backend did not become ready in time. Check /home/thovinh/NemoClaw/third_party/ai-assistant/desktop/backend-launch.log in WSL."
  Show-FallbackBrowser -AppPort $Port
  exit 0
}

Show-DesktopWindow -AppPort $Port
