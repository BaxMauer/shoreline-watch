import type { CoastlinePack } from "./shoreline.ts";
import type {
  GeoPoint,
  RoutePlanningOptions,
  RoutePlanningResult,
} from "./route-planning.ts";

export type RoutePlanningWorkerRequest = {
  requestId: number;
  pack: CoastlinePack;
  start: GeoPoint;
  destination: GeoPoint;
  options: RoutePlanningOptions;
};

export type RoutePlanningWorkerResponse = {
  requestId: number;
  result?: RoutePlanningResult;
  error?: "calculation-failed";
};

type WorkerMessageEvent = { data: RoutePlanningWorkerResponse };

export type RoutePlanningWorker = {
  onmessage: ((event: WorkerMessageEvent) => void) | null;
  onerror: (() => void) | null;
  postMessage(message: RoutePlanningWorkerRequest): void;
  terminate(): void;
};

export type RoutePlanningCallbacks = {
  onResult(result: RoutePlanningResult): void;
  onError(): void;
};

type ActiveCalculation = {
  requestId: number;
  worker: RoutePlanningWorker;
};

/**
 * Owns one job-specific worker at a time. Replacing or cancelling a job
 * terminates the old worker, while request IDs also reject messages that were
 * already queued before termination.
 */
export class RoutePlanningWorkerController {
  private active: ActiveCalculation | null = null;
  private nextRequestId = 0;
  private readonly createWorker: () => RoutePlanningWorker;

  constructor(createWorker: () => RoutePlanningWorker) {
    this.createWorker = createWorker;
  }

  calculate(
    request: Omit<RoutePlanningWorkerRequest, "requestId">,
    callbacks: RoutePlanningCallbacks,
  ) {
    this.cancel();
    const requestId = ++this.nextRequestId;
    const worker = this.createWorker();
    this.active = { requestId, worker };

    worker.onmessage = (event) => {
      if (!this.isActive(worker, event.data.requestId)) return;
      this.finish(worker);
      if (event.data.result) callbacks.onResult(event.data.result);
      else callbacks.onError();
    };
    worker.onerror = () => {
      if (!this.isActive(worker, requestId)) return;
      this.finish(worker);
      callbacks.onError();
    };
    worker.postMessage({ ...request, requestId });
    return requestId;
  }

  cancel() {
    if (!this.active) return;
    this.active.worker.terminate();
    this.active = null;
  }

  dispose() {
    this.cancel();
  }

  private isActive(worker: RoutePlanningWorker, requestId: number) {
    return this.active?.worker === worker && this.active.requestId === requestId;
  }

  private finish(worker: RoutePlanningWorker) {
    worker.terminate();
    this.active = null;
  }
}
