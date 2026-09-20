export const dynamic = "force-dynamic";

export async function GET() {
  const url = "https://data.sec.gov/submissions/CIK0000796343.json";
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "SOLPIENT Research ngkenzy@users.noreply.github.com",
      From: "ngkenzy@users.noreply.github.com",
      "Accept-Encoding": "gzip, deflate",
      Accept: "application/json",
    },
  });

  const body = await response.text();

  return Response.json({
    ok: response.ok,
    status: response.status,
    sample: body.slice(0, 180),
  });
}
