export {
  E_KEYCHAIN_NOT_FOUND,
  IPluginLedgerConnectorQuorumOptions,
  PluginLedgerConnectorQuorum,
} from "./plugin-ledger-connector-quorum";
export { PluginFactoryLedgerConnector } from "./plugin-factory-ledger-connector";

import { IPluginFactoryOptions } from "@hyperledger/cactus-core-api";
import { PluginFactoryLedgerConnector } from "./plugin-factory-ledger-connector";

export {
  QuorumApiClient,
  QuorumApiClientOptions,
} from "./api-client/quorum-api-client";

export * from "./generated/openapi/typescript-axios/api";

export async function createPluginFactory(
  pluginFactoryOptions: IPluginFactoryOptions,
): Promise<PluginFactoryLedgerConnector> {
  return new PluginFactoryLedgerConnector(pluginFactoryOptions);
}
