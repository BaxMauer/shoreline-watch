import { planWaterRoute } from "../lib/route-planning.ts";
import type {
  RoutePlanningWorkerRequest,
  RoutePlanningWorkerResponse,
} from "../lib/route-planning-worker.ts";

type RoutePlanningWorkerScope = {
  onmessage: ((event: MessageEvent<RoutePlanningWorkerRequest>) => void) | null;
  postMessage(message: RoutePlanningWorkerResponse): void;
};

const workerScope = globalThis as unknown as RoutePlanningWorkerScope;

workerScope.onmessage = (event) => {
  const { requestId, pack, start, destination, options } = event.data;
  try {
    workerScope.postMessage({
      requestId,
      result: planWaterRoute(pack, start, destination, options),
    });
  } catch {
    workerScope.postMessage({ requestId, error: "calculation-failed" });
  }
};
