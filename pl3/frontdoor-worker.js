// PL3 official hostname. Keep the existing operations Worker as the sole
// database, OAuth, session and scheduled-sync owner during URL migration.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== "a-little-light-for-every-day.petitelueur-pl.workers.dev") {
      return new Response("Not Found", { status: 404 });
    }
    return env.PL3_BACKEND.fetch(request);
  }
};
