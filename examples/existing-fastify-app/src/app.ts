import Fastify, { type FastifyInstance } from "fastify";

export interface Product {
  id: string;
  name: string;
}

const products: Product[] = [
  { id: "p1", name: "Coffee" },
  { id: "p2", name: "Tea" },
];

/** The shop API. Product browsing is public. */
export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify();

  app.get("/health", async () => ({ ok: true }));
  app.get("/api/products", async () => ({ products }));
  app.get("/api/products/:id", async (req, reply) => {
    const product = products.find((p) => p.id === (req.params as { id: string }).id);
    if (!product) return reply.code(404).send({ error: "not found" });
    return { product };
  });

  return app;
}
