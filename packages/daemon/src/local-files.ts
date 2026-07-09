import type { Dirent } from 'node:fs';
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  WorkspaceFileChange,
  WorkspaceFileChangeOperation,
  WorkspaceFileChangeSummary,
  WorkspaceFileDiff,
  WorkspaceFileDiffSource,
} from '@aicliui/shared';

const IGNORED_ENTRY_NAMES = new Set(['.git', 'node_modules', '.expo', '.next', 'dist', 'build']);
const MAX_WORKSPACE_TREE_DEPTH = 4;
const MAX_WORKSPACE_TREE_ENTRIES = 1000;
const MAX_TEXT_FILE_BYTES = 1024 * 1024 * 2;
const MAX_IMAGE_FILE_BYTES = 1024 * 1024 * 10;
const execFileAsync = promisify(execFile);

export type DirOrFileNode = {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  children?: DirOrFileNode[];
};

export async function getWorkspaceTree(params: Record<string, unknown>): Promise<DirOrFileNode[]> {
  const workspace = resolveLocalPath(requiredString(params.workspace ?? params.path));
  const targetPath = resolveLocalPath(typeof params.path === 'string' ? params.path : workspace);
  const search = typeof params.search === 'string' ? params.search.trim() : '';
  const target = ensurePathInsideRoot(targetPath, workspace);
  const rootNode = await readDirectoryNode(target, workspace, 0, search, { count: 0 });
  return rootNode ? [rootNode] : [];
}

export async function getFileTreeByDir(params: Record<string, unknown>): Promise<DirOrFileNode[]> {
  const root = resolveLocalPath(requiredString(params.root ?? params.dir));
  const dir = ensurePathInsideRoot(resolveLocalPath(requiredString(params.dir)), root);
  const rootNode = await readDirectoryNode(dir, root, 0, '', { count: 0 });
  return rootNode ? [rootNode] : [];
}

export async function readTextFile(path: string): Promise<string> {
  const filePath = resolveLocalPath(path);
  const fileStats = await lstat(filePath);
  if (!fileStats.isFile()) throw new Error(`Path is not a file: ${filePath}`);
  if (fileStats.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`File is too large to preview: ${filePath}`);
  }
  return await readFile(filePath, 'utf8');
}

export async function readImageBase64(path: string): Promise<string> {
  const filePath = resolveLocalPath(path);
  const fileStats = await lstat(filePath);
  if (!fileStats.isFile()) throw new Error(`Path is not a file: ${filePath}`);
  if (fileStats.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`Image file is too large to preview: ${filePath}`);
  }
  const buffer = await readFile(filePath);
  return `data:${imageMimeType(filePath)};base64,${buffer.toString('base64')}`;
}

export async function removeWorkspaceEntry(params: Record<string, unknown>): Promise<{ success: true }> {
  const workspace = resolveLocalPath(requiredString(params.workspace));
  const rawPath =
    typeof params.path === 'string'
      ? params.path
      : typeof params.file_path === 'string'
        ? params.file_path
        : join(workspace, requiredString(params.relativePath));
  const targetPath = ensurePathInsideRoot(resolveLocalPath(rawPath), workspace);
  if (targetPath === workspace) {
    throw new Error('Refusing to remove the workspace root');
  }
  await rm(targetPath, { recursive: true, force: true });
  return { success: true };
}

export async function compareWorkspaceChanges(params: Record<string, unknown>): Promise<WorkspaceFileChangeSummary> {
  const workspace = resolveLocalPath(requiredString(params.workspace));
  const root = ensurePathInsideRoot(workspace, workspace);
  if (!(await isGitWorkspace(root))) {
    return { mode: 'snapshot', branch: null, staged: [], unstaged: [] };
  }

  const branch = await readGitBranch(root);
  const status = await readGitStatus(root);
  const stagedStats = await readGitNumstat(root, ['diff', '--cached', '--numstat']);
  const unstagedStats = await readGitNumstat(root, ['diff', '--numstat']);
  const staged = new Map<string, WorkspaceFileChange>();
  const unstaged = new Map<string, WorkspaceFileChange>();

  for (const item of status) {
    if (item.indexStatus && item.indexStatus !== '?') {
      staged.set(
        item.path,
        buildWorkspaceFileChange(root, item.path, operationFromGitStatus(item.indexStatus), stagedStats.get(item.path)),
      );
    }
    if (item.worktreeStatus) {
      const stats =
        item.worktreeStatus === '?' ? await readUntrackedStats(root, item.path) : unstagedStats.get(item.path);
      unstaged.set(
        item.path,
        buildWorkspaceFileChange(root, item.path, operationFromGitStatus(item.worktreeStatus), stats),
      );
    }
  }

  return {
    mode: 'git-repo',
    branch,
    staged: [...staged.values()].sort(compareFileChanges),
    unstaged: [...unstaged.values()].sort(compareFileChanges),
  };
}

