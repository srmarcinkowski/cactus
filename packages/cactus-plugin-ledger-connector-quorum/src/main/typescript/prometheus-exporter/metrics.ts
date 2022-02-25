import { Gauge } from "prom-client";

export const K_CACTUS_GO_QUORUM_TOTAL_TX_COUNT =
  "cactus_go_quorum_total_tx_count";

export const totalTxCount = new Gauge({
  registers: [],
  name: "cactus_go_quorum_total_tx_count",
  help: "Total transactions executed",
  labelNames: ["type"],
});
