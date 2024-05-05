/*
 * server.ts
 *
 * Copyright (c) 2024 Xiongfei Shi
 *
 * Author: Xiongfei Shi <xiongfei.shi(a)icloud.com>
 * License: Apache-2.0
 *
 * https://github.com/shixiongfei/nanorpc-socketio-client
 */

import { Mutex } from "async-mutex";
import { io } from "socket.io-client";
import {
  NanoRPC,
  NanoValidator,
  createNanoReply,
  createNanoValidator,
} from "nanorpc-validator";
import { NanoClientOptions } from "./index.js";

export enum NanoRPCCode {
  OK = 0,
  ProtocolError,
  MissingMethod,
  ParameterError,
  Exception,
}

const isPromise = <T>(value: T | Promise<T>): value is Promise<T> =>
  typeof value === "object" && value instanceof Promise;

export class NanoRPCServer {
  public readonly validators: NanoValidator;
  private readonly methods: { [method: string]: boolean };
  private readonly subscribes: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [channel: string]: ((...args: any[]) => void)[];
  };
  private readonly mutex: Mutex | undefined;
  private readonly socket: ReturnType<typeof io>;

  constructor(socket: ReturnType<typeof io>, options?: NanoClientOptions) {
    this.validators = createNanoValidator();
    this.methods = {};
    this.subscribes = {};
    this.mutex = options?.queued ? new Mutex() : undefined;
    this.socket = socket;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket.on("/publish", (channels: string[], ...args: any[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listeners: ((...args: any[]) => void)[] = [];

      channels.forEach((channel) => {
        if (channel in this.subscribes) {
          this.subscribes[channel].forEach((listener) => {
            if (listeners.indexOf(listener) < 0) {
              listeners.push(listener);
              listener(...args);
            }
          });
        }
      });
    });
  }

  on<T, M extends string, P extends Array<unknown>>(
    method: M,
    func: (...args: P) => T | Promise<T>,
  ) {
    if (method in this.methods) {
      throw new Error(`${method} method already registered`);
    }

    this.socket.on(
      `/nanorpcs/${method as string}`,
      async (rpc: NanoRPC<string, unknown[]>, resp) => {
        if (typeof resp !== "function") {
          return;
        }

        if (!rpc || !("method" in rpc) || typeof rpc.method !== "string") {
          const reply = createNanoReply(
            rpc?.id ?? "",
            NanoRPCCode.ProtocolError,
            "Protocol Error",
          );
          return resp(reply);
        }

        if (rpc.method !== method) {
          const reply = createNanoReply(
            rpc?.id ?? "",
            NanoRPCCode.MissingMethod,
            "Missing Method",
          );
          return resp(reply);
        }

        const validator = this.validators.getValidator(method);

        if (validator && !validator(rpc)) {
          const lines = validator.errors!.map(
            (err) => `${err.keyword}: ${err.instancePath}, ${err.message}`,
          );
          const reply = createNanoReply(
            (rpc as { id?: string })?.id ?? "",
            NanoRPCCode.ParameterError,
            lines.join("\n"),
          );
          return resp(reply);
        }

        const doFunc = async () => {
          const result = func(...(rpc.arguments as P));
          return isPromise(result) ? await result : result;
        };

        try {
          const retval = this.mutex
            ? await this.mutex.runExclusive(doFunc)
            : await doFunc();

          const reply = createNanoReply(rpc.id, 0, "OK", retval);
          return resp(reply);
        } catch (error) {
          const message =
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : `${error}`;
          const reply = createNanoReply(
            rpc?.id ?? "",
            NanoRPCCode.Exception,
            message,
          );
          return resp(reply);
        }
      },
    );

    this.methods[method] = true;
    return this;
  }

  subscribed<P extends Array<unknown>>(
    channels: string[],
    listener: (...args: P) => void,
  ) {
    channels.forEach((channel) => {
      if (channel in this.subscribes) {
        if (this.subscribes[channel].indexOf(listener) < 0) {
          this.subscribes[channel].push(listener);
        }
      } else {
        this.subscribes[channel] = [listener];
      }
    });
  }

  unsubscribed<P extends Array<unknown>>(
    channels: string[],
    listener: (...args: P) => void,
  ) {
    channels.forEach((channel) => {
      if (channel in this.subscribes) {
        this.subscribes[channel] = this.subscribes[channel].filter(
          (subscriber) => subscriber !== listener,
        );
      }
    });
  }
}
