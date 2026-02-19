import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-jwt-secret'),
            getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  describe('validate', () => {
    it('should return user object with id mapped from sub', () => {
      const payload = {
        sub: 'uuid-123',
        email: 'test@example.com',
        role: 'buyer',
      };

      const result = strategy.validate(payload);

      expect(result).toEqual({
        id: 'uuid-123',
        email: 'test@example.com',
        role: 'buyer',
      });
    });

    it('should map sub to id correctly', () => {
      const payload = {
        sub: 'another-uuid-456',
        email: 'seller@example.com',
        role: 'seller',
      };

      const result = strategy.validate(payload);

      expect(result.id).toBe('another-uuid-456');
      expect(result).not.toHaveProperty('sub');
    });

    it('should return object with exactly id, email and role properties', () => {
      const payload = {
        sub: 'uuid-789',
        email: 'user@example.com',
        role: 'buyer',
      };

      const result = strategy.validate(payload);

      expect(Object.keys(result)).toEqual(['id', 'email', 'role']);
    });
  });
});
