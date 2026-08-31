// POST /api/budgets/import: a past budget, from the interchange CSV.
//
// The browser POSTs the raw file; the year and the name ride along as query
// parameters (see ImportBudgetQuery). Admin only, like every other way of
// creating a budget.
//
// What comes back is as interesting as what goes in: `problems` names the rows
// that could not be read, and `unmatchedCostCenters` the sheets that landed
// detached. Both are reported rather than thrown, because an old budget that is
// 95% readable is worth having, and because the alternative, a silent partial
// import, is the failure that would matter.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { isAdmin } from "@/lib/domain/permissions";
import { parseBudgetCsv } from "@/lib/domain/budget-csv";
import { decodeCsvBytes } from "@/lib/domain/csv";
import { bulkTransaction } from "@/lib/server/tx";
import { fail, gate } from "@/lib/api/guard";
import { ImportBudgetQuery } from "@/lib/api/schemas/budget";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const g = await gate(isAdmin);
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const query = ImportBudgetQuery.safeParse({
    year: url.searchParams.get("year") ?? undefined,
    name: url.searchParams.get("name") ?? undefined,
  });
  if (!query.success) return fail(422, "budget.importBadQuery");

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength === 0) return fail(400, "budget.emptyFile");
  if (buf.byteLength > MAX_BYTES) return fail(413, "budget.fileTooLarge");

  const { sheets, problems } = parseBudgetCsv(decodeCsvBytes(buf));
  // Nothing readable at all is a failed upload, not an empty budget: creating
  // one would leave the user with a budget to delete and no idea why.
  if (sheets.length === 0) return fail(422, "budget.noRows", { extra: { problems } });

  // Sheets are linked to cost centres by code. A code with no cost centre is
  // NOT created here: a cost centre invented as a side effect of a file upload
  // would show up in every allocation dropdown in the app, so the sheet is
  // imported detached, carrying its name as a label, and the code is reported.
  // Note a detached sheet is left out of the Utfall comparison
  // (lib/ledger/comparison.ts), which is usually the reason a past budget was
  // imported at all, so this is worth surfacing loudly in the UI.
  const codes = sheets.map((s) => s.costCenterCode);
  const known = await prisma.costCenter.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const idByCode = new Map(known.map((c) => [c.code, c.id]));
  const unmatchedCostCenters = codes.filter((c) => !idByCode.has(c));

  const budget = await bulkTransaction(async (tx) => {
    const created = await tx.budget.create({
      data: { year: query.data.year, name: query.data.name, createdById: g.actor.id },
    });

    for (const [si, sheet] of sheets.entries()) {
      const costCenterId = idByCode.get(sheet.costCenterCode) ?? null;
      await tx.budgetCostCenter.create({
        data: {
          budgetId: created.id,
          costCenterId,
          // Only a detached sheet needs a label. A linked one is named by the
          // cost centre, and a second name here would be a second opinion.
          label: costCenterId ? null : sheet.costCenterName,
          sortOrder: si,
          accounts: {
            create: sheet.accounts.map((account, ai) => ({
              accountCode: account.code,
              accountName: account.name,
              sortOrder: ai,
              lineItems: {
                create: account.lines.map((line, li) => ({
                  description: line.description,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  expression: line.expression,
                  sortOrder: li,
                })),
              },
            })),
          },
        },
      });
    }
    return created;
  });

  return NextResponse.json(
    {
      budgetId: budget.id,
      sheets: sheets.length,
      accounts: sheets.reduce((n, s) => n + s.accounts.length, 0),
      lines: sheets.reduce((n, s) => n + s.accounts.reduce((m, a) => m + a.lines.length, 0), 0),
      unmatchedCostCenters,
      problems,
    },
    { status: 201 },
  );
}
