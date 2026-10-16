import distribution from "../config/community-distribution.json" with { type: "json" };

/** 分支身份只有这一份事实，构建和更新源必须同时读取它。 */
export const COMMUNITY_DISTRIBUTION = Object.freeze({
  ...distribution,
  github: Object.freeze(distribution.github),
});

/** @returns {import("builder-util-runtime").GithubOptions} */
export function communityPublishOptions() {
  return {
    provider: "github",
    ...COMMUNITY_DISTRIBUTION.github,
    tagNamePrefix: COMMUNITY_DISTRIBUTION.tagPrefix,
    channel: "latest",
    releaseType: "release",
  };
}

/** 必须在签名前写入 .app；--dir 不会由 electron-builder 自动生成这份配置。 */
export function communityUpdateConfiguration() {
  return {
    ...communityPublishOptions(),
    updaterCacheDirName: `${COMMUNITY_DISTRIBUTION.executableName}-updater`,
  };
}

export function validateCommunityRelease({ version, tag, repository, publish = false }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Community version must be a semantic version");
  }
  if (publish && repository !== `${distribution.github.owner}/${distribution.github.repo}`) {
    throw new Error("Community releases must be published from the configured repository");
  }
  if (tag !== `${distribution.tagPrefix}${version}`) {
    throw new Error(`Release tag must be ${distribution.tagPrefix}${version}`);
  }
  return { version, tag, prerelease: version.includes("-") };
}