export async function readWorkspaceFileDiff(params: Record<string, unknown>): Promise<WorkspaceFileDiff> {
  const { workspace, relativePath } = workspaceChangePathParams(params);
  const source: WorkspaceFileDiffSource = params.source === 'staged' ? 'staged' : 'unstaged';
  const filePath = ensurePathInsideRoot(resolve(join(workspace, relativePath)), workspace);

  if (!(await isGitWorkspace(workspace))) {
    return { relativePath, source, diff: '' };
  }

  const status = await readGitStatus(workspace);
  const statusItem = status.find((item) => item.path === relativePath);
  const diff =
    source === 'staged'
      ? await readGitDiff(workspace, ['diff', '--cached', '--', relativePath])
      : statusItem?.worktreeStatus === '?'
        ? await readGitDiff(workspace, ['diff', '--no-index', '--', '/dev/null', filePath], true)
        : await readGitDiff(workspace, ['diff', '--', relativePath]);

  return { relativePath, source, diff };
}

export async function stageWorkspaceFile(params: Record<string, unknown>): Promise<void> {
  const { workspace, relativePath } = workspaceChangePathParams(params);
  if (!(await isGitWorkspace(workspace))) return;
  await runGit(workspace, ['add', '--', relativePath]);
}

export async function stageWorkspace(params: Record<string, unknown>): Promise<void> {
  const workspace = resolveLocalPath(requiredString(params.workspace));
  if (!(await isGitWorkspace(workspace))) return;
  await runGit(workspace, ['add', '--all', '--', '.']);
}

export async function unstageWorkspaceFile(params: Record<string, unknown>): Promise<void> {
  const { workspace, relativePath } = workspaceChangePathParams(params);
  if (!(await isGitWorkspace(workspace))) return;
  await runGit(workspace, ['restore', '--staged', '--', relativePath]);
}

export async function unstageWorkspace(params: Record<string, unknown>): Promise<void> {
  const workspace = resolveLocalPath(requiredString(params.workspace));
  if (!(await isGitWorkspace(workspace))) return;
  await runGit(workspace, ['restore', '--staged', '--', '.']);
}

export async function discardWorkspaceFile(params: Record<string, unknown>): Promise<void> {
  const { workspace, relativePath } = workspaceChangePathParams(params);
  const operation = params.operation === 'create' ? 'create' : params.operation === 'delete' ? 'delete' : 'modify';
  if (!(await isGitWorkspace(workspace))) return;

  if (operation === 'create') {
    await rm(ensurePathInsideRoot(resolve(join(workspace, relativePath)), workspace), { recursive: true, force: true });
    return;
  }

  await runGit(workspace, ['restore', '--', relativePath]);
}

async function readDirectoryNode(
  targetPath: string,
  rootPath: string,
  depth: number,
  search: string,
  counter: { count: number },
): Promise<DirOrFileNode | null> {
  if (counter.count >= MAX_WORKSPACE_TREE_ENTRIES) return null;

  let fileStats;
  try {
    fileStats = await lstat(targetPath);
  } catch {
    return null;
  }
  if (!fileStats.isDirectory() && !fileStats.isFile()) return null;

  counter.count += 1;
  const node: DirOrFileNode = {
    name: basename(targetPath) || targetPath,
    fullPath: targetPath,
    relativePath: normalizeRelativePath(relative(rootPath, targetPath)),
    isDir: fileStats.isDirectory(),
    isFile: fileStats.isFile(),
  };

  if (fileStats.isFile()) {
    return matchesSearch(node, search) ? node : search ? null : node;
  }

  const children: DirOrFileNode[] = [];
  if (depth < MAX_WORKSPACE_TREE_DEPTH) {
    let entries: Dirent[] = [];
    try {
      entries = await readdir(targetPath, { withFileTypes: true });
    } catch {
      entries = [];
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (IGNORED_ENTRY_NAMES.has(entry.name)) continue;
      if (counter.count >= MAX_WORKSPACE_TREE_ENTRIES) break;
      const child = await readDirectoryNode(join(targetPath, entry.name), rootPath, depth + 1, search, counter);
      if (child) children.push(child);
    }
  }

  if (children.length > 0) node.children = children;
  if (!search || matchesSearch(node, search) || children.length > 0) return node;
  return null;
}

function matchesSearch(node: DirOrFileNode, search: string): boolean {
  if (!search) return true;
  const lower = search.toLowerCase();
  return node.name.toLowerCase().includes(lower) || node.relativePath.toLowerCase().includes(lower);
}

