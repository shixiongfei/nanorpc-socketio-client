/*
 * index.test.ts
 *
 * Copyright (c) 2024 Xiongfei Shi
 *
 * Author: Xiongfei Shi <xiongfei.shi(a)icloud.com>
 * License: Apache-2.0
 *
 * https://github.com/shixiongfei/nanorpc-socketio-client
 */

import { createNanoRPCClient } from "./index.js";

type AddRPCFunc = (a: number, b: number) => Promise<number | undefined>;

const test = async () => {
  const rpc = createNanoRPCClient(
    "ws://127.0.0.1:4000",
    "52440ec2-2a22-4544-93a7-161dfc47239a",
  );

  const addRPC: AddRPCFunc = rpc.invoke("add");

  console.log(await Promise.all([addRPC(23, 31), rpc.call("add", 123, 456)]));
};

test();
