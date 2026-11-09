"use client";

// Scanning a product onto a sheet (stocktake event, delivery), and inventing one for a barcode the cellar has not seen
// by opening the product form with the barcode filled in. Returns the overlay as a node so both sheets wire it the same way.
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
  /** The tags the shelf already uses, offered by the product form when a product is invented here. */
  knownTags?: string[];
  /** A product the scan found, for the sheet to take up. */
  onScanned: (id: string) => void;
  /** A product that has just been invented. Defaults to `onScanned`. */
  onCreated?: (id: string) => void;
}) {
  // Its own mutation scope, so a scan does not make the sheet's save button read as busy.
  const { mutate } = useMutation();
  const [scanning, setScanning] = useState(false);
  const [naming, setNaming] = useState<Naming>(null);

  /** A barcode turned into a row: the caller is handed the product so it can put the caret in the box. */
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

  /** A product invented from a typed name: the form opens with it, since a stock product needs more. */
  const invent = (text: string) => setNaming({ name: text });

  return {
    scan: () => setScanning(true),
    invent,
    /** Render once, anywhere in the page: the camera and the product form. */
    overlay: (
      <>
        {scanning && <BarcodeScanner onCode={lookUp} onCancel={() => setScanning(false)} />}
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
