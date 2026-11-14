import { execFile } from 'child_process'

// Ramène au premier plan la fenêtre principale d'un processus (émulateur déjà ouvert
// qu'on tente de relancer depuis RetroLib). Pas de module natif : on passe par
// PowerShell + quelques fonctions user32 compilées à la volée (Add-Type). Les
// fenêtres visibles de premier niveau du processus sont énumérées (EnumWindows) plutôt
// que d'utiliser Process.MainWindowHandle, qui vaut souvent 0 pour les émulateurs dont
// la fenêtre de jeu n'est pas la première créée.
//
// Windows n'autorise SetForegroundWindow qu'au processus au premier plan ou à un
// processus qu'il a lancé : c'est le cas ici (RetroLib vient de recevoir le clic et
// lance PowerShell), d'où l'appel direct depuis le gestionnaire de lancement.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RetroLibFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public static bool Focus(uint target) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == target && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) {
        found = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return false;
    if (IsIconic(found)) ShowWindow(found, 9);
    if (SetForegroundWindow(found)) return true;
    // Refusé (RetroLib n'avait plus le premier plan) : on s'attache à la file d'entrée
    // du thread au premier plan, ce qui lève la restriction le temps de l'appel.
    uint dummy;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint self = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != self && AttachThreadInput(self, fgThread, true);
    BringWindowToTop(found);
    SetForegroundWindow(found);
    if (attached) AttachThreadInput(self, fgThread, false);
    return GetForegroundWindow() == found;
  }
}
"@
if ([RetroLibFocus]::Focus([uint32]$env:RETROLIB_FOCUS_PID)) { exit 0 } else { exit 1 }
`

export function focusProcessWindow(pid) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !pid) {
      resolve(false)
      return
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      {
        windowsHide: true,
        timeout: 10000,
        env: { ...process.env, RETROLIB_FOCUS_PID: String(pid) }
      },
      (error) => resolve(!error)
    )
  })
}
