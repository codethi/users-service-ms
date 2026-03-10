import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let healthController: HealthController;
  let healthCheckService: HealthCheckService;
  let typeOrmIndicator: TypeOrmHealthIndicator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn((indicators: (() => Promise<unknown>)[]) =>
              Promise.all(indicators.map((fn) => fn())).then((results) => ({
                status: 'ok',
                info: Object.assign({}, ...results),
                error: {},
                details: Object.assign({}, ...results),
              })),
            ),
          },
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: {
            pingCheck: jest.fn(),
          },
        },
      ],
    }).compile();

    healthController = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    typeOrmIndicator = module.get<TypeOrmHealthIndicator>(TypeOrmHealthIndicator);
  });

  describe('check', () => {
    it('should return healthy status when database is up', async () => {
      (typeOrmIndicator.pingCheck as jest.Mock).mockResolvedValue({
        database: { status: 'up' },
      });

      const result = await healthController.check();

      expect(result).toEqual({
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      });
      expect(typeOrmIndicator.pingCheck).toHaveBeenCalledWith('database');
    });

    it('should call HealthCheckService.check with database indicator', async () => {
      (typeOrmIndicator.pingCheck as jest.Mock).mockResolvedValue({
        database: { status: 'up' },
      });

      await healthController.check();

      expect(healthCheckService.check).toHaveBeenCalledTimes(1);
      expect(typeOrmIndicator.pingCheck).toHaveBeenCalledTimes(1);
    });

    it('should propagate error when database is down', async () => {
      const dbError = new Error('Connection refused');
      (typeOrmIndicator.pingCheck as jest.Mock).mockRejectedValue(dbError);

      (healthCheckService.check as jest.Mock).mockRejectedValue(dbError);

      await expect(healthController.check()).rejects.toThrow('Connection refused');
    });
  });
});
