# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.14-alpine
FROM ${NODE_IMAGE}

ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ARG MBEARS_NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ARG INSTALL_CA_CERTIFICATES=false
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}

WORKDIR /repo

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN if [ "${INSTALL_CA_CERTIFICATES}" = "true" ]; then \
    if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache ca-certificates; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && \
      apt-get install -y --no-install-recommends ca-certificates && \
      rm -rf /var/lib/apt/lists/*; \
    fi; \
  fi
RUN corepack enable

# 构建上下文必须为仓库根目录；CLI 复用唯一根锁，不能恢复旧嵌套锁。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY apps/zcode-cli apps/zcode-cli
COPY packages/shared packages/shared
COPY packages/model-option-map packages/model-option-map
COPY packages/provider packages/provider
COPY packages/provider-node packages/provider-node
COPY packages/zcode-cua packages/zcode-cua
COPY packages/formal-proof packages/formal-proof
COPY packages/thinkrail packages/thinkrail
COPY config/provider config/provider
COPY scripts scripts

RUN --mount=type=cache,id=zcode-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm config set @mbears:registry ${MBEARS_NPM_CONFIG_REGISTRY} && \
  pnpm config set fetch-retries 5 && \
  pnpm config set fetch-retry-maxtimeout 120000 && \
  pnpm config set fetch-timeout 300000 && \
  HUSKY=0 pnpm install --frozen-lockfile --filter @zcode/cli... --filter @zcode/thinkrail

RUN pnpm --filter @zcode/thinkrail build && pnpm --filter @zcode/cli... build
WORKDIR /repo/apps/zcode-cli

ENTRYPOINT ["node", "e2e/compact-microcompact/run.mjs"]
