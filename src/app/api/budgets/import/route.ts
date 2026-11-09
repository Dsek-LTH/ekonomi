// Admin only. Unreadable rows land in `problems` and sheets with no matching cost centre in `unmatchedCostCenters`, rather than failing the import.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { isAdmin } from "@/lib/domain/permissions";
import { parseBudgetCsv } from "@/lib/domain/budget-csv";
import { decodeCsvBytes } from "@/lib/domain/csv";
import { bulkTransaction } from "@/lib/server/tx";
import { fail, gate } from "@/lib/api/guard";
import { denyBudgetOutsideFiscalYear } from "@/lib/api/fiscal-year";
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
  const offYear = await denyBudgetOutsideFiscalYear(query.data.year);
  if (offYear) return offYear;

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength === 0) return fail(400, "budget.emptyFile");
  if (buf.byteLength > MAX_BYTES) return fail(413, "budget.fileTooLarge");

  const { sheets, problems } = parseBudgetCsv(decodeCsvBytes(buf));
  // Nothing readable is a failed upload, not an empty budget.
  if (sheets.length === 0) return fail(422, "budget.noRows", { extra: { problems } });

  // A code with no cost centre is not created: the sheet is imported detached (label only) and the code reported.
  // Detached sheets are left out of the Utfall comparison (lib/ledger/comparison.ts).
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
          label: costCenterId ? null : sheet.costCenterName,
          sortOrder: si,
          accounts: {
            create: sheet.accounts.map((account) => ({
              accountCode: account.code,
              accountName: account.name,
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
