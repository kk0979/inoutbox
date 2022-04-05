import * as WS from "ws";
import * as Format from "./common.format";
import { JSONstringify, JSONparse } from "../utils";

export * from "./common.format";

export abstract class MethodBox {
  protected messenger: Messenger;
  protected _name: string;
  protected methods: any;
  protected notifies: any;

  protected constructor(messenger: Messenger, name: string) {
    this.messenger = messenger;
    this._name = name;
    this.methods = {};
    this.notifies = {};
  }

  public get name() {
    return this._name;
  }

  public abstract addMethods(methods: any): void;
  public abstract addNotifies(notifies: any): void;
  public Outside<Method, Notify>(
    boxName: string
  ): { method: Method; notify: Notify } | undefined {
    let box = this.messenger.getBox(boxName);
    if (box === undefined) return undefined;
    return { method: box.methods, notify: box.notifies };
  }
  public Outsides<Method, Notify>(
    groupNB: number
  ): Array<{ method: Method; notify: Notify }> {
    // TODO : optimize
    return this.messenger
      .getGroup(groupNB)
      .map<{ method: Method; notify: Notify }>((v) => {
        return { method: v.methods, notify: v.notifies };
      });
  }
  public abstract _recv(msg: Format.Msg): void;
  public abstract _clear(): void;
}

export class InBox extends MethodBox {
  public constructor(messenger: Messenger, name: string) {
    super(messenger, name);
  }

  public _recv(msg: Format.Msg): void {
    const on = [
      (call: Format.Call): void => {
        this.methods[msg.Method](call.From, ...call.Args)
          .then((v: any) => {
            this.messenger.fromInside(new Format.Return(call, v));
          })
          .catch((err: string) => {
            this.messenger.fromInside(
              new Format.Error(
                call,
                `fail: call(${call.Method}) on MethodBox(${this.name}): content ${err}`
              )
            );
          });
      },
      (ret: Format.Return): void => {
        ret;
        // never used
        console.log("Inbox.recv(Return) can't be used. return will be dropped");
      },
      (error: Format.Error): void => {
        error;
        // never used
        console.log("Inbox.recv(Error) can't be used. error will be dropped");
      },
      (notify: Format.Notify): void => {
        let ret = this.notifies[msg.Method](notify.From, ...notify.Args);
      },
    ];
    return on[msg.Type](<any>msg);
  }

  public addMethods(methods: any): void {
    for (let m of Object.getOwnPropertyNames(methods)) {
      if (m.startsWith("$")) continue;
      this.methods[m] = methods[m];
    }
  }

  public addNotifies(notifies: any): void {
    for (let n of Object.getOwnPropertyNames(notifies)) {
      if (n.startsWith("$")) continue;
      this.notifies[n] = notifies[n];
    }
  }

  public _clear() {}
}

export class OutBox extends MethodBox {
  private address: string;
  private pool: ConnectionPool;
  private buffer: Array<Format.Msg>;
  private flushing: NodeJS.Timeout | undefined;
  private callCounter: number;
  private returnWaiting: Map<
    number,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  >;

  private get CALL() {
    return `_${this.name}_call_`;
  }

  public constructor(
    messenger: Messenger,
    name: string,
    address: string,
    pool: ConnectionPool
  ) {
    super(messenger, name);
    this.address = address;
    this.pool = pool;
    this.buffer = new Array<Format.Msg>();
    this.flushing = undefined;
    this.callCounter = 0;
    this.returnWaiting = new Map<
      number,
      { resolve: (value: any) => void; reject: (reason?: any) => void }
    >();
  }

  public _recv(msg: Format.Msg): void {
    this.buffer.push(msg);
    this.tryFlush();
  }

  private tryFlush(): void {
    if (this.buffer.length === 0) {
      this._clear();
      return;
    }
    let socket;
    try {
      socket = this.pool.getConnection(this.address);
    } catch (err: any) {
      // client-only socket은 끊기면 바로 드랍
      console.trace((<Error>err).message);
      this.messenger.dropBox(this);
      return;
    }

    try {
      if (socket.readyState !== WS.OPEN) throw new Error("invaild socket");
      socket.send(JSONstringify(this.buffer), (err) => {
        if (err === undefined) {
          this.buffer.length = 0;
          this._clear();
        } else throw err;
      });
    } catch (err) {
      if (this.flushing === undefined) {
        // TODO : 연결 문제별로 해결시도를 여기서 해야함..
        console.log("tryFlush() fail");
        this.flushing = setTimeout(() => {
          this.flushing = undefined;
          this.tryFlush();
        }, 1000);
      }
    }
  }

