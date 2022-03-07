import { Observable, ReplaySubject } from "rxjs";
import { finalize } from "rxjs/operators";
import { Socket, io, SocketOptions, ManagerOptions } from "socket.io-client";
import { Logger, Checks } from "@hyperledger/cactus-common";
import { LogLevelDesc, LoggerProvider } from "@hyperledger/cactus-common";
import { Constants } from "@hyperledger/cactus-core-api";
import { ISocketApiClient } from "@hyperledger/cactus-core-api";


import { readFile } from "fs";
import { resolve as resolvePath } from "path";
import { verify, VerifyOptions, VerifyErrors, JwtPayload } from "jsonwebtoken";
import { getLogger } from "log4js";
import safeStringify from "fast-safe-stringify";

import { ValidatorAuthentication } from "./ValidatorAuthentication";

const logger = getLogger("ServerPlugin[" + process.pid + "]");
const Web3 = require("web3");
const SplugConfig = require("./PluginConfig.js");


export type QuorumApiClientOptions = {
  readonly logLevel?: LogLevelDesc;
  readonly wsApiHost?: string;
  readonly wsApiPath?: string;
  readonly validatorID: string;
  readonly validatorURL: string;
  readonly validatorKeyPath: string;
  // readonly logLevel?: LogLevelDesc;
  readonly maxCounterRequestID?: number;
  readonly syncFunctionTimeoutMillisecond?: number;
  readonly socketOptions?: Partial<ManagerOptions & SocketOptions>;
}

const defaultMaxCounterRequestID = 100;
const defaultSyncFunctionTimeoutMillisecond = 5 * 1000; // 5 sec

export class SocketQuorumEvent {
  id = "";
  verifierId = "";
  data: Record<string, unknown> | null = null;
}

/**
 * Default logic for validating responses from socketio connector (validator).
 * Assumes that message is JWT signed with validator private key.
 * @param keyPath - Absolute or relative path to validator public key.
 * @param targetData - Signed JWT message to be decoded.
 * @returns Promise resolving to decoded JwtPayload.
 */
 export function verifyValidatorJwt(
  keyPath: string,
  targetData: string,
): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    readFile(
      resolvePath(__dirname, keyPath),
      (fileError: Error | null, publicKey: Buffer) => {
        if (fileError) {
          reject(fileError);
        }

        const option: VerifyOptions = {
          algorithms: ["ES256"],
        };

        verify(
          targetData,
          publicKey,
          option,
          (err: VerifyErrors | null, decoded: JwtPayload | undefined) => {
            if (err) {
              reject(err);
            } else if (decoded === undefined) {
              reject(Error("Decoded message is undefined"));
            } else {
              resolve(decoded);
            }
          },
        );
      },
    );
  });
}


export class QuorumApiClient implements ISocketApiClient<SocketQuorumEvent> {
  private readonly log: Logger;
  private readonly socket: Socket;
  // @todo - Why replay only last one? Maybe make it configurable?
  private monitorSubject: ReplaySubject<SocketQuorumEvent> | undefined;

  readonly className: string;
  counterReqID = 1;
  checkValidator: (
    key: string,
    data: string,
  ) => Promise<JwtPayload> = verifyValidatorJwt;

  /**
   * @param validatorID - (required) ID of validator.
   * @param validatorURL - (required) URL to validator socketio endpoint.
   * @param validatorKeyPath - (required) Path to validator public key in local storage.
   */
  constructor(public readonly options: QuorumApiClientOptions) {
    this.className = this.constructor.name;

    Checks.nonBlankString(
      options.validatorID,
      `${this.className}::constructor() validatorID`,
    );
    Checks.nonBlankString(
      options.validatorURL,
      `${this.className}::constructor() validatorURL`,
    );
    Checks.nonBlankString(
      // TODO - checks path exists?
      options.validatorKeyPath,
      `${this.className}::constructor() validatorKeyPath`,
    );

    const level = this.options.logLevel || "INFO";
    const label = this.className;
    this.log = LoggerProvider.getOrCreate({ level, label });

    this.log.info(
      `Created ApiClient for Validator ID: ${options.validatorID}, URL ${options.validatorURL}, KeyPath ${options.validatorKeyPath}`,
    );
    this.log.debug("socketOptions:", options.socketOptions);

    this.socket = io(options.validatorURL, options.socketOptions);
  }

