import {
  zcodeProtocolMethods,
  zcodeSkillsReferenceCatalogResultSchema,
  type ZCodeSkillsReferenceCatalogParams,
} from "@zcode/shared";
import type { ZCodeProtocolClient } from "#src/zcode-agent/zcodeProtocolClient.js";

/** 内置 scope 用新入口承载；只有 method-not-found 能证明目标 Host 需要旧协议。 */
export async function requestSkillReferenceCatalog(
  client: Pick<ZCodeProtocolClient, "request">,
  params: ZCodeSkillsReferenceCatalogParams,
) {
  try {
    return await client.request(
      zcodeProtocolMethods.skillsReferenceCatalogWithBuiltIns,
      params,
      zcodeSkillsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      zcodeProtocolMethods.skillsReferenceCatalog,
      params,
      zcodeSkillsReferenceCatalogResultSchema,
    );
  }
}
