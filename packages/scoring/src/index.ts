import type { SystemScoreSnapshot } from "@kkd/contracts";

export interface ScoreEngine {
  snapshot(input: unknown): Promise<SystemScoreSnapshot>;
}

export class UnimplementedScoreEngine implements ScoreEngine {
  snapshot(_input: unknown): Promise<SystemScoreSnapshot> {
    return Promise.reject(new Error("@kkd/scoring snapshot is not implemented"));
  }
}