  /**
   * Immediately sends request to the validator, doesn't report any error or responses.
   * @param contract - contract to execute on the ledger.
   * @param method - function / method to be executed by validator.
   * @param args - arguments.
   */
  public sendAsyncRequest(
    // contract: Record<string, unknown>,
    // method: Record<string, unknown>,
    method: {
      type: "web3Eth",
      command: string // web3.eth method to be called
    },
    args: any,
    // TODO: SM change args type
    // args: {
    //   {
    //       args: [<args>] // method.command arguments.
    //   }
    // },
  ): void {
    try {
      if (method.type=="web3Eth"){
        const requestData = {
          // contract: contract,
          method: method,
          args: args,
        };
  
        this.log.debug("sendAsyncRequest() Request:", requestData);
        this.socket.emit("request2", requestData);
      }else{

      }
    } catch (err) {
      this.log.error("sendAsyncRequest() EXCEPTION", err);
      throw err;
    }
  }

  /**
   * Sends request to be executed on the ledger, watches and reports any error and the response from a ledger.
   * @param contract - contract to execute on the ledger.
   * @param method - function / method to be executed by validator.
   * @param args - arguments.
   * @returns Promise that will resolve with response from the ledger, or reject when error occurred.
   * @todo Refactor to RxJS
   */
  public sendSyncRequest(
    //contract: Record<string, unknown>,
    method: {
      type: "web3Eth",
      command: string // web3.eth method to be called
    },
    args: any,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.log.debug("call : sendSyncRequest");

      try {
        this.log.debug(
          "##in sendSyncRequest, contract:",
          //contract,
          "method:",
          method,
          "args:",
          args,
        );
        let responseFlag = false;

        // reqID generation
        const reqID = this.genarateReqID();
        this.log.debug(`##sendSyncRequest, reqID = ${reqID}`);

        this.socket.on("connect_error", (err: Error) => {
          this.log.error("##connect_error:", err);
          this.socket.disconnect();
          reject(err);
        });
        this.socket.on("connect_timeout", (err: Record<string, unknown>) => {
          this.log.error("####Error:", err);
          this.socket.disconnect();
          reject(err);
        });
        this.socket.on("error", (err: Record<string, unknown>) => {
          this.log.error("####Error:", err);
          this.socket.disconnect();
          reject(err);
        });
        this.socket.on("response", (result: any) => {
          this.log.debug("#[recv]response, res:", result);
          if (reqID === result.id) {
            responseFlag = true;

            this.checkValidator(
              this.options.validatorKeyPath,
              result.resObj.data,
            )
              .then((decodedData) => {
                this.log.debug("checkValidator decodedData:", decodedData);
                const resultObj = {
                  status: result.resObj.status,
                  data: decodedData.result,
                };
                this.log.debug("resultObj =", resultObj);
                // Result reply
                resolve(resultObj);
              })
              .catch((err) => {
                responseFlag = false;
                this.log.debug("checkValidator error:", err);
                this.log.error(err);
              });
          }
        });

        // Call Validator
        const requestData = {
          //contract: contract,
          method: method,
          args: args,
          reqID: reqID,
        };
        this.log.debug("requestData:", requestData);
        this.socket.emit("request2", requestData);
        this.log.debug("set timeout");

        // Time-out setting
        const timeoutMilliseconds =
          this.options.syncFunctionTimeoutMillisecond ||
          defaultSyncFunctionTimeoutMillisecond;
        setTimeout(() => {
          if (responseFlag === false) {
            this.log.debug("requestTimeout reqID:", reqID);
            resolve({ status: 504 });
          }
        }, timeoutMilliseconds);
      } catch (err) {
        this.log.error("##Error: sendSyncRequest:", err);
        reject(err);
      }
    });
  }

  /**
   * Start monitoring for new blocks on the ledger associated with given connector.
   * @param monitorOptions - Options to be passed to validator `startMonitoring` procedure.
   * @returns RxJs Observable, `next` - new block, `error` - any error from the validator.
   */
  public watchBlocksV1(
    monitorOptions?: Record<string, unknown>,
  ): Observable<SocketQuorumEvent> {
    if (this.monitorSubject) {
      this.log.debug("Reuse observable subject from previous call...");
      if (monitorOptions) {
        this.log.info(
          "Passed monitorOptions will be ignored since monitoring is already in progress!",
        );
      }
      return this.monitorSubject;
    } else {
      this.log.debug("Create new observable subject...");

      this.monitorSubject = new ReplaySubject<SocketQuorumEvent>(0);

      this.log.debug("call : startMonitor");
      try {
        this.log.debug(
          `##in startMonitor, validatorUrl = ${this.options.validatorURL}`,
        );

        this.socket.on("connect_error", (err: Error) => {
          this.log.error("##connect_error:", err);
          this.socket.disconnect();
          if (this.monitorSubject) {
            this.monitorSubject.error(err);
          }
        });

        this.socket.on("connect_timeout", (err: Record<string, unknown>) => {
          this.log.error("####Error:", err);
          this.socket.disconnect();
          if (this.monitorSubject) {
            this.monitorSubject.error(err);
          }
        });

        this.socket.on("error", (err: Record<string, unknown>) => {
          this.log.error("####Error:", err);
          this.socket.disconnect();
          if (this.monitorSubject) {
            this.monitorSubject.error(err);
          }
        });

        this.socket.on("monitor_error", (err: Record<string, unknown>) => {
          this.log.error("#### Monitor Error:", err);
          if (this.monitorSubject) {
            this.monitorSubject.error(err);
          }
        });

        this.socket.on("eventReceived", (res: any) => {
          // output the data received from the client
          this.log.debug("#[recv]eventReceived, res:", res);

          this.checkValidator(this.options.validatorKeyPath, res.blockData)
            .then((decodedData) => {
              const resultObj = {
                status: res.status,
                blockData: decodedData.blockData,
              };
              this.log.debug("resultObj =", resultObj);
              const event = new SocketQuorumEvent();
              event.verifierId = this.options.validatorID;
              this.log.debug(`##event.verifierId: ${event.verifierId}`);
              event.data = resultObj;
              if (this.monitorSubject) {
                this.monitorSubject.next(event);
              }
            })
            .catch((err) => {
              this.log.error(err);
            });
        });

        const emitStartMonitor = () => {
          this.log.debug("##emit: startMonitor");
          if (!monitorOptions || Object.keys(monitorOptions).length === 0) {
            this.socket.emit("startMonitor");
          } else {
            this.socket.emit("startMonitor", monitorOptions);
          }
        };

        if (this.socket.connected) {
          emitStartMonitor();
        } else {
          this.socket.on("connect", () => {
            this.log.debug("#connect");
            emitStartMonitor();
          });
        }
      } catch (err) {
        this.log.error(`##Error: startMonitor, ${err}`);
        this.monitorSubject.error(err);
      }

      return this.monitorSubject.pipe(
        finalize(() => {
          if (this.monitorSubject && !this.monitorSubject.observed) {
            // Last observer finished
            this.log.debug("##emit: stopMonitor");
            this.socket.emit("stopMonitor");
            this.monitorSubject = undefined;
          }
        }),
      );
    }
  }

  /**
   * Generated sync request id used to track and match responses from the validator.
   * @returns ID lower than maxCounterRequestID.
   */
  private genarateReqID(): string {
    const maxCounterRequestID =
      this.options.maxCounterRequestID || defaultMaxCounterRequestID;
    if (this.counterReqID > maxCounterRequestID) {
      // Counter initialization
      this.counterReqID = 1;
    }
    return `${this.options.validatorID}_${this.counterReqID++}`;
  }



  /*
   * web3Eth
   *
   * @param {Object} args JSON Object
   * {
   *      "method":<method information>,
   *      "args":<argument information>,
   *      "reqID":<request ID> (option)
   * }
   * @return {Object} JSON object
   */
  web3Eth(args:any) {
    return new Promise((resolve, reject) => {
      logger.info("web3Eth start");

      let retObj:any = {};
      const sendFunction = args.method.command;
      const sendArgs = args.args.args[0];
      const reqID = args["reqID"];

      logger.info("send_func  :" + sendFunction);
      logger.info("sendArgs  :" + JSON.stringify(sendArgs));

      // Handle the exception once to absorb the difference of interest.
      try {
        const web3 = new Web3();
        web3.setProvider(new web3.providers.HttpProvider(SplugConfig.SplugConfig.provider));
        let result: any = null;
        if (sendArgs !== undefined) {
          result = web3.eth[sendFunction](sendArgs);
        } else {
          result = web3.eth[sendFunction]();
        }
        const signedResults = ValidatorAuthentication.sign({ result: result });
        retObj = {
          resObj: {
            status: 200,
            data: signedResults,
          },
        };
        if (reqID !== undefined) {
          retObj["id"] = reqID;
        }
        logger.debug(`##web3Eth: retObj: ${JSON.stringify(retObj)}`);
        return resolve(retObj);
      } catch (e) {
        retObj = {
          resObj: {
            status: 504,
            errorDetail: safeStringify(e),
          },
        };
        logger.error(retObj);

        if (reqID !== undefined) {
          retObj["id"] = reqID;
        }
        logger.debug(`##web3Eth: retObj: ${JSON.stringify(retObj)}`);

        return reject(retObj);
      }
    });
  }


    /*
   * contract
   *
   * @param {Object} args JSON Object
   * {
   *      "contract":<contract information>,
   *      "method":<method information>,
   *      "args":<argument information>,
   *      "reqID":<request ID> (option)
   * }
   * @return {Object} JSON object
   */
    contract(args:{
      contract: {
        abi: object,
        address: string
      },
      method: {
        type: "contract",
        command: "call" | "send" | "encodeABI" | "estimateGas"
        function: string
        params: string[] // or object, whatever fits best - to be discussed
      },
      args: any,
      reqID: string

  // Sample args entry:
  // { args:
  //     {
  //         from:"<address(string)>",
  //         gasPrice:"<gasPrice(string)>",
  //         gas:"<gas(string)>",
  //         value:"<value(string)>",
  //         privateFor:"<node address(string)>"
  //     }
  // }
    }) {
      return new Promise((resolve, reject) => {
        logger.info("contract start");
  
        let retObj:any = {};
        const sendCommand = args.method.command;
        const sendFunction = args.method.function;
        const sendArgs = args.args.args;
        const reqID = args["reqID"];
  
        logger.info("sendCommand  :" + sendCommand);
        logger.info("sendFunction  :" + sendFunction);
        logger.info("sendArgs  :" + JSON.stringify(sendArgs));
  
        // Handle the exception once to absorb the difference of interest.
        try {
          const web3 = new Web3();
          web3.setProvider(new web3.providers.HttpProvider(SplugConfig.SplugConfig.provider));
          const contract = web3.eth
            .contract(args.contract.abi)
            .at(args.contract.address);
  
          let result: any = null;
          switch (sendArgs.length) {
            case 0:
              logger.debug(`##contract: No args.`);
              result = contract[sendCommand][sendFunction]();
              break;
            case 1:
              logger.debug(`##contract: One arg.`);
              result = contract[sendCommand][sendFunction](sendArgs[0]);
              break;
            case 2:
              logger.debug(`##contract: Two args.`);
              result = contract[sendCommand][sendFunction](
                sendArgs[0],
                sendArgs[1]
              );
              break;
            case 3:
              logger.debug(`##contract: Three args.`);
              result = contract[sendCommand][sendFunction](
                sendArgs[0],
                sendArgs[1],
                sendArgs[2]
              );
              break;
            case 4:
                logger.debug(`##contract: Three args.`);
                result = contract[sendCommand][sendFunction](
                  sendArgs[0],
                  sendArgs[1],
                  sendArgs[2],
                  sendArgs[3]
                );
                break;
            }
          logger.debug(`##contract: result: ${result}`);
  
          const signedResults = ValidatorAuthentication.sign({ result: result });
          retObj = {
            resObj: {
              status: 200,
              data: signedResults,
            },
          };
          if (reqID !== undefined) {
            retObj["id"] = reqID;
          }
          logger.debug(`##contract: retObj: ${JSON.stringify(retObj)}`);
          return resolve(retObj);
        } catch (e) {
          retObj = {
            resObj: {
              status: 504,
              errorDetail: safeStringify(e),
            },
          };
          logger.error(retObj);
  
          if (reqID !== undefined) {
            retObj["id"] = reqID;
          }
          logger.debug(`##contract: retObj: ${JSON.stringify(retObj)}`);
  
          return reject(retObj);
        }
      });
    }
}