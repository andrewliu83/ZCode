import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { collectNpmNotices, hashBytes } from "./third-party-npm.mjs";
import {
  noticesFileName,
  readNativeSearchNotices,
  repositoryRoot,
} from "./third-party-notices.mjs";

export async function generateThirdPartyNotices(root = repositoryRoot) {
  const inputs = {};
  const readInput = async (file) => {
    const bytes = await readFile(join(root, file));
    inputs[file] = hashBytes(bytes.toString("utf8").replaceAll("\r\n", "\n"));
    return bytes;
  };
  const readJson = async (file) => JSON.parse(await readInput(file));
  const overrides = await readJson("third-party/npm-overrides.json");
  const copied = await readJson("third-party/copied-components.json");
  const embedded = await readJson("third-party/embedded-components.json");
  const runtimes = await readJson("third-party/runtime/sources.json");
  const cuaDriver = await readJson("third-party/cua-driver/sources.json");
  for (const runtime of runtimes.node) {
    if (hashBytes(await readInput(runtime.file)) !== runtime.sha256)
      throw new Error(`Changed Node ${runtime.version} license`);
  }
  const pkg = await readJson("package.json");
  await readInput("pnpm-lock.yaml");
  await readInput("pnpm-workspace.yaml");
  await readInput("third-party/native-search/sources.json");
  const { packages, notInstalled, workspaceManifests } = await collectNpmNotices(root, overrides);
  // 修复：递归扫描会把 bundled-agents/mock-cdn 的可删除缓存当作源码输入，重建立即失效。
  // workspace 边界由 pnpm 解析，同一份项目集合用于依赖图和 manifest 新鲜度检查。
  for (const file of workspaceManifests) await readInput(file);
  const currentPackages = new Set(
    [...packages, ...notInstalled].map((item) => `${item.name}@${item.version}`),
  );
  for (const item of overrides) {
    if (!currentPackages.has(item.package))
      throw new Error(`Stale npm notice override: ${item.package}`);
  }
  const textRecords = new Map();
  function addText(bytes, owner, origin) {
    const sha256 = hashBytes(bytes);
    const record = textRecords.get(sha256) ?? { bytes, references: [] };
    record.references.push({ owner, origin });
    textRecords.set(sha256, record);
    return sha256;
  }
  for (const record of overrides) if (record.file) await readInput(record.file);
  const packageInventory = packages.map(({ notices, ...item }) => ({
    ...item,
    notices: notices.map(({ member, bytes }) => ({
      member,
      sha256: addText(bytes, `${item.name}@${item.version}`, member),
    })),
  }));
  // 修复：Driver 原生归档不属于 npm 扫描范围，按固定来源清单核验并保留原始许可和归属。
  for (const notice of cuaDriver.notices) {
    const file = `third-party/upstream/${notice.sha256}.txt`;
    const bytes = await readInput(file);
    if (hashBytes(bytes) !== notice.sha256)
      throw new Error(`Changed Cua Driver notice: ${notice.member}`);
    addText(bytes, `Cua Driver ${cuaDriver.version} (${notice.member})`, notice.source);
  }
  if (packages.some((item) => item.license === "MPL-2.0")) {
    // 上游 UBJS LICENSE 是 MPL 授权头，原文之外还须提供完整条款及对应版本源码入口。
    const sha256 = "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04";
    const bytes = await readInput(`third-party/upstream/${sha256}.txt`);
    if (hashBytes(bytes) !== sha256) throw new Error("Changed MPL-2.0 license terms");
    addText(bytes, "MPL-2.0 licensed components", "https://www.mozilla.org/media/MPL/2.0/index.txt");
  }
  async function copiedFiles(file, files) {
    if ((await stat(join(root, file))).isDirectory()) {
      for (const child of (await readdir(join(root, file))).sort())
        await copiedFiles(`${file}/${child}`, files);
    } else {
      const bytes = await readInput(file);
      files.push({ file, sha256: hashBytes(bytes) });
    }
  }
  const copiedInventory = [];
  for (const record of copied) {
    if (record.file) {
      const bytes = await readInput(record.file);
      if (hashBytes(bytes) !== record.sha256)
        throw new Error(`Changed copied-source license: ${record.id}`);
      addText(bytes, record.id, record.source);
    } else if (!record.reviewRequired) {
      throw new Error(`Missing copied-source license or review: ${record.id}`);
    }
    const files = [];
    for (const file of record.roots) await copiedFiles(file, files);
    for (const file of record.modifiedFiles ?? []) {
      // 修复：集中 NOTICE 不能替代 Apache 4(b) 的文件内修改声明，重新生成时也不能抹掉这一义务。
      if (!files.some((entry) => entry.file === file))
        throw new Error(`Modified source outside copied roots: ${file}`);
      if (!(await readFile(join(root, file), "utf8")).includes("Modified by ZCode:"))
        throw new Error(`Missing file-local modification notice: ${file}`);
    }
    copiedInventory.push({ ...record, files });
  }
  for (const component of embedded) {
    if (!packages.some((item) => `${item.name}@${item.version}` === component.parentPackage))
      throw new Error(`Stale embedded component: ${component.parentPackage}`);
    for (const evidence of component.buildEvidence ?? []) {
      if (hashBytes(await readInput(evidence.file)) !== evidence.sha256)
        throw new Error(`Changed embedded build provenance: ${component.id}`);
    }
    for (const notice of component.notices) {
      const bytes = await readInput(notice.file);
      if (hashBytes(bytes) !== notice.sha256)
        throw new Error(`Changed embedded notice: ${component.id}`);
      addText(
        bytes,
        `${notice.component ?? component.id} (inside ${component.parentPackage})`,
        notice.source,
      );
    }
  }
  // 上游 AI Elements 的 LICENSE 是短版授权头，还需随包提供 Apache 2.0 全文。
  addText(
    await readInput("scripts/license-texts/Apache-2.0.txt"),
    "Apache-2.0 licensed components",
    "Apache License, Version 2.0",
  );
  const patches = [];
  for (const [name, file] of Object.entries(pkg.pnpm?.patchedDependencies ?? {})) {
    patches.push({ package: name, file, sha256: hashBytes(await readInput(file)) });
  }
  const native = await readNativeSearchNotices(root, { verify: true });
  for (const file of Object.keys(native.inventory.inputs)) await readInput(file);
  for (const component of native.inventory.components) {
    for (const notice of component.notices) await readInput(notice.file);
  }
  const sections = [
    "# Third-party notices",
    "Generated by `node scripts/licenses.mjs notices` from the current workspace production dependency graph, copied source/assets and native tools. This is a conservative union across distributions; not every listed component is included on every platform. Versions, source references and hashes are recorded in `third-party/inventory.json`, `third-party/native-search/sources.json` and `third-party/cua-driver/sources.json` in the source repository.",
    "Original copyright, license and NOTICE text is retained below. Identical text is shared by the components listed above it. Package metadata license identifiers are descriptive; they do not replace the original terms. Copyright holders are never inferred from npm author fields.",
    "## npm packages",
    ...packageInventory.map(
      (item) =>
        `- ${item.name}@${item.version} — ${typeof item.license === "string" ? item.license : JSON.stringify(item.license)}${item.acceptedMissingNotice ? `; ${item.acceptedMissingNotice}` : ""}`,
    ),
    "## MPL-2.0 source code",
    "The following components are covered by MPL-2.0. Their Source Code Form is available at these exact upstream revisions; the original upstream license notices and the full MPL-2.0 terms are included below:",
    ...overrides
      .filter((item) => item.sourceCode)
      .map((item) => `- ${item.package}: ${item.sourceCode}`),
    "## Source evidence limitations",
    "Some publishers provide only a license identifier or a short README license section instead of a complete LICENSE file. For the following packages the supplied material explicitly identifies publisher metadata and standard terms; it is not represented as an original upstream LICENSE file. Any available README copyright notice is retained:",
    ...overrides
      .filter((item) => item.evidenceKind)
      .map((item) => `- ${item.package}: ${item.source}`),
    "The original import revisions of copied components are not recorded in the current checkout. Pinned license references below do not establish the original copy revision. They cover upstream-derived portions only; local adaptations do not change the upstream terms.",
    "## Copied source and assets",
    ...copied.map(
      (item) =>
        `- ${item.id} (${item.license ?? "not established"}): ${item.roots.join(", ")}. License reference: ${item.source ?? "not established"}. Original import revision: ${item.importRevision ?? "not recorded"}.${item.reviewRequired ? ` Review required: ${item.reviewRequired}` : ""}`,
    ),
    "Fig autocomplete source carries the repository's MIT license; the generated registry records npm @withfig/autocomplete@2.692.3 metadata as ISC. The original source MIT notice is retained below.",
    "## Embedded native and WASM components",
    ...embedded.map(
      (item) =>
        `- ${item.id} inside ${item.parentPackage}; upstream revision ${item.revision}; source: ${item.source}. ${item.reviewRequired ?? ""}`,
    ),
    "## Cua Driver native runtime",
    `- Cua Driver ${cuaDriver.version}; upstream revision ${cuaDriver.commit}; source: ${cuaDriver.repository}/tree/${cuaDriver.commit}. Original LICENSE and THIRD_PARTY_NOTICES.md from the verified release archive are retained below and accompany the bundled runtime.`,
    `The compatibility build cua_driver_node_runtime.node derives from the MPL-2.0 UBJS runtime listed above. Its original node-runtime-NOTICE.md is retained below. The corresponding source transformations and pinned input dependency are available at ${cuaDriver.repository}/tree/${cuaDriver.commit}/libs/cua-driver/scripts/build-node-runtime.mjs and ${cuaDriver.repository}/tree/${cuaDriver.commit}/libs/cua-driver/package.json.`,
    "Electron/Chromium target-specific notices are shipped separately under Resources/licenses/electron. Distributions containing an independent Node runtime also include its exact-version LICENSE.node.txt; SEA includes that text in --licenses output.",
    "## Modified npm packages",
    ...patches.map(
      (item) =>
        `- ${item.package}: modified by ZCode; the changes are recorded in ${item.file} in the source repository.`,
    ),
    "## License and NOTICE texts",
  ];
  for (const [sha256, record] of textRecords) {
    sections.push(
      `### Notice ${sha256}`,
      ...record.references.map(({ owner, origin }) => `- ${owner}: ${origin}`),
      "",
      "````text\n" + record.bytes.toString("utf8") + "\n````",
    );
  }
  sections.push("## Native search tools", "````text\n" + native.bytes.toString("utf8") + "\n````");
  const bytes = Buffer.from(`${sections.join("\n\n")}\n`);
  const inventory = {
    schemaVersion: 1,
    inputHashEncoding:
      "UTF-8 with CRLF normalized to LF; notice and source snapshot hashes remain byte-exact",
    scope:
      "Production dependency union across current workspace projects, copied source/assets and native tools; not a per-installer SBOM or a certification of all licensing obligations.",
    noticesSha256: hashBytes(bytes),
    inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b, "en"))),
    packages: packageInventory,
    notInstalled,
    copied: copiedInventory,
    patches,
    exceptions: overrides.filter((item) => item.acceptedMissingNotice || item.evidenceKind),
    embedded,
    runtimes,
    cuaDriver,
    sourceCode: overrides
      .filter((item) => item.sourceCode)
      .map(({ package: name, sourceCode: source, referenceRevision }) => ({
        package: name,
        source,
        referenceRevision,
      })),
    reviewRequired: [
      // 修复：复制源码的缺口此前只写在 README，重生成清单后严格门禁也无法阻断。
      ...copied
        .filter((item) => item.reviewRequired)
        .map((item) => ({ id: item.id, reason: item.reviewRequired })),
      ...overrides
        .filter((item) => item.acceptedMissingNotice || item.evidenceKind)
        .map((item) => ({
          id: item.package,
          reason:
            "Original version-specific publisher copyright/license material remains incomplete.",
        })),
      ...embedded
        .filter((item) => item.reviewRequired)
        .map((item) => ({ id: item.id, reason: item.reviewRequired })),
      ...native.inventory.components
        .filter((item) => !item.notices.length)
        .map((item) => ({
          id: `${item.id}@${item.version}`,
          reason: "No original notice snapshot for this recorded native component.",
        })),
    ],
  };
  await writeFile(join(root, noticesFileName), bytes);
  await writeFile(
    join(root, "third-party/inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  console.log(
    `${relative(root, join(root, noticesFileName))}: ${packages.length} package versions, ${copied.length} copied components, ${native.inventory.archives.length} native archives, ${bytes.length} bytes`,
  );
}
