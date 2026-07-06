import { requireNativeModule } from 'expo-modules-core';

type AicliuiTermuxNativeModule = {
  isTermuxInstalledAsync(): Promise<boolean>;
  hasRunCommandPermissionAsync(): Promise<boolean>;
  openTermuxAppAsync(): Promise<boolean>;
  runCommandAsync(
    commandPath: string,
    args: string[],
    stdin: string | null,
    workdir: string | null,
    background: boolean,
    label: string | null,
  ): Promise<boolean>;
};

let nativeModule: AicliuiTermuxNativeModule | null = null;

export type TermuxRunCommandOptions = {
  commandPath: string;
  args?: string[];
  stdin?: string;
  workdir?: string;
  background?: boolean;
  label?: string;
};

export function isTermuxInstalledAsync(): Promise<boolean> {
  return getNativeModule().isTermuxInstalledAsync();
}

export function hasRunCommandPermissionAsync(): Promise<boolean> {
  return getNativeModule().hasRunCommandPermissionAsync();
}

export function openTermuxAppAsync(): Promise<boolean> {
  return getNativeModule().openTermuxAppAsync();
}

export function runCommandAsync(options: TermuxRunCommandOptions): Promise<boolean> {
  return getNativeModule().runCommandAsync(
    options.commandPath,
    options.args ?? [],
    options.stdin ?? null,
    options.workdir ?? null,
    options.background ?? true,
    options.label ?? null,
  );
}

function getNativeModule(): AicliuiTermuxNativeModule {
  nativeModule ??= requireNativeModule<AicliuiTermuxNativeModule>('AicliuiTermux');
  return nativeModule;
}
