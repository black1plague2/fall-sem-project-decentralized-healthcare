// src/services/uploadProgressService.js
//
// Backs the live pipeline SSE stream (upload / access-request / revoke).
// Previously an in-memory Map — that broke on serverless platforms like
// Vercel because the request that emits progress events (the POST that
// triggers an action) and the request that streams them (the SSE GET)
// are not guaranteed to land on the same instance. Storing events in
// MongoDB (see models/progressSessionModel.js) makes this correct
// regardless of which instance handles which request: sendUpdate()
// just appends to a document, and streamSession() polls that same
// document from whatever instance is holding the SSE connection open.

const crypto = require('crypto');
const ProgressSession = require('../models/progressSessionModel');

const POLL_MS = 180;
// Safety net: end the stream ourselves well before a typical serverless
// function execution limit would kill it uncleanly.
const MAX_STREAM_MS = 45000;

// Call sites fire sendUpdate()/closeSession() synchronously without
// awaiting (they're not the caller's concern to serialize). But Mongo
// writes are async, and several steps in the same pipeline can emit
// within microseconds of each other — without ordering them explicitly,
// their updateOne() calls can complete out of call order, which would
// make the pipeline visualization replay events scrambled. This queues
// each session's writes behind a promise chain so they land in the
// MongoDB events array in exactly the order sendUpdate() was called,
// even though nothing here is awaited by the caller.
const writeQueues = new Map(); // sessionId -> tail promise

function enqueue(sessionId, task) {
  const prev = writeQueues.get(sessionId) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  writeQueues.set(sessionId, next);
  next.finally(() => {
    if (writeQueues.get(sessionId) === next) writeQueues.delete(sessionId);
  });
  return next;
}

/**
 * Record a progress event for a session. Safe to call even if no one is
 * (yet, or ever) listening — the event is simply available for replay
 * whenever a client does connect.
 * @param {string} sessionId
 * @param {object} data - flat event object, e.g. { step, status, ...extra }
 */
function sendUpdate(sessionId, data) {
  if (!sessionId) return Promise.resolve();
  return enqueue(sessionId, () =>
    ProgressSession.updateOne(
      { sessionId },
      {
        $push: { events: { payload: data, timestamp: new Date() } },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    )
  ).catch((err) => {
    console.error('[progressService] sendUpdate failed:', err.message);
  });
}

/**
 * Mark a session as finished. Any stream currently polling it will send
 * a final "complete" frame and end on its next poll tick. Queued behind
 * the same per-session chain so it can't be recorded before an
 * in-flight sendUpdate() for the same session.
 * @param {string} sessionId
 */
function closeSession(sessionId) {
  if (!sessionId) return Promise.resolve();
  return enqueue(sessionId, () =>
    ProgressSession.updateOne({ sessionId }, { $set: { closed: true } }, { upsert: true })
  ).catch((err) => {
    console.error('[progressService] closeSession failed:', err.message);
  });
}

/**
 * Stream a session's events to an already-SSE-headered Express response
 * by polling MongoDB. Replays everything that already happened (so a
 * client connecting late — or after the action already finished — still
 * sees the full sequence), then keeps polling for new events until the
 * session is closed, the client disconnects, or MAX_STREAM_MS elapses.
 * @param {string} sessionId
 * @param {import('express').Response} res
 */
function streamSession(sessionId, res) {
  let lastCount = 0;
  let ended = false;
  const start = Date.now();

  function write(obj) {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch (err) {
      // client gone; the close listener below will stop the poll
    }
  }

  function end() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    write({ status: 'complete' });
    try { res.end(); } catch (err) { /* already gone */ }
  }

  var timer = setInterval(async function poll() {
    if (ended) return;
    try {
      const session = await ProgressSession.findOne({ sessionId }).lean();
      if (session && session.events.length > lastCount) {
        for (let i = lastCount; i < session.events.length; i++) {
          const ev = session.events[i];
          write(Object.assign({ sessionId, timestamp: ev.timestamp ? new Date(ev.timestamp).getTime() : Date.now() }, ev.payload));
        }
        lastCount = session.events.length;
      }
      if ((session && session.closed) || Date.now() - start > MAX_STREAM_MS) {
        end();
      }
    } catch (err) {
      console.error('[progressService] poll failed:', err.message);
    }
  }, POLL_MS);

  res.on('close', function () {
    ended = true;
    clearInterval(timer);
  });
}

/**
 * Generate a unique session ID
 * @returns {string} Session ID
 */
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  sendUpdate,
  closeSession,
  streamSession,
  generateSessionId,
};
