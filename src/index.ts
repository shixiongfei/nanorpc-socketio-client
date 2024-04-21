/*
 * index.ts
 *
 * Copyright (c) 2024 Xiongfei Shi
 *
 * Author: Xiongfei Shi <xiongfei.shi(a)icloud.com>
 * License: Apache-2.0
 *
 * https://github.com/shixiongfei/nanorpc-socketio-client
 */

import { io } from "socket.io-client";
import { createParser } from "safety-socketio";
import {
  NanoReply,
  NanoValidator,
  createNanoRPC,
  createNanoValidator,
} from "nanorpc-validator";

enum NanoRPCCode {
  OK = 0,
  ProtocolError,
  MissingMethod,
  ParameterError,
  Exception,
}

export type NanoClientOptions = Readonly<{
  auth?: object | ((cb: (data: object) => void) => void);
}>;

export class NanoRPCClient {
  public readonly validators: NanoValidator;
  private readonly socket: ReturnType<typeof io>;

  constructor(url: string | URL, secret: string, options?: NanoClientOptions) {
    this.validators = createNanoValidator();
    this.socket = io(typeof url === "string" ? url : url.href, {
      auth: options?.auth,
      parser: createParser(secret),
      transports: ["websocket"],
    });

    this.socket.on("connect_error", (error) => {
      throw new Error(error.message);
    });
  }

  apply<T, M extends string, P extends Array<unknown>>(method: M, args: P) {
    const rpc = createNanoRPC(method, args);

    return new Promise<T | undefined>((resolve, reject) => {
      this.socket.emit("/nanorpcs", rpc, (reply: NanoReply<T>) => {
        const validator = this.validators.getValidator(method);

        if (validator && !validator(reply)) {
          const lines = validator.errors!.map(
            (err) => `${err.keyword}: ${err.instancePath}, ${err.message}`,
          );
          const error = lines.join("\n");

          return reject(new Error(`NanoRPC call ${method}, ${error}`));
        }

        if (reply.code !== NanoRPCCode.OK) {
          return reject(new Error(`NanoRPC call ${method} ${reply.message}`));
        }

        return resolve(reply.value);
      });
    });
  }

  async call<T, M extends string, P extends Array<unknown>>(
    method: M,
    ...args: P
  ) {
    return this.apply<T, M, P>(method, args);
  }

  invoke<T, M extends string, P extends Array<unknown>>(method: M) {
    return async (...args: P) => await this.apply<T, M, P>(method, args);
  }
}

export const createNanoRPCClient = (
  url: string | URL,
  secret: string,
  options?: NanoClientOptions,
) => new NanoRPCClient(url, secret, options);
