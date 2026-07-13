import { requireNativeModule } from 'expo-modules-core';

export type NativeRuntimeState =
  | 'unavailable'
  | 'stopped'
  | 'preparing'
  | 'starting'
  | 'running'
  | 'error';

export type NativeRuntimeStatus = {
  state: NativeRuntimeState;
  supported: boolean;
  port: number;
  pid?: number;
  version?: string;
  detail?: string;
};

type AicliuiRuntimeNativeModule = {
  getStatusAsync(): Promise<NativeRuntimeStatus>;
  prepareAsync(): Promise<NativeRuntimeStatus>;
  startAsync(port: number): Promise<NativeRuntimeStatus>;
  stopAsync(): Promise<NativeRuntimeStatus>;
  getLogPathAsync(): Promise<string>;
};

let nativeModule: AicliuiRuntimeNativeModule | null = null;

export function getStatusAsync(): Promise<NativeRuntimeStatus> {
  return getNativeModule().getStatusAsync();
}

export function prepareAsync(): Promise<NativeRuntimeStatus> {
  return getNativeModule().prepareAsync();
}

export function startAsync(port: number): Promise<NativeRuntimeStatus> {
  return getNativeModule().startAsync(port);
}

export function stopAsync(): Promise<NativeRuntimeStatus> {
  return getNativeModule().stopAsync();
}

export function getLogPathAsync(): Promise<string> {
  return getNativeModule().getLogPathAsync();
}

function getNativeModule(): AicliuiRuntimeNativeModule {
  nativeModule ??= requireNativeModule<AicliuiRuntimeNativeModule>('AicliuiRuntime');
  return nativeModule;
}
