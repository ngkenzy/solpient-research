import { NextResponse } from "next/server";

import { databaseConfigured, dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        mode: "fallback",
        message: "SOLPIENT_DATABASE_URL is not configured.",
      },
      { status: 503 },
    );
  }

  try {
    const [row] = await dbQuery<{
      database: string;
      companies: number;
      postgres_version: string;
      date_sample: string;
      timestamp_sample: string;
    } & Record<string, unknown>>(`
      select
        current_database() as database,
        (select count(*)::int from public.companies) as companies,
        current_setting('server_version') as postgres_version,
        current_date as date_sample,
        now() as timestamp_sample
    `);

    return NextResponse.json({
      ok: true,
      mode: "postgres",
      database: row?.database ?? null,
      companies: row?.companies ?? null,
      postgresVersion: row?.postgres_version ?? null,
      dateSample: row?.date_sample ?? null,
      dateType: typeof row?.date_sample,
      timestampSample: row?.timestamp_sample ?? null,
      timestampType: typeof row?.timestamp_sample,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode: "postgres",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
