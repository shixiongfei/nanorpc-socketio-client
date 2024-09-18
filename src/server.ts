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
  NanoRPCError,
  NanoValidator,
  createNanoRPCError,
  createNanoReply,
  createNanoValidator,
} from "nanorpc-validator";
import { NanoClientOptions, NanoRPCErrCode, NanoRPCStatus } from "./index.js";

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

  on<T, P extends Array<unknown>>(
    method: string,
    func: (...args: P) => T | Promise<T>,
  ) {
    if (method in this.methods) {
      throw new NanoRPCError(
        NanoRPCErrCode.DuplicateMethod,
        `${method} method already registered`,
      );
    }

    this.socket.on(
      `/nanorpcs/${method as string}`,
      async (rpc: NanoRPC<unknown[]>, resp) => {
        if (typeof resp !== "function") {
          return;
        }

        if (!rpc || !("method" in rpc) || typeof rpc.method !== "string") {
          const reply = createNanoRPCError(
            rpc?.id ?? "",
            NanoRPCStatus.Exception,
            NanoRPCErrCode.ProtocolError,
            "Protocol Error",
          );
          return resp(reply);
        }

        if (rpc.method !== method) {
          const reply = createNanoRPCError(
            rpc?.id ?? "",
            NanoRPCStatus.Exception,
            NanoRPCErrCode.MissingMethod,
            "Missing Method",
          );
          return resp(reply);
        }

        const validator = this.validators.getValidator(method);

        if (validator && !validator(rpc)) {
          const lines = validator.errors!.map(
            (err) => `${err.keyword}: ${err.instancePath}, ${err.message}`,
          );
          const reply = createNanoRPCError(
            (rpc as { id?: string })?.id ?? "",
            NanoRPCStatus.Exception,
            NanoRPCErrCode.ParameterError,
            lines.join("\n"),
          );
          return resp(reply);
        }

        const doFunc = async () => {
          const params = (
            Array.isArray(rpc.params)
              ? rpc.params
              : rpc.params
                ? [rpc.params]
                : []
          ) as P;
          const result = func(...params);
          return isPromise(result) ? await result : result;
        };

        try {
          const retval = this.mutex
            ? await this.mutex.runExclusive(doFunc)
            : await doFunc();

          const reply = createNanoReply(rpc.id, NanoRPCStatus.OK, retval);
          return resp(reply);
        } catch (error) {
          const reply =
            error instanceof NanoRPCError
              ? createNanoRPCError(
                  rpc?.id ?? "",
                  NanoRPCStatus.Exception,
                  error.code,
                  error.message,
                )
              : createNanoRPCError(
                  rpc?.id ?? "",
                  NanoRPCStatus.Exception,
                  NanoRPCErrCode.CallError,
                  typeof error === "string"
                    ? error
                    : error instanceof Error
                      ? error.message
                      : `${error}`,
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
