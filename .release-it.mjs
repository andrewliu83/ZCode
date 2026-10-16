import {
  createReleaseChangelogWriterOpts,
  RELEASE_CHANGELOG_PARSER_OPTS,
  RELEASE_CHANGELOG_TYPES,
} from "./scripts/release-it/changelog-writer.mjs";

import { COMMUNITY_DISTRIBUTION } from "./scripts/community-distribution.mjs";

export default {
  git: {
    commitMessage: "chore: release Community ${version}",
    tagName: COMMUNITY_DISTRIBUTION.tagPrefix + "${version}",
    tagAnnotation: "ZCode Community ${version}",
    tagMatch: COMMUNITY_DISTRIBUTION.tagPrefix + "*",
    push: true,
  },
  github: {
    release: false,
  },
  gitlab: {
    release: false,
  },
  npm: {
    publish: false,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
        types: RELEASE_CHANGELOG_TYPES,
      },
      parserOpts: RELEASE_CHANGELOG_PARSER_OPTS,
      writerOpts: createReleaseChangelogWriterOpts(),
      infile: "CHANGELOG.md",
    },
  },
};
