"use client";

// Scanning a product onto a sheet, and inventing one that isn't there yet.
//
// The same errand on both sheets that have it (the stocktake event and the
// delivery), and it was written out twice, down to the state names and the
// comment on the dialog. What it is: a barcode goes to the server, a product
// comes back and lands on the sheet, and a code the cellar has never seen opens
// the product form with the barcode already in it rather than sending somebody
// to another page. That last part is the point of the whole flow: a scan that
// dead-ends is how a trolley ends up half unlogged, and it is exactly the part
// that would drift if the two copies were maintained apart.
//
// The overlay comes back as a node rather than being left to each caller, so
// the scanner and the dialog cannot be wired up two different ways either.
import { useState } from "react";
import { BarcodeScanner } from "@/components/stock/barcode-scanner";
import { ProductDialog } from "@/app/(app)/stock/product-dialog";
import { useMutation } from "@/components/shell/use-mutation";

/** A product being invented mid-sheet: what is known of it so far. */
type Naming = { name?: string; ean?: string } | null;

export function useProductScan({
  unknownError,
  knownTags,
  onScanned,
  onCreated = onScanned,
}: {
  /** Shown when the barcode matches nothing (the caller's own wording). */
  unknownError: string;
  /** The tags the shelf already uses, offered by the product form when a
   *  product is invented here. The sheet is holding the products, so it is the
   *  one that knows them. */
  knownTags?: string[];
  /** A product the scan found, for the sheet to take up. */
  onScanned: (id: string) => void;
  /**
   * A product that has just been invented. Defaults to `onScanned`, because
   * for most sheets they are the same thing: a product to put on a row.
   */
  onCreated?: (id: string) => void;
}) {
  // Its own mutation scope: a scan should not make the sheet's own save button
  // read as busy, and vice versa.
  const { mutate } = useMutation();
  const [scanning, setScanning] = useState(false);
  const [naming, setNaming] = useState<Naming>(null);

  /**
   * A barcode, turned into a row you can type into.
   *
   * Scan, type how many, scan the next: that is the whole errand, which is why
   * the caller is handed the product rather than merely told the scan worked:
   * it is what puts the caret in the box instead of leaving somebody hunting
   * for the row their scan just made.
   */
  async function lookUp(ean: string) {
    setScanning(false);
    const found = await mutate<{ id: string; name: string }>(
      `/api/stock/products/by-ean?ean=${encodeURIComponent(ean)}`,
      { key: "scan", method: "GET", refresh: false, error: unknownError },
    );
    if (!found) {
      setNaming({ ean });
      return;
    }
    onScanned(found.id);
  }

  /**
   * A product invented from a name somebody typed rather than a barcode.
   *
   * The name is all the sheet knows and a stock product needs more, so the form
   * opens with what there is rather than a half-made product appearing on a row.
   */
  const invent = (text: string) => setNaming({ name: text });

  return {
    /** Open the camera. */
    scan: () => setScanning(true),
    invent,
    /** Render once, anywhere in the page: the camera and the product form. */
    overlay: (
      <>
        {scanning && <BarcodeScanner onCode={lookUp} onCancel={() => setScanning(false)} />}
        {/* Invented on the sheet, finished here: a product needs a drink
            type, and a spirit the bottle size its rungs are fractions of. */}
        {naming !== null && (
          <ProductDialog
            product={null}
            name={naming.name}
            ean={naming.ean}
            knownTags={knownTags}
            onClose={() => setNaming(null)}
            onCreated={(id) => onCreated(id)}
          />
        )}
      </>
    ),
  };
}
