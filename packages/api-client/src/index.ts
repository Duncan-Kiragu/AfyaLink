import { apiV1 } from "@kkd/contracts";

export type ApiClientOptions = {
  baseUrl: string;
  getHeaders?: () => Record<string, string>;
};

export function createApiClient(options: ApiClientOptions) {
  return {
    routes: apiV1,
    baseUrl: options.baseUrl.replace(/\/$/, ""),
    async request(path: string, init?: RequestInit): Promise<Response> {
      return fetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          ...(options.getHeaders?.() ?? {}),
          ...init?.headers,
        },
      });
    },
  };
}

export type KkdApiClient = ReturnType<typeof createApiClient>;
