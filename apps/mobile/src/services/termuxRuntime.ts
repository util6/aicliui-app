import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  runCommandAsync,
  type TermuxRunCommandOptions,
} from '@aicliui/termux';

export type ProbeState = 'unknown' | 'yes' | 'no';

export type TermuxRuntimeProbe = {
  nativeModule: 'available' | 'unavailable';
  termuxInstalled: ProbeState;
  runCommandPermission: ProbeState;
};

export async function probeTermuxRuntime(): Promise<TermuxRuntimeProbe> {
  try {
    const termuxInstalled = await isTermuxInstalledAsync();
    const runCommandPermission = termuxInstalled ? await hasRunCommandPermissionAsync() : false;
    return {
      nativeModule: 'available',
      termuxInstalled: termuxInstalled ? 'yes' : 'no',
      runCommandPermission: runCommandPermission ? 'yes' : 'no',
    };
  } catch {
    return {
      nativeModule: 'unavailable',
      termuxInstalled: 'unknown',
      runCommandPermission: 'unknown',
    };
  }
}

export async function openTermuxIfAvailable(): Promise<boolean> {
  try {
    return await openTermuxAppAsync();
  } catch {
    return false;
  }
}

export async function runTermuxCommand(options: TermuxRunCommandOptions): Promise<boolean> {
  return runCommandAsync(options);
}
