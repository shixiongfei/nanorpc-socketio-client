/*
 * message.ts
 *
 * Copyright (c) 2024 Xiongfei Shi
 *
 * Author: Xiongfei Shi <xiongfei.shi(a)icloud.com>
 * License: Apache-2.0
 *
 * https://github.com/shixiongfei/nanorpc-socketio-client
 */

import { io } from "socket.io-client";

export class NanoRPCMessage {
  private readonly socket: ReturnType<typeof io>;

  constructor(socket: ReturnType<typeof io>) {
    this.socket = socket;
  }

  once<P extends Array<unknown>>(
    event: string,
    listener: (...args: P) => void,
  ) {
    this.socket.once(`/message/${event}`, listener);
    return this;
  }

  on<P extends Array<unknown>>(event: string, listener: (...args: P) => void) {
    this.socket.on(`/message/${event}`, listener);

    return () => {
      this.socket.off(event, listener);
    };
  }

  send<P extends Array<unknown>>(event: string, ...args: P) {
    this.socket.emit(`/message/${event}`, ...args);
    return this;
  }
}
