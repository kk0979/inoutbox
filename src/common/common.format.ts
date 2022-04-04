/**
 * @todo TODO: msg에 싣기 : 서버 통신 지연(클라보낸시간->서버받은시간/서버받은시간/클라보낸시간)
 * @todo TODO: msg에 싣기 : 서버 처리 지연(클라Call시간->클라Return시간/서버Call시간->서버Return시간)
 */

export enum Type {
  Call = 0,
  Return,
  Error,
  Notify,
  ConfigClient,
}
export type Context = { [index: string]: number | number };

export interface Msg {
  readonly Type: Type;
  readonly From: string;
  readonly To: string;
  readonly Method: string;
  Context: Context;
}

export class Call implements Msg {
  /*
    Method function prototype
    {name}: (caller: Address, arg1, arg2, ...): Promise<return-type> => {......}
   */
  readonly Type: Type;
  readonly From: string;
  readonly To: string;
  readonly Method: string;
  public Context: Context;
  readonly Args: Array<any>;

  public constructor(
    Method: string,
    Caller: string,
    To: string,
    Context: Context = {},
    ...Args: Array<any>
  ) {
    this.Type = Type.Call;
    this.From = Caller;
    this.To = To;
    this.Method = Method;
    this.Context = Context;
    this.Args = Args;
  }
}

export class Return implements Msg {
  readonly Type: Type;
  readonly From: string;
  readonly To: string;
  readonly Method: string;
  public Context: Context;
  readonly Value: any;

  public constructor(call: Call, Value: any) {
    this.Type = Type.Return;
    this.From = call.To;
    this.To = call.From;
    this.Method = call.Method;
    this.Context = call.Context;
    this.Value = Value;
  }
}

export class Error implements Msg {
  readonly Type: Type;
  readonly From: string;
  readonly To: string;
  readonly Method: string;
  public Context: Context;
  readonly Cause: string;

  public constructor(call: Call, Cause = "") {
    this.Type = Type.Error;
    this.From = call.To;
    this.To = call.From;
    this.Method = call.Method;
    this.Context = call.Context;
    this.Cause = Cause;
  }
}

export class Notify implements Msg {
  /*
    Notify function prototype
    {name}: (talker: Address, arg1, arg2, ...): void => {......}
   */
  readonly Type: Type;
  readonly From: string;
  readonly To: string;
  readonly Method: string;
  public Context: Context;
  readonly Args: Array<any>;

  public constructor(
    Method: string,
    Talker: string,
    To: string,
    Context: Context = {},
    ...Args: Array<any>
  ) {
    this.Type = Type.Notify;
    this.From = Talker;
    this.To = To;
    this.Method = Method;
    this.Context = Context;
    this.Args = Args;
  }
}

export class ConfigClient implements Msg {
  readonly Type: Type;
  readonly From: string;
  readonly To: string;
  readonly Method: string;
  public Context: Context;

  public constructor(
    Method: string,
    Talker: string,
    To: string,
    Context: Context = {}
  ) {
    this.Type = Type.ConfigClient;
    this.From = Talker;
    this.To = To;
    this.Method = Method;
    this.Context = Context;
  }
}
