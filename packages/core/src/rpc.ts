// minimal id-correlated RPC over postMessage
// — used by both main-thread proxy and worker handler

export interface RpcRequest {
	__rpc: "req";
	id: number;
	method: string;
	args: unknown[];
}

export interface RpcResponseOk {
	__rpc: "res";
	id: number;
	ok: true;
	value: unknown;
}

export interface RpcResponseErr {
	__rpc: "res";
	id: number;
	ok: false;
	error: { message: string; stack?: string };
}

export interface RpcEvent {
	__rpc: "evt";
	channel: string;
	payload: unknown;
}

export type RpcMessage = RpcRequest | RpcResponseOk | RpcResponseErr | RpcEvent;

export function isRpcMessage(data: unknown): data is RpcMessage {
	return typeof data === "object" && data !== null && "__rpc" in data;
}
