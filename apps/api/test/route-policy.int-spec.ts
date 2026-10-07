import { type INestApplication, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { isPermission } from '@smartcode/shared';
import { AUTHENTICATED_ONLY_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/core/auth/decorators';
import { createTestApp } from './helpers';

/**
 * Deny-by-default enforcement: every route registered in the real application must declare an access policy
 * (@Public, @AuthenticatedOnly or @RequirePermission with known permissions). New modules can't forget it.
 */
describe('route access policies', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('every route declares a policy', () => {
    const discovery = new DiscoveryService(app.get(ModulesContainer));
    const reflector = app.get(Reflector);
    const scanner = new MetadataScanner();
    const routes: string[] = [];
    const missing: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, (...args: unknown[]) => unknown>;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name]!;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const id = `${method} ${metatype.name}.${name}`;
        routes.push(id);
        const targets = [handler, metatype];
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        const authOnly = reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets);
        const perms = reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
        if (perms?.some((p) => !isPermission(p))) missing.push(`${id} (unknown permission)`);
        if (!isPublic && !authOnly && !perms?.length) missing.push(id);
      }
    }

    expect(routes.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