  public addMethods(methods: any): void {
    for (let m of Object.getOwnPropertyNames(methods)) {
      if (m.startsWith("$")) continue;
      this.methods[m] = (caller: string, ...args: any): Promise<any> => {
        let call = new Format.Call(m, caller, this.name, {}, ...args);
        call.Context[this.CALL] = this.callCounter++;
        let ret = new Promise<any>((resolve, reject) => {
          this.returnWaiting.set(call.Context[this.CALL], { resolve, reject });
        });
        this._recv(call);
        return ret;
      };
    }
  }

  public addNotifies(notifies: any): void {
    for (let n of Object.getOwnPropertyNames(notifies)) {
      if (n.startsWith("$")) continue;
      this.notifies[n] = (talker: string, ...args: any): void => {
        this._recv(new Format.Notify(n, talker, this.name, {}, ...args));
      };
    }
  }

  public _interpret(msg: Format.Msg): void {
    const on = [
      (call: Format.Call): void => {
        this.messenger.fromInside(call);
      },
      (ret: Format.Return): void => {
        let wait = this.returnWaiting.get(ret.Context[this.CALL]);
        if (wait === undefined) {
          console.log(
            `_interpret Error: there was no call with number(${
              ret.Context[this.CALL]
            }). this return will be dropped`
          );
          return;
        }
        wait.resolve(ret.Value);
      },
      (error: Format.Error): void => {
        let wait = this.returnWaiting.get(error.Context[this.CALL]);
        if (wait === undefined) {
          console.log(
            `_interpret Error: there was no call with number(${
              error.Context[this.CALL]
            }). this error will be dropped`
          );
          return;
        }
        wait.reject(error.Cause);
      },
      (notify: Format.Notify): void => {
        this.messenger.fromInside(notify);
      },
    ];
    return on[msg.Type](<any>msg);
  }

  public _clear() {
    if (this.flushing !== undefined) {
      clearTimeout(this.flushing);
      this.flushing = undefined;
    }
  }
}

export class Messenger {
  protected url: string;
  protected boxes: Map<string, { groupNB: number; box: MethodBox }>;
  protected pool: ConnectionPool;
  protected onAfterBoxIn: (box: MethodBox) => void;
  protected onBeforeBoxOut: (box: MethodBox) => void;

  constructor(
    server: WS.Server,
    url: string,
    clientGroup: number = Number.MAX_VALUE
  ) {
    this.url = url;
    this.boxes = new Map<
      string /*name*/,
      { groupNB: number; box: MethodBox }
    >();
    this.pool = new ConnectionPool(this, server, clientGroup, url);
    this.onAfterBoxIn = (box: MethodBox) => void {};
    this.onBeforeBoxOut = (box: MethodBox) => void {};
  }

  public addInBox(groupNB: number, name: string): InBox {
    let mb = new InBox(this, name);
    this.boxes.set(name, { groupNB: groupNB, box: mb });
    this.onAfterBoxIn(mb);
    return mb;
  }

  public addOutBox(
    groupNB: number,
    name: string,
    remoteAddress: string
  ): OutBox {
    let mb = new OutBox(this, name, remoteAddress, this.pool);
    this.boxes.set(name, { groupNB: groupNB, box: mb });
    this.onAfterBoxIn(mb);
    return mb;
  }

  public dropBox(box: MethodBox) {
    this.onBeforeBoxOut(box);
    box._clear();
    this.boxes.delete(box.name);
  }

  public getBox(name: string): MethodBox | undefined {
    return this.boxes.get(name)?.box;
  }

  public getGroup(groupNB: number): Array<MethodBox> {
    let group = Array<MethodBox>();
    this.boxes.forEach((v) => {
      if (v.groupNB === groupNB) group.push(v.box);
    });
    return group;
  }

  public fromInside(msg: Format.Msg) {
    // outbox -> inbox / inbox -> inbox
    let msgBox = this.boxes.get(msg.To)?.box;
    if (msgBox === undefined) {
      console.log(`fromInside() Error: no box(${msg.To}). msg will be dropped`);
      return;
    }
    msgBox._recv(msg);
  }

