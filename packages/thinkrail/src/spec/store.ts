// 派生只读索引 —— 移植自 JetBrains/thinkrail 的
// packages/spec-graph/core/store.ts（MIT）。
//
// 文件系统是唯一事实来源；这里的模型是**派生、内存、只读、按需重校验**的：
// 每次读都重跑一遍 glob（名字排序、忽略 node_modules/.git/dist/build），
// 按 (mtimeMs, size) 重校验每个文件——没变的复用缓存解析，变了/新增的重新解析，
// 消失的逐出；只有 spec 集合真的变了才重建图。

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep, win32 } from "node:path";
import { buildGraph, type SpecGraph } from "./graph.js";
import { FIELDS, isSpec, parseFile, scalar, type SpecFrontmatter } from "./parse.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

export const SPEC_FILE_EXTENSION = ".md";

export interface PathSemantics {
  readonly isAbsolute: (path: string) => boolean;
  readonly relative: (from: string, to: string) => string;
  readonly sep: string;
}

const NATIVE_PATH_SEMANTICS: PathSemantics = { isAbsolute, relative, sep };

export function hasWindowsNamespaceSyntax(path: string): boolean {
  return win32.parse(path).root !== "" || path.includes(":");
}

export function isPathInsideRoot(
  root: string,
  target: string,
  paths: PathSemantics = NATIVE_PATH_SEMANTICS,
): boolean {
  const rel = paths.relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel);
}

