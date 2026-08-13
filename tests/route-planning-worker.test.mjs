import assert from "node:assert/strict";
import test from "node:test";
import { RoutePlanningWorkerController } from "../lib/route-planning-worker.ts";

class FakeWorker {
  onmessage = null;
  onerror = null;
  messages = [];
  terminated = false;

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

function request() {
  return {
    pack: { cells: {} },
    start: { longitude: 15, latitude: 44 },
    destination: { longitude: 15.1, latitude: 44.1 },
    options: {
      clearanceMetres: 300,
      cruiseSpeedKnots: 16,
      speedWarningEnabled: true,
      nearShoreSpeedKnots: 8,
    },
  };
}

test("starting a new route terminates the previous worker and ignores its queued result", () => {
  const workers = [];
  const controller = new RoutePlanningWorkerController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const results = [];
  const errors = [];
  const callbacks = {
    onResult: (result) => results.push(result),
    onError: () => errors.push("error"),
  };

  assert.equal(controller.calculate(request(), callbacks), 1);
  const staleHandler = workers[0].onmessage;
  assert.equal(controller.calculate(request(), callbacks), 2);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].messages[0].requestId, 1);
  assert.equal(workers[1].messages[0].requestId, 2);

  staleHandler({ data: { requestId: 1, result: { failure: "no-route" } } });
  assert.deepEqual(results, []);
  assert.deepEqual(errors, []);

  workers[1].onmessage({ data: { requestId: 2, result: { failure: "too-far" } } });
  assert.deepEqual(results, [{ failure: "too-far" }]);
  assert.equal(workers[1].terminated, true);
});

test("cancelling a route prevents late success and error callbacks", () => {
  const worker = new FakeWorker();
  const controller = new RoutePlanningWorkerController(() => worker);
  let callbackCount = 0;
  controller.calculate(request(), {
    onResult: () => { callbackCount += 1; },
    onError: () => { callbackCount += 1; },
  });
  const staleMessage = worker.onmessage;
  const staleError = worker.onerror;

  controller.cancel();
  staleMessage({ data: { requestId: 1, result: { failure: "no-route" } } });
  staleError();

  assert.equal(worker.terminated, true);
  assert.equal(callbackCount, 0);
});

test("the active worker error is reported once and disposed", () => {
  const worker = new FakeWorker();
  const controller = new RoutePlanningWorkerController(() => worker);
  let errorCount = 0;
  controller.calculate(request(), {
    onResult: () => assert.fail("unexpected result"),
    onError: () => { errorCount += 1; },
  });

  worker.onerror();

  assert.equal(errorCount, 1);
  assert.equal(worker.terminated, true);
});
