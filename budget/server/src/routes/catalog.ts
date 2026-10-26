import type { FastifyInstance } from 'fastify';
import {
  categoryCreateSchema,
  categoryMergeSchema,
  categoryUpdateSchema,
  groupCreateSchema,
  groupUpdateSchema,
  reorderSchema,
  subcategoryCreateSchema,
  subcategoryUpdateSchema,
} from '@budget/shared';
import { thisMonth, type AppContext } from '../context.js';
import { parse } from '../http.js';
import {
  createCategory,
  createGroup,
  createSubcategory,
  getCatalog,
  mergeCategories,
  reorder,
  updateCategory,
  updateGroup,
  updateSubcategory,
} from '../services/catalog.js';
import { syncOpenMonths } from '../services/months.js';

export function catalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const sync = (overwrite: boolean): void => syncOpenMonths(db, thisMonth(ctx), { overwrite });

  app.get('/api/catalog', async () => getCatalog(db));

  app.post('/api/groups', async (req, reply) => {
    const { name } = parse(groupCreateSchema, req.body);
    return reply.status(201).send({ id: createGroup(db, name) });
  });

  app.patch<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
    updateGroup(db, req.params.id, parse(groupUpdateSchema, req.body));
    sync(false);
    return { ok: true };
  });

  app.post('/api/categories', async (req, reply) => {
    const id = createCategory(db, parse(categoryCreateSchema, req.body));
    sync(false);
    return reply.status(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const patch = parse(categoryUpdateSchema, req.body);
    updateCategory(db, req.params.id, patch);
    // A new template amount applies to the current and future months, never to past ones.
    sync(patch.plannedCents !== undefined);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/categories/:id/merge', async (req) => {
    const { intoCategoryId } = parse(categoryMergeSchema, req.body);
    mergeCategories(db, req.params.id, intoCategoryId);
    return { ok: true };
  });

  app.post('/api/subcategories', async (req, reply) => {
    const id = createSubcategory(db, parse(subcategoryCreateSchema, req.body));
    sync(true);
    return reply.status(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>('/api/subcategories/:id', async (req) => {
    const patch = parse(subcategoryUpdateSchema, req.body);
    updateSubcategory(db, req.params.id, patch);
    sync(patch.plannedCents !== undefined);
    return { ok: true };
  });

  app.post('/api/catalog/reorder', async (req) => {
    const { kind, ids } = parse(reorderSchema, req.body);
    reorder(db, kind, ids);
    return { ok: true };
  });
}