function normalizeRelativePath(path: string): string {
  return path === '' ? '' : path.split('\\').join('/');
}

function workspaceChangePathParams(params: Record<string, unknown>): { workspace: string; relativePath: string } {
  const workspace = resolveLocalPath(requiredString(params.workspace));
  const relativePath = normalizeRelativePath(
    typeof params.relativePath === 'string'
      ? params.relativePath
      : relative(workspace, resolveLocalPath(requiredString(params.file_path))),
  );
  ensurePathInsideRoot(resolve(join(workspace, relativePath)), workspace);
  return { workspace, relativePath };
}

function resolveLocalPath(path: string): string {
  if (!path.trim()) throw new Error('Expected non-empty path');
  if (path.includes('\0')) throw new Error('Path contains a null byte');
  return resolve(path.replace(/^~(?=\/|$)/, process.env.HOME || '.'));
}

function ensurePathInsideRoot(path: string, root: string): string {
  const rel = relative(root, path);
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return path;
  throw new Error(`Path is outside the workspace: ${path}`);
}

function imageMimeType(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'avif') return 'image/avif';
  return 'image/png';
}

type GitStatusItem = {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
};

type ChangeStats = {
  additions: number;
  deletions: number;
};

async function isGitWorkspace(workspace: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(workspace, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function readGitBranch(workspace: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

async function readGitStatus(workspace: string): Promise<GitStatusItem[]> {
  const { stdout } = await runGit(workspace, ['status', '--porcelain=v1']);
  return stdout
    .split(/\r?\n/)
    .map((line) => parseGitStatusLine(line))
    .filter((item): item is GitStatusItem => Boolean(item));
}

function parseGitStatusLine(line: string): GitStatusItem | null {
  if (line.length < 4) return null;
  const indexStatus = line[0] === ' ' ? '' : line[0];
  const worktreeStatus = line[1] === ' ' ? '' : line[1];
  const rawPath = line.slice(3);
  const path = normalizeGitStatusPath(rawPath);
  if (!path) return null;
  if (indexStatus === '?' && worktreeStatus === '?') {
    return { indexStatus: '', worktreeStatus: '?', path };
  }
  return { indexStatus, worktreeStatus, path };
}

function normalizeGitStatusPath(path: string): string {
  const renamedPath = path.includes(' -> ') ? path.split(' -> ').pop() ?? path : path;
  return normalizeRelativePath(renamedPath.replace(/^"|"$/g, ''));
}

async function readGitNumstat(workspace: string, args: string[]): Promise<Map<string, ChangeStats>> {
  const { stdout } = await runGit(workspace, args);
  const result = new Map<string, ChangeStats>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [additions, deletions, ...pathParts] = line.split('\t');
    const path = normalizeRelativePath(pathParts.join('\t'));
    if (!path) continue;
    result.set(path, {
      additions: parseGitStatNumber(additions),
      deletions: parseGitStatNumber(deletions),
    });
  }
  return result;
}

function parseGitStatNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function readUntrackedStats(workspace: string, relativePath: string): Promise<ChangeStats> {
  const filePath = ensurePathInsideRoot(resolve(join(workspace, relativePath)), workspace);
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) return { additions: 0, deletions: 0 };
    const content = await readFile(filePath, 'utf8');
    return { additions: countTextLines(content), deletions: 0 };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

function countTextLines(content: string): number {
  if (!content) return 0;
  const lines = content.split(/\r\n|\r|\n/);
  return content.endsWith('\n') || content.endsWith('\r') ? lines.length - 1 : lines.length;
}

function operationFromGitStatus(status: string): WorkspaceFileChangeOperation {
  if (status === 'A' || status === '?' || status === 'R' || status === 'C') return 'create';
  if (status === 'D') return 'delete';
  return 'modify';
}

function buildWorkspaceFileChange(
  workspace: string,
  relativePath: string,
  operation: WorkspaceFileChangeOperation,
  stats: ChangeStats = { additions: 0, deletions: 0 },
): WorkspaceFileChange {
  const normalizedPath = normalizeRelativePath(relativePath);
  return {
    file_path: ensurePathInsideRoot(resolve(join(workspace, normalizedPath)), workspace),
    relativePath: normalizedPath,
    operation,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

function compareFileChanges(left: WorkspaceFileChange, right: WorkspaceFileChange): number {
  return left.relativePath.localeCompare(right.relativePath);
}

async function runGit(workspace: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 4,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

async function readGitDiff(workspace: string, args: string[], allowExitOne = false): Promise<string> {
  try {
    const { stdout } = await runGit(workspace, args);
    return stdout;
  } catch (error) {
    if (allowExitOne && isRecord(error) && error.code === 1 && typeof error.stdout === 'string') {
      return error.stdout;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string bridge parameter');
  return value;
}
