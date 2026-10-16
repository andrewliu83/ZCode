import { readFile } from "node:fs/promises";
import { validateCommunityRelease, COMMUNITY_DISTRIBUTION } from "./community-distribution.mjs";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const publish = process.env.GITHUB_EVENT_NAME === "push";
const tag = publish ? process.env.GITHUB_REF_NAME : `${COMMUNITY_DISTRIBUTION.tagPrefix}${version}`;
const result = validateCommunityRelease({
  version,
  tag,
  repository: process.env.GITHUB_REPOSITORY,
  publish,
});
console.log(JSON.stringify(result));
