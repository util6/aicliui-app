import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

const IGNORED_ENTRY_NAMES = new Set(['.git', 'node_modules', '.expo', '.next', 'dist', 'build']);
const MAX_WORKSPACE_TREE_DEPTH = 4;
const MAX_WORKSPACE_TREE_ENTRIES = 1000;
const MAX_TEXT_FILE_BYTES = 1024 * 1024 * 2;
const MAX_IMAGE_FILE_BYTES = 1024 * 1024 * 10;

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

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string bridge parameter');
  return value;
}
