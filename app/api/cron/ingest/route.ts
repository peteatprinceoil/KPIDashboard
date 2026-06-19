import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listMessages, getMessage } from "@/ingest/agentmail";
import { findParser } from "@/ingest/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Vercel passes CRON_SECRET in the Authorization header on scheduled runs.
  // You can also trigger manually: curl -H "Authorization: Bearer <secret>" <url>
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inboxId = process.env.AGENTMAIL_INBOX_ID;
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!inboxId || !apiKey) {
    return NextResponse.json(
      { error: "AGENTMAIL_INBOX_ID and AGENTMAIL_API_KEY must be set" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseServerClient();

  // Fetch the 50 most recent messages. Dedupe by message_id makes re-runs safe.
  const messages = await listMessages(inboxId, apiKey);

  const results: {
    id: string;
    subject: string;
    status: string;
    rows?: number;
  }[] = [];

  for (const msg of messages) {
    const msgId = msg.message_id;

    // Skip if already successfully processed
    const { data: existing } = await supabase
      .from("email_messages")
      .select("status")
      .eq("message_id", msgId)
      .maybeSingle();

    if (existing?.status === "processed") {
      results.push({ id: msgId, subject: msg.subject, status: "skipped" });
      continue;
    }

    // Claim the message (prevents double-processing on concurrent invocations)
    await supabase.from("email_messages").upsert(
      {
        message_id: msgId,
        subject: msg.subject,
        received_at: msg.timestamp,
        report_type: null,
        status: "processing",
      },
      { onConflict: "message_id" }
    );

    // Match subject to a parser
    const entry = findParser(msg.subject);
    if (!entry) {
      await supabase
        .from("email_messages")
        .update({ status: "unrecognized" })
        .eq("message_id", msgId);
      results.push({ id: msgId, subject: msg.subject, status: "unrecognized" });
      continue;
    }

    try {
      // List endpoint has no body — fetch the full message
      const fullMsg = await getMessage(inboxId, msgId, apiKey);
      const bodyText = fullMsg.text ?? "";

      const { table, rows, onConflict } = entry.parse(bodyText, fullMsg.subject);

      if (rows.length > 0) {
        const rowsWithSource = rows.map((r) => ({
          ...r,
          ingested_message_id: msgId,
        }));
        const { error: upsertErr } = await supabase
          .from(table)
          .upsert(rowsWithSource, { onConflict });
        if (upsertErr) throw upsertErr;
      }

      await supabase
        .from("email_messages")
        .update({ status: "processed", report_type: entry.reportType })
        .eq("message_id", msgId);

      results.push({ id: msgId, subject: msg.subject, status: "processed", rows: rows.length });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("email_messages")
        .update({ status: "error", error: errMsg })
        .eq("message_id", msgId);
      results.push({ id: msgId, subject: msg.subject, status: `error: ${errMsg}` });
    }
  }

  return NextResponse.json({
    processed: results.filter((r) => r.status === "processed").length,
    total: messages.length,
    results,
  });
}
