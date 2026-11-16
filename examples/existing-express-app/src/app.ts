import express from "express";

export interface Product {
  id: string;
  name: string;
}

const products: Product[] = [
  { id: "p1", name: "Coffee" },
  { id: "p2", name: "Tea" },
];

/** The shop API. Product browsing is public. */
export async function createApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/products", (_req, res) => {
    res.json({ products });
  });
  app.get("/api/products/:id", (req, res) => {
    const product = products.find((p) => p.id === req.params.id);
    if (!product) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ product });
  });

  return app;
}
