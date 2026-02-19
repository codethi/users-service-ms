import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new JwtAuthGuard(reflector);
  });

  const createMockExecutionContext = (): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    }) as unknown as ExecutionContext;

  describe('canActivate', () => {
    it('should return true when route is marked as public', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockExecutionContext();

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('should call super.canActivate when route is not public', () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const context = createMockExecutionContext();

      const superCanActivate = jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).toHaveBeenCalledWith(context);

      superCanActivate.mockRestore();
    });

    it('should call super.canActivate when isPublic metadata is undefined', () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockExecutionContext();

      const superCanActivate = jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).toHaveBeenCalledWith(context);

      superCanActivate.mockRestore();
    });
  });
});