export interface WalkEntry {
  readonly name: string;
  /** 排序键：NFC 归一化的名字。 */
  readonly key: string;
  readonly directory: boolean;
}

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function resolves(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function directoryEntries(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

function fold(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

function isIgnoredName(name: string): boolean {
  return IGNORED_DIRS.has(fold(name));
}

export type SegmentResolution = { readonly name: string } | { readonly error: string };

/**
 * 把路径里的一个片段解析成目录里真实存在的那个名字。
 *
 * 大小写/Unicode 折叠只在「该片段当前确实存在但字面不匹配」时启用；
 * 命中多个条目时报错，而不是猜一个。
 */
export function resolvePathSegment(
  entries: readonly string[],
  segment: string,
  exists: boolean,
): SegmentResolution {
  let name = segment;
  if (exists && !entries.includes(segment)) {
    const folded = fold(segment);
    const [only, ...rest] = entries.filter((entry) => fold(entry) === folded);
    if (only === undefined) {
      return {
        error: `Path component "${segment}" resolves to no entry its parent directory lists`,
      };
    }
    if (rest.length > 0) {
      return {
        error: `Path component "${segment}" matches more than one entry on this filesystem ("${only}", "${rest.join('", "')}")`,
      };
    }
    name = only;
  }
  if (isIgnoredName(name)) {
    return { error: `Path is inside an ignored directory ("${name}") and would not be indexed` };
  }
  return { name };
}

export type SpecPathResolution =
  | { readonly rel: string; readonly abs: string }
  | { readonly error: string };

/**
 * 校验一个 root 相对的 spec 路径能否被索引看见，并解析成规范相对路径 / 绝对路径。
 *
 * 拒绝：空路径、绝对路径、非 `.md`、含 `..`、穿过符号链接、穿过被忽略目录、
 * 穿过一个列不出来的目录、Windows 盘符/流语法。
 */
export function resolveSpecPath(root: string, path: string): SpecPathResolution {
  if (path.trim() === "") return { error: "Path must not be empty." };
  if (isAbsolute(path)) return { error: `Path must be root-relative, not absolute: ${path}` };
  if (process.platform === "win32" && hasWindowsNamespaceSyntax(path)) {
    return { error: `Path must not use Windows drive or stream syntax: ${path}` };
  }
  if (!path.endsWith(SPEC_FILE_EXTENSION)) {
    return { error: `Spec files must end in ${SPEC_FILE_EXTENSION}: ${path}` };
  }

  const segments = normalize(path).split(sep);
  if (segments.includes("..")) {
    return { error: `Path must stay inside the project root: ${path}` };
  }
  if (!existsSync(root)) return { error: `Project root does not exist: ${root}` };

  let walked = root;
  let walkedExists: boolean = true;
  const canonical: string[] = [];
  for (const segment of segments) {
    let entries: readonly string[] = [];
    if (walkedExists) {
      const listed = directoryEntries(walked);
      if (listed === null) {
        return {
          error: `Path passes through a directory the index cannot list: ${path}`,
        };
      }
      entries = listed;
    }
    const exists: boolean = walkedExists && resolves(join(walked, segment));
    const resolution = resolvePathSegment(entries, segment, exists);
    if ("error" in resolution) return { error: `${resolution.error}: ${path}` };
    walked = join(walked, resolution.name);
    if (isSymlink(walked)) {
      return { error: `Path passes through a symlink, which the index never follows: ${path}` };
    }
    canonical.push(resolution.name);
    walkedExists = exists;
  }

  const rel = canonical.join("/");
  if (!rel.endsWith(SPEC_FILE_EXTENSION)) {
    return { error: `Spec files must end in ${SPEC_FILE_EXTENSION}: ${path}` };
  }
  if (!isPathInsideRoot(root, walked)) {
    return { error: `Path must stay inside the project root: ${path}` };
  }
  return { rel, abs: walked };
}

export function toWalkEntry(name: string, directory: boolean): WalkEntry {
  return { name, key: name.normalize("NFC"), directory };
}

export function compareWalkEntries(a: WalkEntry, b: WalkEntry): number {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

interface IndexCacheEntry {
  readonly rel: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly content: string;
  readonly frontmatter: SpecFrontmatter | null;
}

export interface SpecRecord {
  readonly abs: string;
  readonly rel: string;
  readonly content: string;
  readonly frontmatter: SpecFrontmatter;
}

/** 一个 root 的 spec 索引；同一个 root 复用同一实例，缓存才有意义。 */
export class SpecIndex {
  readonly root: string;
  private readonly cache = new Map<string, IndexCacheEntry>();
  private graphCache: SpecGraph | null = null;

  constructor(root: string) {
    this.root = root;
  }

  absPath(rel: string): string {
    return join(this.root, rel);
  }

  *walk(dir: string): Generator<string> {
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const candidates: WalkEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRS.has(dirent.name)) candidates.push(toWalkEntry(dirent.name, true));
      } else if (dirent.isFile() && dirent.name.endsWith(SPEC_FILE_EXTENSION)) {
        candidates.push(toWalkEntry(dirent.name, false));
      }
    }
    candidates.sort(compareWalkEntries);
    for (const candidate of candidates) {
      const abs = join(dir, candidate.name);
      if (candidate.directory) yield* this.walk(abs);
      else yield abs;
    }
  }

  scan(): SpecRecord[] {
    const seen = new Set<string>();
    const specs: SpecRecord[] = [];
    let changed = false;

    for (const abs of this.walk(this.root)) {
      seen.add(abs);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      let entry = this.cache.get(abs);
      if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        let content: string;
        try {
          content = readFileSync(abs, "utf8");
        } catch {
          if (this.cache.delete(abs)) changed = true;
          continue;
        }
        const { frontmatter } = parseFile(content);
        entry = {
          rel: toRel(this.root, abs),
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          content: isSpec(frontmatter) ? content : "",
          frontmatter,
        };
        this.cache.set(abs, entry);
        changed = true;
      }
      const fm = entry.frontmatter;
      if (isSpec(fm)) {
        specs.push({ abs, rel: entry.rel, content: entry.content, frontmatter: fm });
      }
    }

    // 边遍历边删除，必须先快照键集：直接迭代 Map 的键会在删除后跳过相邻条目。
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const abs of [...this.cache.keys()]) {
      if (!seen.has(abs)) {
        this.cache.delete(abs);
        changed = true;
      }
    }

    if (changed) this.graphCache = null;
    return specs;
  }

  graph(): SpecGraph {
    const specs = this.scan();
    if (this.graphCache === null) {
      this.graphCache = buildGraph(specs.map((r) => ({ path: r.rel, frontmatter: r.frontmatter })));
    }
    return this.graphCache;
  }

  contentEntries(): { path: string; content: string; frontmatter: SpecFrontmatter }[] {
    return this.scan().map((r) => ({
      path: r.rel,
      content: r.content,
      frontmatter: r.frontmatter,
    }));
  }

  recordForId(id: string): SpecRecord | undefined {
    return this.scan().find((r) => scalar(r.frontmatter, FIELDS.id) === id);
  }

  pathForId(id: string): string | undefined {
    return this.recordForId(id)?.rel;
  }
}
