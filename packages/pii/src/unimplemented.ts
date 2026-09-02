import type { PiiFinding, PiiPolicy, PiiService } from "@kkd/contracts";

export class UnimplementedPiiService implements PiiService {
  detect(_text: string): Promise<PiiFinding[]> {
    return Promise.reject(new Error("@kkd/pii detect is not implemented"));
  }
  sanitizeObject<T>(_value: T, _policy: PiiPolicy): Promise<T> {
    return Promise.reject(new Error("@kkd/pii sanitizeObject is not implemented"));
  }
}
