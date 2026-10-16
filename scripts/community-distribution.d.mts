import type { GithubOptions } from "builder-util-runtime";
export declare const COMMUNITY_DISTRIBUTION: Readonly<{
  name: string;
  appId: string;
  executableName: string;
  tagPrefix: string;
  github: Readonly<{ owner: string; repo: string }>;
}>;
export declare function communityPublishOptions(): GithubOptions;
export declare function communityUpdateConfiguration(): GithubOptions & {
  updaterCacheDirName: string;
};
export declare function validateCommunityRelease(input: {
  version: string;
  tag?: string;
  repository?: string;
  publish?: boolean;
}): { version: string; tag: string; prerelease: boolean };
