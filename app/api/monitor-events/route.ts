import feed from "@/data/monitor/sec-events.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(feed, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
