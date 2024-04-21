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
import { NanoRPCCode, NanoRPCServer } from "./server.js";

export type NanoClientOptions = Readonly<{
  queued?: boolean;
  timeout?: number;
  auth?: object | ((cb: (data: object) => void) => void);
}>;

export class NanoRPCClient {
  public readonly validators: NanoValidator;
  private readonly timeout: number;
  private readonly socket: ReturnType<typeof io>;
  private readonly server: NanoRPCServer;

  constructor(url: string | URL, secret: string, options?: NanoClientOptions) {
    this.validators = createNanoValidator();
    this.timeout = options?.timeout ?? 0;
    this.socket = io(typeof url === "string" ? url : url.href, {
      auth: options?.auth,
      parser: createParser(secret),
      transports: ["websocket"],
    });
    this.server = new NanoRPCServer(this.socket, options);
  }

  get methods() {
    return this.server;
  }

  get id() {
    return this.socket.id;
  }

  get active() {
    return this.socket.active;
  }

  get connected() {
    return this.socket.connected;
  }

  get disconnected() {
    return this.socket.disconnected;
  }

  close() {
    this.socket.disconnect();
    return this;
  }

  apply<T, M extends string, P extends Array<unknown>>(method: M, args: P) {
    const rpc = createNanoRPC(method, args);

    const doReplyFunc = async (reply: NanoReply<T>) => {
      const validator = this.validators.getValidator(method);

      if (validator && !validator(reply)) {
        const lines = validator.errors!.map(
          (err) => `${err.keyword}: ${err.instancePath}, ${err.message}`,
        );
        const error = lines.join("\n");

        throw new Error(`NanoRPC call ${method}, ${error}`);
      }

      if (reply.code !== NanoRPCCode.OK) {
        throw new Error(`NanoRPC call ${method} ${reply.message}`);
      }

      return reply.value;
    };

    return new Promise<T | undefined>((resolve, reject) => {
      if (this.timeout > 0) {
        this.socket
          .timeout(this.timeout)
          .emit("/nanorpcs", rpc, (error: Error, reply: NanoReply<T>) => {
            if (error) {
              reject(error);
            } else {
              try {
                resolve(doReplyFunc(reply));
              } catch (error) {
                reject(error);
              }
            }
          });
      } else {
        this.socket.emit("/nanorpcs", rpc, (reply: NanoReply<T>) => {
          try {
            resolve(doReplyFunc(reply));
          } catch (error) {
            reject(error);
          }
        });
      }
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
