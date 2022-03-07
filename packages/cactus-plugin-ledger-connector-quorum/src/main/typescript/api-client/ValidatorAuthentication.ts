/*
 * Copyright 2020-2021 Hyperledger Cactus Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * ValidatorAuthentication.ts
 */

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

import { getLogger } from "log4js";
const logger = getLogger("ValidatorAuthentication[" + process.pid + "]");



export const config = {
  sslParam: {
    port: 5050,
    key: "./common/core/CA/connector.priv",
    cert: "./common/core/CA/connector.crt",
  },
  validatorKeyPath: "../common/core/validatorKey/key84jUisrs.priv",
  // Log level (trace/debug/info/warn/error/fatal)
  logLevel: "debug",
};

logger.level = config.logLevel;

const privateKey = fs.readFileSync(
  path.resolve(__dirname, config.validatorKeyPath)
);

export class ValidatorAuthentication {
  static sign(payload: object): string {
    const option = {
      algorithm: "ES256",
      expiresIn: "1000",
    };

    // logger.debug(`payload = ${JSON.stringify(payload)}`);
    const signature: string = jwt.sign(payload, privateKey, option);
    // logger.debug(`signature = ${signature}`);
    logger.debug(`signature: OK`);
    return signature;
  }
}
