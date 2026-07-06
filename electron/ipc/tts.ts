import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ipcMain } from "electron";

import { channel } from "./channel";

interface WindowsTtsRequest {
  text: string;
  voiceId?: string;
  rate?: number;
  volume?: number;
  pitch?: number;
}

interface SapiTtsRequest {
  text: string;
  voiceId?: string;
  rate?: number;
  volume?: number;
}

const POWERSHELL_TIMEOUT_MS = 30000;
const ADAPTER_TIMEOUT_MS = 180000;
const ADAPTER_VERSION = "v0.2.9";
const ADAPTER_URL =
  "https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/releases/download/v0.2.9/NaturalVoiceSAPIAdapter_v0.2.9_x86_x64.zip";

const encodePowerShell = (script: string) => Buffer.from(script, "utf16le").toString("base64");

const runPowerShellJson = async <T>(
  script: string,
  env?: NodeJS.ProcessEnv,
  timeoutMs = POWERSHELL_TIMEOUT_MS,
): Promise<T> =>
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
    }, timeoutMs);

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

const sapiVoiceListScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
  $info = $_.VoiceInfo
  [PSCustomObject]@{
    id = $info.Id
    name = $info.Name
    culture = "$($info.Culture)"
    gender = "$($info.Gender)"
    description = $info.Description
  }
}
$sorted = @($voices | Sort-Object @{ Expression = { if ($_.culture -like "zh*") { 0 } else { 1 } } }, name)
ConvertTo-Json -InputObject $sorted -Compress
`;

const sapiSynthesizeScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Speech
$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BIU_SAPI_TTS_REQUEST))
$request = $json | ConvertFrom-Json
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$voice = $null
if ($request.voiceId) {
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.Enabled -and ($_.VoiceInfo.Id -eq $request.voiceId -or $_.VoiceInfo.Name -eq $request.voiceId) } |
    Select-Object -First 1
}
if (-not $voice) {
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.Enabled -and "$($_.VoiceInfo.Culture)" -like "zh*" } |
    Select-Object -First 1
}
if ($voice) {
  $synth.SelectVoice($voice.VoiceInfo.Name)
}
$rate = [double]$request.rate
$synth.Rate = [Math]::Min(10, [Math]::Max(-10, [int][Math]::Round(($rate - 1) * 10)))
$synth.Volume = [Math]::Min(100, [Math]::Max(0, [int][Math]::Round([double]$request.volume * 100)))
$stream = [System.IO.MemoryStream]::new()
$synth.SetOutputToWaveStream($stream)
$synth.Speak([string]$request.text)
$synth.SetOutputToNull()
[PSCustomObject]@{
  audioBase64 = [Convert]::ToBase64String($stream.ToArray())
  mimeType = "audio/wav"
} | ConvertTo-Json -Compress
`;

const naturalVoiceAdapterInstallScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BIU_NATURAL_VOICE_INSTALL))
$request = $json | ConvertFrom-Json
$adapterDir = [string]$request.adapterDir
$zipPath = Join-Path $adapterDir "adapter.zip"
$installerPath = Join-Path $adapterDir "Installer.exe"
New-Item -ItemType Directory -Force -Path $adapterDir | Out-Null
if (!(Test-Path $installerPath)) {
  Invoke-WebRequest -Uri ([string]$request.url) -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $adapterDir -Force
}

$enumKey = "HKCU:\Software\NaturalVoiceSAPIAdapter\Enumerator"
New-Item -Path $enumKey -Force | Out-Null
Set-ItemProperty -Path $enumKey -Name NoNarratorVoices -Type DWord -Value 0
Set-ItemProperty -Path $enumKey -Name NoEdgeVoices -Type DWord -Value 1
Set-ItemProperty -Path $enumKey -Name NoAzureVoices -Type DWord -Value 1
Set-ItemProperty -Path $enumKey -Name NarratorVoicePath -Type String -Value ([string]$request.voicePackageDir)

$configKey = "HKCU:\Software\NaturalVoiceSAPIAdapter"
New-Item -Path $configKey -Force | Out-Null
Set-ItemProperty -Path $configKey -Name LogLevel -Type DWord -Value 2

$x64Dll = Join-Path $adapterDir "x64\NaturalVoiceSAPIAdapter.dll"
$x86Dll = Join-Path $adapterDir "x86\NaturalVoiceSAPIAdapter.dll"
$adminScriptLines = @(
  '$ErrorActionPreference = "Stop"',
  ('& regsvr32.exe /s "{0}"' -f $x64Dll),
  ('if (Test-Path "{0}") {{ & regsvr32.exe /s "{0}" }}' -f $x86Dll)
)
$adminScript = [string]::Join([Environment]::NewLine, $adminScriptLines)
$encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($adminScript))
$process = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
if ($process.ExitCode -ne 0) {
  throw "NaturalVoiceSAPIAdapter registration failed with exit code $($process.ExitCode)"
}

