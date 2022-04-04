import * as Common from "./common.server";
import express from "express";
import * as http from "http";
import * as WS from "ws";

const app = express();

const HOST = "localhost";
const PORT = "4000";
const URL = `ws://${HOST}:${PORT}`;

let server = http.createServer(app);
let wss = new WS.WebSocketServer({ server: server });
server.listen(PORT, () => {
  let messenger = new Common.Messenger(wss, URL);
  describe("common.server.spec.ts", () => {});
});
