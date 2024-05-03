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
  const rpc = createNanoRPCClient("ws://127.0.0.1:4000", {
    secret: "2f278d5f-2b90-4230-8cec-10f70f3feb06",
  });

  rpc.methods.on("ping", (timestamp: number) => timestamp);

  rpc.message.on("test-event", (msg) => {
    console.log("Event:", msg);
  });

  const unsubscribe = await rpc.subscribe("test-channel", (msg) => {
    console.log("Subscribed:", msg);
  });

  await rpc.call("publish");

  const addRPC: AddRPCFunc = rpc.invoke("add");

  console.log(await Promise.all([addRPC(23, 31), rpc.call("add", 123, 456)]));
  console.log("Unsubscribed:", await unsubscribe());

  rpc.close();
};

test();