[PSCustomObject]@{
  adapterDir = $adapterDir
  installed = (Test-Path $x64Dll)
} | ConvertTo-Json -Compress
`;

const cleanYamlValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return "";
  return trimmed.replace(/^['"]|['"]$/g, "");
};

export const parseNaturalVoiceConfig = async (dir: string): Promise<LocalNaturalVoice[]> => {
  const configPath = path.join(dir, "config.yaml");
  const content = await fs.readFile(configPath, "utf8");
  const voices: LocalNaturalVoice[] = [];
  let engine = "";
  let current: Record<string, string> | null = null;

  const pushCurrent = () => {
    if (!engine || !current?.code) return;
    const folder = path.join(dir, engine, current.code);
    voices.push({
      engine,
      code: current.code,
      name: current.name || current.code,
      desc: current.desc || "",
      sampleRate: Number(current.sampleRate) || undefined,
      folder,
      manifestPath: path.join(folder, "AppxManifest.xml"),
      installed: false,
    });
  };

  for (const line of content.split(/\r?\n/)) {
    const engineMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (engineMatch) {
      pushCurrent();
      current = null;
      engine = engineMatch[1];
      continue;
    }

    if (/^-\s+!!/.test(line)) {
      pushCurrent();
      current = {};
      continue;
    }

    const propertyMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (current && propertyMatch) {
      current[propertyMatch[1]] = cleanYamlValue(propertyMatch[2]);
    }
  }

  pushCurrent();
  const withExistingManifest = await Promise.all(
    voices.map(async voice => ({
      ...voice,
      manifestPath: (await fs.stat(voice.manifestPath).then(
        () => voice.manifestPath,
        () => "",
      )),
    })),
  );
  return withExistingManifest.filter(voice => voice.manifestPath);
};

const getAdapterDir = () => path.join(os.homedir(), "AppData", "Local", "Biu", "NaturalVoiceSAPIAdapter", ADAPTER_VERSION);

const getLocalVoiceInstallRoot = () =>
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Biu", "tts-voices");

const copyNaturalVoicesToLocalRoot = async (voicePackageDir: string, voiceCodes?: string[]) => {
  const voices = await parseNaturalVoiceConfig(voicePackageDir);
  const selected = voiceCodes?.length ? voices.filter(voice => voiceCodes.includes(voice.code)) : voices;
  if (!selected.length) throw new Error("No local natural voices found");

  const root = getLocalVoiceInstallRoot();
  await fs.mkdir(root, { recursive: true });
  for (const voice of selected) {
    const target = path.join(root, voice.engine, voice.code);
    await fs.rm(target, { force: true, recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(voice.folder, target, { recursive: true });
  }
  return root;
};

const matchLocalVoicesToSapi = (localVoices: LocalNaturalVoice[], sapiVoices: SapiTtsVoice[]) =>
  localVoices.map(voice => {
    const codeTail = voice.code.split("-").at(-1)?.replace(/Neural$/i, "").toLowerCase() || "";
    const match = sapiVoices.find(
      sapi =>
        sapi.name.toLowerCase().includes(codeTail) ||
        sapi.description?.toLowerCase().includes(codeTail) ||
        sapi.id.toLowerCase().includes(voice.code.toLowerCase()),
    );
    return {
      ...voice,
      sapiVoiceId: match?.id,
      installed: Boolean(match),
    };
  });

export function registerTtsHandlers() {
  ipcMain.handle(channel.tts.listWindowsVoices, async () => runPowerShellJson<WindowsTtsVoice[]>(windowsVoiceListScript));

  ipcMain.handle(channel.tts.synthesizeWindows, async (_, request: WindowsTtsRequest) => {
    const payload = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
    return runPowerShellJson<WindowsTtsAudio>(windowsSynthesizeScript, {
      BIU_WINDOWS_TTS_REQUEST: payload,
    });
  });

  ipcMain.handle(channel.tts.listSapiVoices, async () => runPowerShellJson<SapiTtsVoice[]>(sapiVoiceListScript));

  ipcMain.handle(channel.tts.synthesizeSapi, async (_, request: SapiTtsRequest) => {
    const payload = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
    return runPowerShellJson<WindowsTtsAudio>(sapiSynthesizeScript, {
      BIU_SAPI_TTS_REQUEST: payload,
    });
  });

  ipcMain.handle(channel.tts.parseNaturalVoicePackage, async (_, dir: string) => {
    const [localVoices, sapiVoices] = await Promise.all([
      parseNaturalVoiceConfig(dir),
      runPowerShellJson<SapiTtsVoice[]>(sapiVoiceListScript).catch(() => []),
    ]);
    return matchLocalVoicesToSapi(localVoices, sapiVoices);
  });

  ipcMain.handle(channel.tts.installNaturalVoiceAdapter, async (_, voicePackageDir: string, voiceCodes?: string[]) => {
    const localVoiceRoot = await copyNaturalVoicesToLocalRoot(voicePackageDir, voiceCodes);
    const payload = Buffer.from(
      JSON.stringify({
        adapterDir: getAdapterDir(),
        url: ADAPTER_URL,
        voicePackageDir: localVoiceRoot,
      }),
      "utf8",
    ).toString("base64");
    return runPowerShellJson<NaturalVoiceAdapterInstallResult>(
      naturalVoiceAdapterInstallScript,
      { BIU_NATURAL_VOICE_INSTALL: payload },
      ADAPTER_TIMEOUT_MS,
    );
  });
}