  public fromOutside(msg: Format.Msg) {
    // socket -> outbox
    let msgBox = this.boxes.get(msg.From)?.box;
    if (msgBox === undefined) {
      console.log(
        `fromOutside() Error: no box(${msg.From}). msg will be dropped`
      );
      return;
    }
    if (!(msgBox instanceof OutBox)) {
      console.log(
        `fromOutside() Error: box(${msg.From}) is not OutBox. msg will be dropped`
      );
      return;
    }
    msgBox._interpret(msg);
  }

  public setOnAfterBoxIn(onAfterBoxIn: (box: MethodBox) => void) {
    this.onAfterBoxIn = onAfterBoxIn;
  }

  public setOnABeforeBoxOut(onBeforeBoxOut: (box: MethodBox) => void) {
    this.onBeforeBoxOut = onBeforeBoxOut;
  }
}

class ConnectionPool {
  private url?: string;
  private messenger: Messenger;
  private pool: Map<string, WS.WebSocket>;
  protected server: WS.Server;
  protected CLIENT_SESSION: number;
  protected clientGroup: number;

  public constructor(
    messenger: Messenger,
    server: WS.Server,
    clientGroup: number,
    url?: string
  ) {
    this.url = url;
    this.messenger = messenger;
    this.pool = new Map<string, WS.WebSocket>();
    this.server = server;
    this.CLIENT_SESSION = 0;
    this.clientGroup = clientGroup;

    this.server.on("connection", (ws, req) => {
      console.log("------new connection------");
      const ip =
        req.headers["X-Forwarded-For"] ||
        req.headers["Proxy-Client-IP"] ||
        req.headers["WL-Proxy-Client-IP"] ||
        req.headers["HTTP_CLIENT_IP"] ||
        req.headers["x-forwarded-for"] ||
        req.headers["HTTP_X_FORWARDED_FOR"] ||
        req.socket.remoteAddress;
      // TODO : check ip, url on white list
      console.log(`ip: ${ip} port: ${req.socket.remotePort}`);

      // ws.binaryType = "nodebuffer"; // default
      ws.binaryType = "arraybuffer";
      // ws.binaryType = "fragments";

      let incoming = <string>req.headers["Sec-WebSocket-Protocol"];
      if (incoming === undefined) {
        // this is client only mode
        let session: string = `${this.CLIENT_SESSION++}`;
        console.log(`Sec-WebSocket-Protocol: ${incoming}(client only)`);
        console.log(`Client session: ${session}`);
        this.setConnection(session, ws);
        this.messenger
          .addOutBox(this.clientGroup, session, session)
          ._recv(new Format.ConfigClient("", "", session));
      } else {
        console.log(`Sec-WebSocket-Protocol: ${incoming}(server/client)`);
        this.setConnection(incoming, ws);
      }
      console.log("--------------------------");
    });
  }

  /**
   * get connection. if not connected, try connect
   * @param address
   * @returns socket
   * @throws if can not connect
   */
  public getConnection(address: string): WS.WebSocket {
    let ws = this.pool.get(address);
    console.log(`getConnection(${address})`);
    if (ws !== undefined) {
      if (ws.readyState === ws.CONNECTING || ws.readyState === ws.OPEN)
        return ws;
    }
    if (address.startsWith("ws://") === false)
      throw new Error(
        `this connection should be connected by opposite(${address}`
      );
    ws = new WS.WebSocket(
      address /* destination url */,
      this.url /* header : Sec-WebSocket-Protocol */
    );
    this.setConnection(address, ws);
    return ws;
  }

  public setConnection(address: string, ws: WS.WebSocket) {
    console.log(`setConnection(${address})`);
    if (ws.readyState === ws.CLOSING || ws.readyState === ws.CLOSED) return;
    let old = this.pool.get(address);
    if (ws !== old && old !== undefined) old.close(/* TODO : */);

    ws.on("message", (data) => {
      let msgs: Array<Format.Msg> = JSONparse(data.toString());
      for (let msg of msgs) {
        this.messenger.fromOutside(msg);
      }
    });
    this.pool.set(address, ws);
  }

  public deleteConnection(address: string) {
    this.pool.get(address)?.close();
    this.pool.delete(address);
  }
}
