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
  NanoRPCError,
  NanoReply,
  NanoValidator,
  createNanoRPC,
  createNanoValidator,
} from "nanorpc-validator";
import { NanoRPCServer } from "./server.js";
import { NanoRPCMessage } from "./message.js";

export * from "nanorpc-validator";

export enum NanoRPCStatus {
  OK = 0,
  Exception,
}

export enum NanoRPCErrCode {
  DuplicateMethod = -1,
  MethodNotFound = -2,
  ProtocolError = -3,
  MissingMethod = -4,
  ParameterError = -5,
  CallError = -6,
}

export type NanoClientOptions = Readonly<{
  secret?: string;
  queued?: boolean;
  timeout?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth?: { [key: string]: any } | ((cb: (data: object) => void) => void);

  onConnect?: () => void;
  onConnectError?: (error: Error) => void;
  onDisconnect?: (reason: string) => void;
}>;

export class NanoRPCClient {
  public readonly validators: NanoValidator;
  public readonly message: NanoRPCMessage;
  private readonly timeout: number;
  private readonly socket: ReturnType<typeof io>;
  private readonly server: NanoRPCServer;

  constructor(url: string | URL, options?: NanoClientOptions) {
    this.validators = createNanoValidator();
    this.timeout = options?.timeout ?? 0;
    this.socket = io(typeof url === "string" ? url : url.href, {
      auth: options?.auth,
      parser: options?.secret ? createParser(options.secret) : undefined,
      transports: ["websocket"],
    });
    this.message = new NanoRPCMessage(this.socket);
    this.server = new NanoRPCServer(this.socket, options);

    if (options?.onConnect) {
      this.socket.on("connect", options.onConnect);
    }

    if (options?.onConnectError) {
      this.socket.on("connect_error", options.onConnectError);
    }

    if (options?.onDisconnect) {
      this.socket.on("disconnect", options.onDisconnect);
    }
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

  subscribe<P extends Array<unknown>>(
    channels: string | string[],
    listener: (...args: P) => void,
  ) {
    const unsubscribe = (channels: string[]) => () => {
      return new Promise<string[]>((resolve, reject) => {
        if (this.timeout > 0) {
          this.socket
            .timeout(this.timeout)
            .emit(
              "/unsubscribe",
              channels,
              (error: Error, channels: string[]) => {
                if (error) {
                  reject(error);
                } else {
                  this.server.unsubscribed(channels, listener);
                  resolve(channels);
                }
              },
            );
        } else {
          this.socket.emit("/unsubscribe", channels, (channels: string[]) => {
            this.server.unsubscribed(channels, listener);
            resolve(channels);
          });
        }
      });
    };

    return new Promise<() => Promise<string[]>>((resolve, reject) => {
      if (this.timeout > 0) {
        this.socket
          .timeout(this.timeout)
          .emit("/subscribe", channels, (error: Error, channels: string[]) => {
            if (error) {
              reject(error);
            } else {
              this.server.subscribed(channels, listener);
              resolve(unsubscribe(channels));
            }
          });
      } else {
        this.socket.emit("/subscribe", channels, (channels: string[]) => {
          this.server.subscribed(channels, listener);
          resolve(unsubscribe(channels));
        });
      }
    });
  }

  apply<T, P extends object>(method: string, params?: P) {
    const rpc = createNanoRPC(method, params);

    const parseReply = (reply: NanoReply<T>) => {
      const validator = this.validators.getValidator(method);

      if (validator && !validator(reply)) {
        const lines = validator.errors!.map(
          (err) => `${err.keyword}: ${err.instancePath}, ${err.message}`,
        );
        const error = lines.join("\n");

        throw new NanoRPCError(
          NanoRPCErrCode.CallError,
          `Call ${method}, ${error}`,
        );
      }

      if (reply.status !== NanoRPCStatus.OK) {
        throw new NanoRPCError(
          reply.error?.code ?? NanoRPCErrCode.CallError,
          `Call ${method} ${reply.error?.message ?? "unknown error"}`,
        );
      }

      return reply.result;
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
                resolve(parseReply(reply));
              } catch (error) {
                reject(error);
              }
            }
          });
      } else {
        this.socket.emit("/nanorpcs", rpc, (reply: NanoReply<T>) => {
          try {
            resolve(parseReply(reply));
          } catch (error) {
            reject(error);
          }
        });
      }
    });
  }

  async call<T, P extends Array<unknown>>(method: string, ...args: P) {
    return await this.apply<T, P>(method, args);
  }

  invoke<T, P extends Array<unknown>>(method: string) {
    return async (...args: P) => await this.apply<T, P>(method, args);
  }
}

export const createNanoRPCClient = (
  url: string | URL,
  options?: NanoClientOptions,
) => new NanoRPCClient(url, options);
