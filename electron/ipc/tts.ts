import { spawn } from "node:child_process";

import { ipcMain } from "electron";

import { channel } from "./channel";

interface WindowsTtsRequest {
  text: string;
  voiceId?: string;
  rate?: number;
  volume?: number;
  pitch?: number;
}

const POWERSHELL_TIMEOUT_MS = 30000;

const encodePowerShell = (script: string) => Buffer.from(script, "utf16le").toString("base64");

const runPowerShellJson = async <T>(script: string, env?: NodeJS.ProcessEnv): Promise<T> =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Windows TTS is only available on Windows"));
      return;
    }

    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Windows TTS timed out"));
    }, POWERSHELL_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "null") as T);
      } catch (error) {
        reject(error);
      }
    });
  });

const windowsVoiceListScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object {
  [PSCustomObject]@{
    id = $_.Id
    name = $_.DisplayName
    language = $_.Language
    gender = "$($_.Gender)"
    description = "$($_.DisplayName) ($($_.Language))"
  }
}
$sorted = @($voices | Sort-Object @{ Expression = { if ($_.language -like "zh*") { 0 } else { 1 } } }, name)
ConvertTo-Json -InputObject $sorted -Compress
`;

const windowsSynthesizeScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]

function AwaitTyped($AsyncOperation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
  $task.Wait()
  return $task.Result
}

$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BIU_WINDOWS_TTS_REQUEST))
$request = $json | ConvertFrom-Json
$synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
$voice = $null
if ($request.voiceId) {
  $voice = $voices | Where-Object { $_.Id -eq $request.voiceId } | Select-Object -First 1
}
if (-not $voice) {
  $voice = $voices | Where-Object { $_.Language -like "zh-CN*" } | Select-Object -First 1
}
if (-not $voice) {
  $voice = $voices | Select-Object -First 1
}
if ($voice) {
  $synth.Voice = $voice
}

$synth.Options.SpeakingRate = [Math]::Min(2, [Math]::Max(0.5, [double]$request.rate))
$synth.Options.AudioVolume = [Math]::Min(1, [Math]::Max(0, [double]$request.volume))
$synth.Options.AudioPitch = [Math]::Min(2, [Math]::Max(0.5, [double]$request.pitch))

$stream = AwaitTyped $synth.SynthesizeTextToStreamAsync([string]$request.text) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = [Windows.Storage.Streams.DataReader]::new($stream)
AwaitTyped $reader.LoadAsync([uint32]$stream.Size) ([uint32]) | Out-Null
$bytes = New-Object byte[] ([int]$stream.Size)
$reader.ReadBytes($bytes)
[PSCustomObject]@{
  audioBase64 = [Convert]::ToBase64String($bytes)
  mimeType = "audio/wav"
} | ConvertTo-Json -Compress
`;

export function registerTtsHandlers() {
  ipcMain.handle(channel.tts.listWindowsVoices, async () => runPowerShellJson<WindowsTtsVoice[]>(windowsVoiceListScript));

  ipcMain.handle(channel.tts.synthesizeWindows, async (_, request: WindowsTtsRequest) => {
    const payload = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
    return runPowerShellJson<WindowsTtsAudio>(windowsSynthesizeScript, {
      BIU_WINDOWS_TTS_REQUEST: payload,
    });
  });
}
