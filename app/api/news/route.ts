import { google } from "googleapis";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface NewsRow {
  content: string;
  timestamp: string;
}

export async function GET() {
  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!clientEmail || !privateKey || !sheetId) {
      return NextResponse.json(
        { error: "Google Sheets environment variables are missing." },
        { status: 500 },
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!A:B",
    });

    const rows = response.data.values ?? [];
    const items: NewsRow[] = rows
      .filter((row) => row.length > 0 && String(row[0] ?? "").trim() !== "")
      .map((row) => ({
        content: String(row[0] ?? "").trim(),
        timestamp: String(row[1] ?? "").trim(),
      }))
      .reverse();

    return NextResponse.json(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load Google Sheet news: ${message}` },
      { status: 500 },
    );
  }
}
